#!/bin/zsh

function hxblame () {
  curr_dir="$1"
  filename="$2"
  linenum="$3"
  filepath=$(grealpath --relative-to="$curr_dir" $filename)

  url=$(gh browse -n "$filepath:$linenum" --commit=$(git rev-parse HEAD))

  # go straight to blame instead of the source
  # open "${url//\/blob\//\/blame\/}"

  open $url
}

# Wrapper around LLM CLI meant for direct inline use with pipe: in helix. 
#
# -m sonnet is a default that can be overridden by passing -m again
function hxai () {
  ai -m sonnet --raw --system "You are part of a code completion system in a text editor. You will receive a prompt and possibly some code to replace. Your output will be inserted directly into a text file, so only output code -- do not wrap it in a markdown code block. Do NOT include prose commentary or explanation." "$@"
}
