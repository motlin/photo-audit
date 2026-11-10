<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# photo-audit

A Node CLI (not a browser app) that audits a photo/video library for date
problems. The entry point is `src/cli.ts`; run it during development with
`pnpm run audit -- <directory>`.

Build with red/green TDD. The core (`parseDate`, `classify`, `folderDateFor`)
is pure and unit-tested; exiftool and filesystem access stay in thin outer
layers (`metadata`, `walk`, `cli`).

## Formatting

Formatting uses [oxfmt-next-line](https://www.npmjs.com/package/oxfmt-next-line), a fork of oxfmt that puts opening braces on their own line. mise installs it, and it reads `.oxfmtrc.json`. Run `just format` or `oxfmt-next-line`, not `vp fmt`: Vite+'s bundled oxfmt does not support next-line braces, so `vite.config.ts` has no `fmt` block and `just check` runs `vp check --no-fmt`, which lints and type-checks without formatting. The pre-commit `oxfmt` hook enforces formatting in CI.
