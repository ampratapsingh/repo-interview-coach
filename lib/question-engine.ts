import type { AnswerEvaluation, EvidenceRef, InterviewQuestion, RepoFactSheet, SessionReport, TopicResult } from "./domain";

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim();

type EvidenceCriteria = { kinds: EvidenceRef["kind"][]; paths?: string[]; keywords?: string[]; fallback?: string };

function evidenceFor(facts: RepoFactSheet, { kinds, paths = [], keywords = [], fallback }: EvidenceCriteria) {
  const exactFallback = fallback ? facts.evidence.find((item) => item.id === fallback) : undefined;
  if (exactFallback) return exactFallback;
  const normalizedPaths = paths.map((path) => path.toLowerCase());
  const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase()).filter(Boolean);
  const found = facts.evidence
    .filter((item) => kinds.includes(item.kind))
    .map((item) => {
      const path = item.path.toLowerCase();
      const searchable = `${path} ${item.symbol ?? ""} ${item.excerpt}`.toLowerCase();
      let score = (kinds.length - kinds.indexOf(item.kind)) * 15 + item.confidence;
      if (normalizedPaths.includes(path)) score += 120;
      if (normalizedPaths.some((candidate) => path.endsWith(`/${candidate}`))) score += 80;
      for (const keyword of normalizedKeywords) {
        if (path.includes(keyword)) score += 24;
        else if (searchable.includes(keyword)) score += 8;
      }
      return { item, score };
    })
    .sort((a, b) => b.score - a.score || a.item.path.localeCompare(b.item.path))[0]?.item;
  return found ?? facts.evidence[0] ?? {
    id: "absence_repository-evidence", path: "repository", startLine: 1, endLine: 1,
    symbol: "repository-evidence", excerpt: "No supported source evidence was detected in the analyzed files.",
    kind: "absence", confidence: 0.5,
  };
}

function point(id: string, label: string, aliases: string[], evidenceId: string, explanation: string, weight = 1) {
  return { id, label, aliases, evidenceIds: [evidenceId], explanation, weight };
}

