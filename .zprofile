#!/bin/zsh

# clone repo and cd into it. first arg is repo name, second is optional target
# dir. further args are passed through to jj git clone
oxclone() {
  local repo_name="$1"
  local target_dir="${2:-$1}" # accept a second arg but fall back to first
  jj git clone --colocate "https://github.com/oxidecomputer/$repo_name.git" "$target_dir" "${@:3}"
  cd "$target_dir"
}

alias js="jj status"
alias jd="jj diff"
alias jdp="jj diff -r @-"
alias jr="jj log -n 10"
alias jds="jj diff --stat"
alias jf="jj git fetch"
alias jp="jj git push"
alias jpp="jj new && jj tug && jj git push"
# reset on top of main after being done with a PR
alias jrm="jj git fetch && jj new 'trunk()'"

# fzf jj bookmark picker
function zjb() {
  jj b list -T 'separate("\t", name, normal_target.author().name(), normal_target.description())' |
    column -t -s "	" | # that's a tab lol
    fzf --reverse --height '25%' --accept-nth=1
}

function curr_bookmark {
  jj bookmark list --tracked -r 'trunk()..@' -T 'name++"\n"' | head -1
}

function jpl() {
  local b=$(curr_bookmark)
  jj git fetch --branch "$b"
  jj new "$b"
}

alias jdr='jj diff --from "$(curr_bookmark)@origin"'
alias jbs='jj tug'

# when you accidentally edit a revision with a pushed bookmark, this puts the
# changes in a new commit and resets the bookmark to the origin version
function jsr() {
  local b=$(curr_bookmark)
  jj new "$b"@origin
  jj restore -f "$b"
  jj abandon "$b"
  jj bookmark set "$b" -r "$b"@origin
}

# jj abandon branch
function jab() {
  jj abandon -r "trunk()..$1" && jj bookmark forget "$1"
}

function pick_branch() {
  gh pr list --limit 100 --json headRefName,number,title,updatedAt,author --template \
    '{{range .}}{{tablerow .headRefName .number .title .author.name (timeago .updatedAt)}}{{end}}' |
    fzf --height 25% --reverse --with-nth=2.. --accept-nth=1
}

# same as ghpr except we need the branch name, so we include it in each line,
# hide it from the UI with --with-nth, and then extract it from the output
function jpr() {
  local branch="$(pick_branch)"
  [[ -z "$branch" ]] && return
  echo "Branch name: '$branch'"
  jj git fetch
  jj new "$branch@origin"
}

# same as jpr but tracks the branch too
function jprt() {
  local branch="$(pick_branch)"
  [[ -z "$branch" ]] && return
  echo "Branch name: '$branch'"
  jj git fetch
  jj bookmark track "$branch@origin"
  jj new "$branch@origin"
}

# prune branches, get list of delete remote references,
# attempt to delete local copies, ignoring errors
function gfp() {
  git fetch --prune 2>&1 |
    grep "\[deleted\]" |
    sed -E "s/.+origin\///g" |
    xargs git b -D 2>/dev/null
}

alias gr='git r'
alias gco='git co'
alias grph='git rev-parse HEAD | ecopy'

function grp() {
  if [ -z "$1" ]; then
    echo "Error: missing argument" >&2
    return 1
  fi
  git rev-parse "$1" | ecopy
}

