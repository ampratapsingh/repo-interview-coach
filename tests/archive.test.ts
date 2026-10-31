import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { inspectZip } from "../lib/archive";

describe("ZIP archive preflight", () => {
  it("counts entries and uncompressed bytes before extraction", () => {
    const bytes = zipSync({ "repo/index.ts": new TextEncoder().encode("export const value = 1;") });
    expect(inspectZip(bytes)).toEqual({ entries: 1, uncompressedBytes: 23 });
  });

  it("rejects malformed input", () => {
    expect(() => inspectZip(new Uint8Array([1, 2, 3]))).toThrow(/valid ZIP/);
  });
});

