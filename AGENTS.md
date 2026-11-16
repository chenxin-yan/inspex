## Tests

- Vitest via Vite+: `import { describe, expect, it, vi } from "vite-plus/test"`; `pnpm run test` (builds `dist/` first), or `pnpm exec vp test run [file]` after `pnpm run build`: the end-to-end tests in `tests/` run the 7.1 compiler on `tests/fixtures`, with `dist/server.js` as the content mapper.
- `openapi-typescript` is a test oracle only (`tests/differential.test.ts`); nothing it needs may become a runtime dependency.
- Unit tests are co-located (`src/foo.test.ts` beside `src/foo.ts`); integration tests go in `tests/`.
- CI runs every test on Linux, and on macOS and Windows the files tagged for them with a `@module-tag macos` / `@module-tag windows` comment. A mapper runs inside the compiler on every host, so tag tests that touch paths, processes or the file system.

## Docs

`README.md` is the npm landing page (what it is, install, setup, options, examples, short limits); reference material (diagnostics, differences, keyword table, cost) goes in `docs/reference.md`, linked by absolute GitHub URL.

## Gates

`pnpm run check && pnpm run check:types && pnpm run test && pnpm run build`

## Changesets

Do not edit `CHANGELOG.md` by hand. Run `pnpm run changeset` to record user-visible changes; the release workflow consumes them. Skip changesets for changes with no effect on users (refactors, tests, docs, CI, tooling).

## Releases

`main` is released by `.github/workflows/release.yml` through npm trusted publishing. Never publish from a local machine after the first version, and never merge the release pull request without the maintainer's go-ahead.
