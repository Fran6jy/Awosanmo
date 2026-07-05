import { createRequire } from "node:module";

// otplib v13 and qrcode are CommonJS; load via createRequire for reliable interop.
const require = createRequire(import.meta.url);
const otplib = require("otplib") as {
  generateSecret: () => string;
  generate: (opts: { secret: string }) => Promise<string> | string;
  verify: (opts: { token: string; secret: string }) => Promise<{ valid: boolean }> | { valid: boolean };
  generateURI: (opts: { secret: string; label: string; issuer: string }) => Promise<string> | string;
};
const qrcode = require("qrcode") as { toDataURL: (text: string) => Promise<string> };

export function generateSecret(): string {
  return otplib.generateSecret();
}

export async function otpauthUri(secret: string, label: string): Promise<string> {
  return await otplib.generateURI({ secret, label, issuer: "Awosanmo" });
}

export async function qrDataUrl(otpauth: string): Promise<string> {
  return await qrcode.toDataURL(otpauth);
}

/** Verify a 6-digit code against a secret (tolerant of the async API). */
export async function verifyTotp(token: string, secret: string): Promise<boolean> {
  const clean = String(token).replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const result = await otplib.verify({ token: clean, secret });
  return Boolean(result?.valid);
}
