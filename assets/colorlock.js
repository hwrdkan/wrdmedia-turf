// Color lock: after the AI render, pull the new turf's color back onto the real
// product. The model decides where the turf goes and how the light falls; this
// step makes the hue and saturation match TurfHub's own product photo.
//
// Method, all deterministic:
//   1. mask   = pixels that changed between the original and the render AND read as turf green
//   2. target = CIELAB statistics of the turf fibers in the product photo (white studio
//               background and black backing excluded)
//   3. apply  = per-pixel Reinhard transfer on a* and b* (the color) inside the mask, with only
//               a partial shift of L* so the scene's sunlight and shade survive.
// Works on RGBA byte arrays, so it runs in the browser (canvas ImageData) and in Node tests.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TurfColorLock = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // sRGB <-> CIELAB (D65)
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const gam = (c) => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(v * 255))); };
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fi = (t) => (t * t * t > 216 / 24389 ? t * t * t : (116 * t - 16) / (24389 / 27));

  function rgbToLab(r, g, b) {
    const R = lin(r), G = lin(g), B = lin(b);
    const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
    const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const fy = f(Y);
    return [116 * fy - 16, 500 * (f(X) - fy), 200 * (fy - f(Z))];
  }

  function labToRgb(L, a, b) {
    const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    const X = fi(fx) * 0.95047, Y = fi(fy), Z = fi(fz) * 1.08883;
    const R = X * 3.2406 + Y * -1.5372 + Z * -0.4986;
    const G = X * -0.9689 + Y * 1.8758 + Z * 0.0415;
    const B = X * 0.0557 + Y * -0.2040 + Z * 1.0570;
    return [gam(R), gam(G), gam(B)];
  }

  // Turf reads as green-to-olive: a* negative, b* positive, not near-white, not near-black.
  function isTurfLab(L, a, b) {
    return L > 12 && L < 92 && a < -4 && b > 2 && Math.hypot(a, b) > 10;
  }

  function stats(samples) {
    const n = samples.length;
    if (!n) return null;
    const m = [0, 0, 0], s = [0, 0, 0];
    for (const p of samples) for (let k = 0; k < 3; k++) m[k] += p[k];
    for (let k = 0; k < 3; k++) m[k] /= n;
    for (const p of samples) for (let k = 0; k < 3; k++) s[k] += (p[k] - m[k]) ** 2;
    for (let k = 0; k < 3; k++) s[k] = Math.sqrt(s[k] / n) || 1e-6;
    return { mean: m, std: s, n };
  }

  // Target statistics from the product photo: turf fibers only.
  function swatchStats(rgba, step = 2) {
    const out = [];
    for (let i = 0; i < rgba.length; i += 4 * step) {
      const lab = rgbToLab(rgba[i], rgba[i + 1], rgba[i + 2]);
      if (isTurfLab(lab[0], lab[1], lab[2])) out.push(lab);
    }
    return stats(out);
  }

  // Changed-and-green mask. Returns a Uint8Array of 0/1 plus its coverage.
  function turfMask(before, after, threshold = 18) {
    const n = after.length / 4, mask = new Uint8Array(n);
    let count = 0;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const la = rgbToLab(after[i], after[i + 1], after[i + 2]);
      if (!isTurfLab(la[0], la[1], la[2])) continue;
      const lb = rgbToLab(before[i], before[i + 1], before[i + 2]);
      const d = Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
      if (d >= threshold) { mask[p] = 1; count++; }
    }
    return { mask, coverage: count / n };
  }

  // Mask of green pixels only (for when the "before" can't be aligned pixel-for-pixel).
  function greenMask(after) {
    const n = after.length / 4, mask = new Uint8Array(n);
    let count = 0;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const la = rgbToLab(after[i], after[i + 1], after[i + 2]);
      if (isTurfLab(la[0], la[1], la[2])) { mask[p] = 1; count++; }
    }
    return { mask, coverage: count / n };
  }

  // In-place color transfer on `after` inside `mask`. lStrength keeps scene lighting.
  function apply(after, mask, target, { strength = 0.85, lStrength = 0.25 } = {}) {
    const samples = [];
    for (let p = 0, i = 0; p < mask.length; p++, i += 4) if (mask[p]) samples.push(rgbToLab(after[i], after[i + 1], after[i + 2]));
    const src = stats(samples);
    if (!src || !target) return { changed: 0, before: src, target };
    const k = [lStrength, strength, strength];
    for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
      if (!mask[p]) continue;
      const lab = rgbToLab(after[i], after[i + 1], after[i + 2]);
      for (let c = 0; c < 3; c++) {
        const moved = (lab[c] - src.mean[c]) * (target.std[c] / src.std[c]) + target.mean[c];
        lab[c] = lab[c] + (moved - lab[c]) * k[c];
      }
      const rgb = labToRgb(lab[0], lab[1], lab[2]);
      after[i] = rgb[0]; after[i + 1] = rgb[1]; after[i + 2] = rgb[2];
    }
    return { changed: samples.length, before: src, target };
  }

  // Shift-only color transfer: moves the turf's average a* b* to the product's measured color and keeps every pixel's own
  // variation. Unlike `apply` it does not rescale the spread, so sun and shade stay natural while the average hits the
  // product color (tested 4 Oct 2026 on 18 renders: average a*b* error 1.0 against 1.3 for full-strength `apply`, with the
  // lowest peak saturation). Dark pixels are shifted less (floor) so deep shade does not turn vivid.
  function shiftTo(after, mask, target, { floor = 0.25, lShift = 0.15 } = {}) {
    const lab = [], idx = [];
    for (let p = 0, i = 0; p < mask.length; p++, i += 4) if (mask[p]) { lab.push(rgbToLab(after[i], after[i + 1], after[i + 2])); idx.push(i); }
    const n = lab.length; if (!n || !target) return { changed: 0 };
    const m = [0, 0, 0]; for (const v of lab) for (let c = 0; c < 3; c++) m[c] += v[c] / n;
    const Ls = lab.map((v) => v[0]).sort((a, b) => a - b), med = Ls[n >> 1] || 1;
    const W = lab.map((v) => Math.max(floor, Math.min(1, v[0] / med)));
    // Shaded pixels are shifted less, so the average shift is below 1; scale up so the AVERAGE color lands on the product.
    const gain = Math.min(1.5, 1 / (W.reduce((s, x) => s + x, 0) / n));
    for (let j = 0; j < n; j++) {
      const v = lab[j], w = W[j] * gain;
      const rgb = labToRgb(v[0] + (target.mean[0] - m[0]) * lShift * w, v[1] + (target.mean[1] - m[1]) * w, v[2] + (target.mean[2] - m[2]) * w);
      after[idx[j]] = rgb[0]; after[idx[j] + 1] = rgb[1]; after[idx[j] + 2] = rgb[2];
    }
    return { changed: n };
  }

  // Mean color difference (CIE76 on a*, b*) between masked pixels and a target: the report number.
  function chromaError(rgba, mask, target) {
    const s = [];
    for (let p = 0, i = 0; p < mask.length; p++, i += 4) if (mask[p]) s.push(rgbToLab(rgba[i], rgba[i + 1], rgba[i + 2]));
    const st = stats(s);
    return st && target ? Math.hypot(st.mean[1] - target.mean[1], st.mean[2] - target.mean[2]) : null;
  }

  // Keep the homeowner's own pixels wherever the model changed something that is NOT turf. A pool, edging, a wall
  // or a patio the model invented shows up as "changed and not turf-colored", so it reverts to the original photo.
  // Turf (including deep shade) and everything the model left alone stay as rendered.
  function revertMask(before, after, w, h, dE = 20) {
    const m = new Uint8Array(w * h);
    for (let p = 0, i = 0; p < m.length; p++, i += 4) {
      const la = rgbToLab(after[i], after[i + 1], after[i + 2]);
      const turfish = (la[1] < -1 && la[2] > 0 && Math.hypot(la[1], la[2]) > 4) || la[0] < 22;
      if (turfish) continue;
      const lb = rgbToLab(before[i], before[i + 1], before[i + 2]);
      if (Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]) >= dE) m[p] = 1;
    }
    return m;
  }
  function boxMax(src, w, h, r, takeMax) {
    const pad = takeMax ? 0 : 1, tmp = new Uint8Array(src.length), out = new Uint8Array(src.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = takeMax ? 0 : 1; for (let k = -r; k <= r; k++) { const xx = x + k, t = xx < 0 || xx >= w ? pad : src[y * w + xx]; v = takeMax ? (t > v ? t : v) : (t < v ? t : v); }
      tmp[y * w + x] = v;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = takeMax ? 0 : 1; for (let k = -r; k <= r; k++) { const yy = y + k, t = yy < 0 || yy >= h ? pad : tmp[yy * w + x]; v = takeMax ? (t > v ? t : v) : (t < v ? t : v); }
      out[y * w + x] = v;
    }
    return out;
  }
  // Fill holes inside invented objects, drop stray specks, feather the edge. Returns Float32Array 0..1.
  function softRevert(mask, w, h) {
    let m = boxMax(boxMax(mask, w, h, 3, true), w, h, 3, false);   // close
    m = boxMax(boxMax(m, w, h, 1, false), w, h, 1, true);          // open
    const f = 2, soft = new Float32Array(m.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sum = 0, n = 0; for (let dy = -f; dy <= f; dy++) for (let dx = -f; dx <= f; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < h && xx >= 0 && xx < w) { sum += m[yy * w + xx]; n++; } }
      soft[y * w + x] = sum / n;
    }
    return soft;
  }
  // out = original where soft is 1, render where it is 0. Writes into `after` (RGBA bytes).
  function revert(before, after, soft) {
    for (let p = 0, i = 0; p < soft.length; p++, i += 4) {
      const m = soft[p]; if (m <= 0.001) continue;
      for (let k = 0; k < 3; k++) after[i + k] = Math.round(after[i + k] * (1 - m) + before[i + k] * m);
    }
    return after;
  }

  return { shiftTo, revertMask, softRevert, revert, rgbToLab, labToRgb, isTurfLab, swatchStats, turfMask, greenMask, apply, chromaError, stats };
});
