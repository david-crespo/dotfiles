// Internal imports for digest.sh. Reads source paths on stdin (repo-relative,
// run from the repo root) and writes to the directory given as argv[2]:
//   imports.tsv  one line per file: its path, a tab, its internal imports
//   edges.txt    import counts between top-level directories
// It scans the text rather than parsing (TypeScript 7 has no JS API), for
// `from "…"`, `import "…"` and `import("…")`, so it sees type imports,
// re-exports and dynamic imports, not only what a declaration file keeps.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = process.argv[2];
const specifier = /(?:\bfrom\s*|^\s*import\s*|\bimport\s*\(\s*)["']([^"']+)["']/gm;

const sources = readFileSync(0, "utf8").split("\n").filter(Boolean);
const known = new Set(sources);

// "./x.js" names x.ts under TypeScript's ESM convention
function resolve(from, spec) {
  const base = path.normalize(path.join(path.dirname(from), spec));
  const stem = base.replace(/\.[cm]?[jt]sx?$/, "");
  const candidates = [base, ...[".ts", ".tsx", ".mts", ".mjs"].map((e) => stem + e), path.join(base, "index.ts")];
  return candidates.find((c) => known.has(c)) ?? candidates.find((c) => existsSync(c)) ?? base;
}

const group = (f) => (f.includes("/") ? f.split("/")[0] + "/" : f);

const lines = [];
const edges = new Map();
for (const f of sources) {
  const text = readFileSync(f, "utf8");
  const deps = [
    ...new Set(
      [...text.matchAll(specifier)]
        .map((m) => m[1])
        .filter((s) => s.startsWith("."))
        .map((s) => resolve(f, s)),
    ),
  ].sort();
  lines.push(`${f}\t${deps.join(" ")}`);
  for (const d of deps) {
    if (group(d) === group(f)) continue;
    const key = `${group(f)} -> ${group(d)}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
}

writeFileSync(path.join(out, "imports.tsv"), lines.join("\n") + "\n");
writeFileSync(
  path.join(out, "edges.txt"),
  [...edges]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `${String(n).padStart(3)}  ${k}`)
    .join("\n") + "\n",
);
