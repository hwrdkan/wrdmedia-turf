// Render checks: cheap, deterministic tests that run on every AI render before the homeowner sees it.
// They catch the failures seen in the 3 Oct 2026 test batches: a pale concrete slab or other neutral object
// added to the ground, old dry grass left behind, the ground not converted to turf, and a scene that was
// rebuilt instead of edited (the top of the frame no longer matches the photo).
// Inputs are RGBA byte arrays of the SAME size (the browser downsamples both to 192 px first).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./colorlock.js"));
  else root.TurfChecks = factory(root.TurfColorLock);
})(typeof self !== "undefined" ? self : this, function (CL) {
  "use strict";
  // Calibrated 4 Oct 2026 on 25 renders across 7 yards. Pale hardscape and rocks are normal in a real yard, so the
// object check only counts pale neutral pixels that are NEW compared with the original photo.
const T = { minTop: 0.2, minGreen: 0.15, maxNewGray: 0.03, maxDry: 0.03 };

  const gray = (d, n) => { const g = new Float32Array(n); for (let p = 0, i = 0; p < n; p++, i += 4) g[p] = (d[i] + d[i + 1] + d[i + 2]) / 3; return g; };
  function grad(g, w, h) {
    const o = new Float32Array((w - 1) * (h - 1));
    for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) o[y * (w - 1) + x] = Math.abs(g[y * w + x + 1] - g[y * w + x]) + Math.abs(g[(y + 1) * w + x] - g[y * w + x]);
    return o;
  }
  function ncc(a, b) {
    let ma = 0, mb = 0; const n = a.length;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n; let s = 0, sa = 0, sb = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; s += x * y; sa += x * x; sb += y * y; }
    return s / Math.sqrt(sa * sb + 1e-9);
  }
  // Best normalized correlation of the top band's edges, searching small shifts (a phone shot can drift a few pixels).
  function topSimilarity(before, after, w, h, frac = 0.3, sh = 10) {
    const bh = Math.floor(h * frac), W = w - 1, H = bh - 1;
    const ga = grad(gray(after, w * h).subarray(0, w * bh), w, bh), gb = grad(gray(before, w * h).subarray(0, w * bh), w, bh);
    let best = -1;
    for (let dy = -sh; dy <= sh; dy += 2) for (let dx = -sh; dx <= sh; dx += 2) {
      const x0 = Math.max(0, -dx), y0 = Math.max(0, -dy), x1 = W - Math.max(0, dx), y1 = H - Math.max(0, dy);
      if ((x1 - x0) * (y1 - y0) < 500) continue;
      const a = [], b = [];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { a.push(ga[y * W + x]); b.push(gb[(y + dy) * W + x + dx]); }
      best = Math.max(best, ncc(a, b));
    }
    return best;
  }

  // Pale, nearly colorless pixels (concrete, stone, a patio) in the lower part of the frame.
  function paleMask(d, w, h, y0) {
    const m = new Uint8Array(w * h);
    for (let y = y0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, lab = CL.rgbToLab(d[i], d[i + 1], d[i + 2]);
      if (Math.hypot(lab[1], lab[2]) < 9 && lab[0] > 55) m[y * w + x] = 1;
    }
    return m;
  }
  // Grow a mask by r pixels so slightly shifted existing hardscape does not count as new.
  function grow(m, w, h, r) {
    const out = new Uint8Array(m.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < h && xx >= 0 && xx < w) out[yy * w + xx] = 1;
      }
    }
    return out;
  }

  function check(before, after, w, h, opts = {}) {
    const m = { top: topSimilarity(before, after, w, h) };
    const y0 = Math.floor(h * 0.45), lowN = (h - y0) * w;
    let green = 0, dry = 0;
    for (let y = Math.floor(h * 0.25); y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, lab = CL.rgbToLab(after[i], after[i + 1], after[i + 2]);
      if (CL.isTurfLab(lab[0], lab[1], lab[2])) { if (y >= y0) green++; }
      else if (lab[0] > 55 && lab[2] > 28 && lab[1] > -6 && lab[1] < 12) dry++;   // tan or yellow
    }
    m.green = green / lowN;
    m.dry = dry / ((h - Math.floor(h * 0.25)) * w);
    const pb = grow(paleMask(before, w, h, y0), w, h, 6), pa = paleMask(after, w, h, y0);
    let fresh = 0; for (let k = y0 * w; k < w * h; k++) if (pa[k] && !pb[k]) fresh++;
    m.newGray = fresh / lowN;
    const reasons = [];
    if (m.top < T.minTop) reasons.push("scene changed");
    if (!opts.partial && m.green < T.minGreen) reasons.push("ground not converted");   // a putting-green-only render leaves most of the ground as it was
    if (m.newGray > T.maxNewGray) reasons.push("new object on the ground");
    if (!opts.partial && m.dry > T.maxDry) reasons.push("old dry grass left");
    return { ok: reasons.length === 0, reasons, metrics: m };
  }

  return { check, topSimilarity, THRESHOLDS: T };
});