export function planQuestions(facts: RepoFactSheet): InterviewQuestion[] {
  const primaryLanguage = facts.languages[0]?.name ?? "the primary language";
  const framework = facts.signals.frameworks[0] ?? primaryLanguage;
  const entry = facts.entryPoints[0] ?? "the repository entry point";
  const architectureEv = evidenceFor(facts, { kinds: ["symbol", "import", "manifest"], paths: [entry], keywords: [entry, "main", "server", "app", "index"] });
  const controlFlowEntries = facts.entryPoints.filter((path) => /(^|\/)(server|app|api|cli)\./i.test(path));
  const dataEv = evidenceFor(facts, { kinds: ["route", "symbol", "import"], paths: controlFlowEntries, keywords: ["route", "server", "command", "controller", "handler", "service", "request", "response", "parse", "api"] });
  const designEv = evidenceFor(facts, { kinds: ["manifest", "import"], paths: facts.manifests, keywords: [framework] });
  const testsEv = facts.signals.tests.length ? evidenceFor(facts, { kinds: ["test", "symbol", "import"], paths: facts.signals.tests, keywords: ["test", "spec"] }) : evidenceFor(facts, { kinds: ["absence"], fallback: "absence_tests" });
  const securityEv = facts.signals.auth.length ? evidenceFor(facts, { kinds: ["import", "config", "symbol"], keywords: [...facts.signals.auth, "auth", "jwt", "permission", "login"] }) : evidenceFor(facts, { kinds: ["absence"], fallback: "absence_authentication" });
  const operationsEv = facts.signals.observability.length ? evidenceFor(facts, { kinds: ["config", "import", "symbol"], keywords: [...facts.signals.observability, "log", "metric", "trace", "monitor"] }) : evidenceFor(facts, { kinds: ["absence"], fallback: "absence_observability" });
  const datastore = facts.signals.dataStores[0] ?? "persistent state";
  const dataStoreEv = facts.signals.dataStores.length ? evidenceFor(facts, { kinds: ["import", "symbol", "manifest"], keywords: [...facts.signals.dataStores, "database", "cache", "repository", "store"] }) : evidenceFor(facts, { kinds: ["absence"], fallback: "absence_data-store" });

  const make = (id: string, topic: InterviewQuestion["topic"], prompt: string, ev: EvidenceRef, rubric: InterviewQuestion["rubric"], explanation: string, difficulty: InterviewQuestion["difficulty"] = "applied"): InterviewQuestion => ({
    id, topic, prompt, difficulty, rubric, evidenceIds: [ev.id], explanation,
    followUps: {},
  });

  return [
    make("architecture", "architecture", `Walk me through this repository from ${entry}. What are the major boundaries and responsibilities?`, architectureEv, [
      point("arch-entry", "entry point and request/control flow", ["entry point", "starts", "bootstrap", "request", "flow", entry], architectureEv.id, "Explain where execution begins and how control moves."),
      point("arch-boundaries", "module boundaries", ["module", "layer", "component", "service", "boundary", ...facts.modules.slice(0, 4)], architectureEv.id, "Identify distinct responsibilities rather than listing folders.", 1.2),
    ], `The code identifies ${entry} as an entry-point candidate and uses ${framework} as a prominent framework or language signal.`),
    make("data-flow", "data-flow", `Trace one important piece of data through the system. Where is it validated, transformed, and returned or stored?`, dataEv, [
      point("data-path", "a concrete end-to-end path", ["input", "request", "validate", "transform", "return", "response", "store"], dataEv.id, "Name the actual steps rather than giving a generic framework description.", 1.2),
      point("data-failure", "failure handling", ["error", "exception", "invalid", "failure", "fallback", "status"], dataEv.id, "Include what happens when the path fails."),
    ], facts.routes.length ? `Detected routes include ${facts.routes.slice(0, 3).join(", ")}.` : "No explicit HTTP routes were detected, so the answer should anchor to the repository's primary control flow."),
    make("design", "design", `Why was ${framework} a reasonable choice here, and what trade-off did it introduce?`, designEv, [
      point("design-fit", "fit to requirements", ["because", "requirement", "developer experience", "ecosystem", "speed", "type", framework], designEv.id, "Connect the choice to this project's needs."),
      point("design-tradeoff", "a concrete trade-off", ["trade off", "tradeoff", "cost", "complex", "limitation", "however", "downside"], designEv.id, "A defensible answer includes a downside."),
    ], `${framework} is grounded by the repository manifest or imports; the trade-off must be your reasoning, not an invented code fact.`),
    make("reliability", "reliability", `What is the most likely production failure mode in this codebase, and how would you make it recover safely?`, dataEv, [
      point("rel-mode", "specific failure mode", ["timeout", "network", "database", "race", "memory", "crash", "failure", "exception"], dataEv.id, "Choose a failure tied to the actual flow."),
      point("rel-recovery", "recovery strategy", ["retry", "backoff", "idempot", "fallback", "circuit", "queue", "rollback", "recover"], dataEv.id, "Explain safe recovery and duplicate-work behavior.", 1.2),
    ], "Reliability feedback is grounded in the detected control-flow evidence; proposed mitigations are design reasoning."),
    make("security", "security", facts.signals.auth.length ? `Explain the authentication or authorization boundary. What would you review first for a bypass?` : `No authentication signal was detected. Is that appropriate, and where would the trust boundary belong if access control were required?`, securityEv, [
      point("sec-boundary", "trust boundary", ["trust", "boundary", "authenticate", "authorize", "permission", "public", "private"], securityEv.id, "State what is trusted and where access is enforced.", 1.2),
      point("sec-input", "input and secret handling", ["validate", "sanitize", "secret", "token", "environment", "injection", "escape"], securityEv.id, "Cover hostile input or credential exposure."),
    ], securityEv.kind === "absence" ? securityEv.excerpt : `Authentication-related signals include ${facts.signals.auth.join(", ")}.`, "deep-dive"),
    make("testing", "testing", facts.signals.tests.length ? `What behavior is best covered by the current tests, and what high-risk path is still missing?` : `No test suite was detected. What would your first three tests be, and why those first?`, testsEv, [
      point("test-behavior", "behavior-focused coverage", ["unit", "integration", "end to end", "e2e", "behavior", "contract", "test"], testsEv.id, "Prioritize observable behavior over implementation details."),
      point("test-risk", "risk-based prioritization", ["risk", "critical", "failure", "edge case", "regression", "first"], testsEv.id, "Explain why these tests reduce the most risk.", 1.2),
    ], testsEv.kind === "absence" ? testsEv.excerpt : `Detected test paths include ${facts.signals.tests.slice(0, 4).join(", ")}.`),
    make("scaling", "scaling", `Traffic grows 10×. What bottleneck appears first around ${datastore}, and what measurement would prove it?`, dataStoreEv, [
      point("scale-bottleneck", "first constrained resource", ["bottleneck", "cpu", "memory", "database", "connection", "latency", "throughput", "queue"], dataStoreEv.id, "Name one likely constraint and why it comes first.", 1.2),
      point("scale-measure", "measurement before redesign", ["metric", "measure", "profile", "latency", "p95", "p99", "throughput", "load test"], dataStoreEv.id, "Use a metric to validate the hypothesis."),
    ], dataStoreEv.kind === "absence" ? dataStoreEv.excerpt : `Data-store signals include ${facts.signals.dataStores.join(", ")}.`, "deep-dive"),
    make("operations", "operations", facts.signals.observability.length ? `How would you detect and diagnose a bad deployment with the current observability setup?` : `No observability tooling was detected. What minimum signals would you add before deploying this?`, operationsEv, [
      point("ops-signals", "logs, metrics, and traces", ["log", "metric", "trace", "alert", "error rate", "latency"], operationsEv.id, "Name signals that reveal user impact."),
      point("ops-action", "an actionable response", ["dashboard", "alert", "rollback", "runbook", "diagnose", "correlation"], operationsEv.id, "Connect detection to diagnosis or rollback.", 1.1),
    ], operationsEv.kind === "absence" ? operationsEv.excerpt : `Observability signals include ${facts.signals.observability.join(", ")}.`),
  ];
}

