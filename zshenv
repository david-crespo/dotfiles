#!/bin/zsh

# Wrapper around LLM CLI meant for direct inline use with pipe: in helix. 
#
# -m sonnet is a default that can be overridden by passing -m again
function hxai () {
  ai -m sonnet --raw --system "You are part of a code completion system in a text editor. You will receive a prompt and possibly some code to replace. Your output will be inserted directly into a text file, so only output code -- do not wrap it in a markdown code block. Do NOT include prose commentary or explanation." "$@"
}
