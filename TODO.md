# Existing Tasks (JS era complete, TS migration done)

## Old Plan Steps (Completed)

1-9 ✅ TypeScript migration, tests, build verified.

## New Task: Add Git Husky for code formatting (Prettier) and commitlint before push/commit

### Steps:

- ✅ Step 1: Update package.json (deps ✅, scripts optional - use npx).
- ✅ Step 2: Create .prettierrc.json
- ✅ Step 3: Create lint-staged.config.mjs
- ✅ Step 4: Create commitlint.config.mjs
- ✅ Step 5: Update .husky/pre-commit to `npx lint-staged`
- ✅ Step 6: Create .husky/prepare-commit-msg `npx commitlint --edit $1`
- ✅ Step 7: `npm install`
- ✅ Step 8: `npx husky init`
- ✅ Step 9: `npx prettier --write .` formatted codebase.
- ✅ Step 10: Add lint to CI.
- ✅ Step 11: Task complete, test hooks with `git commit`.
- ✅ Step 12: Fix remaining Prettier issues in TODO.md itself.
- ✅ Step 13: Verify pre-commit (lint-staged Prettier all files), commitlint (types: feat, fix, docs, chore...).

**Hooks Ready ✅**

## Fix lint-staged Pre-commit Error ✅

- Prettier `"No parser"` error fixed — lint-staged now passes `${files.join(' ')}` correctly.
