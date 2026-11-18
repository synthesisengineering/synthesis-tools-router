# tools-synthesiswriting-router

Cloudflare Worker that serves `tools.synthesiswriting.org` and routes URL path prefixes to per-tool Pages projects.

## Architecture

```
tools.synthesiswriting.org/
├── /slopcheck and /slopcheck/*  → proxies to slopcheck.pages.dev
├── /                            → minimal tools-index landing page
└── (anything else)              → 404
```

Adding a new tool: append an entry to `TOOL_ROUTES` in `src/worker.js`. One line. The Pages project deploys independently of this Worker.

## Why a router and not a single multi-tool Pages project

- Each tool keeps its own repo, deploy lifecycle, KV bindings, secrets, environment surface.
- One tool's deploy doesn't risk breaking another tool.
- Tools can use different stacks (Pages + Functions, pure static, Workers).
- The router is ~50 lines and changes only when a tool is added.

## Deploy

```sh
cd synthesis-tools-router
node scripts/deploy.mjs --dry-run   # the checks and the plan; changes nothing
node scripts/deploy.mjs             # the production deploy, with the owner's approval for it
```

The deploy tool refuses unless the checkout is clean and at the tip of GitHub's `main` with CI passed, then runs `wrangler deploy` and reads `/` and `/slopcheck/` back from the live site. The `wrangler.toml` declares the `tools.synthesiswriting.org/*` route on the `synthesiswriting.org` zone, so deploys take effect immediately.

## Files

- `src/worker.js` — the router logic
- `scripts/deploy.mjs` — the deploy tool
- `wrangler.toml` — Worker config + route binding
- `package.json` — scripts (deploy / dev / tail)
