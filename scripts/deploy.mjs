#!/usr/bin/env node
// Deploy the router Worker to tools.synthesiswriting.org.
//
// Running this for real is a production deploy, which the owner approves each time: run it only with the owner's
// approval for that deploy. `--dry-run` runs the checks and prints the plan, and changes nothing.
//
//   node scripts/deploy.mjs --dry-run   # the checks and the plan; changes nothing
//   node scripts/deploy.mjs             # the production deploy
//
// It refuses, before deploying anything, unless the tree is clean, wrangler is installed (`npm install --no-package-lock`
// installs it into the ignored node_modules/ and writes no lockfile), and HEAD is the tip of main on GitHub (read with
// git's own config left out) with CI passed for it there. It then runs `wrangler deploy` from this checkout and reads
// the live site back: / must be the index this commit's Worker renders, byte for byte, and /slopcheck/ must answer 200
// with the page of the Pages project this commit's Worker sends it to. A deploy is complete only when this exits 0.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { devNull } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../src/worker.js";

export const REPOSITORY = "synthesisengineering/synthesis-tools-router";
export const REMOTE = `https://github.com/${REPOSITORY}.git`;
export const SITE = "https://tools.synthesiswriting.org";
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// What git reads and runs here is the repository's own objects and nothing its config adds.
const GIT = ["git", "--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];
const DEPLOY = ["npx", "--no-install", "wrangler", "deploy"];
// GitHub's own server errors, which the same request usually gets past a moment later.
const TRANSIENT = /HTTP 5\d\d|Bad Gateway|Service Unavailable|Gateway Time-?out|unexpected end of JSON input|connection reset|i\/o timeout|TLS handshake timeout/i;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function runCommand(argv, { cwd, env, timeout = 120_000, inherit = false } = {}) {
  const stdio = ["ignore", inherit ? "inherit" : "pipe", inherit ? "inherit" : "pipe"];
  const result = spawnSync(argv[0], argv.slice(1), { cwd, env, timeout, encoding: "utf8", stdio });
  if (result.error) {
    return { status: result.error.code === "ETIMEDOUT" ? 124 : 127, stdout: "", stderr: `cannot run ${argv[0]}: ${result.error.message}` };
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function tail(proc, lines = 3) {
  const text = (proc.stderr || "").trim() || (proc.stdout || "").trim();
  return text.split("\n").slice(-lines).join(" | ") || `exit ${proc.status}`;
}

// git's environment for what it reads from GitHub: no global or system config, so nothing rewrites where it connects.
function cleanEnv() {
  return { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull, GIT_TERMINAL_PROMPT: "0" };
}

function sameFolder(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

// { passed, detail } for the commit's CI on GitHub. Unknown is not passed.
export async function ciState(sha, { run = runCommand, sleep = delay } = {}) {
  let proc;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    proc = run(["gh", "run", "list", "-R", `github.com/${REPOSITORY}`, "--commit", sha, "--json",
      "status,conclusion,workflowName", "--limit", "50"], { timeout: 60_000 });
    if (proc.status === 0 || attempt === 3 || !TRANSIENT.test(tail(proc))) break;
    await sleep(10_000 * attempt);
  }
  let runs = null;
  if (proc.status === 0) {
    try {
      runs = JSON.parse(proc.stdout);
    } catch {
      runs = null;
    }
  }
  const short = sha.slice(0, 12);
  if (!Array.isArray(runs)) return { passed: false, detail: `cannot read CI for ${short} (is gh installed and signed in?): ${tail(proc)}` };
  if (!runs.length) return { passed: false, detail: `no CI run for ${short} yet; wait for CI on main` };
  const pending = runs.filter((r) => r.status !== "completed").map((r) => r.workflowName ?? "?");
  const failed = runs.filter((r) => r.status === "completed" && !["success", "skipped", "neutral"].includes(r.conclusion))
    .map((r) => r.workflowName ?? "?");
  if (pending.length || failed.length) {
    return { passed: false, detail: `CI for ${short}: running ${pending.join(", ") || "none"}, failed ${failed.join(", ") || "none"}` };
  }
  return { passed: true, detail: `CI passed for ${short} (${runs.length} run(s))` };
}

// { head, problems } for a deploy of the checkout `repo`; nothing is deployed unless problems is empty.
export async function preflight({ repo = ROOT, run = runCommand, sleep = delay } = {}) {
  const top = run([...GIT, "-C", repo, "rev-parse", "--show-toplevel"]);
  if (top.status !== 0 || !sameFolder(top.stdout.trim(), repo)) {
    return { head: "", problems: [`${repo} is not the root of a git checkout`] };
  }
  const problems = [];
  const status = run([...GIT, "-C", repo, "status", "--porcelain"]);
  if (status.status !== 0) problems.push(`cannot read the tree's state: ${tail(status)}`);
  else if (status.stdout.trim()) {
    const paths = status.stdout.trim().split("\n").map((line) => line.trim());
    problems.push(`the tree has uncommitted changes: ${paths.slice(0, 3).join(", ")}${paths.length > 3 ? ", ..." : ""}`);
  }
  const wrangler = run(["npx", "--no-install", "wrangler", "--version"], { cwd: repo, timeout: 60_000 });
  if (wrangler.status !== 0) {
    problems.push("wrangler is not installed here or on PATH: `npm install --no-package-lock` installs it into the "
      + "ignored node_modules/ and leaves the tree clean");
  }
  const head = run([...GIT, "-C", repo, "rev-parse", "HEAD"]).stdout.trim();
  const listed = run([...GIT, "ls-remote", REMOTE, "refs/heads/main"], { env: cleanEnv() });
  const main = listed.status === 0 ? (listed.stdout.match(/^([0-9a-f]{40})\trefs\/heads\/main$/m)?.[1] ?? "") : "";
  if (!main) {
    problems.push(`cannot read ${REPOSITORY} main on GitHub: ${tail(listed)}`);
  } else if (main !== head) {
    problems.push(`HEAD ${head.slice(0, 12) || "unread"} is not the tip of ${REPOSITORY} main (${main.slice(0, 12)}): `
      + "deploy only what is merged there; pull, or merge its pull request first");
  }
  if (!head) {
    problems.push("cannot read HEAD");
  } else {
    const ci = await ciState(head, { run, sleep });
    if (!ci.passed) problems.push(ci.detail);
  }
  return { head, problems };
}

// Where this commit's Worker sends a tool's path: it runs with a fetch that records the request and answers nothing.
async function toolOrigin(site, toolPath) {
  const seen = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (request) => {
    seen.push(String(request.url ?? request));
    return new Response(null, { status: 204 });
  };
  try {
    await worker.fetch(new Request(`${site}${toolPath}`), {}, {});
  } finally {
    globalThis.fetch = saved;
  }
  return seen[0] ?? "";
}

async function get(fetchImpl, url) {
  try {
    const response = await fetchImpl(url, { headers: { "cache-control": "no-cache" } });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    return { status: 0, body: "", error: String(error?.message ?? error) };
  }
}

function titleOf(body) {
  return (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
}

function said(answer) {
  return answer.error ? `nothing (${answer.error})` : `${answer.status} "${titleOf(answer.body)}"`;
}

// Read the live site back after a deploy, a few times while the new Worker reaches the edge.
export async function readBack({ site = SITE, fetchImpl = (...args) => globalThis.fetch(...args), sleep = delay,
  attempts = 6, interval = 10_000 } = {}) {
  const index = await (await worker.fetch(new Request(`${site}/`), {}, {})).text();
  const origin = await toolOrigin(site, "/slopcheck/");
  let problems = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const home = await get(fetchImpl, `${site}/`);
    const tool = await get(fetchImpl, `${site}/slopcheck/`);
    const source = origin ? await get(fetchImpl, origin) : { status: 0, body: "", error: "this commit routes no /slopcheck/" };
    const want = titleOf(source.body);
    problems = [];
    if (home.status !== 200 || home.body !== index) {
      problems.push(`${site}/ answers ${said(home)}, not the index this commit's Worker renders`);
    }
    if (tool.status !== 200 || source.status !== 200 || !want || titleOf(tool.body) !== want) {
      problems.push(`${site}/slopcheck/ answers ${said(tool)}, not the page of ${origin || "its Pages project"} (${said(source)})`);
    }
    if (!problems.length) {
      return { ok: true, lines: [`${site}/: the index this commit's Worker renders`, `${site}/slopcheck/: ${origin}'s page, "${want}"`] };
    }
    if (attempt < attempts) await sleep(interval);
  }
  return { ok: false, problems };
}

export async function main(argv = process.argv.slice(2), { repo = ROOT, run = runCommand, fetchImpl, sleep = delay,
  log = console.log, attempts, interval } = {}) {
  const unknown = argv.filter((arg) => arg !== "--dry-run");
  if (unknown.length) {
    log(`usage: node scripts/deploy.mjs [--dry-run]\nnot an option of it: ${unknown.join(" ")}`);
    return 2;
  }
  const { head, problems } = await preflight({ repo, run, sleep });
  if (problems.length) {
    log(`refused before deploying anything:\n  ${problems.join("\n  ")}`);
    return 1;
  }
  const ready = `preflight: ${head.slice(0, 12)} is the tip of GitHub's main, CI passed for it, and the tree is clean`;
  if (argv.includes("--dry-run")) {
    log([ready, "plan (a dry run: nothing was changed):",
      `  1. ${DEPLOY.join(" ")}, from ${repo}: a production deploy of the Worker on ${SITE}, which the owner approves each time`,
      `  2. read ${SITE}/ back, which must be the index this commit's Worker renders, and ${SITE}/slopcheck/, which must`
      + " be the page of the Pages project this commit's Worker sends it to"].join("\n"));
    return 0;
  }
  log(ready);
  const deployed = run(DEPLOY, { cwd: repo, inherit: true, timeout: 600_000 });
  if (deployed.status !== 0) {
    log(`stopped: wrangler deploy exited ${deployed.status}; ${SITE} may still serve the previous Worker`);
    return 1;
  }
  const read = await readBack({ fetchImpl, sleep, attempts, interval });
  if (!read.ok) {
    log(`deployed ${head.slice(0, 12)}, but the live site does not read back:\n  ${read.problems.join("\n  ")}`);
    return 1;
  }
  log([...read.lines, `deploy complete: ${head.slice(0, 12)} serves ${SITE}`].join("\n"));
  return 0;
}

function invokedDirectly() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  process.exitCode = await main();
}
