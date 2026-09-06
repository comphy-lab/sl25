const VERCEL_BASE = "https://sl2-vatsal-sanjays-projects.vercel.app";
const CANONICAL_HOST = "sl25.comphy-lab.org";
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

export function canonicalCalculationPath(requestPath) {
  let normalizedPath;
  try {
    // decodeURI resolves accepted unreserved aliases such as %61 without
    // decoding reserved separators such as %2F into a different route.
    normalizedPath = decodeURI(requestPath);
  } catch {
    normalizedPath = requestPath;
  }
  normalizedPath = normalizedPath.replace(/\/{2,}/g, "/");

  return normalizedPath.startsWith("/sl25/")
    ? normalizedPath.replace(/^\/sl25/, "")
    : normalizedPath;
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

function upstreamRequestInit(request) {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }

  const init = { method: request.method, redirect: "follow", headers };
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

async function proxyToVercel(request, path, rewriteLegacyHtml = false) {
  const url = new URL(request.url);
  const resp = await fetch(
    VERCEL_BASE + path + url.search,
    upstreamRequestInit(request),
  );

  const contentType = resp.headers.get("content-type") || "";
  if (rewriteLegacyHtml && contentType.includes("text/html")) {
    let html = await resp.text();
    html = html.replace(/href="\/static\//g, `href="${VERCEL_BASE}/static/`);
    html = html.replace(/src="\/static\//g, `src="${VERCEL_BASE}/static/`);
    html = html.replace(
      /href="\/regime-diagram/g,
      `href="${VERCEL_BASE}/regime-diagram`,
    );
    html = html.replace(
      /src="\/regime-diagram/g,
      `src="${VERCEL_BASE}/regime-diagram`,
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
    return proxyToVercel(request, path);
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
    return proxyToVercel(request, strippedPath, true);
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
    return proxyToVercel(request, path);
  }

  return fetch(request);
}

export default {
  fetch: handleRequest,
};
