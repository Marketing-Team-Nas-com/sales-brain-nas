import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { DEFAULT_CRAWL_INTERVAL_MINUTES, getCrawlIntervalMinutes } from "../app/lib/crawl-interval.ts";
import {
  classifyMondayError,
  getBoardSnapshot,
  mondayRequest,
  mondayRetryDelayMs,
  mondayRetryHintSeconds,
} from "../app/lib/monday.ts";

const realFetch = globalThis.fetch;
const realToken = process.env.MONDAY_API_TOKEN;
const realWarn = console.warn;

beforeEach(() => {
  process.env.MONDAY_API_TOKEN = "test-token-not-real";
  console.warn = () => {};
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
  if (realToken === undefined) delete process.env.MONDAY_API_TOKEN;
  else process.env.MONDAY_API_TOKEN = realToken;
});

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// Fake fetch that replays the given responses in order and records requests.
function fakeFetch(responses) {
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    const next = responses[calls.length - 1];
    if (!next) throw new Error(`unexpected monday call #${calls.length}`);
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next;
  };
  return calls;
}

const noSleep = () => {
  const delays = [];
  return { delays, sleep: async (ms) => void delays.push(ms) };
};

// ---------- query shape + mapping ----------

const statusSettings = JSON.stringify({ labels: { 0: "Fit", 1: "Not Fit" } });

function item(id, name) {
  return {
    id,
    name,
    created_at: "2026-11-01T10:00:00Z",
    group: { id: "g1", title: "Inbound" },
    column_values: [
      { id: "multiple_person_mm546gv2", text: "Alex Rep", value: null, type: "people" },
      { id: "color_mm594jh8", text: "", value: JSON.stringify({ index: 0 }), type: "status" },
      { id: "email_mm4jfc4f", text: `${id}@example.com`, value: null, type: "email" },
      { id: "date_mm4tf2tz", text: "", value: JSON.stringify({ date: "2026-11-02" }), type: "date" },
      { id: "text_mm4jzveb", text: "100k-300k", value: null, type: "text" },
    ],
  };
}

test("board queries no longer request item updates", async () => {
  const calls = fakeFetch([
    jsonResponse({
      data: {
        boards: [
          {
            id: "123",
            name: "Sales",
            columns: [
              { id: "color_mm594jh8", title: "Final Verdict", type: "status", settings_str: statusSettings },
            ],
            calculatedColumns: [],
            items_page: { cursor: "next-1", items: [item("1", "Acme")] },
          },
        ],
      },
    }),
    jsonResponse({ data: { next_items_page: { cursor: null, items: [item("2", "Globex")] } } }),
  ]);

  await getBoardSnapshot("123");

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.doesNotMatch(call.query, /\bupdates\s*\(/);
    // Fields the mapping does rely on are still requested.
    for (const field of ["column_values", "created_at", "group", "text", "value", "battery_value"]) {
      assert.match(call.query, new RegExp(`\\b${field}\\b`));
    }
  }
  assert.match(calls[0].query, /settings_str/);
  assert.equal(calls[1].variables.cursor, "next-1");
});

test("deal mapping is unchanged across first and next pages without updates", async () => {
  fakeFetch([
    jsonResponse({
      data: {
        boards: [
          {
            id: "123",
            name: "Sales",
            columns: [
              { id: "color_mm594jh8", title: "Final Verdict", type: "status", settings_str: statusSettings },
            ],
            calculatedColumns: [],
            items_page: { cursor: "next-1", items: [item("1", "Acme")] },
          },
        ],
      },
    }),
    jsonResponse({ data: { next_items_page: { cursor: null, items: [item("2", "Globex")] } } }),
  ]);

  const { board, deals } = await getBoardSnapshot("123");

  assert.equal(board.items_page.items.length, 2);
  assert.equal(deals.length, 2);
  const [acme, globex] = deals;
  assert.equal(acme.account, "Acme");
  assert.equal(acme.owner, "Alex Rep");
  assert.equal(acme.finalVerdict, "Fit");
  assert.equal(acme.stage, "Fit");
  assert.equal(acme.email, "1@example.com");
  assert.equal(acme.dateAdded, "2026-11-02");
  assert.equal(acme.group, "Inbound");
  assert.equal(acme.budget, "100k-300k");
  assert.equal(acme.mondayUrl, "https://nas-io.monday.com/boards/123/pulses/1");
  assert.equal(globex.account, "Globex");
  assert.equal(globex.boardId, "123");
  assert.equal("updates" in acme, false);
});

// ---------- error classification ----------

