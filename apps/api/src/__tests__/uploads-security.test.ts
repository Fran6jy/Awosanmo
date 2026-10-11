import { describe, expect, it } from "vitest";
import { isPublicAddress, pinnedLookup } from "../modules/uploads/routes.js";

describe("add-by-URL address validation", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
  ])("rejects non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])("accepts public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe("add-by-URL pinned DNS lookup", () => {
  const target = { address: "1.1.1.1", family: 4 };

  it("returns an address array when Node requests all results", () => {
    let result: unknown;
    pinnedLookup(target)("example.com", { all: true }, (_error: unknown, addresses: unknown) => { result = addresses; });
    expect(result).toEqual([target]);
  });

  it("returns the legacy scalar callback shape otherwise", () => {
    let result: unknown;
    pinnedLookup(target)("example.com", {}, (_error: unknown, address: unknown, family: unknown) => { result = { address, family }; });
    expect(result).toEqual(target);
  });
});
