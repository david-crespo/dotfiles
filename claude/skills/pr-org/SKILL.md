---
name: pr-org
description: Analyze commits and propose a cleaner commit organization for a PR
---

# PR Organization

Analyze commits between the current branch and main, then propose a cleaner organization.

## On invocation

1. Run `jj log -r 'main..@-' --no-graph` to list commits
2. For each commit, run `jj show -r <rev> --stat` to see what files changed
3. Run `jj diff -r 'main..@-' --stat` to see the net changes

## Analysis

Identify:
- **Canceling commits**: Files added then removed (e.g., PLAN.md) that net to zero
- **Logical threads**: Changes that belong together by purpose
- **Iterative work**: Multiple commits touching the same files that could be unified
- **Coupling**: Changes that only make sense together

## Proposal

Present options, typically:
- **Single commit**: When all changes serve one purpose; often the cleanest
- **N commits**: When there are genuinely distinct logical units
- **Stacked PRs**: When parts of the work are uncontroversial and independently reviewable

Consider a stack when:
- Infrastructure/refactoring can land separately from the feature using it
- A complex change has an easy-to-approve foundation
- Uncontroversial cleanup would otherwise bloat a contentious PR
- Earlier PRs unblock review of later ones (reviewers can focus on one thing at a time)

For each option, provide suggested commit/PR messages. Favor fewer commits unless separation adds clarity for reviewers. A single well-described commit is better than arbitrary splits, but a stack of small PRs can be better than one large PR.

## Execution

If the user approves an organization, use jj commands to restructure:
- `jj squash --from <rev> --into <rev>` to combine commits
- `jj split` to separate commits
- `jj describe -r <rev> -m "message"` to update messages

For stacked PRs, create branches at each split point with `jj branch create` and push them separately. Each PR targets the previous branch (or main for the first).
