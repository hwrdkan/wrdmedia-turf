// Run: node --test build-kit/turf-tool/visualizer/visualizer.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const P = require("./prompt.js");
const L = require("./colorlock.js");
const catalog = require("../data/turfhub-catalog.json");

const line = (id) => catalog.lines.find((l) => l.id === id);
const fx = (name) => {
  const meta = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name + ".json")));
  return { ...meta, px: new Uint8ClampedArray(fs.readFileSync(path.join(__dirname, "fixtures", name + ".rgba"))) };
};

test("prompt carries the product's published specs, not invented ones", () => {
  const p = P.build({ line: line("sierra-blend-pro"), area: "backyard" });
  assert.match(p, /TurfHub Sierra Blend Pro/);
  assert.match(p, /1 3\/4 inch pile height/);
  assert.match(p, /75 oz face weight/);
  assert.match(p, /Spring and Emerald green/);
  assert.match(p, /brown and green thatch/);
  assert.match(p, /wave-shaped blades/);
  assert.match(p, /CHANGE NOTHING ELSE/);
  assert.doesNotMatch(p, /PUTTING GREEN/);
});

test("putting presets add geometry and the putting turf, and short turf gets the golf-green clause", () => {
  const p = P.build({ line: line("sierra-blend-pro"), area: "lawn", preset: "kidney", puttingLine: line("tour-platinum") });
  assert.match(p, /kidney-shaped \(bean-shaped\) putting green/);
  assert.match(p, /About 300 square feet, roughly 14 by 27 feet/);
  assert.match(p, /It has 4 cups/);
  assert.match(p, /TurfHub Tour Platinum/);
  const g = P.build({ line: line("tour-platinum"), area: "backyard" });
  assert.match(g, /short putting-green turf/);
  assert.doesNotMatch(g, /thatch curls between them/);
  for (const [k, v] of Object.entries(P.PRESETS)) if (k !== "none") assert.ok(v.sqft > 0 && v.desc, k);
});

test("fractional pile heights read like a spec sheet", () => {
  assert.equal(P.fmtPile(1.75), "1 3/4 inch");
  assert.equal(P.fmtPile(0.375), "3/8 inch");
  assert.equal(P.fmtPile(2), "2 inch");
  assert.equal(P.fmtPile(1.99), "2 inch");
  assert.equal(P.fmtPile(0), null);
});

test("every catalog line produces a prompt without crashing", () => {
  for (const l of catalog.lines) assert.ok(P.build({ line: l }).length > 500, l.id);
  assert.throws(() => P.build({}));
});

test("Lab conversion round-trips", () => {
  for (const c of [[0, 0, 0], [255, 255, 255], [34, 120, 40], [120, 140, 60], [200, 30, 90]]) {
    const back = L.labToRgb(...L.rgbToLab(...c));
    c.forEach((v, i) => assert.ok(Math.abs(v - back[i]) <= 1, `${c} -> ${back}`));
  }
});

test("swatch stats ignore the white studio background", () => {
  const s = fx("swatch-sierra-blend-pro");
  const st = L.swatchStats(s.px);
  assert.ok(st.n > 500);
  assert.ok(st.mean[1] < -10 && st.mean[2] > 10, `turf green expected, got ${st.mean.map((v) => v.toFixed(1))}`);
  assert.ok(st.mean[0] < 70, "white background leaked into the stats");
});

test("color lock pulls a drifted render back to the product and leaves the rest of the photo alone", () => {
  const scene = fx("scene"), target = L.swatchStats(fx("swatch-sierra-blend-pro").px);
  // Simulated "before": the lawn is brown dirt. Simulated AI "after": the turf came out too yellow and bright.
  const before = new Uint8ClampedArray(scene.px), after = new Uint8ClampedArray(scene.px);
  const turf = L.greenMask(scene.px).mask;
  for (let p = 0, i = 0; p < turf.length; p++, i += 4) {
    if (!turf[p]) continue;
    before[i] = 150; before[i + 1] = 120; before[i + 2] = 90;
    const lab = L.rgbToLab(after[i], after[i + 1], after[i + 2]);
    const rgb = L.labToRgb(lab[0] + 6, lab[1] * 0.55, lab[2] * 1.5 + 12);
    after[i] = rgb[0]; after[i + 1] = rgb[1]; after[i + 2] = rgb[2];
  }
  const { mask, coverage } = L.turfMask(before, after);
  assert.ok(coverage > 0.15 && coverage < 0.8, `coverage ${coverage}`);
  const drift = L.chromaError(after, mask, target);
  const untouched = after.slice();
  const lBefore = L.stats([...mask.keys()].filter((p) => mask[p]).map((p) => L.rgbToLab(after[p * 4], after[p * 4 + 1], after[p * 4 + 2]))).mean[0];
  L.apply(after, mask, target);
  const locked = L.chromaError(after, mask, target);
  assert.ok(drift > 8, `test drift too small: ${drift}`);
  assert.ok(locked < drift * 0.3, `color error ${drift.toFixed(1)} -> ${locked.toFixed(1)}`);
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) if (!mask[p]) assert.equal(after[i], untouched[i]);
  const lAfter = L.stats([...mask.keys()].filter((p) => mask[p]).map((p) => L.rgbToLab(after[p * 4], after[p * 4 + 1], after[p * 4 + 2]))).mean[0];
  assert.ok(Math.abs(lAfter - lBefore) < Math.abs(target.mean[0] - lBefore) * 0.5 + 1, "scene lighting should mostly survive");
});

