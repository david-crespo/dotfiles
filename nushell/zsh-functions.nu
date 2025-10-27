# Functions callable from zsh via nu -c

# Track bookmark. optional -r arg
def jbt [
  --revision (-r): string  # revision to track bookmark for (default: @-)
] {
  let rev = if ($revision | is-empty) { "@-" } else { $revision }

  let bookmark = (jj b l -r $rev -T 'name' | str trim)
  jj bookmark track $"($bookmark)@origin"
}
