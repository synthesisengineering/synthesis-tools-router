// Router Worker for tools.synthesiswriting.org.
//
// Adding a new tool: append an entry to TOOL_ROUTES. The path-prefix matches
// /<key> and /<key>/*; requests are proxied to the named Pages project,
// preserving the trailing path. Each Pages project is independent.

const TOOL_ROUTES = {
  slopcheck: "slopcheck.pages.dev",
  // Add future tools here, e.g.:
  // factcheck: "factcheck.pages.dev",
};

// Permanent identity tag. Used for the router landing page and 404s.
const ROUTER_NAME = "synthesis writing tools";
const ROUTER_HOME = "https://synthesiswriting.org";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Identify which tool prefix this request maps to, if any.
    const segments = pathname.split("/").filter(Boolean);
    const toolKey = segments[0];

    if (toolKey && TOOL_ROUTES[toolKey]) {
      return proxyToPages(request, url, toolKey, TOOL_ROUTES[toolKey], pathname);
    }

    // Root: serve a minimal landing page.
    if (pathname === "/" || pathname === "") {
      return new Response(landingHtml(), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=300",
        },
      });
    }

    // Unknown path: 404 with a hint.
    return new Response(notFoundHtml(pathname), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
};

async function proxyToPages(request, url, toolKey, targetHost, pathname) {
  // Strip the /<toolKey> prefix before forwarding so the target Pages project
  // sees a root-relative path. Example: /slopcheck/api/hosted/analyze becomes
  // /api/hosted/analyze on slopcheck.pages.dev.
  const prefix = `/${toolKey}`;
  let targetPath = pathname.slice(prefix.length);
  if (targetPath === "") targetPath = "/";

  // Bare /slopcheck without trailing slash: redirect so relative URLs in the
  // tool's HTML resolve correctly inside tools.synthesiswriting.org/slopcheck/.
  if (pathname === prefix) {
    return Response.redirect(`${url.origin}${prefix}/`, 308);
  }

  const targetUrl = new URL(targetPath + url.search, `https://${targetHost}`);

  // Build a forwarded request. Preserve method, headers, body. Override the
  // Host header to the target so the Pages project routes correctly.
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("Host", targetHost);
  // Pass the original visitor's IP and the public path so the Pages Function
  // sees the same client info it would for a direct .pages.dev request.
  forwardedHeaders.set(
    "X-Forwarded-Host",
    "tools.synthesiswriting.org"
  );
  forwardedHeaders.set("X-Forwarded-Path-Prefix", prefix);

  const forwardedRequest = new Request(targetUrl.toString(), {
    method: request.method,
    headers: forwardedHeaders,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.clone().arrayBuffer(),
    redirect: "manual",
  });

  const response = await fetch(forwardedRequest);

  // Pass the response through unchanged. The Pages project's content uses
  // relative URLs throughout, so no body rewriting is needed.
  return response;
}

function landingHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${ROUTER_NAME}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 640px; margin: 4rem auto; padding: 0 1.5rem; line-height: 1.6; color: #1a1a1a; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  a { color: #2d5d3a; }
  ul { padding-left: 1.5rem; }
  li { margin: 0.4rem 0; }
  .footer { margin-top: 3rem; font-size: 0.9rem; color: #555; }
</style>
</head>
<body>
<h1>${ROUTER_NAME}</h1>
<p>Open source tools from the synthesis writing ecosystem.</p>
<ul>
  <li><a href="/slopcheck/">slopcheck</a> — open source slop detection. Slop, not just AI.</li>
</ul>
<p class="footer">
Part of <a href="${ROUTER_HOME}">synthesiswriting.org</a>.
Open source: <a href="https://github.com/synthesisengineering">github.com/synthesisengineering</a>.
Support: <a href="https://github.com/sponsors/rajivpant">GitHub Sponsors</a>.
</p>
</body>
</html>`;
}

function notFoundHtml(pathname) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Not found — ${ROUTER_NAME}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 640px; margin: 4rem auto; padding: 0 1.5rem; line-height: 1.6; color: #1a1a1a; }
  h1 { font-size: 1.3rem; }
  a { color: #2d5d3a; }
  code { background: #f4f4f0; padding: 0.1em 0.35em; border-radius: 3px; }
</style>
</head>
<body>
<h1>Path not found: <code>${escapeHtml(pathname)}</code></h1>
<p>Available tools: <a href="/slopcheck/">slopcheck</a>.</p>
<p><a href="/">Back to the tools index</a>.</p>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
