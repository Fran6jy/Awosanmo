export function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

export function formatEta(seconds?: number | null) {
  if (!seconds || seconds < 0) return "Unknown";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  return `${Math.ceil(seconds / 3600)}h`;
}

export function formatDuration(seconds?: number | null) {
  if (!seconds || seconds < 0) return null;
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const rest = rounded % 60;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m ${rest}s`;
}
