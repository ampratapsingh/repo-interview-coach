import { describe, expect, it } from "vitest";
import { analyzeFiles } from "../lib/analyzer";
import { evaluateAnswer, planQuestions } from "../lib/question-engine";
import { selectEvidenceForQuestion } from "../lib/repo-qa";
import { newRepoChat, repoKey } from "../lib/repo-chat";
import type { ParsedFile, RepoIdentity } from "../lib/domain";

const identity: RepoIdentity = { owner: "student", repository: "portfolio-api", defaultBranch: "main", headSha: "a".repeat(40), sourceUrl: "https://github.com/student/portfolio-api" };
const files: ParsedFile[] = [
  {
    path: "package.json",
    language: "JSON",
    content: JSON.stringify({ dependencies: { express: "^5", jsonwebtoken: "^9", redis: "^5" }, devDependencies: { vitest: "^3" } }),
    symbols: [], imports: [],
  },
  {
    path: "src/server.ts",
    language: "TypeScript",
    content: "import express from 'express';\nconst app = express();\napp.get('/health', (_req, res) => res.json({ ok: true }));",
    symbols: [{ name: "app", line: 2, kind: "lexical_declaration" }], imports: [{ value: "express", line: 1 }],
  },
  {
    path: "tests/server.test.ts",
    language: "TypeScript",
    content: "import { test } from 'vitest';\ntest('health', () => {});",
    symbols: [], imports: [{ value: "vitest", line: 1 }],
  },
];

describe("deterministic coaching", () => {
  const facts = analyzeFiles(identity, files, []);
  const questions = planQuestions(facts);

  it("produces exactly eight diverse, evidence-grounded topics", () => {
    expect(questions).toHaveLength(8);
    expect(new Set(questions.map((question) => question.topic)).size).toBe(8);
    const evidenceIds = new Set(facts.evidence.map((item) => item.id));
    expect(questions.every((question) => question.evidenceIds.every((id) => evidenceIds.has(id)))).toBe(true);
  });

  it("extracts framework, datastore, auth, route, and test signals", () => {
    expect(facts.signals.frameworks).toContain("express");
    expect(facts.signals.dataStores).toContain("redis");
    expect(facts.signals.auth).toContain("jsonwebtoken");
    expect(facts.routes).toContain("GET /health");
    expect(facts.signals.tests).toContain("tests/server.test.ts");
  });

  it("grades qualitatively and targets a missing rubric point", () => {
    const result = evaluateAnswer(questions[0], "The request starts at the entry point and flows through the service layer and module boundary.");
    expect(["strong", "partial"]).toContain(result.verdict);
    expect(result.evidenceIds).toEqual(questions[0].evidenceIds);
    expect(result.followUp).toBeNull();
    expect(result.expectedAnswer).toContain("strong response");
  });
});

describe("topic-specific evidence selection", () => {
  it("prefers the entry point and test suite over unrelated files", () => {
    const cppFiles: ParsedFile[] = [
      { path: "src/util.cpp", language: "C++", content: "int helper() { return 1; }", symbols: [{ name: "helper", line: 1, kind: "function_definition" }], imports: [] },
      { path: "tests/test_main.cpp", language: "C++", content: "void test_server() {}", symbols: [{ name: "test_server", line: 1, kind: "function_definition" }], imports: [] },
      { path: "src/main.cpp", language: "C++", content: "int main() { return 0; }", symbols: [{ name: "main", line: 1, kind: "function_definition" }], imports: [{ value: "server.hpp", line: 1 }] },
    ];
    const facts = analyzeFiles(identity, cppFiles, []);
    const planned = planQuestions(facts);
    const evidenceById = new Map(facts.evidence.map((item) => [item.id, item]));
    expect(evidenceById.get(planned[0].evidenceIds[0])?.path).toBe("src/main.cpp");
    expect(evidenceById.get(planned[5].evidenceIds[0])?.path).toBe("tests/test_main.cpp");
  });
});

describe("ad-hoc repository evidence", () => {
  it("selects question-relevant snippets without sending the full fact sheet", () => {
    const facts = analyzeFiles(identity, files, []);
    const selected = selectEvidenceForQuestion(facts, "How does the health route handle requests?", 3);
    expect(selected.length).toBeLessThanOrEqual(3);
    expect(selected[0].path).toBe("src/server.ts");
    expect(selected.some((item) => item.kind === "route")).toBe(true);
  });
});

describe("repository chat threads", () => {
  it("creates separate persistent identities for each repository commit", () => {
    const chat = newRepoChat(identity);
    expect(chat.messages).toEqual([]);
    expect(repoKey(chat.identity)).toBe(`student/portfolio-api@${"a".repeat(40)}`);
    expect(chat.title).toBe("New conversation");
  });
});

describe("large repository evidence", () => {
  it("retains absence evidence when file evidence reaches the cap", () => {
    const noisyFiles: ParsedFile[] = Array.from({ length: 610 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      content: `export function function${index}() { return ${index}; }`,
      language: "TypeScript",
      symbols: [{ name: `function${index}`, line: 1, kind: "function_declaration" }],
      imports: [],
    }));
    const facts = analyzeFiles(identity, noisyFiles, []);
    expect(facts.evidence).toHaveLength(600);
    expect(facts.evidence.map((item) => item.id)).toEqual(expect.arrayContaining([
      "absence_tests", "absence_authentication", "absence_observability", "absence_data-store",
    ]));
    expect(planQuestions(facts)).toHaveLength(8);
  });
});

