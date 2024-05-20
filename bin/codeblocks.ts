#!/usr/bin/env -S deno run --allow-read

import { extname } from "https://deno.land/std@0.224.0/path/mod.ts";
import { parseArgs } from "https://deno.land/std@0.224.0/cli/parse_args.ts";

// adoc doesn't display right in glow but it does on github
const LANGS = ["rs", "ts", "tsx", "js", "json", "adoc", "sh"];

const args = parseArgs(Deno.args, {
  boolean: ["collapse"],
  alias: { c: "collapse" },
});

for (const filename of args._) {
  const file = filename.toString();
  // only look at files
  if (!(await Deno.lstat(file)).isFile) continue;

  if (args.collapse) {
    console.log("<details>");
    console.log(`  <summary>${file}</summary>\n`);
  } else {
    console.log(`\n---\n\n### \`${file}\`\n\n`);
  }

  const ext = extname(file).slice(1);
  if (ext === "md") {
    // for markdown, just render the contents directly
    console.log(await Deno.readTextFile(file));
    console.log();
    continue;
  }

  const lang = LANGS.includes(ext) ? ext : "";
  const content = await Deno.readTextFile(file);
  console.log(`\`\`\`${lang}\n${content}\n\`\`\`\n`);

  if (args.collapse) console.log("</details>");
}
