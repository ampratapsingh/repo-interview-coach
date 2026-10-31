export const LIMITS = {
  compressedArchiveBytes: 20 * 1024 * 1024,
  extractedFiles: 2_000,
  extractedArchiveBytes: 80 * 1024 * 1024,
  analyzedSourceFiles: 500,
  sourceFileBytes: 1 * 1024 * 1024,
  parsedTextBytes: 10 * 1024 * 1024,
} as const;

export const IGNORED_SEGMENTS = new Set([
  "node_modules", "vendor", "dist", "build", ".next", ".git", "coverage", "__pycache__", ".venv", "venv", "target",
]);

