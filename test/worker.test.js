// Router smoke tests. Run: npm test
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const ORIGIN = "https://tools.synthesiswriting.org";
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function get(path) {
  return new Request(ORIGIN + path, { method: "GET" });
}

describe("landing", () => {
  it("serves the index at /", async () => {
    const res = await worker.fetch(get("/"), {}, {});
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /synthesis writing tools/);
    assert.match(body, /\/slopcheck\//);
  });
});

describe("unknown paths", () => {
  it("404s without reflecting markup", async () => {
    const res = await worker.fetch(get("/nope<script>"), {}, {});
    assert.equal(res.status, 404);
    const body = await res.text();
    assert.doesNotMatch(body, /<script>/);
    assert.match(body, /Path not found/);
  });
});

describe("tool proxy", () => {
  it("redirects the bare prefix with a trailing slash", async () => {
    const res = await worker.fetch(get("/slopcheck"), {}, {});
    assert.equal(res.status, 308);
    assert.equal(res.headers.get("location"), `${ORIGIN}/slopcheck/`);
  });

  it("forwards the stripped path with routing headers", async () => {
    let seen = null;
    globalThis.fetch = async (req) => {
      seen = req;
      return new Response("proxied", { status: 200 });
    };
    const res = await worker.fetch(
      get("/slopcheck/api/hosted/analyze?x=1"),
      {},
      {}
    );
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "proxied");
    assert.equal(seen.url, "https://slopcheck.pages.dev/api/hosted/analyze?x=1");
    assert.equal(seen.headers.get("Host"), "slopcheck.pages.dev");
    assert.equal(seen.headers.get("X-Forwarded-Path-Prefix"), "/slopcheck");
  });

  it("maps the tool root to the target root", async () => {
    let seen = null;
    globalThis.fetch = async (req) => {
      seen = req;
      return new Response("ok");
    };
    await worker.fetch(get("/slopcheck/"), {}, {});
    assert.equal(seen.url, "https://slopcheck.pages.dev/");
  });
});
