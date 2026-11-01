# Git Safety

The user controls staging, commits, pushes and history changes. A request to edit files does not authorize Git operations.

## Before changing Git

Check the exact repository root, branch, HEAD, upstream (when relevant), and staged, unstaged and untracked changes. Check other worktrees when the operation could affect them. Don't infer the branch from the directory name.

`git status`, `git diff` and `git log` are safe for inspection. A dirty checkout is normal; don't clean it up just to make a task look finished.

## Protect existing work

- Never discard, hide or overwrite existing changes you don't own.
- Don't reset, broadly restore, clean untracked files, stash unknown work, rebase or rewrite history without permission for that specific operation.
- Before removing a branch or worktree, check its uncommitted files, untracked files and commits that may exist nowhere else. Removal needs explicit permission.
- Create worktrees only for a real isolation need, and don't modify other worktrees as incidental cleanup.

## Staging and commits

- Stage only the paths or hunks included in the user's authorization. Don't use `git add .` or `git add -A` in a dirty checkout unless the user explicitly wants all changes.
- Before an authorized commit, check the staged diff and run the relevant verification.
- Use conventional commit messages: `type(scope?): description`. Typical types are `feat`, `fix`, `refactor`, `test`, `docs` and `chore`. Add a scope when it makes the change clearer.
- After committing, report the commit SHA and Git status. Don't include unrelated staged changes.

## Pushes and history changes

- A request to commit does not authorize a push. A request to push does not authorize a force-push.
- Never tag, publish, amend, reset, rebase, force-push or rewrite history without separate permission for that operation.
- Inspect the exact target and likely impact before any authorized destructive operation.