test("classifies monday rate-limit and complexity errors as retryable rate limits", () => {
  assert.equal(classifyMondayError({ status: 429, message: "Too Many Requests" }), "rate_limit");
  assert.equal(
    classifyMondayError({
      status: 200,
      message: "Complexity budget exhausted, query cost 30001 budget remaining 8616 out of 1000000 reset in 23 seconds",
    }),
    "rate_limit",
  );
  assert.equal(classifyMondayError({ status: 200, code: "COMPLEXITY_BUDGET_EXHAUSTED" }), "rate_limit");
  assert.equal(classifyMondayError({ status: 200, code: "ComplexityException" }), "rate_limit");
  assert.equal(classifyMondayError({ status: 429, code: "RATE_LIMIT_EXCEEDED" }), "rate_limit");
  assert.equal(classifyMondayError({ status: 429, code: "IP_RATE_LIMIT_EXCEEDED" }), "rate_limit");
  assert.equal(classifyMondayError({ status: 200, code: "maxConcurrencyExceeded" }), "rate_limit");
  assert.equal(classifyMondayError({ message: "Minute limit rate exceeded" }), "rate_limit");
});

test("keeps transient server errors retryable and other 4xx fatal", () => {
  assert.equal(classifyMondayError({ status: 500, message: "Internal Server Error" }), "transient");
  assert.equal(classifyMondayError({ status: 503 }), "transient");
  assert.equal(classifyMondayError({ message: "fetch failed" }), "transient");
  assert.equal(classifyMondayError({ status: 400, message: "Parse error on bad query" }), "fatal");
  assert.equal(classifyMondayError({ status: 401, message: "Not Authenticated" }), "fatal");
  assert.equal(classifyMondayError({ status: 403, message: "Permission denied" }), "fatal");
  assert.equal(classifyMondayError({ status: 404 }), "fatal");
  assert.equal(classifyMondayError({ status: 429, code: "DAILY_LIMIT_EXCEEDED" }), "fatal");
  assert.equal(
    classifyMondayError({ status: 200, message: "Query has complexity of 6000000, which exceeds max complexity of 5000000" }),
    "fatal",
  );
});

test("reads monday's retry hint from extensions, Retry-After, or the message", () => {
  assert.equal(mondayRetryHintSeconds({ retryInSeconds: 12 }), 12);
  assert.equal(mondayRetryHintSeconds({ retryAfterHeader: "7" }), 7);
  assert.equal(mondayRetryHintSeconds({ message: "budget remaining 0 reset in 23 seconds" }), 23);
  assert.equal(mondayRetryHintSeconds({ message: "nope" }), undefined);
});

test("rate-limit backoff is exponential, honours monday's hint, and is capped", () => {
  const delay = (attempt, hintSeconds) =>
    mondayRetryDelayMs({ kind: "rate_limit", attempt, hintSeconds, jitterMs: 0 });
  assert.equal(delay(1), 2_000);
  assert.equal(delay(2), 4_000);
  assert.equal(delay(3), 8_000);
  assert.equal(delay(1, 23), 23_000);
  assert.equal(delay(1, 600), 30_000);
  assert.equal(mondayRetryDelayMs({ kind: "transient", attempt: 1 }), 500);
  assert.equal(mondayRetryDelayMs({ kind: "transient", attempt: 2 }), 1_000);
});

// ---------- retry loop ----------

test("retries HTTP 429 with backoff and then succeeds", async () => {
  const calls = fakeFetch([
    jsonResponse({ error_message: "Rate Limit Exceeded", error_code: "RATE_LIMIT_EXCEEDED" }, { status: 429 }),
    jsonResponse({ errors: [{ message: "Too many requests" }] }, { status: 429, headers: { "Retry-After": "5" } }),
    jsonResponse({ data: { ok: true } }),
  ]);
  const { delays, sleep } = noSleep();

  const data = await mondayRequest({ query: "{ me { id } }" }, { sleep });

  assert.deepEqual(data, { ok: true });
  assert.equal(calls.length, 3);
  assert.equal(delays.length, 2);
  assert.ok(delays[0] >= 2_000 && delays[0] < 2_250);
  assert.ok(delays[1] >= 5_000 && delays[1] < 5_250);
});

test("retries a complexity-budget error returned with HTTP 200", async () => {
  const calls = fakeFetch([
    jsonResponse({
      errors: [
        {
          message: "Complexity budget exhausted",
          extensions: { code: "COMPLEXITY_BUDGET_EXHAUSTED", retry_in_seconds: 9 },
        },
      ],
    }),
    jsonResponse({ data: { ok: true } }),
  ]);
  const { delays, sleep } = noSleep();

  assert.deepEqual(await mondayRequest({ query: "{ me { id } }" }, { sleep }), { ok: true });
  assert.equal(calls.length, 2);
  assert.ok(delays[0] >= 9_000 && delays[0] < 9_250);
});

