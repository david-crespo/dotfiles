// Structure metrics for a TypeScript repo, one column per revision, to compare
// a refactor's before and after. Run from the repo root:
//
//   node metrics.mjs [--exclude <regex>] [--list] [<rev>...]
//
// With no revs it measures the working copy. --list prints the last column's
// single-use helpers after the table. Each rev is a jj revset naming
// one commit (hidden ones by commit ID too), copied to a temp dir to measure.
// Files are chosen as in digest.sh, minus tests. The import graph comes from
// imports.mjs and named functions from functions.yml (ast-grep).
//
// The graph numbers follow Lakos (CCD, ACD, NCCD), MacCormack et al.
// (propagation cost) and Martin (stability). Most are only meaningful
// compared across versions of the same repo.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
let exclude = /^$/;
let list = false;
const revs = [];
while (args.length) {
  const a = args.shift();
  if (a === "--exclude") exclude = new RegExp(args.shift());
  else if (a === "--list") list = true;
  else revs.push(a);
}

// The name in a function's first line: function f, const f =, or a method
const signature =
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s+([\w$]+)|(?:const|let|var)\s+([\w$]+)|(?:(?:public|private|protected|static|async|get|set|override)\s+)*#?([\w$]+)\s*[(<])/;

const sh = (cmd, argv, opts = {}) =>
  execFileSync(cmd, argv, { encoding: "utf8", maxBuffer: 1 << 28, ...opts });

const isSource = (f) =>
  /\.(ts|tsx|mts|mjs)$/.test(f) &&
  !/\.test\.|\.spec\.|\.d\.ts$/.test(f) &&
  !/^\.claude\/|(^|\/)node_modules\/|(^|\/)dist\/|^scripts\/|(^|\/)[^/]+\.config\.[cm]?[jt]s$/.test(f) &&
  !exclude.test(f);

const jj = existsSync(".jj");
// A colocated repo can copy a whole tree with one git archive
const git = existsSync(".git");
const commitOf = (rev) =>
  jj ? sh("jj", ["log", "--no-graph", "-r", rev, "-T", "commit_id"]).trim() : sh("git", ["rev-parse", rev]).trim();
const listFiles = (commit) =>
  (commit && git
    ? sh("git", ["ls-tree", "-r", "--name-only", commit])
    : jj
      ? sh("jj", ["file", "list", ...(commit ? ["-r", commit] : [])])
      : sh("git", ["ls-files"])
  )
    .split("\n")
    .filter(isSource)
    .sort();

