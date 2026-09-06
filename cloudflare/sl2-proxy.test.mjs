import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyRateLimit,
  canonicalCalculationPath,
  handleRequest,
  rateLimitedResponse,
} from "./sl2-proxy.mjs";

function createLimiter(maximum) {
  const counts = new Map();
  return {
    calls: 0,
    async limit({ key }) {
      this.calls += 1;
      const count = (counts.get(key) || 0) + 1;
      counts.set(key, count);
      return { success: count <= maximum };
    },
  };
}

function request(path, method = "POST", ip = "203.0.113.8") {
  return new Request(`https://comphy-lab.org${path}`, {
    method,
    headers: { "cf-connecting-ip": ip },
  });
}

function requestAt(origin, path, options = {}) {
  return new Request(`${origin}${path}`, options);
}

async function withMockFetch(mock, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("returns a non-cacheable JSON 429 with Retry-After", async () => {
  const response = rateLimitedResponse();
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("retry-after"), "60");
  assert.deepEqual(await response.json(), {
    error: "Too many requests. Please wait a minute and try again.",
  });
});

test("allows 120 calculation requests per route and IP", async () => {
  const env = {
    CALC_RATE_LIMITER: createLimiter(120),
    BATCH_RATE_LIMITER: createLimiter(20),
  };

  for (let count = 0; count < 120; count += 1) {
    assert.equal(await applyRateLimit(request("/add"), env), null);
  }

  assert.equal((await applyRateLimit(request("/add"), env)).status, 429);
  assert.equal(await applyRateLimit(request("/regime"), env), null);
  assert.equal(
    await applyRateLimit(request("/add", "POST", "203.0.113.9"), env),
    null,
  );
});

test("allows 20 batch requests per IP", async () => {
  const env = {
    CALC_RATE_LIMITER: createLimiter(120),
    BATCH_RATE_LIMITER: createLimiter(20),
  };

  for (let count = 0; count < 20; count += 1) {
    assert.equal(await applyRateLimit(request("/batch"), env), null);
  }

  assert.equal((await applyRateLimit(request("/batch"), env)).status, 429);
});

test("shares counters between bare and /sl25 calculation routes", async () => {
  const env = {
    CALC_RATE_LIMITER: createLimiter(120),
    BATCH_RATE_LIMITER: createLimiter(20),
  };

  for (let count = 0; count < 119; count += 1) {
    assert.equal(await applyRateLimit(request("/add"), env), null);
  }

  assert.equal(await applyRateLimit(request("/sl25/add"), env), null);
  assert.equal((await applyRateLimit(request("/add"), env)).status, 429);

  for (let count = 0; count < 20; count += 1) {
    assert.equal(await applyRateLimit(request("/sl25/batch"), env), null);
  }
  assert.equal((await applyRateLimit(request("/batch"), env)).status, 429);
});

test("normalises only accepted slash and unreserved-character aliases", async () => {
  assert.equal(canonicalCalculationPath("/sl25//add"), "/add");
  assert.equal(canonicalCalculationPath("/sl25/%61dd"), "/add");
  assert.equal(canonicalCalculationPath("//regime"), "/regime");
  assert.equal(canonicalCalculationPath("/sl25/%2Fadd"), "/%2Fadd");
  assert.equal(canonicalCalculationPath("/sl25/additional"), "/additional");

  const env = {
    CALC_RATE_LIMITER: createLimiter(1),
    BATCH_RATE_LIMITER: createLimiter(20),
  };
  assert.equal(await applyRateLimit(request("/sl25//add"), env), null);
  assert.equal((await applyRateLimit(request("/sl25/%61dd"), env)).status, 429);
  assert.equal(env.CALC_RATE_LIMITER.calls, 2);
});

test("does not count GETs, static assets, diagrams, or unrelated prefixes", async () => {
  const env = {
    CALC_RATE_LIMITER: createLimiter(120),
    BATCH_RATE_LIMITER: createLimiter(20),
  };

  assert.equal(await applyRateLimit(request("/add", "GET"), env), null);
  assert.equal(await applyRateLimit(request("/static/site.js"), env), null);
  assert.equal(await applyRateLimit(request("/regime-diagram.svg"), env), null);
  assert.equal(await applyRateLimit(request("/additional"), env), null);
  assert.equal(await applyRateLimit(request("/sl25/regime-diagram.svg"), env), null);
  assert.equal(env.CALC_RATE_LIMITER.calls, 0);
  assert.equal(env.BATCH_RATE_LIMITER.calls, 0);
});

test("preserves the legacy /sl2 redirect", async () => {
  const env = {
    CALC_RATE_LIMITER: createLimiter(120),
    BATCH_RATE_LIMITER: createLimiter(20),
  };
  const response = await handleRequest(
    request("/sl2/example?theme=dark", "GET"),
    env,
  );

  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get("location"),
    "https://comphy-lab.org/sl25/example?theme=dark",
  );
});

