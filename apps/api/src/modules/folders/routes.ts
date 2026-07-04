import { Router } from "express";
import { z } from "zod";
import { createFolder, deleteFolder, folderPath, listFolders, renameFolder } from "./folderService.js";

const createSchema = z.object({ name: z.string().min(1).max(120), parentId: z.string().nullable().optional() });
const renameSchema = z.object({ name: z.string().min(1).max(120) });

export const folderRoutes = Router();

// List folders in a parent (parent=root or a folder id) plus the breadcrumb.
// With ?all=1 return a flat list of every folder (used by the move picker).
folderRoutes.get("/", (req, res) => {
  if (req.query.all === "1") return res.json({ folders: listFolders(undefined), breadcrumb: [] });
  const parent = typeof req.query.parent === "string" && req.query.parent !== "root" ? req.query.parent : null;
  res.json({
    folders: listFolders(parent),
    breadcrumb: parent ? folderPath(parent) : [],
  });
});

folderRoutes.post("/", (req, res) => {
  const body = createSchema.parse(req.body);
  try {
    res.status(201).json(createFolder(body.name, body.parentId ?? null));
  } catch (e: any) {
    res.status(400).json({ error: e.message ?? "Could not create folder" });
  }
});

folderRoutes.patch("/:id", (req, res) => {
  const body = renameSchema.parse(req.body);
  const folder = renameFolder(req.params.id, body.name);
  if (!folder) return res.status(404).json({ error: "Folder not found" });
  res.json(folder);
});

folderRoutes.delete("/:id", (req, res) => {
  if (!deleteFolder(req.params.id)) return res.status(404).json({ error: "Folder not found" });
  res.sendStatus(204);
});
