#!/usr/bin/env bash

curr_dir="$1"
filename="$2"
linenum="$3"
filepath=$(grealpath --relative-to="$curr_dir" $filename)

url=$(gh browse -n "$filepath:$linenum" --commit=$(git rev-parse HEAD))

# go straight to blame instead of the source
# open "${url//\/blob\//\/blame\/}"

open $url
