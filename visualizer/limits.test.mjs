// node --test build-kit/turf-tool/visualizer/limits.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, limitsFrom, cacheKey, counterKeys, reserve, usage } from "./limits.mjs";

const fakeKV = () => { const m = new Map(); return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => void m.set(k, v) }; };
const NOW = new Date("2026-09-27T15:00:00Z");

test("defaults apply when env is empty or junk", () => {
  const l = limitsFrom({ DAILY_PER_LEAD: "", MONTHLY_CAP: "abc" });
  assert.equal(l.perLead, DEFAULTS.DAILY_PER_LEAD);
  assert.equal(l.monthCap, DEFAULTS.MONTHLY_CAP);
  assert.equal(l.paused, false);
  assert.equal(limitsFrom({ MONTHLY_CAP: "0" }).monthCap, 0);
  assert.equal(limitsFrom({ RENDERS_PAUSED: "1" }).paused, true);
});

test("kill switch refuses before touching the store", async () => {
  const kv = fakeKV();
  const r = await reserve(kv, limitsFrom({ RENDERS_PAUSED: "1" }), await counterKeys({ email: "a@b.co", ip: "1.1.1.1", now: NOW }));
  assert.equal(r.ok, false); assert.equal(r.status, 503); assert.equal(kv.m.size, 0);
});

test("per-lead cap: the ninth render of the day is refused, email case ignored", async () => {
  const kv = fakeKV(), lim = limitsFrom({ DAILY_PER_LEAD: "8", DAILY_PER_IP: "100", MONTHLY_CAP: "100" });
  for (let i = 0; i < 8; i++) assert.equal((await reserve(kv, lim, await counterKeys({ email: i % 2 ? "Jo@X.com" : "jo@x.com ", ip: "1.1.1.1", now: NOW }))).ok, true);
  const r = await reserve(kv, lim, await counterKeys({ email: "jo@x.com", ip: "1.1.1.1", now: NOW }));
  assert.equal(r.ok, false); assert.equal(r.status, 429); assert.match(r.error, /switch turf colors instantly/);
  assert.equal((await reserve(kv, lim, await counterKeys({ email: "other@x.com", ip: "1.1.1.1", now: NOW }))).ok, true);
});

test("monthly cap is the hard budget across all homeowners", async () => {
  const kv = fakeKV(), lim = limitsFrom({ DAILY_PER_LEAD: "100", DAILY_PER_IP: "100", MONTHLY_CAP: "3" });
  for (let i = 0; i < 3; i++) assert.equal((await reserve(kv, lim, await counterKeys({ email: `u${i}@x.com`, ip: `ip${i}`, now: NOW }))).ok, true);
  const r = await reserve(kv, lim, await counterKeys({ email: "new@x.com", ip: "ip9", now: NOW }));
  assert.equal(r.ok, false); assert.match(r.error, /paused for this month/);
  assert.deepEqual(await usage(kv, NOW), { month: "2026-09", renders: 3, usd: 0.26 });
});

test("a failed render gives its reservation back", async () => {
  const kv = fakeKV(), lim = limitsFrom({ MONTHLY_CAP: "1" });
  const keys = await counterKeys({ email: "a@b.co", ip: "1.1.1.1", now: NOW });
  const r = await reserve(kv, lim, keys);
  assert.equal(r.ok, true);
  await r.release();
  assert.equal((await usage(kv, NOW)).renders, 0);
  assert.equal((await reserve(kv, lim, keys)).ok, true);
});

test("no KV binding means no counting (local and mock use)", async () => {
  const r = await reserve(null, limitsFrom({}), []);
  assert.equal(r.ok, true);
});

test("cache key changes with any render input and ignores putting turf when no green", async () => {
  const base = { photoB64: "AAAA", lineId: "sierra-blend-pro", area: "backyard", preset: "none", puttingLineId: "tour-platinum", model: "m" };
  const k = await cacheKey(base);
  assert.equal(k, await cacheKey({ ...base, puttingLineId: "other" }));
  for (const change of [{ photoB64: "AAAB" }, { lineId: "pet" }, { area: "front" }, { preset: "kidney" }, { model: "m2" }]) assert.notEqual(k, await cacheKey({ ...base, ...change }));
  assert.match(k, /^cache:[0-9a-f]{64}$/);
});

test("daily keys roll over at midnight UTC; month key per calendar month", async () => {
  const a = await counterKeys({ email: "a@b.co", ip: "x", now: new Date("2026-09-30T23:59:00Z") });
  const b = await counterKeys({ email: "a@b.co", ip: "x", now: new Date("2026-10-01T00:01:00Z") });
  assert.notEqual(a[0].key, b[0].key); assert.equal(a[2].key, "month:2026-09"); assert.equal(b[2].key, "month:2026-10");
});
