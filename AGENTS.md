# Repository Instructions: synthesis-tools-router

## Purpose

This public repository is the Cloudflare Worker that serves
`tools.synthesiswriting.org`. It sends each tool's path prefix to that tool's own
Cloudflare Pages project (today `/slopcheck/` to `slopcheck.pages.dev`), serves the
tools index at `/` and answers every other path with a 404. `README.md` explains
why each tool keeps its own repository and deploys on its own.

## Layout

- `src/worker.js`: the router. Adding a tool is one entry in `TOOL_ROUTES`.
- `test/worker.test.js`: the tests, run by Node's own test runner.
- `wrangler.toml`: the Worker's name and its route on the `synthesiswriting.org` zone.

## Rules

1. Write the test first. A change to routing, the index page or the 404 page comes
   with a test in `test/` that fails without the change.
2. Do not add credentials, personal paths or private names to this public
   repository.

## Verification

CI runs exactly what you run locally, and it is the only gate:

```bash
npm test
```

`.github/workflows/ci.yml` runs it on every pull request and on every push to
`main`. Its `ci` job passes only when every job before it passed. That job is the
one check branch protection requires, so the jobs can change without touching the
repository's settings.

The Worker has no runtime dependencies and the tests import it directly, so CI
installs nothing. A change that adds a dependency also commits `package-lock.json`
and adds `npm ci` before the tests.

## Changes and deploys

- Every change reaches `main` through a pull request whose `ci` check passed.
- A merge to `main` deploys nothing. `npm run deploy` (`wrangler deploy`) is a
  production deploy of the Worker on its custom domain. Run it by hand from a clean
  checkout of `main`, and only with the owner's approval for that deploy.
- The Worker is deployed, not released: no tag or package is published from this
  repository.
