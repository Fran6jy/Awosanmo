import { createRequire } from "node:module";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, migrate } from "../db/schema.js";
import {
  completeTwoFactorLogin,
  disableTotp,
  enableTotp,
  issueRefreshToken,
  login,
  register,
  rotateRefresh,
  setupTotp,
} from "../modules/auth/auth.js";

const otplib = createRequire(import.meta.url)("otplib") as { generate: (o: { secret: string }) => Promise<string> | string };
const codeFor = async (secret: string) => String(await otplib.generate({ secret }));

function clearDb() {
  for (const t of ["refresh_tokens", "wishlist", "folders", "files", "torrents", "users"]) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
}

beforeAll(() => migrate());
beforeEach(() => clearDb());

describe("registration & login", () => {
  it("registers a new user and returns a session", async () => {
    const session = await register("alice@x.com", "password123");
    expect(session).not.toBeNull();
    expect(session!.token).toBeTypeOf("string");
    expect(session!.refreshToken).toBeTypeOf("string");
  });

  it("rejects a duplicate email", async () => {
    await register("alice@x.com", "password123");
    expect(await register("alice@x.com", "password123")).toBeNull();
  });

  it("logs in with correct credentials and rejects wrong ones", async () => {
    await register("bob@x.com", "password123");
    expect(await login("bob@x.com", "wrongpass")).toBeNull();
    const ok = await login("bob@x.com", "password123");
    expect(ok).not.toBeNull();
    expect("token" in ok!).toBe(true);
  });
});

describe("refresh tokens", () => {
  it("rotates and invalidates the previous refresh token", async () => {
    const { id } = (await register("carol@x.com", "password123")) as any;
    void id;
    const user = db.prepare("SELECT id FROM users WHERE email = ?").get("carol@x.com") as any;
    const rt = issueRefreshToken(user.id);
    const rotated = rotateRefresh(rt);
    expect(rotated).not.toBeNull();
    expect(rotated!.refreshToken).not.toEqual(rt);
    // The original token can no longer be used after rotation.
    expect(rotateRefresh(rt)).toBeNull();
  });

  it("rejects a garbage refresh token", () => {
    expect(rotateRefresh("not-a-jwt")).toBeNull();
  });
});

describe("two-factor authentication", () => {
  it("enrolls, requires a code at login, and can be disabled", async () => {
    await register("dave@x.com", "password123");
    const user = db.prepare("SELECT id FROM users WHERE email = ?").get("dave@x.com") as any;

    const setup = await setupTotp(user.id);
    expect(setup?.secret).toBeTypeOf("string");

    // Enabling requires a valid current code.
    expect(await enableTotp(user.id, "000000")).toBe(false);
    expect(await enableTotp(user.id, await codeFor(setup!.secret))).toBe(true);

    // Login now returns a challenge instead of tokens.
    const challenge = (await login("dave@x.com", "password123")) as any;
    expect(challenge.twoFactorRequired).toBe(true);
    expect(challenge.ticket).toBeTypeOf("string");

    // Wrong code fails; correct code yields a session.
    expect(await completeTwoFactorLogin(challenge.ticket, "000000")).toBeNull();
    const session = await completeTwoFactorLogin(challenge.ticket, await codeFor(setup!.secret));
    expect(session).not.toBeNull();

    // Disable requires a code; afterwards login is single-step again.
    expect(await disableTotp(user.id, await codeFor(setup!.secret))).toBe(true);
    const plain = (await login("dave@x.com", "password123")) as any;
    expect(plain.token).toBeTypeOf("string");
  });
});
