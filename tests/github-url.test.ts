import { describe, expect, it } from "vitest";
import { parseGitHubUrl } from "../lib/github-url";

describe("parseGitHubUrl", () => {
  it("normalizes a canonical public repository URL", () => {
    expect(parseGitHubUrl("https://github.com/openai/openai-node.git")).toEqual({ owner: "openai", repository: "openai-node" });
  });

  it.each([
    "https://gitlab.com/openai/openai-node",
    "https://github.com/openai/openai-node/tree/main",
    "https://github.com/openai/openai-node/pull/1",
    "not-a-url",
  ])("rejects unsupported input: %s", (value) => expect(() => parseGitHubUrl(value)).toThrow());
});

