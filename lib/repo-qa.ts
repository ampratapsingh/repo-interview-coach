import type { EvidenceRef, RepoFactSheet } from "./domain";

const STOP_WORDS = new Set(["about", "after", "again", "also", "does", "from", "have", "into", "repo", "repository", "that", "their", "there", "this", "what", "when", "where", "which", "with", "would"]);

export function selectEvidenceForQuestion(facts: RepoFactSheet, question: string, limit = 6): EvidenceRef[] {
  const terms = question.toLowerCase().match(/[a-z0-9_+#.-]{3,}/g)?.filter((term) => !STOP_WORDS.has(term)) ?? [];
  const ranked = facts.evidence.map((item) => {
    const path = item.path.toLowerCase();
    const symbol = (item.symbol ?? "").toLowerCase();
    const excerpt = item.excerpt.toLowerCase();
    let score = item.confidence + (item.kind === "absence" ? -4 : 0);
    for (const term of terms) {
      if (path.includes(term)) score += 12;
      if (symbol.includes(term)) score += 9;
      if (excerpt.includes(term)) score += 4;
    }
    if (facts.entryPoints.includes(item.path)) score += 2;
    return { item, score };
  }).sort((a, b) => b.score - a.score || a.item.path.localeCompare(b.item.path));

  const selected: EvidenceRef[] = [];
  const paths = new Set<string>();
  for (const candidate of ranked) {
    if (paths.has(candidate.item.path) && selected.length < Math.min(3, limit)) continue;
    selected.push(candidate.item); paths.add(candidate.item.path);
    if (selected.length === limit) break;
  }
  return selected;
}
