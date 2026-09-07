const VERCEL_BASE = "https://sl2-vatsal-sanjays-projects.vercel.app";
const CANONICAL_HOST = "sl25.comphy-lab.org";
const LEGACY_HOST = "comphy-lab.org";
const LEGACY_REDIRECTS_ON = "on";

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
];

const RATE_LIMITED_PATHS = new Map([
  ["/add", "CALC_RATE_LIMITER"],
  ["/regime", "CALC_RATE_LIMITER"],
  ["/batch", "BATCH_RATE_LIMITER"],
]);

function normalizedPath(requestPath) {
  let normalizedPath;
  try {
    // decodeURI resolves accepted unreserved aliases such as %61 without
    // decoding reserved separators such as %2F into a different route.
    normalizedPath = decodeURI(requestPath);
  } catch {
    normalizedPath = requestPath;
  }
  return normalizedPath.replace(/\/{2,}/g, "/");
}

export function canonicalCalculationPath(requestPath) {
  const path = normalizedPath(requestPath);
  return path.startsWith("/sl25/") ? path.replace(/^\/sl25/, "") : path;
}

export function rateLimitedResponse() {
  return new Response(
    JSON.stringify({
      error: "Too many requests. Please wait a minute and try again.",
    }),
    {
      status: 429,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "retry-after": "60",
      },
    },
  );
}

export async function applyRateLimit(request, env) {
  if (request.method !== "POST") {
    return null;
  }

  const requestPath = new URL(request.url).pathname;
  const canonicalPath = canonicalCalculationPath(requestPath);
  const bindingName = RATE_LIMITED_PATHS.get(canonicalPath);
  if (!bindingName) {
    return null;
  }

  const clientIp = request.headers.get("cf-connecting-ip") || "unknown";
  const { success } = await env[bindingName].limit({
    key: `${canonicalPath}:${clientIp}`,
  });

  return success ? null : rateLimitedResponse();
}

function upstreamRequestInit(request, originToken) {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }

  headers.set("x-sl25-origin-token", originToken);
  const init = { method: request.method, redirect: "manual", headers };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }
  return init;
}

function legacyRedirect(url, pathPrefix) {
  const canonicalPath = url.pathname.replace(pathPrefix, "") || "/";
  return Response.redirect(
    `https://${CANONICAL_HOST}${canonicalPath}${url.search}`,
    308,
  );
}

function isCanonicalPath(path) {
  return (
    path === "/" ||
    path === "/add" ||
    path === "/regime" ||
    path === "/batch" ||
    path === "/regime-diagram" ||
    path === "/regime-diagram.svg" ||
    path.startsWith("/static/")
  );
}

function proxyError(status, message, headers = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

async function proxyToVercel(request, path, env, rewriteLegacyHtml = false) {
  // Only the public calculator surface may use the Worker's origin credential.
  const upstreamPath = normalizedPath(path);
  if (!isCanonicalPath(upstreamPath)) {
    return proxyError(404, "Not found.");
  }
  const methods = RATE_LIMITED_PATHS.has(upstreamPath)
    ? ["POST", "OPTIONS"]
    : ["GET", "HEAD", "OPTIONS"];
  if (!methods.includes(request.method)) {
    return proxyError(405, "Method not allowed.", { allow: methods.join(", ") });
  }
  const originToken = env?.SL25_ORIGIN_TOKEN;
  if (typeof originToken !== "string" || !/^[0-9a-f]{64}$/.test(originToken)) {
    return proxyError(503, "Origin authentication is unavailable.");
  }

  const url = new URL(request.url);
  let resp;
  try {
    resp = await fetch(
      VERCEL_BASE + upstreamPath + url.search,
      upstreamRequestInit(request, originToken),
    );
  } catch {
    return proxyError(502, "Origin request failed.");
  }
  // The supported Flask routes do not redirect. Never expose or follow an
  // upstream redirect with the private credential, including off-origin hops.
  if (resp.status >= 300 && resp.status < 400) {
    await resp.body?.cancel().catch(() => {});
    return proxyError(502, "Unexpected origin redirect.");
  }

  const contentType = resp.headers.get("content-type") || "";
  if (rewriteLegacyHtml && contentType.includes("text/html")) {
    let html = await resp.text();
    const publicBase = `https://${CANONICAL_HOST}`;
    html = html.replace(/href="\/static\//g, `href="${publicBase}/static/`);
    html = html.replace(/src="\/static\//g, `src="${publicBase}/static/`);
    html = html.replace(
      /href="\/regime-diagram/g,
      `href="${publicBase}/regime-diagram`,
    );
    html = html.replace(
      /src="\/regime-diagram/g,
      `src="${publicBase}/regime-diagram`,
    );
    const headers = new Headers(resp.headers);
    headers.set("content-type", "text/html; charset=utf-8");
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response(html, { status: resp.status, headers });
  }

  return new Response(resp.body, {
    status: resp.status,
    headers: resp.headers,
  });
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const redirectsEnabled = env?.LEGACY_REDIRECTS === LEGACY_REDIRECTS_ON;

  if (url.hostname !== CANONICAL_HOST && url.hostname !== LEGACY_HOST) {
    return fetch(request);
  }

  if (url.hostname === CANONICAL_HOST && !isCanonicalPath(path)) {
    return new Response("Not found.\n", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }

  const limitedResponse = await applyRateLimit(request, env);
  if (limitedResponse) {
    return limitedResponse;
  }

  if (url.hostname === CANONICAL_HOST) {
    return proxyToVercel(request, path, env);
  }

  // During the final rollout, move legacy entry GETs to the new hostname.
  if (path === "/sl2" || path.startsWith("/sl2/")) {
    if (
      redirectsEnabled &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return legacyRedirect(url, /^\/sl2/);
    }
    const newPath = path.replace(/^\/sl2/, "/sl25") || "/sl25";
    return Response.redirect(url.origin + newPath + (url.search || ""), 308);
  }

  // Strip /sl25 prefix for the main app route.
  if (path === "/sl25" || path.startsWith("/sl25/")) {
    if (
      redirectsEnabled &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return legacyRedirect(url, /^\/sl25/);
    }
    const strippedPath = path.replace(/^\/sl25/, "") || "/";
    return proxyToVercel(request, strippedPath, env, true);
  }

  // API + asset routes pass through as-is.
  const passthroughPaths = [
    "/add",
    "/regime",
    "/batch",
    "/regime-diagram",
    "/static/",
  ];
  if (passthroughPaths.some((prefix) => path === prefix || path.startsWith(prefix))) {
    return proxyToVercel(request, path, env);
  }

  return fetch(request);
}

export default {
  fetch: handleRequest,
};
