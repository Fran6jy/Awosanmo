import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import type { Request, Response } from "express";
import { getDiskPath, getOwnedFile } from "./fileService.js";

// archiver is CommonJS; load it via createRequire so Node's ESM loader doesn't
// choke on the missing default export.
const require = createRequire(import.meta.url);
const archiver = require("archiver") as (format: string, options?: any) => any;

type Ticket = { ids: string[]; userId: string; expires: number };

// Short-lived tickets let the browser download a zip by plain navigation (no
// Authorization header), the same pattern used for stream/download tokens.
const tickets = new Map<string, Ticket>();
const TTL_MS = 5 * 60 * 1000;

export function createZipTicket(ids: string[], userId: string): string {
  const token = crypto.randomBytes(24).toString("hex");
  tickets.set(token, { ids, userId, expires: Date.now() + TTL_MS });
  return token;
}

function takeTicket(token: string): Ticket | null {
  const ticket = tickets.get(token);
  if (!ticket) return null;
  if (Date.now() > ticket.expires) {
    tickets.delete(token);
    return null;
  }
  return ticket;
}

// Periodically drop expired tickets so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [token, ticket] of tickets) if (now > ticket.expires) tickets.delete(token);
}, TTL_MS).unref();

export function zipDownload(req: Request, res: Response) {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const ticket = takeTicket(token);
  if (!ticket) return res.status(401).json({ error: "Invalid or expired zip token" });
  const { ids, userId } = ticket;

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="awosanmo-${Date.now()}.zip"`);

  const archive = archiver("zip", { zlib: { level: 3 } });
  archive.on("error", () => {
    if (!res.headersSent) res.status(500);
    res.end();
  });
  archive.pipe(res);

  const seen = new Set<string>();
  for (const id of ids) {
    const file = getOwnedFile(id, userId);
    if (!file) continue;
    const disk = getDiskPath(file);
    if (!fs.existsSync(disk)) continue;
    // De-duplicate names inside the archive.
    let entryName = file.name as string;
    let n = 1;
    while (seen.has(entryName)) {
      const dot = (file.name as string).lastIndexOf(".");
      entryName = dot > 0 ? `${(file.name as string).slice(0, dot)} (${n})${(file.name as string).slice(dot)}` : `${file.name} (${n})`;
      n += 1;
    }
    seen.add(entryName);
    archive.file(disk, { name: entryName });
  }
  archive.finalize();
}