test("nothing green changed means nothing to lock", () => {
  const scene = fx("scene");
  const { coverage } = L.turfMask(scene.px, scene.px);
  assert.equal(coverage, 0);
  const r = L.apply(new Uint8ClampedArray(scene.px), new Uint8Array(scene.px.length / 4), L.swatchStats(fx("swatch-pet").px));
  assert.equal(r.changed, 0);
});

test("revert restores the original photo wherever the model invented non-turf, and keeps the turf", () => {
  const L = require("./colorlock.js");
  const w = 24, h = 24, before = new Uint8ClampedArray(w * h * 4), after = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const x = p % w, i = p * 4, left = x < 12;
    before.set([176, 148, 108, 255], i);
    after.set(left ? [60, 120, 40, 255] : [235, 235, 240, 255], i); // right half: the model invented a pale patio
  }
  const soft = L.softRevert(L.revertMask(before, after, w, h), w, h);
  L.revert(before, after, soft);
  const px = (x, y) => Array.from(after.slice((y * w + x) * 4, (y * w + x) * 4 + 3));
  assert.deepEqual(px(3, 12), [60, 120, 40]);    // turf is kept
  assert.deepEqual(px(20, 12), [176, 148, 108]); // invented patio reverts to the original dirt
});

test("revert leaves dark shaded turf alone", () => {
  const L = require("./colorlock.js");
  const w = 12, h = 12, before = new Uint8ClampedArray(w * h * 4), after = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) { before.set([176, 148, 108, 255], p * 4); after.set([22, 38, 18, 255], p * 4); }
  const m = L.revertMask(before, after, w, h);
  assert.equal(m.reduce((a, b) => a + b, 0), 0);
});

test("size and placement are written into the prompt, with the guide-image clause only when a guide is sent", () => {
  const base = { line: line("sierra-blend-pro"), area: "lawn", preset: "ribbon", puttingLine: line("tour-platinum"), size: "l" };
  const a = P.build({ ...base, place: { x: 0.62, y: 0.7, rot: 0 }, guide: true });
  assert.match(a, /About 300 square feet/);
  assert.match(a, /62 percent from the left edge and 70 percent from the top/);
  assert.match(a, /LAST image/);
  assert.match(a, /spans about 42 percent of the frame width/);
  const b = P.build({ ...base, place: { x: 0.2, y: 0.5, rot: 1 }, guide: false });
  assert.doesNotMatch(b, /LAST image/);
  assert.match(b, /toward the camera/);
  const c = P.build({ ...base });
  assert.match(c, /open part of the new turf/);
  assert.equal(P.footprint("kidney", "s").sqft, 180);
  assert.equal(P.cupsFor(100), 2); assert.equal(P.cupsFor(300), 4);
  assert.equal(P.footprint("none", "m"), null);
});

test("shiftTo moves the average turf color onto the product color and keeps the spread", () => {
  const L = require("./colorlock.js");
  const n = 400, a = new Uint8ClampedArray(n * 4), mask = new Uint8Array(n).fill(1);
  for (let p = 0; p < n; p++) { const v = 90 + (p % 20) * 3; a.set([v * 0.6, v, v * 0.5, 255], p * 4); }
  const target = { mean: [50, -34, 38], std: [10, 6, 6] };
  const before = L.chromaError(a, mask, target);
  L.shiftTo(a, mask, target);
  const after = L.chromaError(a, mask, target);
  assert.ok(after < 2, "average lands on the product color: " + after);
  assert.ok(after < before);
  const spread = new Set(Array.from({ length: n }, (_, p) => a[p * 4 + 1])).size;
  assert.ok(spread > 10, "pixels keep their own variation");
});

test("lead rules need name, email, a 10-digit phone and a 5-digit ZIP", async () => {
  const { leadProblems } = await import("./render-core.mjs");
  const ok = { name: "Pat Lee", email: "pat@example.com", phone: "(480) 555-0123", zip: "85040" };
  assert.deepEqual(leadProblems(ok), []);
  assert.deepEqual(leadProblems({ ...ok, phone: "1-480-555-0123", zip: "85040-1234" }), []);
  assert.deepEqual(leadProblems({}), ["your name", "a valid email", "a phone number with 10 digits", "a 5-digit ZIP code"]);
  assert.deepEqual(leadProblems({ ...ok, phone: "555-0123" }), ["a phone number with 10 digits"]);
  assert.deepEqual(leadProblems({ ...ok, zip: "8504" }), ["a 5-digit ZIP code"]);
  assert.deepEqual(leadProblems({ ...ok, email: "pat@x" }), ["a valid email"]);
  assert.deepEqual(leadProblems({ ...ok, name: "P" }), ["your name"]);
});

