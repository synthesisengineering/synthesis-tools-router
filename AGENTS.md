# Repository Instructions: synthesis-tools-router

## Purpose

This public repository is the Cloudflare Worker that serves
`tools.synthesiswriting.org`. It sends each tool's path prefix to that tool's own
Cloudflare Pages project (today `/slopcheck/` to `slopcheck.pages.dev`), serves the
tools index at `/` and answers every other path with a 404. `README.md` explains
why each tool keeps its own repository and deploys on its own.

## Layout

- `src/worker.js`: the router. Adding a tool is one entry in `TOOL_ROUTES`.
- `scripts/deploy.mjs`: the deploy tool (see Changes and deploys).
- `test/`: the tests, run by Node's own test runner: `worker.test.js` for the
  router, `deploy.test.js` for the deploy tool.
- `wrangler.toml`: the Worker's name and its route on the `synthesiswriting.org` zone.

## Rules

1. Write the test first. A change to routing, the index page, the 404 page or the
   deploy tool comes with a test in `test/` that fails without the change.
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
- A merge to `main` deploys nothing. The deploy tool deploys the Worker, from a
  clean checkout of `main` with wrangler installed (`npm install --no-package-lock`
  installs it into the ignored `node_modules/` and writes no lockfile):

  ```bash
  node scripts/deploy.mjs --dry-run   # the checks and the plan; changes nothing
  node scripts/deploy.mjs             # the production deploy
  ```

  Running it for real is a production deploy of the Worker on its custom domain,
  which the owner approves each time: run it only with the owner's approval for
  that deploy. It refuses, before deploying anything, unless the tree is clean,
  wrangler is installed, and HEAD is the tip of GitHub's `main` with CI passed for
  it there. It then runs
  `wrangler deploy` and reads the live site back: `/` must be the index this
  commit's Worker renders, byte for byte, and `/slopcheck/` must answer with the
  page of the Pages project the Worker sends it to. A deploy is complete only when
  the tool exits 0. `test/deploy.test.js` tests it with every git, gh, wrangler and
  network call faked.
- `npm run deploy` and a bare `wrangler deploy` skip those checks: deploy with the
  tool.
- The Worker is deployed, not released: no tag or package is published from this
  repository.
