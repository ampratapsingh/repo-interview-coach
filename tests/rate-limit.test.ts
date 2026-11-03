import { describe, expect, it } from "vitest";
import { consumeAiRateLimit } from "../lib/rate-limit";

describe("AI rate limiting", () => {
  it("limits each authenticated user and resets after the window", () => {
    const user = `user-${Math.random()}`;
    for (let index = 0; index < 12; index++) expect(consumeAiRateLimit(user, 1_000).allowed).toBe(true);
    expect(consumeAiRateLimit(user, 1_000).allowed).toBe(false);
    expect(consumeAiRateLimit(user, 10 * 60 * 1_000 + 1_000).allowed).toBe(true);
  });
});
