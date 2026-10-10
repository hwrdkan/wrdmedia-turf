// Spend controls for the public render endpoint. Pure logic over a KV-like store
// ({ get(key), put(key, value, { expirationTtl }) }), so it runs in the Pages Function and in node tests.
//
// Layers, cheapest first:
//   1. kill switch        RENDERS_PAUSED=1 stops every paid call for this dealer site.
//   2. cache              the same photo + choices returns the stored render; no spend, no count.
//   3. per-lead day cap   one homeowner (email) gets DAILY_PER_LEAD fresh renders a day.
//   4. per-IP day cap     DAILY_PER_IP per network per day (households share one IP, so it is looser).
//   5. per-site month cap MONTHLY_CAP renders per dealer site per calendar month: the hard budget.
// Counters are reserved BEFORE the paid call and released if it fails, so bursts can't run far past a cap.
// KV is eventually consistent, so simultaneous requests can overshoot a cap by a few renders; the Google
// project spend cap is the final backstop.

export const DEFAULTS = { DAILY_PER_LEAD: 8, DAILY_PER_IP: 15, MONTHLY_CAP: 150, CACHE_DAYS: 7, USD_PER_RENDER: 0.085 };

export function limitsFrom(env = {}) {
  const n = (k) => (Number.isFinite(Number(env[k])) && Number(env[k]) >= 0 && env[k] !== "" && env[k] != null ? Number(env[k]) : DEFAULTS[k]);
  return { paused: String(env.RENDERS_PAUSED || "") === "1", perLead: n("DAILY_PER_LEAD"), perIp: n("DAILY_PER_IP"), monthCap: n("MONTHLY_CAP"), cacheDays: n("CACHE_DAYS") };
}

const day = (d) => d.toISOString().slice(0, 10);
const month = (d) => d.toISOString().slice(0, 7);

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Cache key covers everything that changes the image: the photo bytes, turf, area, putting design and model.
export async function cacheKey({ photoB64, lineId, area, preset, puttingLineId, model, size, place, mode, border }) {
  const put = preset === "none" ? "" : [puttingLineId || "", size || "m", place ? [place.x, place.y, place.rot].map((n) => Number(n).toFixed(2)).join(",") : ""].join(":");
  return "cache:" + (await sha256([photoB64, lineId, area, preset, put, model || "", mode === "putt" ? "putt:" + (border || "auto") : ""].join("|")));
}

export async function counterKeys({ email, ip, now = new Date() }) {
  const lead = await sha256(String(email || "").trim().toLowerCase());
  return [
    { key: `lead:${day(now)}:${lead}`, ttl: 172800, limit: "perLead", msg: "You've used today's fresh renders. You can still switch turf colors instantly, and we'll send more with your quote." },
    { key: `ip:${day(now)}:${ip || "unknown"}`, ttl: 172800, limit: "perIp", msg: "Lots of previews from this network today. Try again tomorrow, or request a quote and we'll render it for you." },
    { key: `month:${month(now)}`, ttl: 3456000, limit: "monthCap", msg: "Previews are paused for this month. Request a quote and we'll render your yard for you." },
  ];
}

// Check every cap, then reserve one unit on each. Returns { ok, status, error, release }.
export async function reserve(kv, limits, keys) {
  if (limits.paused) return { ok: false, status: 503, error: "Previews are paused for the moment. Request a quote and we'll render your yard for you." };
  if (!kv) return { ok: true, release: async () => {} };
  const counts = await Promise.all(keys.map((k) => kv.get(k.key).then((v) => Number(v || 0))));
  for (let i = 0; i < keys.length; i++) if (counts[i] >= limits[keys[i].limit]) return { ok: false, status: 429, error: keys[i].msg };
  await Promise.all(keys.map((k, i) => kv.put(k.key, String(counts[i] + 1), { expirationTtl: k.ttl })));
  return {
    ok: true,
    release: async () => {
      const now = await Promise.all(keys.map((k) => kv.get(k.key).then((v) => Number(v || 0))));
      await Promise.all(keys.map((k, i) => kv.put(k.key, String(Math.max(0, now[i] - 1)), { expirationTtl: k.ttl })));
    },
  };
}

// Month-to-date usage for monitoring (count and estimated dollars).
export async function usage(kv, now = new Date(), usdPerRender = DEFAULTS.USD_PER_RENDER) {
  const count = kv ? Number((await kv.get(`month:${month(now)}`)) || 0) : 0;
  return { month: month(now), renders: count, usd: Math.round(count * usdPerRender * 100) / 100 };
}
