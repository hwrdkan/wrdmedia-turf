// Provider adapters for the Turf Visualizer. One function, three backends, same contract:
//   render({ provider, keys, photo, swatches, prompt }) -> { png: Uint8Array, provider, model, ms, usd }
// photo / swatches are { mime, b64 } (bare base64). Used by the Cloudflare Pages Function
// (functions/api/turf-render.js) and the local dev server (dev-server.mjs).
//
// Default: OpenAI gpt-image-2.5-sunburst, about $0.085 per 1536 px render (validated 4 Oct 2026: 6 of 6 new yards kept the scene,
// cleaner turf than Gemini). Fallback: Google Gemini 3 Pro Image, $0.134 per 1K render. Tested 3 Oct 2026 against flash-lite ($0.034), 2.5 flash ($0.039)
// and 3.1 flash ($0.067): Pro kept the scene and the product look most faithfully. GEMINI_MODEL switches model.
// Fallbacks: fal.ai Seedream 4 edit (about $0.03, needs image URLs, so data URIs are sent),
//            OpenAI gpt-image (the ARS visualizer's model, roughly $0.20+ per render at high quality).

export const PROVIDERS = {
  gemini: { model: "gemini-3-pro-image", usd: 0.134, key: "GEMINI_API_KEY" },
  fal: { model: "fal-ai/bytedance/seedream/v4/edit", usd: 0.03, key: "FAL_KEY" },
  openai: { model: "gpt-image-2.5-sunburst", usd: 0.25, key: "OPENAI_API_KEY" }, // usd is an estimate; the real cost comes back in the response usage
};

// Google list prices per 1K render (checked 3 Oct 2026 on ai.google.dev/gemini-api/docs/pricing).
export const GEMINI_USD = { "gemini-3.1-flash-lite-image": 0.0336, "gemini-2.5-flash-image": 0.039, "gemini-3.1-flash-image": 0.067, "gemini-3-pro-image": 0.134 };

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// Aspect ratios the Gemini image models accept; the photo's own ratio is snapped to the nearest one
// so the render comes back the same shape and the color lock can align it pixel for pixel.
const RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
export function nearestRatio(aspect) {
  const a = Number(aspect);
  if (!Number.isFinite(a) || a <= 0) return undefined;
  return RATIOS.reduce((best, r) => { const [w, h] = r.split(":").map(Number); return Math.abs(Math.log(w / h / a)) < Math.abs(Math.log(best.v)) ? { r, v: w / h / a } : best; }, { r: "1:1", v: 1 / a }).r;
}

async function gemini(key, { photo, swatches, prompt, aspect, model, guide }) {
  const parts = [{ text: prompt }, { inline_data: { mime_type: photo.mime, data: photo.b64 } }, ...swatches.slice(0, 3).map((s) => ({ inline_data: { mime_type: s.mime, data: s.b64 } })), ...(guide ? [{ inline_data: { mime_type: guide.mime, data: guide.b64 } }] : [])];
  const imageConfig = { imageSize: "1K" };
  const ratio = nearestRatio(aspect);
  if (ratio) imageConfig.aspectRatio = ratio;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model || PROVIDERS.gemini.model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig } }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error?.message || `Gemini returned ${res.status}`), { status: res.status });
  const img = (j.candidates?.[0]?.content?.parts || []).find((p) => p.inline_data || p.inlineData);
  const data = img && (img.inline_data || img.inlineData).data;
  if (!data) throw Object.assign(new Error(j.candidates?.[0]?.finishReason ? `No image returned (${j.candidates[0].finishReason})` : "No image returned"), { status: 502 });
  return b64ToBytes(data);
}

