// Internal imports for digest.sh. Reads source paths on stdin (repo-relative,
// run from the repo root) and writes to the directory given as argv[2]:
//   imports.tsv  one line per file: its path, a tab, its internal imports
//   edges.txt    import counts between top-level directories
// It scans the text rather than parsing (TypeScript 7 has no JS API), for
// `from "…"`, `import "…"` and `import("…")`, so it sees type imports,
// re-exports and dynamic imports, not only what a declaration file keeps.
// Besides relative specifiers it follows the `paths` aliases in tsconfig.json.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = process.argv[2];
const specifier = /(?:\bfrom\s*|^\s*import\s*|\bimport\s*\(\s*)["']([^"']+)["']/gm;

const sources = readFileSync(0, "utf8").split("\n").filter(Boolean);
const known = new Set(sources);

// tsconfig paths as [prefix, target prefix], e.g. ["~/", "app/"], or an exact
// specifier with its file. Line comments are dropped first (tsconfig is JSONC).
const aliases = (() => {
  if (!existsSync("tsconfig.json")) return [];
  const text = readFileSync("tsconfig.json", "utf8").replace(/^\s*\/\/.*$/gm, "");
  let paths;
  try {
    paths = JSON.parse(text).compilerOptions?.paths ?? {};
  } catch {
    return [];
  }
  return Object.entries(paths).map(([k, [v]]) => [k.replace(/\*$/, ""), path.normalize(v).replace(/\*$/, ""), k.endsWith("*")]);
})();

// A specifier as a repo-relative path, or null for a package
function locate(from, spec) {
  if (spec.startsWith(".")) return path.normalize(path.join(path.dirname(from), spec));
  for (const [prefix, target, wildcard] of aliases)
    if (wildcard ? spec.startsWith(prefix) : spec === prefix) return path.normalize(target + spec.slice(prefix.length));
  return null;
}

// "./x.js" names x.ts under TypeScript's ESM convention
function resolve(base) {
  const stem = base.replace(/\.[cm]?[jt]sx?$/, "");
  const candidates = [base, ...[".ts", ".tsx", ".mts", ".mjs"].map((e) => stem + e), path.join(base, "index.ts"), path.join(base, "index.tsx")];
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
        .map((m) => locate(f, m[1]))
        .filter((p) => p !== null)
        .map(resolve),
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
