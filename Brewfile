# What a machine needs installed, Mac or Linux. `brew bundle` installs what's
# missing, `brew bundle check` says whether this machine has everything, and
# `brew bundle cleanup` lists what's installed but not here. Versions aren't
# pinned: the list is the minimum, not a lockfile.
#
# Not here, because they come from their own installers (see
# dotfiles-private/vm/bootstrap.sh): rustup and cargo tools, deno, bun, node
# (fnm) and the npm globals (`npm-globals` in .zprofile), Claude Code, Rex, and
# the Helix fork.

# Shell and everyday CLI
brew "atuin"
brew "bat"
brew "dust"
brew "entr"
brew "eza"
brew "fd"
brew "fzf"
brew "gawk"
brew "git-delta"
brew "glow"
brew "gnu-sed"
brew "gum"
brew "jq"
brew "parallel"
brew "ripgrep"
brew "sd"
brew "tlrc"
brew "tree"
brew "watch"
brew "watchexec"
brew "yq"
brew "zoxide"

# Version control and GitHub
brew "gh"
brew "jj"
brew "mergiraf"

# Code tools
brew "actionlint"
brew "ast-grep"
brew "cargo-binstall"
brew "fnm"
brew "go"
brew "hyperfine"
brew "just"
brew "serpl"
brew "tokei"
brew "uv"

# Language servers Helix uses (the npm ones are in npm-globals)
brew "rust-analyzer"
brew "taplo"

# Docs and diagrams
brew "d2"
brew "vale"

if OS.mac?
  # omicron's tools/install_builder_prerequisites.sh. On Linux it installs
  # its own apt packages, and pkg-config comes from apt so it finds them.
  brew "coreutils"
  brew "libxmlsec1"
  brew "pkgconf"
  brew "postgresql@18"

  brew "asciidoctor"
  brew "asciinema"
  brew "bash"
  brew "binaryen"
  brew "cloudflared"
  brew "f2"
  brew "googleworkspace-cli"
  brew "imagemagick"
  brew "libxslt"
  brew "license-eye"
  brew "minimal-racket"
  brew "mpv"
  brew "neovim"
  brew "pandoc"
  brew "pipx"
  brew "poppler"
  brew "prettierd"
  brew "qpdf"
  brew "switchaudio-osx"

  cask "gcloud-cli"
end
