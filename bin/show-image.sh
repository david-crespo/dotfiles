#!/bin/sh

# Open image files in Preview.
#
#   show-image plot.png shot.jpg
#
# For agents: `open` is blocked in the Claude Code sandbox, and allowing it
# outright would let an agent launch anything. This is narrow enough to run
# outside the sandbox: it only takes regular files that are named .png, .jpg,
# .jpeg or .gif and whose contents are that kind of image, and it only ever
# opens them in Preview.

set -eu

if [ $# -eq 0 ]; then
  echo "usage: show-image <file.png|.jpg|.jpeg|.gif>..." >&2
  exit 2
fi

for arg in "$@"; do
  # Resolve symlinks first, so the checks are on the file Preview would get.
  # An absolute path also can't be read as a flag by `open`.
  path=$(realpath -- "$arg") || exit 1

  case "$path" in
    *.png | *.PNG) want=image/png ;;
    *.jpg | *.jpeg | *.JPG | *.JPEG) want=image/jpeg ;;
    *.gif | *.GIF) want=image/gif ;;
    *)
      echo "show-image: $arg: not a .png, .jpg, .jpeg or .gif file" >&2
      exit 1
      ;;
  esac

  if [ ! -f "$path" ]; then
    echo "show-image: $arg: not a regular file" >&2
    exit 1
  fi

  got=$(file --brief --mime-type -- "$path")
  if [ "$got" != "$want" ]; then
    echo "show-image: $arg: contents are $got, not $want" >&2
    exit 1
  fi

  set -- "$@" "$path"
  shift
done

exec open -a Preview "$@"
