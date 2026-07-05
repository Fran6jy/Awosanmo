import { Router } from "express";
import { z } from "zod";
import { deleteFile, getFile, listFiles, renameFile } from "./fileService.js";
import { moveFiles } from "../folders/folderService.js";
import { createZipTicket } from "./zipController.js";

const renameSchema = z.object({ name: z.string().min(1).max(180) });
const bulkSchema = z.object({ ids: z.array(z.string()).min(1).max(500) });
const moveSchema = z.object({ ids: z.array(z.string()).min(1).max(500), folderId: z.string().nullable() });
export const fileRoutes = Router();

fileRoutes.get("/", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const folderParam = req.query.folderId;
  const folderId = folderParam === undefined ? undefined : folderParam === "root" ? null : String(folderParam);
  res.json(listFiles(q, folderId));
});

fileRoutes.get("/:id", (req, res) => {
  const file = getFile(req.params.id);
  if (!file) return res.status(404).json({ error: "File not found" });
  res.json(file);
});

fileRoutes.post("/bulk-delete", (req, res) => {
  const body = bulkSchema.parse(req.body);
  let deleted = 0;
  for (const id of body.ids) {
    if (deleteFile(id)) deleted += 1;
  }
  res.json({ deleted });
});

fileRoutes.post("/move", (req, res) => {
  const body = moveSchema.parse(req.body);
  try {
    res.json({ moved: moveFiles(body.ids, body.folderId) });
  } catch (e: any) {
    res.status(400).json({ error: e.message ?? "Move failed" });
  }
});

fileRoutes.post("/zip-token", (req, res) => {
  const body = bulkSchema.parse(req.body);
  res.json({ zipToken: createZipTicket(body.ids) });
});

fileRoutes.patch("/:id", (req, res) => {
  const body = renameSchema.parse(req.body);
  try {
    const file = renameFile(req.params.id, body.name);
    if (!file) return res.status(404).json({ error: "File not found" });
    res.json(file);
  } catch (error: any) {
    res.status(400).json({ error: error.message ?? "Invalid filename" });
  }
});

fileRoutes.delete("/:id", (req, res) => {
  if (!deleteFile(req.params.id)) return res.status(404).json({ error: "File not found" });
  res.sendStatus(204);
});