test("gives up after 4 attempts when monday stays rate limited", async () => {
  const calls = fakeFetch(
    Array.from({ length: 4 }, () => () => jsonResponse({ errors: [{ message: "Rate limit exceeded" }] }, { status: 429 })),
  );
  const { delays, sleep } = noSleep();

  await assert.rejects(mondayRequest({ query: "{ me { id } }" }, { sleep }), /Rate limit exceeded/);
  assert.equal(calls.length, 4);
  assert.equal(delays.length, 3);
});

test("does not retry non-retryable 4xx errors", async () => {
  for (const status of [400, 401, 403, 404]) {
    const calls = fakeFetch([jsonResponse({ errors: [{ message: `bad request ${status}` }] }, { status })]);
    const { delays, sleep } = noSleep();

    await assert.rejects(mondayRequest({ query: "{ me { id } }" }, { sleep }), new RegExp(`bad request ${status}`));
    assert.equal(calls.length, 1);
    assert.equal(delays.length, 0);
  }
});

test("still retries transient 500 / network errors up to 3 attempts", async () => {
  const calls = fakeFetch([
    jsonResponse({ errors: [{ message: "Internal Server Error" }] }, { status: 500 }),
    new TypeError("fetch failed"),
    jsonResponse({ errors: [{ message: "Internal Server Error" }] }, { status: 500 }),
  ]);
  const { delays, sleep } = noSleep();

  await assert.rejects(mondayRequest({ query: "{ me { id } }" }, { sleep }), /Internal Server Error/);
  assert.equal(calls.length, 3);
  assert.deepEqual(delays, [500, 1_000]);
});

test("handles a non-JSON 429 body", async () => {
  fakeFetch([
    new Response("<html>Too Many Requests</html>", { status: 429 }),
    jsonResponse({ data: { ok: true } }),
  ]);
  const { sleep } = noSleep();

  assert.deepEqual(await mondayRequest({ query: "{ me { id } }" }, { sleep }), { ok: true });
});

// ---------- crawl interval ----------

test("crawl interval defaults to 10 minutes", () => {
  assert.equal(DEFAULT_CRAWL_INTERVAL_MINUTES, 10);
  assert.equal(getCrawlIntervalMinutes(undefined), 10);
  assert.equal(getCrawlIntervalMinutes(""), 10);
  assert.equal(getCrawlIntervalMinutes("   "), 10);
});

test("crawl interval accepts custom whole-minute values", () => {
  assert.equal(getCrawlIntervalMinutes("15"), 15);
  assert.equal(getCrawlIntervalMinutes(" 20 "), 20);
  assert.equal(getCrawlIntervalMinutes("5"), 5);
  assert.equal(getCrawlIntervalMinutes("1440"), 1440);
});

test("invalid crawl interval values fall back to 10 minutes", () => {
  for (const value of ["abc", "-5", "0", "1", "4", "1441", "15.5", "1e3", "15m", "NaN"]) {
    assert.equal(getCrawlIntervalMinutes(value), 10, `value ${JSON.stringify(value)}`);
  }
});

test("crawl interval reads SALES_BRAIN_CRAWL_INTERVAL_MINUTES from the environment", () => {
  const previous = process.env.SALES_BRAIN_CRAWL_INTERVAL_MINUTES;
  try {
    process.env.SALES_BRAIN_CRAWL_INTERVAL_MINUTES = "20";
    assert.equal(getCrawlIntervalMinutes(), 20);
    delete process.env.SALES_BRAIN_CRAWL_INTERVAL_MINUTES;
    assert.equal(getCrawlIntervalMinutes(), 10);
  } finally {
    if (previous === undefined) delete process.env.SALES_BRAIN_CRAWL_INTERVAL_MINUTES;
    else process.env.SALES_BRAIN_CRAWL_INTERVAL_MINUTES = previous;
  }
});

test("does not retry monday's daily limit or an over-max-complexity query", async () => {
  const fatalResponses = [
    () => jsonResponse(
      { errors: [{ message: "Daily limit exceeded", extensions: { code: "DAILY_LIMIT_EXCEEDED", retry_in_seconds: 3600 } }] },
      { status: 429 },
    ),
    () => jsonResponse({
      errors: [
        {
          message: "Query has complexity of 6000000, which exceeds max complexity of 5000000",
          extensions: { code: "maxComplexityExceeded" },
        },
      ],
    }),
  ];

  for (const response of fatalResponses) {
    const calls = fakeFetch([response]);
    const { delays, sleep } = noSleep();

    await assert.rejects(mondayRequest({ query: "{ me { id } }" }, { sleep }));
    assert.equal(calls.length, 1);
    assert.equal(delays.length, 0);
  }
});
