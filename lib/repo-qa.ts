import type { EvidenceRef, RepoFactSheet } from "./domain";

type ChatTurn = { role: "user" | "assistant"; content: string };
type Intent = "architecture" | "data-flow" | "security" | "testing" | "operations" | "dependencies" | "general";

const STOP_WORDS = new Set(["about", "after", "again", "also", "does", "from", "have", "into", "repo", "repository", "that", "their", "there", "this", "what", "when", "where", "which", "with", "would", "could", "should", "tell", "explain"]);
const INTENT_TERMS: Record<Intent, string[]> = {
  architecture: ["architecture", "architectural", "module", "layer", "component", "boundary", "entry", "structure", "orchestration", "design"],
  "data-flow": ["flow", "request", "response", "input", "output", "transform", "validate", "handler", "route", "workflow", "pipeline"],
  security: ["security", "secure", "auth", "authentication", "authorization", "permission", "token", "secret", "validation", "injection", "trust"],
  testing: ["test", "tests", "testing", "coverage", "spec", "mock", "fixture", "regression"],
  operations: ["deploy", "deployment", "production", "logging", "monitoring", "metric", "trace", "ci", "docker", "failure", "reliability"],
  dependencies: ["dependency", "dependencies", "package", "library", "framework", "version", "manifest"],
  general: [],
};

const INTENT_KINDS: Record<Intent, EvidenceRef["kind"][]> = {
  architecture: ["documentation", "symbol", "import", "manifest"],
  "data-flow": ["route", "symbol", "import"],
  security: ["config", "symbol", "import", "absence"],
  testing: ["test", "symbol", "import", "absence"],
  operations: ["config", "manifest", "import", "absence"],
  dependencies: ["manifest", "import", "documentation"],
  general: ["symbol", "route", "documentation", "import", "manifest", "config", "test", "absence"],
};

const tokens = (value: string) => value.toLowerCase().match(/[a-z0-9_+#.-]{3,}/g)?.filter((term) => !STOP_WORDS.has(term)) ?? [];

export function classifyRepositoryQuestion(question: string): Intent {
  const searchable = ` ${question.toLowerCase()} `;
  const scored = (Object.entries(INTENT_TERMS) as Array<[Intent, string[]]>).map(([intent, terms]) => ({
    intent,
    score: terms.reduce((sum, term) => sum + (searchable.includes(term) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score);
  return scored[0]?.score ? scored[0].intent : "general";
}

export function buildRetrievalQuery(question: string, history: ChatTurn[]) {
  const trimmed = question.trim();
  const ambiguous = tokens(trimmed).length <= 5 && /\b(it|that|this|they|them|those|there|same|above|previous|work|happen)\b|^(how|why|and|but)\b/i.test(trimmed);
  if (!ambiguous) return trimmed;
  const previousUser = [...history].reverse().find((turn) => turn.role === "user")?.content.trim();
  return previousUser ? `${previousUser}\nFollow-up: ${trimmed}` : trimmed;
}

export function selectEvidenceForQuestion(facts: RepoFactSheet, question: string, limit = 6): EvidenceRef[] {
  const intent = classifyRepositoryQuestion(question);
  const expandedTerms = [...new Set([...tokens(question), ...INTENT_TERMS[intent]])];
  const preferredKinds = INTENT_KINDS[intent];
  const ranked = facts.evidence.map((item) => {
    const path = item.path.toLowerCase();
    const symbol = (item.symbol ?? "").toLowerCase();
    const excerpt = item.excerpt.toLowerCase();
    let score = item.confidence * 10;
    const kindIndex = preferredKinds.indexOf(item.kind);
    if (kindIndex >= 0) score += Math.max(3, 14 - kindIndex * 3);
    if (item.kind === "absence") score += ["security", "testing", "operations"].includes(intent) ? 5 : -8;
    if (facts.entryPoints.includes(item.path)) score += intent === "architecture" || intent === "data-flow" ? 12 : 3;
    for (const term of expandedTerms) {
      if (path.includes(term)) score += 13;
      if (symbol.includes(term)) score += 10;
      if (excerpt.includes(term)) score += 4;
    }
    if (intent === "architecture" && /(^|\/)(main|app|server|index|cli|run_|dashboard)/.test(path)) score += 8;
    if (intent === "security" && /(auth|security|middleware|config|env|route)/.test(path)) score += 8;
    if (intent === "testing" && /(test|spec|fixture|mock)/.test(path)) score += 12;
    if (intent === "operations" && /(docker|deploy|workflow|config|log|monitor|observ)/.test(path)) score += 10;
    return { item, score };
  }).sort((a, b) => b.score - a.score || a.item.path.localeCompare(b.item.path)).slice(0, 24);

  const selected: EvidenceRef[] = [];
  const pathCounts = new Map<string, number>();
  const kindCounts = new Map<EvidenceRef["kind"], number>();
  while (selected.length < limit && ranked.length) {
    ranked.sort((a, b) => {
      const adjusted = (candidate: typeof a) => candidate.score - (pathCounts.get(candidate.item.path) ?? 0) * 14 - (kindCounts.get(candidate.item.kind) ?? 0) * 2;
      return adjusted(b) - adjusted(a);
    });
    const nextIndex = ranked.findIndex(({ item }) => (pathCounts.get(item.path) ?? 0) < 2);
    if (nextIndex < 0) break;
    const [{ item }] = ranked.splice(nextIndex, 1);
    selected.push(item);
    pathCounts.set(item.path, (pathCounts.get(item.path) ?? 0) + 1);
    kindCounts.set(item.kind, (kindCounts.get(item.kind) ?? 0) + 1);
  }
  return selected;
}
