#!/usr/bin/env nu

let repos = [
  { repo: 'anthropics/claude-code', file: 'main/CHANGELOG.md' }
  { repo: 'biomejs/biome', file: null }
  { repo: 'colinhacks/zod', file: null }
  { repo: 'denoland/deno', file: null }
  { repo: 'charmbracelet/glow', file: null }
  { repo: 'charmbracelet/gum', file: null }
  { repo: 'element-hq/element-web', file: null }
  { repo: 'element-hq/element-x-ios', file: null }
  { repo: 'junegunn/fzf', file: 'master/CHANGELOG.md' }
  { repo: 'jjvcs/jj', file: null }
  { repo: 'microsoft/playwright', file: null }
  { repo: 'microsoft/typescript', file: null }
  { repo: 'mswjs/msw', file: null }
  { repo: 'openai/codex', file: null }
  { repo: 'prettier/prettier', file: 'main/CHANGELOG.md' }
  { repo: 'recharts/recharts', file: null }
  { repo: 'remeda/remeda', file: null }
  { repo: 'react-hook-form/react-hook-form', file: null }
  { repo: 'remix-run/react-router', file: 'main/CHANGELOG.md' }
  { repo: 'remix-run/remix', file: 'main/CHANGELOG.md' }
  { repo: 'rust-lang/rust-analyzer', file: null }
  { repo: 'sst/opencode', file: null }
  { repo: 'tailwindlabs/tailwindcss', file: null }
  { repo: 'TanStack/query', file: null }
  { repo: 'vitejs/vite', file: 'main/packages/vite/CHANGELOG.md' }
  { repo: 'vitest-dev/vitest', file: null }
];

let release_template = '# {{.name}}

{{timefmt "2006-01-02" .createdAt}} ({{timeago .createdAt}})
{{.body}}'

def pick_repo [] {
  ($repos | get repo | to text | fzf --height 25% | str trim)
}

# TODO: fzf key bindings https://github.com/junegunn/fzf?tab=readme-ov-file#executing-external-programs

def main [
  --list (-l) # list releases instead of showing latest single release
  repo_filter?: string # match against repo names
]: nothing -> nothing {
  let repo = match $repo_filter {
    null => { pick_repo }
    _ => {
      let matches = ($repos | where repo =~ $repo_filter | get repo)
      if ($matches | length) == 0 {
        print -e $"error: no repos match substring '($repo_filter)'"
        exit 1
      } else if ($matches | length) == 1 {
        $matches | get 0
      } else {
        print -e $"error: multiple repos match substring '($repo_filter)':"
        print -e ($matches | str join "\n  ")
        exit 1
      }
    }
  }

  if ($repo | is-empty) { exit }
  let file = $repos | find -c [repo] $repo | get file | get 0

  # file is always a list, so the list flag is irrelevant
  if ($file != null) {
    curl $"https://raw.githubusercontent.com/($repo)/($file)" | glow -p
    exit
  }

  if $list {
    gh release list -R $repo
  } else {
    gh release view -R $repo --json name,body,createdAt -t $release_template | glow -p
  }
}
