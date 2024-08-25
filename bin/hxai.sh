#!/usr/bin/env bash

# Wrapper around LLM CLI that is meant for direct inline use in helix. 
#
# -m sonnet is a default choice, but you can override it by passing a
# second -m arg at # call time.

 ai -m sonnet --raw --system "You are part of a code completion system in a text editor. You will receive a prompt and possibly some code to replace. Your output will be inserted directly into a text file, so only output code -- do not wrap it in a markdown code block. Do NOT include prose commentary or explanation." "$@"
