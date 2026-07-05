export type PreviewKind = "video" | "audio" | "image" | "pdf" | "text" | "epub" | "file";

const imageExt = new Set([".avif", ".bmp", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
const audioExt = new Set([".aac", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".opus", ".wav", ".weba"]);
const videoExt = new Set([".m4v", ".mkv", ".mov", ".mp4", ".mpeg", ".mpg", ".ogv", ".webm"]);
const textExt = new Set([".csv", ".log", ".md", ".nfo", ".srt", ".txt", ".vtt"]);

export function extname(name: string) {
  const match = name.toLowerCase().match(/\.[^.]+$/);
  return match?.[0] ?? "";
}

export function previewKind(file: { name: string; mime?: string | null; media_kind?: string | null }): PreviewKind {
  const mime = file.mime ?? "";
  const ext = extname(file.name);
  if (file.media_kind === "video" || mime.startsWith("video/") || videoExt.has(ext)) return "video";
  if (file.media_kind === "audio" || mime.startsWith("audio/") || audioExt.has(ext)) return "audio";
  if (file.media_kind === "image" || mime.startsWith("image/") || imageExt.has(ext)) return "image";
  if (mime === "application/pdf" || ext === ".pdf") return "pdf";
  if (mime.includes("epub") || ext === ".epub") return "epub";
  if (mime.startsWith("text/") || textExt.has(ext)) return "text";
  return "file";
}

export function canPreview(file: { name: string; mime?: string | null; media_kind?: string | null }) {
  return previewKind(file) !== "file";
}
