/**
 * Identity for this player instance. Per tab (sessionStorage), because two tabs
 * are two players as far as "what is playing where" is concerned -- exactly the
 * case where you want the second tab to know the first is already playing.
 */
function makeId() {
  return (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).replace(/-/g, "").slice(0, 32);
}

export const deviceId: string = (() => {
  try {
    const k = "jy.device";
    let id = sessionStorage.getItem(k);
    if (!id) { id = makeId(); sessionStorage.setItem(k, id); }
    return id;
  } catch { return makeId(); }
})();

export const deviceName: string = (() => {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "device";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const pwa = window.matchMedia?.("(display-mode: standalone)").matches;
  return pwa ? `JYMusic on ${os}` : `${browser} on ${os}`;
})();
