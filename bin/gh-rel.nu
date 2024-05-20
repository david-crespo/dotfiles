#!/usr/bin/env nu

let repos = [
  { repo: 'biomejs/biome', file: null }
  { repo: 'colinhacks/zod', file: null }
  { repo: 'denoland/deno', file: null }
  { repo: 'charmbracelet/glow', file: null }
  { repo: 'charmbracelet/gum', file: null }
  { repo: 'element-hq/element-web', file: null }
  { repo: 'element-hq/element-x-ios', file: null }
  { repo: 'junegunn/fzf', file: 'master/CHANGELOG.md' }
  { repo: 'martinvonz/jj', file: null }
  { repo: 'microsoft/playwright', file: null }
  { repo: 'microsoft/typescript', file: null }
  { repo: 'mswjs/msw', file: null }
  { repo: 'prettier/prettier', file: 'main/CHANGELOG.md' }
  { repo: 'recharts/recharts', file: null }
  { repo: 'react-hook-form/react-hook-form', file: null }
  { repo: 'remix-run/react-router', file: 'main/CHANGELOG.md' }
  { repo: 'remix-run/remix', file: 'main/CHANGELOG.md' }
  { repo: 'rust-lang/rust-analyzer', file: null }
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

def search_repos [input: string] {
  (gh search repos $input --json fullName,description --template '{{range .}}{{tablerow .fullName .description}}{{end}}' | 
    fzf | cut -f 1 -d ' ')
}

def main [
  --list (-l) # list releases instead of showing latest single release
  --search (-s): string # search github for repo
]: nothing -> nothing {
  let repo = match $search {
    null => { pick_repo }
    _ => { search_repos $search }
  }

  if ($repo | is-empty) { exit }
  let file = $repos | find -c [repo] $repo | get file | get 0 -i # -i means don't error if list is empty

  if $list {
    gh release list -R $repo
    exit
  }

  match $file {
    null => { gh release view -R $repo --json name,body,createdAt -t $release_template | glow -p }
    _ => { curl $"https://raw.githubusercontent.com/($repo)/($file)" | glow -p }
  }
}
