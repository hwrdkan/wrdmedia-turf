const test = require("node:test"), assert = require("node:assert/strict");
const Checks = require("./checks.js");
const W = 96, H = 96;

// Synthetic "yard": sky and a striped wall on top (edges to match), dirt below.
function scene(ground) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; let c;
    if (y < H * 0.12) c = [150, 190, 235];                                   // sky
    else if (y < H * 0.28) c = x % 12 < 6 ? [120, 90, 75] : [150, 112, 92];  // block wall, vertical joints
    else c = ground(x, y);
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  return d;
}
const dirt = () => [176, 148, 108];
const turf = (x, y) => [60 + ((x * 7 + y * 3) % 9), 120 + ((x + y) % 11), 40];
const before = scene(dirt), good = scene(turf);

test("a clean turf render passes", () => {
  const r = Checks.check(before, good, W, H);
  assert.equal(r.ok, true, r.reasons.join());
});
test("a pale concrete slab on the ground is flagged", () => {
  const bad = scene((x, y) => (x > 50 && y > 60 ? [205, 205, 200] : turf(x, y)));
  const r = Checks.check(before, bad, W, H);
  assert.equal(r.ok, false); assert.ok(r.reasons.includes("new object on the ground"));
});
test("a strip of old dry grass is flagged", () => {
  const bad = scene((x, y) => (y > H * 0.3 && y < H * 0.36 ? [205, 175, 90] : turf(x, y)));
  const r = Checks.check(before, bad, W, H);
  assert.equal(r.ok, false); assert.ok(r.reasons.includes("old dry grass left"));
});
test("ground that was never converted is flagged", () => {
  const r = Checks.check(before, before, W, H);
  assert.equal(r.ok, false); assert.ok(r.reasons.includes("ground not converted"));
});
test("a rebuilt wall and sky (scene changed) is flagged", () => {
  const rebuilt = new Uint8ClampedArray(good);
  for (let y = 0; y < H * 0.3; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, v = ((x * 37 + y * 91) % 5) * 40; rebuilt[i] = v; rebuilt[i + 1] = 255 - v; rebuilt[i + 2] = (v * 3) % 255; }
  const r = Checks.check(before, rebuilt, W, H);
  assert.equal(r.ok, false); assert.ok(r.reasons.includes("scene changed"));
});
test("a small camera drift of a few pixels still passes", () => {
  const shifted = new Uint8ClampedArray(good.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const sx = Math.min(W - 1, x + 4), si = (y * W + sx) * 4, i = (y * W + x) * 4; for (let k = 0; k < 4; k++) shifted[i + k] = good[si + k]; }
  assert.equal(Checks.check(before, shifted, W, H).ok, true);
});