test("counts a POST after the method-preserving /sl2 redirect", async () => {
  const env = {
    CALC_RATE_LIMITER: createLimiter(0),
    BATCH_RATE_LIMITER: createLimiter(20),
  };
  const redirect = await handleRequest(request("/sl2/add"), env);
  assert.equal(redirect.status, 308);

  const redirectedRequest = new Request(redirect.headers.get("location"), {
    method: "POST",
    headers: { "cf-connecting-ip": "203.0.113.8" },
  });
  const response = await handleRequest(redirectedRequest, env);
  assert.equal(response.status, 429);
  assert.equal(env.CALC_RATE_LIMITER.calls, 1);
});

test("missing or off rollout flag preserves the legacy entry behaviour", async () => {
  for (const env of [{}, { LEGACY_REDIRECTS: "off" }]) {
    const sl2Response = await handleRequest(
      request("/sl2?theme=dark", "GET"),
      env,
    );
    assert.equal(sl2Response.status, 308);
    assert.equal(
      sl2Response.headers.get("location"),
      "https://comphy-lab.org/sl25?theme=dark",
    );

    await withMockFetch(
      async (url) => {
        assert.equal(url, "https://sl2-vatsal-sanjays-projects.vercel.app/");
        return new Response('<link href="/static/site.css">', {
          headers: {
            "content-encoding": "gzip",
            "content-length": "999",
            "content-type": "text/html",
          },
        });
      },
      async () => {
        const response = await handleRequest(request("/sl25", "GET"), env);
        assert.equal(response.headers.get("content-encoding"), null);
        assert.equal(response.headers.get("content-length"), null);
        assert.match(
          await response.text(),
          /href="https:\/\/sl2-vatsal-sanjays-projects\.vercel\.app\/static\//,
        );
      },
    );
  }
});

test("enabled rollout redirects legacy GET and HEAD paths to the canonical host", async () => {
  const env = { LEGACY_REDIRECTS: "on" };
  const cases = [
    ["/sl25", "GET", "https://sl25.comphy-lab.org/"],
    [
      "/sl25/regime-diagram.svg?theme=dark",
      "HEAD",
      "https://sl25.comphy-lab.org/regime-diagram.svg?theme=dark",
    ],
    ["/sl2", "GET", "https://sl25.comphy-lab.org/"],
    [
      "/sl2/static/site.js?v=2",
      "GET",
      "https://sl25.comphy-lab.org/static/site.js?v=2",
    ],
  ];

  for (const [path, method, location] of cases) {
    const response = await handleRequest(request(path, method), env);
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), location);
  }
});

test("legacy calculation POSTs remain compatible when redirects are enabled", async () => {
  const env = {
    LEGACY_REDIRECTS: "on",
    CALC_RATE_LIMITER: createLimiter(120),
    BATCH_RATE_LIMITER: createLimiter(20),
  };

  await withMockFetch(
    async (url, init) => {
      assert.equal(url, "https://sl2-vatsal-sanjays-projects.vercel.app/add");
      assert.equal(init.method, "POST");
      assert.equal(init.headers.get("content-type"), "application/json");
      return new Response('{"reynoldsNumber":42}', {
        headers: { "content-type": "application/json" },
      });
    },
    async () => {
      const response = await handleRequest(
        requestAt("https://comphy-lab.org", "/sl25/add", {
          method: "POST",
          headers: {
            "cf-connecting-ip": "203.0.113.8",
            "content-type": "application/json",
          },
          body: '{"weberNumber":10,"ohnesorgeNumber":0.1}',
        }),
        env,
      );
      assert.equal(response.status, 200);
      assert.equal(env.CALC_RATE_LIMITER.calls, 1);
    },
  );

  const sl2Post = await handleRequest(request("/sl2/add", "POST"), env);
  assert.equal(sl2Post.status, 308);
  assert.equal(sl2Post.headers.get("location"), "https://comphy-lab.org/sl25/add");
});

test("canonical host serves app and static paths through the same origin", async () => {
  const seen = [];
  await withMockFetch(
    async (url) => {
      seen.push(url);
      if (url.endsWith("/")) {
        return new Response(
          '<link href="/static/site.css"><img src="/regime-diagram.svg">',
          { headers: { "content-type": "text/html" } },
        );
      }
      return new Response("asset", { headers: { "content-type": "text/css" } });
    },
    async () => {
      const page = await handleRequest(
        requestAt("https://sl25.comphy-lab.org", "/", { method: "GET" }),
        {},
      );
      assert.equal(
        await page.text(),
        '<link href="/static/site.css"><img src="/regime-diagram.svg">',
      );

      const asset = await handleRequest(
        requestAt("https://sl25.comphy-lab.org", "/static/site.css", {
          method: "GET",
        }),
        {},
      );
      assert.equal(await asset.text(), "asset");
    },
  );

  assert.deepEqual(seen, [
    "https://sl2-vatsal-sanjays-projects.vercel.app/",
    "https://sl2-vatsal-sanjays-projects.vercel.app/static/site.css",
  ]);
});

