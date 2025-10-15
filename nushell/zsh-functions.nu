# Functions callable from zsh via nu -c

# Track bookmark. optional -r arg
def jbt [
  --revision (-r): string  # revision to track bookmark for (default: @-)
] {
  let rev = if ($revision | is-empty) { "@-" } else { $revision }

  let bookmark = (jj b l -r $rev -T 'name' | str trim)
  jj bookmark track $"($bookmark)@origin"
}

# Upgrade rust-analyzer to the latest nightly, verifying the hash
def upgrade-ra [] {
  let release = (gh release view -R rust-lang/rust-analyzer --json assets | from json)
  let asset = ($release.assets | where name =~ "aarch64-apple-darwin" | first)
  let temp_file = "/tmp/rust-analyzer.gz"

  curl -L $asset.url -o $temp_file

  let expected_hash = ($asset.digest | str replace "sha256:" "")
  let actual_hash = (shasum -a 256 $temp_file | awk '{print $1}')
  if $actual_hash != $expected_hash {
    error make {msg: $"Hash mismatch: expected '($expected_hash)', got '($actual_hash)'"}
  }

  let bin_path = $"($env.HOME)/.local/bin/rust-analyzer"
  gunzip -c $temp_file | save --force $bin_path
  chmod +x $bin_path

  rm $temp_file
}
