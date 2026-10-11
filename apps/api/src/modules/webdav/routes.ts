import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Router } from "express";
import mime from "mime-types";
import { config } from "../../config.js";
import { db } from "../../db/schema.js";
import { authenticateWebdav } from "./credentials.js";
import { copyFolder, createFolder, deleteFolder, listFolders, moveFolder, renameFolder } from "../folders/folderService.js";
import { copyFiles, deleteFile, renameFile, resolveDiskPath } from "../files/fileService.js";
import { commitQuotaReservation, releaseQuota, reserveQuota } from "../storage/storageService.js";
import { torrentService, uploadsDirFor } from "../torrents/torrentService.js";

type Node = { kind: "root" } | { kind: "folder"; value: any } | { kind: "file"; value: any };
export const webdavRoutes = Router();

webdavRoutes.use(async (req: any, res, next) => {
  if (req.method === "OPTIONS") return next();
  const raw = req.headers.authorization;
  if (!raw?.startsWith("Basic ")) return challenge(res);
  try {
    const decoded = Buffer.from(raw.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 1) return challenge(res);
    const user = await authenticateWebdav(decoded.slice(0, separator), decoded.slice(separator + 1));
    if (!user) return challenge(res);
    req.webdavUser = user;
    next();
  } catch { return challenge(res); }
});

webdavRoutes.use(async (req: any, res) => {
  res.setHeader("DAV", "1, 2");
  res.setHeader("MS-Author-Via", "DAV");
  if (req.method === "OPTIONS") return res.status(204).setHeader("Allow", "OPTIONS, PROPFIND, GET, HEAD, PUT, MKCOL, DELETE, MOVE, COPY, LOCK, UNLOCK").end();
  try {
    const segments = segmentsFor(req.path);
    const node = resolveNode(req.webdavUser.id, segments);
    if (req.method === "PROPFIND") return propfind(req, res, node, segments);
    if (req.method === "GET" || req.method === "HEAD") return sendFile(req, res, node);
    if (req.method === "MKCOL") return mkcol(res, req.webdavUser.id, segments, node);
    if (req.method === "PUT") return await put(req, res, req.webdavUser.id, segments, node);
    if (req.method === "DELETE") return remove(res, req.webdavUser.id, node);
    if (req.method === "MOVE") return move(req, res, req.webdavUser.id, segments, node);
    if (req.method === "COPY") return copy(req, res, req.webdavUser.id, node);
    if (req.method === "LOCK") return lock(req, res);
    if (req.method === "UNLOCK") return res.status(204).end();
    res.status(405).setHeader("Allow", "OPTIONS, PROPFIND, GET, HEAD, PUT, MKCOL, DELETE, MOVE").end();
  } catch (error: any) {
    res.status(error.status ?? 500).type("text/plain").send(error.message ?? "WebDAV request failed");
  }
});

