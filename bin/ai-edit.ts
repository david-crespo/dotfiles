#! /usr/bin/env -S deno run --allow-env=ANTHROPIC_API_KEY --allow-net

import { readAll } from "jsr:@std/io@0.224"

import Anthropic from "npm:@anthropic-ai/sdk@0.30"
import * as v from "jsr:@valibot/valibot@0.42"
import { parseArgs } from "jsr:@std/cli@1.0"

// read all of stdin
const getStdin = async () => new TextDecoder().decode(await readAll(Deno.stdin)).trim()

// needed for now because the SDK types are not helpful about it
const TextEditorSchema = v.object({
  type: v.literal("tool_use"),
  input: v.object({
    command: v.literal("str_replace"),
    old_str: v.string(),
    new_str: v.string(),
  }),
})

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function askClaude(text: string, instructions: string) {
  const response = await new Anthropic().beta.messages.create({
    model: "claude-3-5-sonnet-latest",
    system:
      `You are a text editor assistant. You will receive some text and some instructions about how to modify it. Use the str_replace command in the str_replace_editor tool to make the requested changes. Return multiple replace calls if making multiple small edits lets you avoid making a large edit.`,
    messages: [{
      role: "user",
      content: `<text>\n${text}\n</text>\n<instructions>\n${instructions}\n</instructions>`,
    }],
    max_tokens: 4096,
    tools: [{ type: "text_editor_20241022", name: "str_replace_editor" }],
    betas: ["computer-use-2024-10-22"],
    tool_choice: { "type": "tool", "name": "str_replace_editor" },
  })

  let result = text
  for (const contentBlock of response.content) {
    const toolCall = v.parse(TextEditorSchema, contentBlock)
    const { old_str, new_str } = toolCall.input
    result = result.replace(old_str, new_str)
  }
  return [response, result]
}

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    boolean: ["debug"],
    alias: { d: "debug" },
  })

  const text = await getStdin()
  invariant(text, "No input provided via stdin")

  const instructions = args._.join(" ")
  invariant(instructions, "No instructions provided via positional args")

  const [response, result] = await askClaude(text, instructions)

  console.log(result)

  // print debug output at the end because the result can be long
  if (args.debug) {
    console.log("\n============\nDEBUG OUTPUT\n============\n")
    console.log(response)
  }
}