test("canonical API keeps content headers and strips credentials upstream", async () => {
  const env = {
    CALC_RATE_LIMITER: createLimiter(120),
    BATCH_RATE_LIMITER: createLimiter(20),
  };
  const body = '{"weberNumber":10,"ohnesorgeNumber":0.1}';

  await withMockFetch(
    async (url, init) => {
      assert.equal(
        url,
        "https://sl2-vatsal-sanjays-projects.vercel.app/regime?theme=dark",
      );
      assert.equal(init.headers.get("content-type"), "application/json");
      assert.equal(init.headers.get("accept"), "application/json");
      assert.equal(init.headers.get("cookie"), null);
      assert.equal(init.headers.get("authorization"), null);
      assert.equal(init.headers.get("cf-access-jwt-assertion"), null);
      assert.equal(init.headers.get("cf-access-client-id"), null);
      assert.equal(init.headers.get("cf-access-client-secret"), null);
      assert.equal(await new Response(init.body).text(), body);
      return new Response('{"regime":"I"}', {
        headers: { "content-type": "application/json" },
      });
    },
    async () => {
      const response = await handleRequest(
        requestAt("https://sl25.comphy-lab.org", "/regime?theme=dark", {
          method: "POST",
          headers: {
            "cf-connecting-ip": "203.0.113.8",
            "content-type": "application/json",
            accept: "application/json",
            cookie: "session=private",
            authorization: "Bearer private",
            "cf-access-jwt-assertion": "private",
            "cf-access-client-id": "private",
            "cf-access-client-secret": "private",
          },
          body,
        }),
        env,
      );
      assert.equal(response.status, 200);
      assert.equal(env.CALC_RATE_LIMITER.calls, 1);
    },
  );
});

test("canonical rate limits apply before proxying", async () => {
  const env = {
    CALC_RATE_LIMITER: createLimiter(0),
    BATCH_RATE_LIMITER: createLimiter(20),
  };
  let fetchCalls = 0;

  await withMockFetch(
    async () => {
      fetchCalls += 1;
      return new Response("unexpected");
    },
    async () => {
      const response = await handleRequest(
        requestAt("https://sl25.comphy-lab.org", "/add", {
          method: "POST",
          headers: { "cf-connecting-ip": "203.0.113.8" },
        }),
        env,
      );
      assert.equal(response.status, 429);
    },
  );
  assert.equal(fetchCalls, 0);
});

test("canonical custom domain rejects paths outside the calculator surface", async () => {
  let fetchCalls = 0;
  const env = {
    CALC_RATE_LIMITER: createLimiter(120),
    BATCH_RATE_LIMITER: createLimiter(20),
  };
  await withMockFetch(
    async () => {
      fetchCalls += 1;
      return new Response("unexpected");
    },
    async () => {
      for (const path of ["/admin", "/additional", "/static", "/sl25"]) {
        const response = await handleRequest(
          requestAt("https://sl25.comphy-lab.org", path, {
            method: path === "/additional" ? "POST" : "GET",
            headers: { "cf-connecting-ip": "203.0.113.8" },
          }),
          env,
        );
        assert.equal(response.status, 404);
        assert.equal(response.headers.get("cache-control"), "no-store");
      }
    },
  );
  assert.equal(fetchCalls, 0);
  assert.equal(env.CALC_RATE_LIMITER.calls, 0);
  assert.equal(env.BATCH_RATE_LIMITER.calls, 0);
});

test("Wrangler config retains legacy routes, limits, and safe rollout defaults", async () => {
  const config = await readFile(
    new URL("./wrangler.toml", import.meta.url),
    "utf8",
  );
  const legacyPatterns = [
    "comphy-lab.org/add",
    "comphy-lab.org/sl25*",
    "comphy-lab.org/regime-diagram*",
    "comphy-lab.org/batch",
    "comphy-lab.org/regime",
    "comphy-lab.org/sl2*",
    "comphy-lab.org/static/*",
  ];

  for (const pattern of legacyPatterns) {
    assert.ok(config.includes(`pattern = "${pattern}"`));
  }
  assert.match(config, /pattern = "sl25\.comphy-lab\.org", custom_domain = true/);
  assert.match(config, /LEGACY_REDIRECTS = "on"/);
  assert.match(config, /name = "CALC_RATE_LIMITER"[\s\S]*limit = 120[\s\S]*period = 60/);
  assert.match(config, /name = "BATCH_RATE_LIMITER"[\s\S]*limit = 20[\s\S]*period = 60/);
  assert.match(config, /workers_dev = false/);
  assert.match(config, /preview_urls = false/);
});
