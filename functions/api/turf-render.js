// Cloudflare Pages Function: POST /api/turf-render
//
// PUBLIC ENDPOINT THAT SPENDS MONEY ON EVERY CALL. Unlike the ARS visualizer (an internal sales
// tool behind a password), this one sits on a dealer's public site, so it is protected in layers:
//   1. A lead is required: name, email, phone and ZIP travel with the request (that is the point of the tool).
//   2. Cloudflare Turnstile, verified server-side, when TURNSTILE_SECRET is set.
//   3. Spend controls in KV (limits.mjs), when the RENDER_KV binding exists: a cache (repeat requests
//      cost nothing), a per-homeowner daily cap, a per-IP daily cap and a per-site monthly cap that
//      is the dealer's hard budget. RENDERS_PAUSED=1 stops all paid calls.
//   4. The server builds the prompt and fetches the product photos: callers cannot send a prompt.
// Switching turf color on an existing render happens in the browser (color lock) and never calls this.
// It FAILS CLOSED: no provider key -> 500, never a silent free-for-all.
//
// Env: GEMINI_API_KEY (default provider) | FAL_KEY | OPENAI_API_KEY, TURNSTILE_SECRET (optional),
//      RENDER_KV (optional KV binding), DAILY_PER_LEAD (default 8), DAILY_PER_IP (default 15),
//      MONTHLY_CAP (default 150 renders, about $13 at $0.085), CACHE_DAYS (default 7), RENDERS_PAUSED.
// Body: { photo: dataURL, lineId, area, preset, puttingLineId, lead: {name,email,phone,zip}, turnstile }
// Returns image/png bytes, or JSON { error }.
import catalog from "../../data/turfhub-catalog.json";
import Prompt from "../../visualizer/prompt.js";
import { render, validate, fetchSwatches, pickProvider, leadProblems, bytesToB64, PROVIDERS } from "../../visualizer/render-core.mjs";
import { limitsFrom, cacheKey, counterKeys, reserve } from "../../visualizer/limits.mjs";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function onRequestPost({ request, env, waitUntil }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Body must be JSON." }, 400); }
  // No provider key configured (the default until rendering is approved): say so before doing any work.
  if (!env.GEMINI_API_KEY && !env.FAL_KEY && !env.OPENAI_API_KEY) return json({ error: "Previews are paused for the moment. Request a quote and we'll render your yard for you." }, 503);
  const v = validate(body, catalog, Prompt);
  if (v.error) return json({ error: v.error }, v.status);
  const need = leadProblems(v.lead);
  if (need.length) return json({ error: "Please add " + need.join(", ") + " to see your yard." }, 400);

  if (env.TURNSTILE_SECRET) {
    const form = new FormData();
    form.append("secret", env.TURNSTILE_SECRET);
    form.append("response", String(body.turnstile || ""));
    form.append("remoteip", request.headers.get("CF-Connecting-IP") || "");
    const ok = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form }).then((r) => r.json()).catch(() => ({}));
    if (!ok.success) return json({ error: "Please confirm you're not a robot and try again." }, 403);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const limits = limitsFrom(env), kv = env.RENDER_KV;
  if (limits.paused) return json({ error: "Previews are paused for the moment. Request a quote and we'll render your yard for you." }, 503);
  const png = (bytes, extra = {}) => new Response(bytes, { headers: { "content-type": "image/png", "cache-control": "no-store", ...extra } });

  // Multi-angle set: up to 2 extra photos of the same yard. One bot check and one set of caps cover the whole set
  // (each angle counts as a render). Angle 1 renders first; its result goes to angles 2 and 3 as the REFERENCE RENDER
  // so the turf and the putting green match in every view. Nothing is returned until all angles finish.
  if (Array.isArray(body.angles) && body.angles.length) return renderSet({ request, env, waitUntil, body, v, limits, kv, ip });

  // Same photo and same choices as before: serve the stored render, spend nothing, count nothing.
  const prov = pickProvider(v.provider, env); // cache key must change when the provider or model does
  const model = prov === "openai" ? (env.OPENAI_MODEL || PROVIDERS.openai.model) : prov === "gemini" ? (env.GEMINI_MODEL || PROVIDERS.gemini.model) : prov;
  const ck = kv ? await cacheKey({ photoB64: v.photo.b64, lineId: v.line.id, area: v.area, preset: v.preset, puttingLineId: v.puttingLine && v.puttingLine.id, model, size: v.size, place: v.place, mode: v.mode, border: v.border }) : null;
  if (ck) {
    const hit = await kv.get(ck, { type: "arrayBuffer" });
    if (hit) return png(hit, { "x-render-cache": "hit", "x-render-usd": "0", "x-render-provider": prov || "", "x-render-model": model }); // the page picks its color-match strength from the provider, so a cached repeat must say it too
  }

  const hold = await reserve(kv, limits, await counterKeys({ email: v.lead.email, ip }));
  if (!hold.ok) return json({ error: hold.error }, hold.status);

  try {
    const swatches = await fetchSwatches(v.swatchUrls.map(u => new URL(u, request.url).href));
    const out = await render({ provider: v.provider, keys: env, photo: v.photo, swatches, prompt: v.prompt, aspect: v.aspect, guide: v.guide });
    if (ck && limits.cacheDays > 0) waitUntil(kv.put(ck, out.png, { expirationTtl: Math.max(60, limits.cacheDays * 86400) }).catch(() => {}));
    return png(out.png, { "x-render-cache": "miss", "x-render-provider": out.provider, "x-render-model": out.model, "x-render-ms": String(out.ms), "x-render-usd": String(out.usd) });
  } catch (err) {
    // Log the real reason for us; never show visitors provider billing or key errors.
    console.error("turf-render failed", err.status, err.message);
    waitUntil(hold.release().catch(() => {}));
    const capped = /spend(ing)? cap|quota|billing/i.test(String(err.message)); // Google project cap or billing: ours to fix, not a busy signal
    const busy = err.status === 429 && !capped;
    const account = capped || [401, 402, 403].includes(err.status);
    const msg = busy ? "Lots of people are previewing right now. Try again in a minute."
      : account ? "Previews are paused for the moment. Request a quote and we'll render your yard for you."
      : "That render didn't work. Try again, or try a different photo.";
    return json({ error: msg }, busy ? 429 : 502);
  }
}

