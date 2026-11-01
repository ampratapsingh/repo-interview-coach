import type { EvidenceRef, ParsedFile, RepoFactSheet, RepoIdentity } from "./domain";

const extLanguage: Record<string, string> = {
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript",
  py: "Python", json: "JSON",
  cpp: "C++", cc: "C++", cxx: "C++", h: "C++", hpp: "C++", hh: "C++",
};

function hash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

function excerptAt(content: string, line: number) {
  return content.split("\n").slice(Math.max(0, line - 1), line + 2).join("\n").trim().slice(0, 360);
}

export function analyzeFiles(identity: RepoIdentity, files: ParsedFile[], limitations: string[]): RepoFactSheet {
  const evidence: EvidenceRef[] = [];
  const languageMap = new Map<string, { files: number; lines: number }>();
  const manifests: string[] = [];
  const dependencies = new Set<string>();
  const imports = new Set<string>();
  const routes = new Set<string>();
  const entryPoints = new Set<string>();
  const modules = new Set<string>();
  const signals = { frameworks: new Set<string>(), dataStores: new Set<string>(), auth: new Set<string>(), tests: new Set<string>(), ci: new Set<string>(), deployment: new Set<string>(), observability: new Set<string>() };

  const addEvidence = (file: ParsedFile, line: number, kind: EvidenceRef["kind"], symbol: string | undefined, excerpt?: string) => {
    const id = `ev_${hash(`${file.path}:${line}:${kind}:${symbol ?? ""}`)}`;
    if (!evidence.some((item) => item.id === id)) evidence.push({ id, path: file.path, startLine: Math.max(1, line), endLine: Math.max(1, line + 2), symbol, excerpt: excerpt ?? excerptAt(file.content, line), kind, confidence: 0.92 });
    return id;
  };

  for (const file of files) {
    const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
    const language = extLanguage[ext] ?? file.language;
    if (["JavaScript", "TypeScript", "Python", "C++"].includes(language)) {
      const stats = languageMap.get(language) ?? { files: 0, lines: 0 };
      stats.files += 1; stats.lines += file.content.split("\n").length; languageMap.set(language, stats);
    }
    const lower = file.path.toLowerCase();
    const segments = file.path.split("/");
    if (segments.length > 1) modules.add(segments[0]);
    if (/(^|\/)(index|main|app|server|cli)\.(js|jsx|mjs|cjs|ts|tsx|py|cpp|cc|cxx)$/.test(lower)) entryPoints.add(file.path);
    if (/(package\.json|pyproject\.toml|requirements[^/]*\.txt|pipfile|cmakelists\.txt)$/.test(lower)) {
      manifests.push(file.path); addEvidence(file, 1, "manifest", undefined, file.content.slice(0, 360));
      if (lower.endsWith("package.json")) {
        try {
          const pkg = JSON.parse(file.content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
          Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).forEach((dep) => dependencies.add(dep));
        } catch { limitations.push(`Could not parse ${file.path}.`); }
      } else if (lower.endsWith("cmakelists.txt")) {
        for (const match of file.content.matchAll(/find_package\s*\(\s*([\w-]+)/gi)) dependencies.add(match[1]);
      } else {
        file.content.split("\n").map((line) => line.trim().split(/[=<>~!\[]/)[0]).filter(Boolean).forEach((dep) => dependencies.add(dep));
      }
    }
    for (const item of file.imports) { imports.add(item.value); addEvidence(file, item.line, "import", item.value); }
    for (const symbol of file.symbols.slice(0, 20)) addEvidence(file, symbol.line, "symbol", symbol.name);
    const text = file.content;
    const routeRegex = /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)/g;
    for (const match of text.matchAll(routeRegex)) { routes.add(`${match[1].toUpperCase()} ${match[2]}`); addEvidence(file, text.slice(0, match.index).split("\n").length, "route", match[2]); }
    if (/(test|spec)\.(js|jsx|ts|tsx|py)$/.test(lower) || /(^|\/)tests?\//.test(lower)) { signals.tests.add(file.path); addEvidence(file, 1, "test", "test suite"); }
    if (/\.github\/workflows\/.+\.ya?ml$/.test(lower)) { signals.ci.add("GitHub Actions"); addEvidence(file, 1, "config", "GitHub Actions"); }
    if (/(dockerfile|compose\.ya?ml|vercel\.json|wrangler\.json|netlify\.toml)$/.test(lower)) { signals.deployment.add(file.path.split("/").pop() ?? file.path); addEvidence(file, 1, "config", "deployment"); }
  }

  const allDeps = [...dependencies];
  const matchDeps = (names: string[], target: Set<string>) => allDeps.filter((d) => names.some((n) => d.toLowerCase().includes(n))).forEach((d) => target.add(d));
  matchDeps(["react", "next", "express", "fastify", "flask", "django", "fastapi", "vite"], signals.frameworks);
  matchDeps(["prisma", "mongoose", "sequelize", "typeorm", "postgres", "mysql", "redis", "sqlite", "sqlalchemy"], signals.dataStores);
  matchDeps(["auth", "jwt", "jsonwebtoken", "passport", "oauth", "bcrypt", "clerk"], signals.auth);
  matchDeps(["sentry", "datadog", "opentelemetry", "winston", "pino"], signals.observability);
  if (files.some((file) => /(^|\/)(database|storage|store|cache)\.(cpp|cc|cxx|hpp?|hh)$/.test(file.path.toLowerCase()))) signals.dataStores.add("repository storage engine");

  const first = files[0] ?? { path: "repository", content: "No supported source files found." } as ParsedFile;
  const absence = (label: string, present: boolean) => {
    if (present) return;
    evidence.push({ id: `absence_${label}`, path: "repository", startLine: 1, endLine: 1, symbol: label, excerpt: `No ${label} signal was detected in the analyzed files.`, kind: "absence", confidence: 0.72 });
  };
  absence("tests", signals.tests.size > 0); absence("continuous-integration", signals.ci.size > 0); absence("authentication", signals.auth.size > 0); absence("observability", signals.observability.size > 0); absence("data-store", signals.dataStores.size > 0);
  if (!evidence.length) addEvidence(first, 1, "symbol", "repository");

  // Absence evidence is added after file evidence, so a large repository can
  // otherwise push it beyond the fact-sheet cap. Questions rely on these refs
  // when a signal is missing, so reserve room for every absence observation.
  const absenceEvidence = evidence.filter((item) => item.kind === "absence");
  const retainedEvidence = [
    ...evidence.filter((item) => item.kind !== "absence").slice(0, 600 - absenceEvidence.length),
    ...absenceEvidence,
  ];

  return {
    version: 1, identity,
    languages: [...languageMap].map(([name, value]) => ({ name, ...value })).sort((a, b) => b.lines - a.lines),
    manifests: [...new Set(manifests)], dependencies: allDeps.slice(0, 80), entryPoints: [...entryPoints].slice(0, 20), modules: [...modules].slice(0, 24), imports: [...imports].slice(0, 80), routes: [...routes].slice(0, 40),
    signals: Object.fromEntries(Object.entries(signals).map(([key, value]) => [key, [...value]])) as RepoFactSheet["signals"],
    limitations, evidence: retainedEvidence, analyzedFiles: files.length, analyzedAt: new Date().toISOString(),
  };
}