# Execute a command, echo output, and also copy it to the clipboard
function ecopy() {
  local output
  if [ $# -gt 0 ]; then
    output="$*"
  else
    read -r output
  fi
  echo "$output (copied!)"
  echo -n "$output" | pbcopy
}

alias server='python3 -m http.server 8000'

alias cdc='cd ~/oxide/console'
alias dev='npm run dev'
alias ts='./node_modules/.bin/tsc'
alias e2e='npx playwright test'
alias e2ec='npx playwright test --project=chrome'
alias e2es='npx playwright test --project=safari'
alias e2ef='npx playwright test --project=firefox'
alias lint='npm run lint -- --cache'
alias oxlint='./node_modules/.bin/oxlint'

# -v includes homepage, which is very wide
alias outdated='npm outdated --long --json | dq "R.pipe(data, R.entries, R.map(([k, v]) => [k, v.type.startsWith(\"dev\") ? \"dev\" : \"\", v.current, v.wanted, v.latest]), table)"'

alias outdated-v='npm outdated --long --json | dq "R.pipe(data, R.entries, R.map(([k, v]) => [k, v.type.startsWith(\"dev\") ? \"dev\" : \"\", v.current, v.wanted, v.latest, v.homepage]), table)"'

alias api-diff='~/oxide/console/tools/deno/api-diff.ts'
alias npm-clean='dust --no-percent-bars --depth 0 node_modules && echo "Deleting..." && rm -rf node_modules'

alias brew-outdated='brew outdated -v | grep -vf ~/.local/share/brew-outdated-exclude.txt'

function brew-why() {
  for package in $(brew-outdated | awk '{ print $1 }'); do
    echo "---------------"
    echo "Package: $package"
    brew uses --installed "$package"
  done
}

alias cdo='cd ~/oxide/omicron'

alias nt='cargo t -p omicron-nexus --no-fail-fast --success-output immediate'

function ntpick() {
  print -z -- "nt $(ntpicker)"
}

# list all nexus integration tests and run them through fzf to pick one
function ntpicker() {
  rg -A1 "#\[nexus_test" --no-heading -N |
    rg --replace '$module::$function' --no-filename \
      --only-matching '/(?P<module>[^/]+).rs-[ ]*async fn (?P<function>test_[^(]+)' |
    fzf --reverse
}

alias update-auth='EXPECTORATE=overwrite nt unauthorized'

alias clippy='cargo xtask clippy'
alias uuid='uuidgen | tr "[:upper:]" "[:lower:]" | ecopy'
alias sweep='cargo sweep -t 5'

alias cdk='cd ~/oxide/oxide-computer'
alias cdd='cd ~/oxide/docs'

alias ls='eza'
alias l='eza -l --all --group-directories-first --git'
alias lt='eza -T --git-ignore --level=2 --group-directories-first'
alias ltt='eza -T --git-ignore --level=3 --group-directories-first'
alias llt='eza -lT --git-ignore --level=2 --group-directories-first'

alias sgr='sg run -l rust --pattern'
alias sgt='sg run -l ts --pattern'
alias sgx='sg run -l tsx --pattern'
alias sga='sg run --pattern'

alias hxconf='hx ~/.config/helix/config.toml'

# make it easier to check up on helix updates because I'm insane
alias hxpr='gh search prs -R helix-editor/helix --sort updated --state open --limit 20'
alias hxprw="open 'https://github.com/helix-editor/helix/pulls?q=is%3Apr+is%3Aopen+sort%3Aupdated-desc'"

function hxcm() {
  gh api '/repos/helix-editor/helix/commits?per_page=20' |
    jq -r '.[] | [(.commit.message | split("\n")[0]), .author.login, .commit.committer.date] | @tsv' |
    rg -v 'dependabot' |
    gum table --print --separator "	" -c Message,Author,Date
}

function ghpr() {
  gh pr list --limit 100 --json number,title,updatedAt,author --template \
    '{{range .}}{{tablerow .number .title .author.name (timeago .updatedAt)}}{{end}}' |
    fzf --height 25% --reverse --accept-nth=1 |
    xargs gh pr checkout
}

alias prc='git push -u && gh pr create --web'
alias prv='gh pr view --web'

function gcob() {
  git b |
    grep -v " \* " |
    fzf --ansi --height 25% --reverse --accept-nth=1 |
    xargs git co
}

# delete branch (with picker)
function gdlb() {
  git b |
    grep -v "^\* " |
    fzf --ansi --height 25% --reverse |
    awk '{print $1}' |
    xargs git b -D
}

function gdsnl() {
  git diff --stat $1 -- . :^package-lock.json :^yarn.lock
}

function aip() {
  pbpaste | cb | ai "$@"
}

alias fp='files-to-prompt'

# play happy sound on success and error sound on error
function bell() {
  "$@"
  (($?)) && SOUND="Sosumi" || SOUND="Funk"
  (afplay "/System/Library/Sounds/$SOUND.aiff" &)
}

function findrep() {
  local old_pattern="$1"
  local new_pattern="$2"
  local glob_pattern="$3"
  local matching_files

  matching_files=($(rg -l "$old_pattern" "$glob_pattern"))
  match_count=$(rg "$old_pattern" "$glob_pattern" | wc -l | xargs echo)

  if ((!${#matching_files})); then
    echo "No matches found."
    return
  fi

  rg --color always "$old_pattern" "$glob_pattern"

  echo ''
  read "response?Replace all $match_count matches? (y/N) "
  [[ "$response" == [yY] ]] || return

  for file in $matching_files; do
    sd "$old_pattern" "$new_pattern" "$file"
  done
  echo "Done."
}

function aijq() {
  local input=$(cat)
  local jq_str=$(ai --raw --ephemeral -m sonnet "write jq to $*. output the raw jq string only. no markdown, no codeblock, no backticks, no quotes")
  echo "$input" | jq "$jq_str"
}

function find-space() {
  {
    find ~/oxide -maxdepth 3 -type d \( -name "node_modules" -o -name "target" \)
    find ~/repos -maxdepth 3 -type d \( -name "node_modules" -o -name "target" \)
    ls -d ~/.rustup/toolchains/*
    echo ~/Library/Caches
  } |
    xargs dust -d 0 -p
  df -H /
}

function clear-space() {
  brew cleanup

  for dir in ~/oxide/dendrite ~/oxide/maghemite; do
    echo "$dir"
    cd "$dir" && cargo clean
  done
  for dir in ~/oxide/docs ~/oxide/rfd-site; do
    echo "$dir"
    cd "$dir" && npm-clean
  done
}

alias tviz='~/repos/things-viz/main.ts'
alias tsearch='~/repos/things-viz/search.ts'

function tts() {
  if [ -p /dev/stdin ]; then
    edge-playback --file -
  else
    edge-playback --text "$*"
  fi
}

source "$HOME/.cargo/env"

eval "$(/opt/homebrew/bin/brew shellenv)"

eval "$(fnm env --use-on-cd --resolve-engines=false --shell zsh)"

export PATH="$HOME/.local/bin:$PATH"
export PATH="/Users/david/oxide/omicron/out/dendrite-stub/root/opt/oxide/dendrite/bin:$PATH"
export PATH="/Users/david/oxide/omicron/out/mgd/root/opt/oxide/mgd/bin:$PATH"
export PATH="/Applications/Racket v8.11.1/bin:$PATH"
