export async function readClipboardMagnet() {
  if (!window.isSecureContext || !navigator.clipboard?.readText) return null;

  try {
    const text = (await navigator.clipboard.readText()).trim();
    return text.startsWith("magnet:") ? text : null;
  } catch {
    return null;
  }
}
