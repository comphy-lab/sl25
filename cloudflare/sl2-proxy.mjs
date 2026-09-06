const VERCEL_BASE = "https://sl2-vatsal-sanjays-projects.vercel.app";

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

export async function handleRequest(request, env) {
  const limitedResponse = await applyRateLimit(request, env);
  if (limitedResponse) {
    return limitedResponse;
  }

  const url = new URL(request.url);
  const path = url.pathname;

  // Canonicalise old path to the new one.
  if (path === "/sl2" || path.startsWith("/sl2/")) {
    const newPath = path.replace(/^\/sl2/, "/sl25") || "/sl25";
    return Response.redirect(url.origin + newPath + (url.search || ""), 308);
  }

  // Strip /sl25 prefix for the main app route.
  if (path === "/sl25" || path.startsWith("/sl25/")) {
    const strippedPath = path.replace(/^\/sl25/, "") || "/";
    const targetUrl = VERCEL_BASE + strippedPath + (url.search || "");
    const init = { method: request.method, redirect: "follow" };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
      init.headers = request.headers;
    }
    const resp = await fetch(targetUrl, init);
    const contentType = resp.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
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
      return new Response(html, { status: resp.status, headers });
    }
    return new Response(resp.body, {
      status: resp.status,
      headers: resp.headers,
    });
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
    const targetUrl = VERCEL_BASE + path + (url.search || "");
    const init = { method: request.method, redirect: "follow" };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
      init.headers = request.headers;
    }
    const resp = await fetch(targetUrl, init);
    return new Response(resp.body, {
      status: resp.status,
      headers: resp.headers,
    });
  }

  return fetch(request);
}

export default {
  fetch: handleRequest,
};