async function fal(key, { photo, swatches, prompt }) {
  const urls = [photo, ...swatches.slice(0, 2)].map((i) => `data:${i.mime};base64,${i.b64}`);
  const res = await fetch(`https://fal.run/${PROVIDERS.fal.model}`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Key ${key}` },
    body: JSON.stringify({ prompt, image_urls: urls, num_images: 1, enable_safety_checker: true }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.detail?.[0]?.msg || j.detail || `fal returned ${res.status}`), { status: res.status });
  const url = j.images?.[0]?.url;
  if (!url) throw Object.assign(new Error("No image returned"), { status: 502 });
  const img = await fetch(url);
  return new Uint8Array(await img.arrayBuffer());
}

// OpenAI image edit. Size follows the photo's shape (multiples of 16, long edge 1536), quality from OPENAI_QUALITY
// (default high), model from OPENAI_MODEL. Real cost is computed from the usage the API returns.
async function openai(key, { photo, swatches, prompt, aspect, model, env = {}, guide, mask }) {
  const a = Number(aspect) > 0 ? Number(aspect) : 1.5;
  const r16 = (n) => Math.max(256, Math.round(n / 16) * 16);
  const [w, h] = a >= 1 ? [1536, r16(1536 / a)] : [r16(1536 * a), 1536];
  const form = new FormData();
  form.append("model", model || PROVIDERS.openai.model);
  form.append("image[]", new Blob([b64ToBytes(photo.b64)], { type: photo.mime }), "photo.jpg");
  swatches.slice(0, 3).forEach((s, i) => form.append("image[]", new Blob([b64ToBytes(s.b64)], { type: s.mime }), `swatch${i}.jpg`));
  if (mask) form.append("mask", new Blob([b64ToBytes(mask.b64)], { type: "image/png" }), "mask.png");
  if (guide) form.append("image[]", new Blob([b64ToBytes(guide.b64)], { type: guide.mime }), "guide.jpg");
  form.append("prompt", prompt);
  form.append("size", `${w}x${h}`);
  form.append("quality", env.OPENAI_QUALITY || "high");
  const res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error?.message || `OpenAI returned ${res.status}`), { status: res.status });
  const data = j.data?.[0]?.b64_json;
  if (!data) throw Object.assign(new Error("No image returned"), { status: 502 });
  const png = b64ToBytes(data);
  const u = j.usage || {}, d = u.input_tokens_details || {};
  const imgIn = d.image_tokens ?? 0, txtIn = d.text_tokens ?? Math.max(0, (u.input_tokens || 0) - imgIn);
  png.usageUsd = ((txtIn * 5 + imgIn * 8 + (u.output_tokens || 0) * 30) / 1e6);   // list prices checked 4 Oct 2026
  png.usage = { size: `${w}x${h}`, ...u };
  return png;
}

const ADAPTERS = { gemini, fal, openai };

export function pickProvider(requested, keys) {
  const order = [requested, "openai", "gemini", "fal"].filter((p, i, a) => p && ADAPTERS[p] && a.indexOf(p) === i);
  return order.find((p) => keys[PROVIDERS[p].key]) || null;
}

export async function render({ provider, keys, photo, swatches, prompt, aspect, guide, mask }) {
  const p = pickProvider(provider, keys);
  if (!p) throw Object.assign(new Error("No image provider key is configured (GEMINI_API_KEY, FAL_KEY or OPENAI_API_KEY)."), { status: 500 });
  const model = p === "gemini" && keys.GEMINI_MODEL ? keys.GEMINI_MODEL : p === "openai" && keys.OPENAI_MODEL ? keys.OPENAI_MODEL : PROVIDERS[p].model;
  const t0 = Date.now();
  const png = await ADAPTERS[p](keys[PROVIDERS[p].key], { photo, swatches, prompt, aspect, model, env: keys, guide, mask });
  return { png, provider: p, model, ms: Date.now() - t0, usd: p === "gemini" ? (GEMINI_USD[model] ?? PROVIDERS.gemini.usd) : (png.usageUsd ?? PROVIDERS[p].usd), usage: png.usage };
}

// Request validation shared by both servers. The browser sends only the photo and its choices;
// the server builds the prompt from the catalog and fetches the product photos itself, so the
// endpoint can never be used as a general-purpose image generator.
export const MAX_B64 = 8_000_000;
export function validate(body, catalog, Prompt) {
  const clean = (s) => String(s || "").replace(/^data:image\/[a-z+]+;base64,/, "").trim();
  const mimeOf = (s) => (String(s || "").match(/^data:(image\/(?:jpeg|png|webp));base64,/) || [])[1] || "image/jpeg";
  if (!body || typeof body !== "object") return { error: "Body must be JSON.", status: 400 };
  const photo = clean(body.photo);
  if (!photo) return { error: "Missing photo.", status: 400 };
  if (photo.length > MAX_B64) return { error: "Image too large. Try a smaller photo.", status: 413 };
  if (!/^[A-Za-z0-9+/]+$/.test(photo.slice(0, 4000))) return { error: "Images must be base64.", status: 400 };
  const line = catalog.lines.find((l) => l.id === body.lineId);
  if (!line) return { error: "Unknown turf.", status: 400 };
  const mode = body.mode === "putt" ? "putt" : "lawn";
  const border = mode === "putt" && Prompt.BORDERS && Prompt.BORDERS[body.border] ? body.border : "auto";
  if (mode === "putt" && !(line.uses || []).includes("putting")) return { error: "Pick a putting turf.", status: 400 };
  const area = Prompt.AREAS[body.area] ? body.area : "backyard";
  const preset = Prompt.PRESETS[body.preset] ? (mode === "putt" && body.preset === "none" ? "kidney" : body.preset) : (mode === "putt" ? "kidney" : "none");
  const puttingLine = mode === "putt" ? line : preset !== "none" ? catalog.lines.find((l) => l.id === body.puttingLineId && l.uses.includes("putting")) || catalog.lines.find((l) => l.id === "tour-platinum") : null;
  const size = Prompt.SIZES && Prompt.SIZES[body.size] && (body.size !== "x" || mode === "putt") ? body.size : "m";
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const px = num(body.place && body.place.x), py = num(body.place && body.place.y);
  const place = preset !== "none" && px !== null && py !== null ? { x: Math.min(0.95, Math.max(0.05, px)), y: Math.min(0.95, Math.max(0.3, py)), rot: body.place.rot ? 1 : 0 } : null;
  const guideB64 = preset !== "none" && place ? clean(body.guide) : "";
  if (guideB64.length > MAX_B64) return { error: "Image too large. Try a smaller photo.", status: 413 };
  if (guideB64 && !/^[A-Za-z0-9+/]+$/.test(guideB64.slice(0, 4000))) return { error: "Images must be base64.", status: 400 };
  const guide = guideB64 ? { mime: mimeOf(body.guide), b64: guideB64 } : null;
  return {
    size, place, guide, mode, border,
    photo: { mime: mimeOf(body.photo), b64: photo },
    line, puttingLine, area, preset,
    prompt: Prompt.build({ line, area, preset, puttingLine, size, place, guide: !!guide, mode, border }),
    swatchUrls: line.images.slice(0, 3).filter(Boolean),
    provider: typeof body.provider === "string" ? body.provider : undefined,
    aspect: Number(body.aspect) > 0.2 && Number(body.aspect) < 5 ? Number(body.aspect) : undefined,
    lead: body.lead && typeof body.lead === "object" ? { email: String(body.lead.email || "").slice(0, 200), name: String(body.lead.name || "").slice(0, 100), phone: String(body.lead.phone || "").slice(0, 30), zip: String(body.lead.zip || "").trim().slice(0, 10) } : null,
  };
}

// Product photos, fetched server-side and cached in memory per isolate.
const swatchCache = new Map();
export async function fetchSwatches(urls) {
  return Promise.all(urls.map(async (u) => {
    if (swatchCache.has(u)) return swatchCache.get(u);
    const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 TurfVisualizer" } });
    if (!r.ok) throw Object.assign(new Error(`Turf sample unavailable (${r.status})`), { status: 502 });
    const bytes = new Uint8Array(await r.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const v = { mime: r.headers.get("content-type") || "image/jpeg", b64: btoa(bin) };
    swatchCache.set(u, v);
    return v;
  }));
}

// Lead rules shared by the page and the server: all four fields are required to see a render.
// Phone needs 10 digits (an optional leading 1 is allowed); ZIP is 5 digits, optionally followed by -1234.
export function leadProblems(lead) {
  const l = lead || {}, digits = String(l.phone || "").replace(/\D/g, "");
  const out = [];
  if (String(l.name || "").trim().length < 2) out.push("your name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(l.email || "").trim())) out.push("a valid email");
  if (!(digits.length === 10 || (digits.length === 11 && digits[0] === "1"))) out.push("a phone number with 10 digits");
  if (!/^\d{5}(-\d{4})?$/.test(String(l.zip || "").trim())) out.push("a 5-digit ZIP code");
  return out;
}
