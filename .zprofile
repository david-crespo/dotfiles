#!/bin/zsh

# clone repo and cd into it. first arg is repo name, second is optional target
# dir. further args are passed through to jj git clone
oxclone() {
  local repo_name="$1"
  local target_dir="${2:-$1}" # accept a second arg but fall back to first
  jj git clone "https://github.com/oxidecomputer/$repo_name.git" "$target_dir" "${@:3}"
  cd "$target_dir"
}

ghclone() {
  local org="$1"
  local repo_name="$2"
  local target_dir="${3:-$2}" # accept a third arg but fall back to second
  jj git clone "https://github.com/$org/$repo_name.git" "$target_dir" "${@:4}"
  cd "$target_dir"
}

alias jw="jj watch"
alias js="jj status"
alias jd="jj diff"
alias jdnl="jj diff '~package-lock.json & ~Cargo.lock'"
alias jdp="jj diff -r @-"
alias jdps="jj diff -r @- --stat"
alias jr="jj log -n 10"
alias jds="jj diff --stat"
alias jf="jj git fetch"
alias jp="jj git push"
alias jpm="jj git push --remote mine"
alias jpp="jj new && jj tug && jj git push"
# reset on top of main after being done with a PR
alias jrm="jj git fetch && jj new 'trunk()'"

function jjw() {
  if [[ ("$1" == "create" || "$1" == "c") && "$#" -eq 1 ]]; then
    local wspath
    wspath="$(jjw-cmd create)" || return 1
    cd "$wspath"
  else
    jjw-cmd "$@"
  fi
}

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

# choose a PR, returning the PR number only
function pick_pr() {
  gh pr list --limit 100 --json headRefName,number,title,updatedAt,author --template \
    '{{range .}}{{tablerow .number .title .author.name (timeago .updatedAt)}}{{end}}' |
    fzf --height 25% --reverse --accept-nth=1
}

function jpr() {
  local pr="$(pick_pr)"
  [[ -z "$pr" ]] && return
  echo "Checking out PR #$pr"
  gh pr checkout "$pr"
  local branch="$(git branch --show-current)"
  jj git import
  jj bookmark track "$branch" --remote=origin
  jj log -n 2
}

function nu-run {
  nu -c "source ~/.config/nushell/zsh-functions.nu; $*"
}

function nu-alias {
  alias "$1"="nu-run $1"
}

nu-alias jbt
nu-alias upgrade-ra

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

function grp() {
  local ref="${1:-HEAD}"
  git rev-parse "$ref" | ecopy
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

alias dev='npm run dev'
alias ts='./node_modules/.bin/tsc'
alias e2e='npx playwright test'
alias e2ec='npx playwright test --project=chrome'
alias e2es='npx playwright test --project=safari'
alias e2ef='npx playwright test --project=firefox'
alias lint='npm run lint'
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

alias cdk='cd ~/oxide/oxide-computer'
alias cdd='cd ~/oxide/docs'
alias cdo='cd ~/oxide/omicron'
alias cdc='cd ~/oxide/console'

alias ls='eza'
alias l='eza --all --long --group-directories-first --git'
alias lt='eza --all --tree --group-directories-first --git-ignore --level=2'
alias ltt='eza --all --tree --group-directories-first --git-ignore --level=3'

alias sgr='sg run -l rust --pattern'
alias sgt='sg run -l ts --pattern'
alias sgx='sg run -l tsx --pattern'
alias sga='sg run --pattern'

alias ais='ai --search -m gpt-5'
alias aisf='ai --search -m flash'
alias aif='ai -m flash'
alias cbd='cb -l diff'

# default divisor is 4 and it seems pretty good, but you can pass a different one
function tok() {
  local div=${1:-4}
  wc -m | awk -v d="$div" '{printf("%.0f\n",$1/d)}'
}

# vipe: open $VISUAL/$EDITOR on a temp file, then emit contents to stdout
function vipe() {
  local tmp
  tmp="$(mktemp -t vipe)" || return

  # prefill from stdin if present, else start empty
  if [ -t 0 ]; then : >"$tmp"; else cat >"$tmp"; fi

  # choose editor: VISUAL > EDITOR > vi (supports quoted args)
  local -a cmd
  if [[ -n $VISUAL ]]; then
    cmd=("${(z)VISUAL}")
  elif [[ -n $EDITOR ]]; then
    cmd=("${(z)EDITOR}")
  else
    cmd=(vi)
  fi

  "${cmd[@]}" "$tmp" || { rm -f "$tmp"; return $?; }
  cat "$tmp"
  rm -f "$tmp"
}

function ghpr() {
  gh pr list --limit 100 --json number,title,updatedAt,author --template \
    '{{range .}}{{tablerow .number .title .author.name (timeago .updatedAt)}}{{end}}' |
    fzf --height 25% --reverse --accept-nth=1 |
    xargs gh pr checkout
}

alias prc='git push -u && gh pr create --web'
alias prv='gh pr view --web'

function oxdocs() {
  (cd ~/oxide/docs/content && claude "/answer $*")
}

function jjdocs() {
  (cd ~/repos/jj/docs && claude "/answer $*")
}

function hxdocs() {
  (cd ~/repos/helix/book/src && claude "/answer $*")
}

# play happy sound on success and error sound on error
function bell() {
  "$@"
  (($?)) && SOUND="Sosumi" || SOUND="Funk"
  (afplay "/System/Library/Sounds/$SOUND.aiff" &)
  echo -e '\a' # terminal bell
}

function aijq() {
  local input=$(cat)
  local jq_str=$(ai --raw --ephemeral -m sonnet "write jq to $*. output the raw jq string only. no markdown, no codeblock, no backticks, no quotes")
  echo "$input" | jq "$jq_str"
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

function upgrade-agents() {
  codex --version && npm install -g @openai/codex@latest && codex --version
  claude update
  opencode upgrade
}

source "$HOME/.cargo/env"

export PATH="$HOME/.local/bin:$PATH"

# omicron things obviously
export PATH="/Users/david/oxide/omicron/out/dendrite-stub/root/opt/oxide/dendrite/bin:$PATH"
export PATH="/Users/david/oxide/omicron/out/mgd/root/opt/oxide/mgd/bin:$PATH"
export PATH="/Users/david/oxide/omicron/out/clickhouse:$PATH"
export PATH="/Users/david/oxide/omicron/out/cockroachdb/bin:$PATH"

# gate these to suppress noisy warnings whenever codex runs things
[[ -o interactive ]] || return
eval "$(/opt/homebrew/bin/brew shellenv)"
eval "$(fnm env --use-on-cd --resolve-engines=false --shell zsh)"
