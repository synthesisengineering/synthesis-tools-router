// scripts/deploy.mjs against fakes. Every git, gh and wrangler command goes to World, which answers as this Mac and
// GitHub would and fails the test on any command it does not know; every request goes to World's fake live site.
// No test deploys, and none reaches the network. Run: npm test
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import path from "node:path";
import worker from "../src/worker.js";
import { main, REMOTE, REPOSITORY, SITE } from "../scripts/deploy.mjs";

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);
const ORIGIN = "https://slopcheck.pages.dev/";
const PAGE = "<!DOCTYPE html><html><head><title>slopcheck: open source slop detection</title></head><body></body></html>";
const LANDING = await (await worker.fetch(new Request(`${SITE}/`), {}, {})).text();
const realFetch = globalThis.fetch;

function html(body, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

class World {
  constructor(repo) {
    this.repo = repo;
    this.dirty = "";
    this.head = SHA;
    this.main = SHA;
    this.githubDown = false;
    this.ci = [{ status: "completed", conclusion: "success", workflowName: "CI" }];
    this.wrangler = 0; // wrangler's exit status
    this.installed = true; // whether wrangler is installed
    this.deployed = false;
    this.stale = 0; // requests to / that still reach the previous Worker
    this.home = null; // what the live / serves once deployed; null: this commit's landing
    this.tool = html(PAGE); // what the live /slopcheck/ serves
    this.answerOnce = {}; // "run list" -> the error GitHub answers once
    this.commands = [];
    this.requests = [];
    this.waits = [];
    this.lines = [];
  }

  run = (argv, options = {}) => {
    this.commands.push(argv);
    const [program, ...rest] = argv;
    if (program === "git") return this.git(rest, options);
    if (program === "gh") {
      const failure = this.answerOnce[rest.slice(0, 2).join(" ")];
      delete this.answerOnce[rest.slice(0, 2).join(" ")];
      return failure ? { status: 1, stdout: "", stderr: failure } : this.gh(rest);
    }
    if (program === "npx" && rest.join(" ") === "--no-install wrangler --version") {
      assert.equal(options.cwd, this.repo);
      return this.installed ? { status: 0, stdout: "4.93.0\n", stderr: "" }
        : { status: 1, stdout: "", stderr: "npm error npx canceled due to missing packages and no YES option: [\"wrangler\"]" };
    }
    if (program === "npx" && rest.join(" ") === "--no-install wrangler deploy") {
      assert.equal(options.cwd, this.repo, "wrangler deploys this checkout");
      this.deployed = this.wrangler === 0;
      return { status: this.wrangler, stdout: "", stderr: "" };
    }
    throw new Error(`a command the fakes do not know ran: ${argv.join(" ")}`);
  };

  git(args, options) {
    let where = null;
    while (args[0].startsWith("-")) {
      const flag = args.shift();
      if (flag === "-c" || flag === "-C") {
        const value = args.shift();
        if (flag === "-C") where = value;
      }
    }
    const [command, ...rest] = args;
    if (command === "ls-remote") {
      assert.equal(options.env?.GIT_CONFIG_GLOBAL, devNull, "GitHub's main is read with git's own config left out");
      assert.deepEqual(rest, [REMOTE, "refs/heads/main"]);
      if (this.githubDown) return { status: 128, stdout: "", stderr: "fatal: unable to access 'https://github.com/'" };
      return { status: 0, stdout: `${this.main}\trefs/heads/main\n`, stderr: "" };
    }
    if (where === this.repo && command === "rev-parse" && rest[0] === "--show-toplevel") {
      return { status: 0, stdout: `${this.repo}\n`, stderr: "" };
    }
    if (where === this.repo && command === "status") return { status: 0, stdout: this.dirty, stderr: "" };
    if (where === this.repo && command === "rev-parse" && rest[0] === "HEAD") {
      return { status: 0, stdout: `${this.head}\n`, stderr: "" };
    }
    throw new Error(`a git command the fakes do not know ran: ${args.join(" ")}`);
  }

  gh(args) {
    assert.deepEqual(args, ["run", "list", "-R", `github.com/${REPOSITORY}`, "--commit", this.head, "--json",
      "status,conclusion,workflowName", "--limit", "50"]);
    if (this.ci === null) return { status: 4, stdout: "", stderr: "To get started with GitHub CLI, please run:  gh auth login" };
    return { status: 0, stdout: JSON.stringify(this.ci), stderr: "" };
  }

  fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    this.requests.push(url);
    assert.ok(this.deployed, "the live site is read only after the deploy");
    if (url === `${SITE}/`) {
      if (this.stale > 0) {
        this.stale -= 1;
        return html("<!DOCTYPE html><title>synthesis writing tools</title><p>the previous index</p>");
      }
      return html(this.home ?? LANDING);
    }
    if (url === `${SITE}/slopcheck/`) return this.tool.clone();
    if (url === ORIGIN) return html(PAGE);
    throw new Error(`a request the fakes do not know: ${url}`);
  };

  deploy(...argv) {
    return main(argv, {
      repo: this.repo, run: this.run, fetchImpl: this.fetch, interval: 1000,
      sleep: async (ms) => { this.waits.push(ms); }, log: (text) => this.lines.push(text),
    });
  }

  get printed() {
    return this.lines.join("\n");
  }

  ran(program) {
    return this.commands.filter((argv) => argv[0] === program);
  }
}

