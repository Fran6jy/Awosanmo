import { Router } from "express";
import { z } from "zod";
import { deleteFile, listFiles, renameFile } from "./fileService.js";

const renameSchema = z.object({ name: z.string().min(1).max(180) });
const bulkSchema = z.object({ ids: z.array(z.string()).min(1).max(500) });
export const fileRoutes = Router();

fileRoutes.get("/", (req, res) => {
  res.json(listFiles(typeof req.query.q === "string" ? req.query.q : undefined));
});

fileRoutes.post("/bulk-delete", (req, res) => {
  const body = bulkSchema.parse(req.body);
  let deleted = 0;
  for (const id of body.ids) {
    if (deleteFile(id)) deleted += 1;
  }
  res.json({ deleted });
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