export function evaluateAnswer(question: InterviewQuestion, answer: string): AnswerEvaluation {
  const normalized = normalize(answer);
  const covered = question.rubric.filter((p) => p.aliases.some((alias) => normalized.includes(normalize(alias))));
  const missed = question.rubric.filter((p) => !covered.includes(p));
  const total = question.rubric.reduce((sum, p) => sum + p.weight, 0);
  const score = covered.reduce((sum, p) => sum + p.weight, 0) / total;
  const verdict = score >= 0.72 ? "strong" : score >= 0.34 ? "partial" : "needs_work";
  const feedback = verdict === "strong" ? `Strong answer. You covered ${covered.map((p) => p.label.toLowerCase()).join(" and ")}.` : covered.length ? `You grounded part of the answer, but it still needs ${missed.map((p) => p.label.toLowerCase()).join(" and ")}.` : `The answer did not yet address the grounded rubric. Focus on ${missed.map((p) => p.label.toLowerCase()).join(" and ")}.`;
  const expectedAnswer = `${question.explanation} A strong response should ${question.rubric.map((point) => point.explanation.replace(/\.$/, "").toLowerCase()).join(" and ")}.`;
  return { verdict, coveredPointIds: covered.map((p) => p.id), missedPointIds: missed.map((p) => p.id), feedback, expectedAnswer, evidenceIds: question.evidenceIds, confidence: answer.trim().length < 20 ? 0.48 : 0.74, followUp: null };
}

export function buildReport(facts: RepoFactSheet, results: TopicResult[], startedAt: string): SessionReport {
  const strong = results.filter((r) => r.evaluation.verdict === "strong").map((r) => r.question.topic);
  const gaps = results.flatMap((r) => r.question.rubric.filter((p) => r.evaluation.missedPointIds.includes(p.id)).map((p) => p.label));
  return {
    version: 1, id: `${facts.identity.owner}-${facts.identity.repository}-${Date.now()}`, identity: facts.identity, startedAt, completedAt: new Date().toISOString(), results,
    strengths: [...new Set(strong)], recurringGaps: [...new Set(gaps)].slice(0, 8),
    revisionCards: results.filter((r) => r.evaluation.verdict !== "strong").map((r) => ({ id: `card-${r.question.id}`, front: r.question.prompt, back: r.question.explanation, evidenceIds: r.question.evidenceIds })),
    limitations: facts.limitations,
  };
}