// Copy a commit's source files, and tsconfig.json for its path aliases, into
// a temp dir and return it
function materialize(commit, files) {
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), "metrics-"));
  const wanted = [...files, "tsconfig.json"];
  if (git) {
    const tar = execFileSync("git", ["archive", commit, "--", ...wanted.filter((f) => f !== "tsconfig.json"), ...(sh("git", ["ls-tree", "--name-only", commit, "tsconfig.json"]).trim() ? ["tsconfig.json"] : [])], { maxBuffer: 1 << 30 });
    execFileSync("tar", ["-x", "-C", dir], { input: tar });
    return dir;
  }
  for (const f of wanted) {
    let content;
    try {
      content = sh("jj", ["file", "show", "-r", commit, f], { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      continue; // no tsconfig.json at this commit
    }
    mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
    writeFileSync(path.join(dir, f), content);
  }
  return dir;
}

function measure(root, files) {
  const out = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), "imports-"));
  sh("node", [path.join(here, "imports.mjs"), out], { cwd: root, input: files.join("\n") + "\n" });
  const known = new Set(files);
  const deps = new Map(
    readFileSync(path.join(out, "imports.tsv"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [f, d = ""] = l.split("\t");
        return [f, d.split(" ").filter((x) => known.has(x))];
      }),
  );
  rmSync(out, { recursive: true });

  const text = new Map(files.map((f) => [f, readFileSync(path.join(root, f), "utf8")]));
  const fns = sh("ast-grep", ["scan", "--rule", path.join(here, "functions.yml"), "--json=stream", ...files], { cwd: root })
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .map((m) => {
      // A helper is a function only its own file can call: not exported, and
      // not a public method. React components (capitalized) don't count: a
      // one-off component is the normal way to name a piece of UI. Mentions
      // count the definition too.
      const head = m.lines.split("\n")[0];
      const name = head.match(signature)?.slice(1).find(Boolean);
      const helper = name && !/^[A-Z]/.test(name) && !/^\s*export\b/.test(head) && (!/^\s+\w/.test(head) || /\b(private|#)/.test(head) || /^\s*(const|let|function)\b/.test(head));
      const mentions = helper ? (text.get(m.file).match(new RegExp(`(?<![\\w$])#?${name}\\b`, "g")) ?? []).length : 0;
      return {
        lines: m.range.end.line - m.range.start.line + 1,
        where: `${m.file}:${m.range.start.line + 1}`,
        name,
        singleUse: helper && mentions === 2,
      };
    });

  const lineCounts = files.map((f) => [f, text.get(f).split("\n").filter((l) => l.trim()).length]);
  return { files, deps, fns, lineCounts };
}

// Tarjan's strongly connected components
function sccs(nodes, out) {
  let index = 0;
  const idx = new Map(), low = new Map(), on = new Set(), stack = [], comps = [];
  const visit = (v) => {
    idx.set(v, index), low.set(v, index++), stack.push(v), on.add(v);
    for (const w of out.get(v)) {
      if (!idx.has(w)) visit(w), low.set(v, Math.min(low.get(v), low.get(w)));
      else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const c = [];
      let w;
      do (w = stack.pop()), on.delete(w), c.push(w);
      while (w !== v);
      comps.push(c);
    }
  };
  for (const v of nodes) if (!idx.has(v)) visit(v);
  return comps;
}

function report({ files, deps, fns, lineCounts }) {
  const n = files.length;
  const out = new Map(files.map((f) => [f, new Set(deps.get(f) ?? [])]));
  const inn = new Map(files.map((f) => [f, new Set()]));
  for (const [a, bs] of out) for (const b of bs) inn.get(b).add(a);
  const edges = [...out].flatMap(([a, bs]) => [...bs].map((b) => [a, b]));

  // Everything a file depends on transitively, itself included
  const reach = new Map();
  for (const f of files) {
    const seen = new Set([f]), todo = [f];
    while (todo.length) for (const m of out.get(todo.pop())) if (!seen.has(m)) seen.add(m), todo.push(m);
    reach.set(f, seen);
  }
  const ccd = files.reduce((s, f) => s + reach.get(f).size, 0);
  const btree = (n + 1) * (Math.log2(n + 1) - 1) + 1;

  const comps = sccs(files, out);
  const cyclic = comps.filter((c) => c.length > 1).flat();
  const compOf = new Map(comps.flatMap((c, i) => c.map((f) => [f, i])));
  // Longest chain of files, counting a cycle as one step
  const depthMemo = new Map();
  const depth = (ci) => {
    if (depthMemo.has(ci)) return depthMemo.get(ci);
    let d = 0;
    for (const f of comps[ci]) for (const m of out.get(f)) if (compOf.get(m) !== ci) d = Math.max(d, depth(compOf.get(m)));
    depthMemo.set(ci, d + 1);
    return d + 1;
  };
  const chain = Math.max(0, ...comps.map((_, i) => depth(i)));

  // Edges a longer path already implies
  const redundant = edges.filter(([a, b]) => [...out.get(a)].some((m) => m !== b && reach.get(m).has(b))).length;
  const instability = (f) => {
    const o = out.get(f).size, i = inn.get(f).size;
    return o + i ? o / (o + i) : 0;
  };
  const sdp = edges.filter(([a, b]) => instability(b) > instability(a)).length;
  const top = (m) => {
    const [f, s] = [...m].sort((x, y) => y[1].size - x[1].size)[0] ?? ["-", new Set()];
    return `${s.size} (${f})`;
  };

  const lens = fns.map((f) => f.lines).sort((a, b) => a - b);
  const longest = [...fns].sort((a, b) => b.lines - a.lines)[0];
  const total = lineCounts.reduce((s, [, l]) => s + l, 0);
  const biggest = [...lineCounts].sort((a, b) => b[1] - a[1])[0];
  const pct = (k) => (lens.length ? `${k} (${Math.round((100 * k) / lens.length)}%)` : "0");

  return [
    ["Files / non-blank lines", `${n} / ${total}`],
    ["Largest file", `${biggest[1]} (${biggest[0]})`],
    ["Files under 40 lines", lineCounts.filter(([, l]) => l < 40).length],
    ["Named functions", lens.length],
    ["Median function lines", lens.length ? lens[Math.floor(lens.length / 2)] : 0],
    ["Functions of 1–4 lines", pct(lens.filter((l) => l < 5).length)],
    ["Functions over 40 lines", lens.filter((l) => l > 40).length],
    ["Longest function", longest ? `${longest.lines} (${longest.where})` : "-"],
    ["Single-use helpers", pct(fns.filter((f) => f.singleUse).length)],
    ["…of them under 10 lines", fns.filter((f) => f.singleUse && f.lines < 10).length],
    ["Import edges", edges.length],
    ["Files in cycles", cyclic.length ? `${cyclic.length} in ${comps.filter((c) => c.length > 1).length} cycles` : 0],
    ["Longest import chain", chain],
    ["ACD", (ccd / n).toFixed(2)],
    ["NCCD", (ccd / btree).toFixed(2)],
    ["Propagation cost", `${((100 * ccd) / (n * n)).toFixed(0)}%`],
    ["Redundant edges", redundant],
    ["Edges toward less stable files", sdp],
    ["Max fan-in", top(inn)],
    ["Max fan-out", top(out)],
  ];
}

const columns = [];
for (const rev of revs.length ? revs : [null]) {
  const commit = rev && commitOf(rev);
  const files = listFiles(commit);
  const root = rev ? materialize(commit, files) : process.cwd();
  try {
    const m = measure(root, files);
    columns.push([rev ?? "working copy", report(m), m.fns.filter((f) => f.singleUse)]);
  } finally {
    if (rev) rmSync(root, { recursive: true });
  }
}

const rows = columns[0][1].map(([label], i) => [label, ...columns.map(([, r]) => String(r[i][1]))]);
console.log(`| | ${columns.map(([c]) => c).join(" | ")} |`);
console.log(`| --- |${columns.map(() => " --- |").join("")}`);
for (const r of rows) console.log(`| ${r.join(" | ")} |`);

if (list) {
  const [label, , helpers] = columns.at(-1);
  console.log(`\nSingle-use helpers in ${label}:`);
  for (const f of helpers) console.log(`  ${f.where}  ${f.name} (${f.lines} lines)`);
}