test("putting-green-only prompt installs one green and leaves the rest of the yard alone", () => {
  const p = P.build({ line: line("tour-platinum"), area: "dogrun", preset: "ribbon", size: "m", puttingLine: line("tour-platinum"), mode: "putt" });
  assert.match(p, /Install ONLY a putting green/);
  assert.match(p, /ribbon-shaped/);
  assert.match(p, /TurfHub Tour Platinum/);
  assert.match(p, /Do NOT turn any of the rest of the ground into artificial turf/);
  assert.match(p, /side yard or dog-run/);
  assert.doesNotMatch(p, /Replace every|professionally installed artificial turf/);
  const lawn = P.build({ line: line("sierra-blend-pro"), area: "backyard", preset: "none" });
  assert.doesNotMatch(lawn, /Install ONLY a putting green/);
});

test("server validation: putt mode needs a putting turf and defaults the shape", async () => {
  const { validate } = await import("./render-core.mjs");
  const cat = require("../data/turfhub-catalog.json");
  const base = { photo: "AAAA", area: "dogrun", size: "m", lead: {} };
  assert.equal(validate({ ...base, mode: "putt", lineId: "sierra-blend-pro" }, cat, P).error, "Pick a putting turf.");
  const v = validate({ ...base, mode: "putt", lineId: "tour-platinum", preset: "none" }, cat, P);
  assert.equal(v.error, undefined);
  assert.equal(v.mode, "putt"); assert.equal(v.preset, "kidney"); assert.equal(v.puttingLine.id, "tour-platinum");
  assert.match(v.prompt, /Install ONLY a putting green/);
  assert.equal(validate({ ...base, lineId: "sierra-blend-pro" }, cat, P).mode, "lawn");
});

test("a putting-only render is not rejected for leaving most of the ground as it was", () => {
  const Checks = require("./checks.js"), W = 96, H = 96;
  const scene = (green) => { const d = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; let c = y < H * 0.12 ? [150, 190, 235] : y < H * 0.28 ? (x % 12 < 6 ? [120, 90, 75] : [150, 112, 92]) : (green(x, y) ? [60, 120, 40] : [176, 148, 108]); d.set([...c, 255], i); } return d; };
  const before = scene(() => false), after = scene((x, y) => x > 30 && x < 60 && y > 60 && y < 80);
  assert.equal(Checks.check(before, after, W, H).ok, false);                       // a lawn render must convert the ground
  assert.equal(Checks.check(before, after, W, H, { partial: true }).ok, true);     // a green-only render must not
});

test("green-only prompt carries a two-tone fringe, the chosen border and the fill-the-space size", () => {
  const base = { line: line("tour-platinum"), area: "backyard", preset: "kidney", puttingLine: line("tour-platinum"), mode: "putt" };
  for (const [b, re] of [["metal", /thin dark edging strip/], ["paver", /pavers about 12 inches/], ["rock", /lava rock or river rock/], ["curb", /concrete curb about 4 inches/], ["none", /no visible border/]]) {
    const t = P.build({ ...base, size: "m", border: b });
    assert.match(t, /TWO-TONE FRINGE/); assert.match(t, /2 to 3 feet wide of slightly taller, darker green turf/);
    assert.match(t, /BORDER\./); assert.match(t, re, b);
  }
  assert.match(P.build({ ...base, size: "x", border: "metal" }), /fill most of the open ground/);
  assert.doesNotMatch(P.build({ ...base, size: "m", border: "metal" }), /fill most of the open ground/);
  assert.match(P.build({ ...base, size: "m" }), /best suits the existing ground/); // auto ("Match my yard") is the default
  assert.match(P.build({ ...base, size: "m", border: "auto" }), /decorative rock where it sits in a rock or gravel bed/);
  assert.ok(P.SIZES.x.fill && P.footprint("kidney", "x").sqft > P.footprint("kidney", "l").sqft);
});

test("server: border and fill size only apply to green-only projects, and bad values fall back", async () => {
  const { validate } = await import("./render-core.mjs");
  const cat = require("../data/turfhub-catalog.json");
  const base = { photo: "AAAA", area: "dogrun", lead: {} };
  const a = validate({ ...base, mode: "putt", lineId: "tour-platinum", border: "rock", size: "x" }, cat, P);
  assert.equal(a.border, "rock"); assert.equal(a.size, "x"); assert.match(a.prompt, /lava rock or river rock/);
  assert.equal(validate({ ...base, mode: "putt", lineId: "tour-platinum", border: "lava" }, cat, P).border, "auto");
  const lawn = validate({ ...base, lineId: "sierra-blend-pro", size: "x", border: "rock", preset: "kidney" }, cat, P);
  assert.equal(lawn.size, "m"); assert.doesNotMatch(lawn.prompt, /BORDER\./);
});
