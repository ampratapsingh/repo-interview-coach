/// <reference lib="webworker" />
import { unzipSync } from "fflate";
import { Language, Parser } from "web-tree-sitter";
import { analyzeFiles } from "../lib/analyzer";
import { inspectZip } from "../lib/archive";
import { IGNORED_SEGMENTS, LIMITS } from "../lib/config";
import type { ParsedFile, RepoIdentity } from "../lib/domain";

type RequestMessage = { type: "analyze"; archive: ArrayBuffer; identity: RepoIdentity };
type Node = { type: string; text: string; startPosition: { row: number }; namedChildren: Node[] };
const decoder = new TextDecoder("utf-8", { fatal: false });

function languageFor(path: string): ParsedFile["language"] | null {
  const ext = path.split(".").pop()?.toLowerCase();
  if (["js", "jsx", "mjs", "cjs"].includes(ext ?? "")) return "JavaScript";
  if (["ts", "tsx", "mts", "cts"].includes(ext ?? "")) return "TypeScript";
  if (ext === "py") return "Python";
  if (["json", "toml", "txt", "yml", "yaml", "md"].includes(ext ?? "")) return ext === "json" ? "JSON" : "Other";
  return null;
}

function safePath(path: string) {
  if (path.startsWith("/") || path.includes("..") || path.includes("\\") || path.includes("\0")) return false;
  return !path.split("/").some((segment) => IGNORED_SEGMENTS.has(segment));
}

function walk(node: Node, file: ParsedFile) {
  const symbolTypes = new Set(["function_declaration", "class_declaration", "method_definition", "function_definition", "class_definition", "lexical_declaration"]);
  const importTypes = new Set(["import_statement", "import_from_statement", "import_statement"]);
  if (symbolTypes.has(node.type)) {
    const name = node.namedChildren.find((n) => ["identifier", "property_identifier"].includes(n.type))?.text ?? node.text.split(/[\s({:=]/).filter(Boolean).slice(0, 3).join(" ");
    if (name) file.symbols.push({ name: name.slice(0, 80), line: node.startPosition.row + 1, kind: node.type });
  }
  if (importTypes.has(node.type)) {
    const value = node.text.match(/["']([^"']+)["']/)?.[1] ?? node.text.slice(0, 100);
    file.imports.push({ value, line: node.startPosition.row + 1 });
  }
  node.namedChildren?.forEach((child) => walk(child, file));
}

async function parseSource(file: ParsedFile, parsers: Record<string, Parser>) {
  const ext = file.path.split(".").pop()?.toLowerCase();
  const parser = ext === "py" ? parsers.python : ext === "tsx" || ext === "jsx" ? parsers.tsx : file.language === "TypeScript" ? parsers.typescript : parsers.javascript;
  const tree = parser.parse(file.content);
  if (tree) { walk(tree.rootNode as unknown as Node, file); tree.delete(); }
}

async function createParsers() {
  await Parser.init({ locateFile: () => "/parsers/tree-sitter.wasm" });
  const paths = { javascript: "/parsers/javascript.wasm", typescript: "/parsers/typescript.wasm", tsx: "/parsers/tsx.wasm", python: "/parsers/python.wasm" };
  const entries = await Promise.all(Object.entries(paths).map(async ([name, path]) => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Could not load the ${name} parser.`);
    const parser = new Parser(); parser.setLanguage(await Language.load(new Uint8Array(await response.arrayBuffer()))); return [name, parser] as const;
  }));
  return Object.fromEntries(entries) as Record<string, Parser>;
}

self.onmessage = async (event: MessageEvent<RequestMessage>) => {
  if (event.data.type !== "analyze") return;
  try {
    const limitations: string[] = [];
    const archiveBytes = new Uint8Array(event.data.archive);
    inspectZip(archiveBytes);
    const entries = unzipSync(archiveBytes);
    const names = Object.keys(entries);
    if (names.length > LIMITS.extractedFiles) throw new Error(`Repository contains more than ${LIMITS.extractedFiles.toLocaleString()} files.`);
    const root = names[0]?.split("/")[0] ?? "";
    const files: ParsedFile[] = [];
    let textBytes = 0;
    for (const rawPath of names) {
      const path = rawPath.startsWith(`${root}/`) ? rawPath.slice(root.length + 1) : rawPath;
      const bytes = entries[rawPath];
      const language = languageFor(path);
      if (!path || path.endsWith("/") || !language || !safePath(path) || bytes.length > LIMITS.sourceFileBytes) continue;
      if (bytes.slice(0, 800).includes(0)) continue;
      if (files.length >= LIMITS.analyzedSourceFiles || textBytes + bytes.length > LIMITS.parsedTextBytes) { limitations.push("The repository exceeded the analysis budget; lower-priority files were skipped."); break; }
      textBytes += bytes.length;
      files.push({ path, content: decoder.decode(bytes), language, symbols: [], imports: [] });
    }
    const parsers = await createParsers();
    for (const file of files) if (["JavaScript", "TypeScript", "Python"].includes(file.language)) await parseSource(file, parsers);
    Object.values(parsers).forEach((parser) => parser.delete());
    const facts = analyzeFiles(event.data.identity, files, limitations);
    self.postMessage({ type: "complete", facts });
  } catch (error) {
    console.error("Repository analysis failed", error);
    self.postMessage({ type: "error", message: error instanceof Error ? (error.stack ?? error.message) : "Analysis failed." });
  }
};