describe("deploy", () => {
  let repo;
  let world;

  beforeEach(() => {
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), "router-deploy-")));
    world = new World(repo);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    rmSync(repo, { recursive: true, force: true });
  });

  it("deploys GitHub's main with CI passed, then reads / and /slopcheck/ back from the live site", async () => {
    assert.equal(await world.deploy(), 0, world.printed);
    assert.deepEqual(world.ran("npx"), [["npx", "--no-install", "wrangler", "--version"],
      ["npx", "--no-install", "wrangler", "deploy"]]);
    assert.deepEqual([...new Set(world.requests)].sort(), [`${SITE}/`, `${SITE}/slopcheck/`, ORIGIN].sort());
    assert.match(world.printed, /the index this commit's Worker renders/);
    assert.match(world.printed, /slopcheck: open source slop detection/);
    assert.match(world.printed, /deploy complete: aaaaaaaaaaaa serves https:\/\/tools\.synthesiswriting\.org/);
    assert.equal(globalThis.fetch, realFetch, "the global fetch is left as it was");
  });

  it("a dry run checks, prints the plan and changes nothing", async () => {
    assert.equal(await world.deploy("--dry-run"), 0, world.printed);
    assert.deepEqual(world.ran("npx"), [["npx", "--no-install", "wrangler", "--version"]]);
    assert.deepEqual(world.requests, []);
    assert.match(world.printed, /nothing was changed/);
    assert.match(world.printed, /production deploy/);
    assert.match(world.printed, /approves each time/);
  });

  const refusals = {
    "the tree has uncommitted changes: M src/worker.js, ?? package-lock.json":
      (w) => { w.dirty = " M src/worker.js\n?? package-lock.json\n"; },
    "wrangler is not installed here or on PATH": (w) => { w.installed = false; },
    [`is not the tip of ${REPOSITORY} main`]: (w) => { w.main = OTHER; },
    "failed CI": (w) => { w.ci = [{ status: "completed", conclusion: "failure", workflowName: "CI" }]; },
    "running CI": (w) => { w.ci = [{ status: "in_progress", conclusion: "", workflowName: "CI" }]; },
    "no CI run": (w) => { w.ci = []; },
    "cannot read CI": (w) => { w.ci = null; },
    [`cannot read ${REPOSITORY} main on GitHub`]: (w) => { w.githubDown = true; },
  };
  for (const [expected, arrange] of Object.entries(refusals)) {
    it(`refuses before deploying anything: ${expected}`, async () => {
      arrange(world);
      assert.equal(await world.deploy(), 1, world.printed);
      assert.match(world.printed, /refused before deploying anything/);
      assert.ok(world.printed.includes(expected), world.printed);
      assert.deepEqual(world.ran("npx").filter((argv) => argv.includes("deploy")), []);
      assert.deepEqual(world.requests, []);
    });
  }

  it("waits while the new Worker reaches the edge", async () => {
    world.stale = 2;
    assert.equal(await world.deploy(), 0, world.printed);
    assert.deepEqual(world.waits, [1000, 1000]);
  });

  it("a live / that is not this commit's index fails the read-back", async () => {
    world.home = "<!DOCTYPE html><title>synthesis writing tools</title><p>another index</p>";
    assert.equal(await world.deploy(), 1, world.printed);
    assert.match(world.printed, /does not read back/);
    assert.match(world.printed, /not the index this commit's Worker renders/);
    assert.equal(world.waits.length, 5, "it reads six times before it says so");
  });

  it("a /slopcheck/ that is not the Pages project's page fails the read-back", async () => {
    world.tool = html("<!DOCTYPE html><title>Not found — synthesis writing tools</title>", 404);
    assert.equal(await world.deploy(), 1, world.printed);
    assert.match(world.printed, /\/slopcheck\/ answers 404/);
  });

  it("a failed wrangler deploy stops before reading the site", async () => {
    world.wrangler = 1;
    assert.equal(await world.deploy(), 1, world.printed);
    assert.match(world.printed, /wrangler deploy exited 1/);
    assert.deepEqual(world.requests, []);
  });

  it("a GitHub server error reading CI is tried again", async () => {
    world.answerOnce["run list"] = "HTTP 502: Bad Gateway (https://api.github.com/)";
    assert.equal(await world.deploy(), 0, world.printed);
    assert.equal(world.ran("gh").length, 2);
  });

  it("refuses an option it does not know before anything runs", async () => {
    assert.equal(await world.deploy("--force"), 2, world.printed);
    assert.deepEqual(world.commands, []);
  });
});