function challenge(res: any) { return res.status(401).setHeader("WWW-Authenticate", 'Basic realm="Awosanmo WebDAV", charset="UTF-8"').end(); }
function fail(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }
function segmentsFor(value: string) {
  const segments = value.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  if (segments.some((part) => !part || part === "." || part === ".." || /[\\/\0]/.test(part))) fail(400, "Invalid path");
  return segments;
}
function findFolder(userId: string, parentId: string | null, name: string) {
  return parentId === null
    ? db.prepare("SELECT * FROM folders WHERE user_id = ? AND parent_id IS NULL AND name = ?").get(userId, name) as any
    : db.prepare("SELECT * FROM folders WHERE user_id = ? AND parent_id = ? AND name = ?").get(userId, parentId, name) as any;
}
function findFile(userId: string, folderId: string | null, name: string) {
  return folderId === null
    ? db.prepare("SELECT * FROM files WHERE user_id = ? AND folder_id IS NULL AND selected = 1 AND name = ?").get(userId, name) as any
    : db.prepare("SELECT * FROM files WHERE user_id = ? AND folder_id = ? AND selected = 1 AND name = ?").get(userId, folderId, name) as any;
}
function resolveNode(userId: string, segments: string[]): Node | null {
  if (!segments.length) return { kind: "root" };
  let parent: string | null = null;
  for (let index = 0; index < segments.length; index += 1) {
    const folder = findFolder(userId, parent, segments[index]);
    if (folder) { parent = folder.id; if (index === segments.length - 1) return { kind: "folder", value: folder }; continue; }
    if (index === segments.length - 1) { const file = findFile(userId, parent, segments[index]); if (file) return { kind: "file", value: file }; }
    return null;
  }
  return null;
}
function parentFor(userId: string, segments: string[]) {
  const parent = resolveNode(userId, segments.slice(0, -1));
  if (!parent || parent.kind === "file") fail(409, "Parent folder not found");
  return parent.kind === "folder" ? parent.value.id as string : null;
}
function children(userId: string, node: Node) {
  const folderId = node.kind === "folder" ? node.value.id : null;
  const folders = listFolders(folderId, userId).map((value) => ({ kind: "folder", value }) as Node);
  const files = folderId === null
    ? db.prepare("SELECT * FROM files WHERE user_id = ? AND folder_id IS NULL AND selected = 1 ORDER BY name").all(userId) as any[]
    : db.prepare("SELECT * FROM files WHERE user_id = ? AND folder_id = ? AND selected = 1 ORDER BY name").all(userId, folderId) as any[];
  return [...folders, ...files.map((value) => ({ kind: "file", value }) as Node)];
}
function propfind(req: any, res: any, node: Node | null, segments: string[]) {
  if (!node) return res.status(404).end();
  const entries = [{ node, segments }];
  if (req.headers.depth !== "0" && node.kind !== "file") for (const child of children(req.webdavUser.id, node)) {
    if (child.kind !== "root") entries.push({ node: child, segments: [...segments, child.value.name] });
  }
  const body = entries.map(({ node: item, segments: itemSegments }) => responseXml(req, item, itemSegments)).join("");
  res.status(207).type("application/xml; charset=utf-8").send(`<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${body}</D:multistatus>`);
}
function responseXml(req: any, node: Node, segments: string[]) {
  const isCollection = node.kind !== "file";
  const name = node.kind === "root" ? "Awosanmo" : node.value.name;
  const href = `${req.baseUrl}/${segments.map((part: string) => encodeURIComponent(part)).join("/")}${isCollection ? "/" : ""}`.replace(/\/+/g, "/");
  const size = node.kind === "file" ? Number(node.value.size) : 0;
  const modified = new Date(node.kind === "root" ? Date.now() : node.value.created_at).toUTCString();
  return `<D:response><D:href>${xml(href)}</D:href><D:propstat><D:prop><D:displayname>${xml(name)}</D:displayname><D:resourcetype>${isCollection ? "<D:collection/>" : ""}</D:resourcetype><D:getcontentlength>${size}</D:getcontentlength><D:getcontenttype>${node.kind === "file" ? xml(node.value.mime || "application/octet-stream") : "httpd/unix-directory"}</D:getcontenttype><D:getlastmodified>${modified}</D:getlastmodified><D:getetag>\"${node.kind === "file" ? `${node.value.id}-${node.value.size}` : name}\"</D:getetag></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
}
function xml(value: unknown) { return String(value).replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!); }

function sendFile(req: any, res: any, node: Node | null) {
  if (!node) return res.status(404).end();
  if (node.kind !== "file") return res.status(405).end();
  const diskPath = resolveDiskPath(node.value);
  if (!fs.existsSync(diskPath)) return res.status(404).end();
  const size = fs.statSync(diskPath).size;
  res.setHeader("Accept-Ranges", "bytes"); res.setHeader("Content-Type", node.value.mime || mime.lookup(node.value.name) || "application/octet-stream");
  const range = String(req.headers.range ?? "").match(/^bytes=(\d*)-(\d*)$/);
  let start = 0, end = size - 1;
  if (range) { start = range[1] ? Number(range[1]) : 0; end = range[2] ? Math.min(Number(range[2]), end) : end; if (start > end) return res.status(416).setHeader("Content-Range", `bytes */${size}`).end(); res.status(206).setHeader("Content-Range", `bytes ${start}-${end}/${size}`); }
  res.setHeader("Content-Length", String(end - start + 1));
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(diskPath, { start, end }).pipe(res);
}
function mkcol(res: any, userId: string, segments: string[], existing: Node | null) {
  if (existing) return res.status(405).end();
  if (!segments.length) return res.status(405).end();
  createFolder(segments.at(-1)!, parentFor(userId, segments), userId);
  return res.status(201).end();
}
async function put(req: any, res: any, userId: string, segments: string[], existing: Node | null) {
  if (!segments.length || existing?.kind === "folder") return res.status(409).end();
  const length = Number(req.headers["content-length"]);
  if (!Number.isSafeInteger(length) || length < 0) return res.status(411).end();
  if (length > config.maxUploadBytes) return res.status(413).end();
  const oldSize = existing?.kind === "file" ? Number(existing.value.size) : 0;
  const reservationId = crypto.randomUUID();
  const dir = uploadsDirFor(userId); fs.mkdirSync(dir, { recursive: true });
  const relativeName = path.join("webdav", crypto.randomUUID(), segments.at(-1)!);
  const diskPath = path.join(dir, relativeName); fs.mkdirSync(path.dirname(diskPath), { recursive: true });
  try {
    reserveQuota(userId, reservationId, Math.max(0, length - oldSize));
    await pipeline(req, fs.createWriteStream(diskPath));
    if (fs.statSync(diskPath).size !== length) fail(400, "Incomplete upload");
    const folderId = parentFor(userId, segments);
    const record = commitQuotaReservation(reservationId, userId, () => torrentService.registerUpload({ relativeName, displayName: segments.at(-1)!, size: length, folderId }, userId));
    if (existing?.kind === "file") deleteFile(existing.value.id, userId);
    return res.status(existing ? 204 : 201).setHeader("ETag", `\"${record.id}-${length}\"`).end();
  } catch (error) { releaseQuota(reservationId, userId); fs.rmSync(path.dirname(diskPath), { recursive: true, force: true }); throw error; }
}
function remove(res: any, userId: string, node: Node | null) {
  if (!node || node.kind === "root") return res.status(node ? 403 : 404).end();
  if (node.kind === "file") deleteFile(node.value.id, userId); else deleteFolderTree(node.value.id, userId);
  return res.status(204).end();
}
function deleteFolderTree(folderId: string, userId: string) {
  const ids: string[] = []; const stack = [folderId];
  while (stack.length) {
    const current = stack.pop()!; ids.push(current);
    for (const child of listFolders(current, userId)) stack.push(child.id);
  }
  for (const id of ids) {
    const files = db.prepare("SELECT id FROM files WHERE user_id = ? AND folder_id = ? AND selected = 1").all(userId, id) as { id: string }[];
    for (const file of files) deleteFile(file.id, userId);
  }
  deleteFolder(folderId, userId);
}
function move(req: any, res: any, userId: string, segments: string[], node: Node | null) {
  if (!node || node.kind === "root") return res.status(404).end();
  const destination = req.headers.destination;
  if (typeof destination !== "string") return res.status(400).end();
  const url = new URL(destination, `${req.protocol}://${req.get("host")}`);
  if (url.host !== req.get("host") || !url.pathname.startsWith(req.baseUrl)) return res.status(502).end();
  const targetSegments = segmentsFor(url.pathname.slice(req.baseUrl.length));
  if (!targetSegments.length || resolveNode(userId, targetSegments)) return res.status(412).end();
  const targetParent = parentFor(userId, targetSegments); const targetName = targetSegments.at(-1)!;
  if (node.kind === "file") { db.prepare("UPDATE files SET folder_id = ? WHERE id = ? AND user_id = ?").run(targetParent, node.value.id, userId); renameFile(node.value.id, targetName, userId); }
  else { moveFolder(node.value.id, targetParent, userId); renameFolder(node.value.id, targetName, userId); }
  return res.status(201).setHeader("Location", `${req.baseUrl}/${targetSegments.map(encodeURIComponent).join("/")}`).end();
}
function copy(req: any, res: any, userId: string, node: Node | null) {
  if (!node || node.kind === "root") return res.status(404).end();
  const target = destinationFor(req, userId);
  if (resolveNode(userId, target.segments)) return res.status(412).end();
  if (node.kind === "folder") {
    const created = copyFolder(node.value.id, target.parentId, userId);
    if (!created) return res.status(404).end();
    renameFolder(created.id, target.name, userId);
  } else {
    const before = new Set((db.prepare("SELECT id FROM files WHERE user_id = ?").all(userId) as { id: string }[]).map((item) => item.id));
    copyFiles([node.value.id], target.parentId, userId, { preserveName: true });
    const created = (db.prepare("SELECT id FROM files WHERE user_id = ? ORDER BY created_at DESC").all(userId) as { id: string }[]).find((item) => !before.has(item.id));
    if (!created) fail(500, "Copy failed");
    renameFile(created.id, target.name, userId);
  }
  return res.status(201).end();
}
function destinationFor(req: any, userId: string) {
  const destination = req.headers.destination;
  if (typeof destination !== "string") fail(400, "Missing destination");
  const url = new URL(destination, `${req.protocol}://${req.get("host")}`);
  if (url.host !== req.get("host") || !url.pathname.startsWith(req.baseUrl)) fail(502, "Invalid destination");
  const segments = segmentsFor(url.pathname.slice(req.baseUrl.length));
  if (!segments.length) fail(403, "Invalid destination");
  return { segments, parentId: parentFor(userId, segments), name: segments.at(-1)! };
}
function lock(req: any, res: any) {
  const token = `opaquelocktoken:${crypto.randomUUID()}`;
  res.status(200).setHeader("Lock-Token", `<${token}>`).type("application/xml").send(`<?xml version="1.0"?><D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:depth>infinity</D:depth><D:timeout>Second-3600</D:timeout><D:locktoken><D:href>${token}</D:href></D:locktoken></D:activelock></D:lockdiscovery></D:prop>`);
}
