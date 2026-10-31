import { describe, expect, it } from "vitest";
import { analyzeFiles } from "../lib/analyzer";
import { evaluateAnswer, planQuestions } from "../lib/question-engine";
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
  });
});