const sniff = (u8) => (u8[0] === 0xff && u8[1] === 0xd8 ? "image/jpeg" : "image/png");

function failure(err) {
  // Log the real reason for us; never show visitors provider billing or key errors.
  console.error("turf-render failed", err.status, err.message);
  const capped = /spend(ing)? cap|quota|billing/i.test(String(err.message));
  const busy = err.status === 429 && !capped;
  const account = capped || [401, 402, 403].includes(err.status);
  const msg = busy ? "Lots of people are previewing right now. Try again in a minute."
    : account ? "Previews are paused for the moment. Request a quote and we'll render your yard for you."
    : "That render didn't work. Try again, or try a different photo.";
  return json({ error: msg }, busy ? 429 : 502);
}

async function renderSet({ request, env, waitUntil, body, v, limits, kv, ip }) {
  const vs = [];
  for (const a of body.angles.slice(0, 2)) {
    const x = validate({ ...body, photo: a && a.photo, aspect: a && a.aspect, place: a && a.place, guide: a && a.guide, angles: undefined }, catalog, Prompt);
    if (x.error) return json({ error: x.error }, x.status);
    vs.push(x);
  }
  const keys = await counterKeys({ email: v.lead.email, ip });
  const holds = [];
  for (let i = 0; i < 1 + vs.length; i++) {
    const h = await reserve(kv, limits, keys);
    if (!h.ok) { waitUntil(Promise.all(holds.map((x) => x.release().catch(() => {})))); return json({ error: h.error }, h.status); }
    holds.push(h);
  }
  const releaseAll = () => waitUntil(Promise.all(holds.map((x) => x.release().catch(() => {}))));
  try {
    const swatches = await fetchSwatches(v.swatchUrls.map((u) => new URL(u, request.url).href));
    const hero = await render({ provider: v.provider, keys: env, photo: v.photo, swatches, prompt: v.prompt, aspect: v.aspect, guide: v.guide });
    const ref = { mime: sniff(hero.png), b64: bytesToB64(hero.png) };
    const rest = await Promise.allSettled(vs.map((x) => render({
      provider: v.provider, keys: env, photo: x.photo, swatches, aspect: x.aspect, guide: x.guide, ref,
      prompt: Prompt.build({ line: x.line, area: x.area, preset: x.preset, puttingLine: x.puttingLine, size: x.size, place: x.place, guide: !!x.guide, mode: x.mode, border: x.border, hasRef: true }),
    })));
    const results = [{ b64: ref.b64, mime: ref.mime }];
    let usd = hero.usd;
    rest.forEach((r, i) => {
      if (r.status === "fulfilled") { results.push({ b64: bytesToB64(r.value.png), mime: sniff(r.value.png) }); usd += r.value.usd; }
      else { console.error("angle failed", r.reason && r.reason.message); results.push({ error: "This angle didn't render. Try again." }); waitUntil(holds[i + 1].release().catch(() => {})); }
    });
    return new Response(JSON.stringify({ results, provider: hero.provider, model: hero.model, usd }), { headers: { "content-type": "application/json", "cache-control": "no-store", "x-render-provider": hero.provider, "x-render-model": hero.model, "x-render-usd": String(usd) } });
  } catch (err) {
    releaseAll();
    return failure(err);
  }
}
