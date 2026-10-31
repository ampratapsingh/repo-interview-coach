import { z } from "zod";

export const repoIdentitySchema = z.object({
  owner: z.string(),
  repository: z.string(),
  defaultBranch: z.string(),
  headSha: z.string(),
  sourceUrl: z.string().url(),
});

export const evidenceRefSchema = z.object({
  id: z.string(),
  path: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  symbol: z.string().optional(),
  excerpt: z.string(),
  kind: z.enum(["manifest", "symbol", "import", "route", "config", "test", "absence"]),
  confidence: z.number().min(0).max(1),
});

export const factSheetSchema = z.object({
  version: z.literal(1),
  identity: repoIdentitySchema,
  languages: z.array(z.object({ name: z.string(), files: z.number(), lines: z.number() })),
  manifests: z.array(z.string()),
  dependencies: z.array(z.string()),
  entryPoints: z.array(z.string()),
  modules: z.array(z.string()),
  imports: z.array(z.string()),
  routes: z.array(z.string()),
  signals: z.object({
    frameworks: z.array(z.string()),
    dataStores: z.array(z.string()),
    auth: z.array(z.string()),
    tests: z.array(z.string()),
    ci: z.array(z.string()),
    deployment: z.array(z.string()),
    observability: z.array(z.string()),
  }),
  limitations: z.array(z.string()),
  evidence: z.array(evidenceRefSchema),
  analyzedFiles: z.number().int(),
  analyzedAt: z.string(),
});

export const rubricPointSchema = z.object({
  id: z.string(),
  label: z.string(),
  aliases: z.array(z.string()),
  weight: z.number().positive(),
  explanation: z.string(),
  evidenceIds: z.array(z.string()),
});

export const interviewQuestionSchema = z.object({
  id: z.string(),
  topic: z.enum(["architecture", "data-flow", "design", "reliability", "security", "testing", "scaling", "operations"]),
  prompt: z.string(),
  difficulty: z.enum(["foundation", "applied", "deep-dive"]),
  rubric: z.array(rubricPointSchema),
  evidenceIds: z.array(z.string()),
  followUps: z.record(z.string(), z.string()),
  explanation: z.string(),
});

export const answerEvaluationSchema = z.object({
  verdict: z.enum(["strong", "partial", "needs_work"]),
  coveredPointIds: z.array(z.string()),
  missedPointIds: z.array(z.string()),
  feedback: z.string(),
  evidenceIds: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  followUp: z.string().nullable(),
});

export const topicResultSchema = z.object({
  question: interviewQuestionSchema,
  answer: z.string(),
  followUpAnswer: z.string().optional(),
  evaluation: answerEvaluationSchema,
});

export const sessionReportSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  identity: repoIdentitySchema,
  startedAt: z.string(),
  completedAt: z.string(),
  results: z.array(topicResultSchema),
  strengths: z.array(z.string()),
  recurringGaps: z.array(z.string()),
  revisionCards: z.array(z.object({ id: z.string(), front: z.string(), back: z.string(), evidenceIds: z.array(z.string()) })),
  limitations: z.array(z.string()),
});

export type RepoIdentity = z.infer<typeof repoIdentitySchema>;
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type RepoFactSheet = z.infer<typeof factSheetSchema>;
export type InterviewQuestion = z.infer<typeof interviewQuestionSchema>;
export type AnswerEvaluation = z.infer<typeof answerEvaluationSchema>;
export type TopicResult = z.infer<typeof topicResultSchema>;
export type SessionReport = z.infer<typeof sessionReportSchema>;

export type ParsedFile = {
  path: string;
  content: string;
  language: "JavaScript" | "TypeScript" | "Python" | "JSON" | "Other";
  symbols: Array<{ name: string; line: number; kind: string }>;
  imports: Array<{ value: string; line: number }>;
};

