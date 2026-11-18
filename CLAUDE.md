
## Project Rules

Follow the project-specific rules under `.claude/rules/`.

These rules define conventions for:

- API development
- Application architecture
- Database access
- TypeScript
- Automated testing

Before implementing a feature, review the approved
documentation under `docs/`.

If a design decision is missing or ambiguous,
explain the alternatives before implementing it.

Do not invent requirements or silently expand scope.


## Git Restrictions

- NEVER execute git add, git commit, git push, or git reset.
- NEVER create, modify, delete, or switch Git branches.
- NEVER modify Git history.
- Git operations are exclusively managed by the developer.
- You may execute read-only Git commands such as git status, git diff, and git log.
- After completing a task, suggest an appropriate Conventional Commit message.
- Do not execute the suggested commit.
- These restrictions apply even if a task has been completed successfully.
