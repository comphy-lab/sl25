import assert from "node:assert/strict";
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
