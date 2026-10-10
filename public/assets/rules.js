// Turf Planner rules engine: project areas, product picks, installed price,
// water savings and payback. Pure functions, no DOM, so the math is tested on
// its own and the same file runs in the browser (window.TurfRules) and in Node.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TurfRules = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const GAL_PER_SQFT_INCH = 0.623; // 1 inch of water over 1 sq ft

  // Estimated water a grass lawn uses, by metro. Method: annual irrigation need
  // = 0.8 x reference evapotranspiration - 0.5 x rainfall (inches), scaled so the
  // Phoenix value matches the 55 gal/sq ft/yr saving the Southern Nevada Water
  // Authority measured converting grass to desert landscape (the closest large
  // desert study; 73 vs under 18 gal/sq ft/yr). ETo and rainfall are
  // approximate annual normals (AZMET, CIMIS, TexasET, NOAA). Estimates: every
  // dealer can override with their utility's own number. waterPrice is a rough
  // combined water + sewer cost per 1,000 gallons, also an estimate.
  const METROS = {
    phoenix: { name: "Phoenix metro", eto: 75, rain: 8, waterPrice: 5.5 },
    "san-diego": { name: "San Diego", eto: 50, rain: 10, waterPrice: 12 },
    albuquerque: { name: "Albuquerque", eto: 65, rain: 9, waterPrice: 6 },
    dallas: { name: "Dallas", eto: 62, rain: 38, waterPrice: 7 },
    "fort-worth": { name: "Fort Worth", eto: 62, rain: 37, waterPrice: 7 },
    austin: { name: "Austin", eto: 63, rain: 34, waterPrice: 9 },
    houston: { name: "Houston", eto: 55, rain: 50, waterPrice: 8 },
    "oklahoma-city": { name: "Oklahoma City", eto: 60, rain: 36, waterPrice: 6 },
    orlando: { name: "Orlando", eto: 52, rain: 51, waterPrice: 5 },
    charlotte: { name: "Charlotte", eto: 42, rain: 43, waterPrice: 9 },
  };
  const PHX_NEED = 0.8 * 75 - 0.5 * 8;

  function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function galPerSqFt(metroId, override) {
    if (override != null && Number.isFinite(Number(override))) return Number(override);
    const m = METROS[metroId];
    if (!m) return 0;
    const need = Math.max(0, 0.8 * m.eto - 0.5 * m.rain);
    return Math.round((55 * need) / PHX_NEED);
  }

  function lineById(catalog, id) {
    return catalog.lines.find((l) => l.id === id) || null;
  }

  // Products for a use, best first. Dealers can hide lines they don't carry.
  // Preferences nudge the order: pets favour fast drainage, heat favours
  // CoolFlo / Heat Guard, "plush" favours face weight.
  function recommend(catalog, use, prefs = {}, dealer = {}) {
    const hidden = new Set(dealer.hideLines || []);
    const priced = new Set(Object.keys(dealer.prices || {}));
    const score = (l) => {
      const s = l.specs || {};
      // Putting surfaces are judged by a short, tight pile; tee and bunker turf are specialty add-ons.
      let v = use === "putting" ? 10 - (s.pileHeightIn || 1) * 10 - (/tee|bunker|performance/i.test(l.name) ? 15 : 0) : (s.faceWeightOz || 0) / 10;
      if (priced.has(l.id)) v += 20; // lines the dealer actually prices come first
      if (prefs.pets && (s.drainRateInPerHr || 0) >= 100) v += 8;
      if (prefs.heat && l.tech.includes("Heat Guard")) v += 8;
      if (prefs.heat && l.tech.includes("CoolFlo")) v += 3;
      if (prefs.plush) v += (s.faceWeightOz || 0) / 10;
      if ((s.warrantyYears || 0) < 15) v -= 5;
      return v;
    };
    return catalog.lines.filter((l) => l.uses.includes(use) && !hidden.has(l.id)).sort((a, b) => score(b) - score(a));
  }

  // Installed price per sq ft for a line: the dealer's own number if they list
  // it, else the catalog's planning range for that use.
  function rate(catalog, dealer, lineId, use) {
    const p = (dealer.prices || {})[lineId];
    if (p != null) return { low: num(p), high: num(p), source: "dealer" };
    const r = (dealer.defaultRanges || {})[use] || catalog.pricing_DEMO_DEFAULTS.installedPerSqFt[use] || catalog.pricing_DEMO_DEFAULTS.installedPerSqFt.landscape;
    return { low: r[0], high: r[1], source: "range" };
  }

  function normalizeArea(catalog, a = {}, dealer = {}) {
    const use = catalog.uses[a.use] ? a.use : "landscape";
    let sqft = Math.round(num(a.sqft, 0));
    if (!sqft && a.lengthFt && a.widthFt) sqft = Math.round(num(a.lengthFt) * num(a.widthFt));
    sqft = Math.min(Math.max(sqft, 0), 50000);
    const options = recommend(catalog, use, a.prefs || {}, dealer);
    const line = options.find((l) => l.id === a.lineId) || options[0] || null;
    return { name: a.name || catalog.uses[use], use, sqft, lineId: line ? line.id : null, removeGrass: a.removeGrass !== false && use !== "wall", prefs: a.prefs || {} };
  }

  // Full project estimate. Money is rounded to whole dollars; ranges stay ranges
  // until every area is priced by the dealer's own list.
  function estimate(catalog, project = {}, dealer = {}) {
    const d = catalog.pricing_DEMO_DEFAULTS;
    const areas = (project.areas || []).map((a) => normalizeArea(catalog, a, dealer)).filter((a) => a.sqft > 0);
    const removal = dealer.removalPerSqFt != null ? [num(dealer.removalPerSqFt), num(dealer.removalPerSqFt)] : d.removalPerSqFt;
    let low = 0, high = 0, grassSqft = 0;
    const lines = areas.map((a) => {
      const r = rate(catalog, dealer, a.lineId, a.use);
      const rem = a.removeGrass ? [removal[0] * a.sqft, removal[1] * a.sqft] : [0, 0];
      if (a.removeGrass) grassSqft += a.sqft;
      const l = r.low * a.sqft + rem[0], h = r.high * a.sqft + rem[1];
      low += l; high += h;
      return { ...a, rate: r, low: Math.round(l), high: Math.round(h) };
    });
    const minimum = num(dealer.minimumJob, d.minimumJob);
    const minApplied = areas.length > 0 && high < minimum;
    if (areas.length) { low = Math.max(low, minimum); high = Math.max(high, minimum); }
    const rebatePerSqFt = num((dealer.rebate || {}).perSqFt, 0);
    const rebateCap = num((dealer.rebate || {}).cap, Infinity);
    const rebate = Math.round(Math.min(grassSqft * rebatePerSqFt, rebateCap));
    const gal = galPerSqFt(project.metro || dealer.metro, dealer.galPerSqFt) * grassSqft;
    const m = METROS[project.metro || dealer.metro] || {};
    const waterPrice = num(project.waterPrice, num(dealer.waterPrice, m.waterPrice || 0));
    const waterDollars = (gal / 1000) * waterPrice;
    const upkeep = num(project.lawnCarePerMonth, 0) * 12;
    const yearly = waterDollars + upkeep;
    const netLow = Math.max(0, low - rebate), netHigh = Math.max(0, high - rebate);
    return {
      areas: lines, totalSqft: areas.reduce((s, a) => s + a.sqft, 0), grassSqft,
      low: Math.round(low), high: Math.round(high),
      exact: lines.length > 0 && lines.every((l) => l.rate.source === "dealer") && (grassSqft === 0 || dealer.removalPerSqFt != null),
      minimumApplied: minApplied, rebate, netLow: Math.round(netLow), netHigh: Math.round(netHigh),
      water: { gallonsPerYear: Math.round(gal), dollarsPerYear: Math.round(waterDollars) },
      savingsPerYear: Math.round(yearly),
      paybackYears: yearly > 0 ? { low: +(netLow / yearly).toFixed(1), high: +(netHigh / yearly).toFixed(1) } : null,
    };
  }

  // Shareable link state: compact, URL-safe, and tolerant of garbage.
  function encode(project) {
    const p = { m: project.metro, c: project.lawnCarePerMonth || 0, a: (project.areas || []).map((a) => [a.use, a.sqft, a.lineId || "", a.removeGrass === false ? 0 : 1, a.name || ""]) };
    const json = JSON.stringify(p);
    const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json, "utf8").toString("base64");
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decode(s) {
    try {
      const b64 = String(s).replace(/-/g, "+").replace(/_/g, "/");
      const json = typeof atob === "function" ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, "base64").toString("utf8");
      const p = JSON.parse(json);
      return {
        metro: typeof p.m === "string" ? p.m : undefined, lawnCarePerMonth: num(p.c, 0),
        areas: Array.isArray(p.a) ? p.a.slice(0, 12).map((x) => ({ use: x[0], sqft: num(x[1]), lineId: x[2] || undefined, removeGrass: x[3] !== 0, name: x[4] || undefined })) : [],
      };
    } catch (e) {
      return { areas: [] };
    }
  }

  return { METROS, galPerSqFt, recommend, rate, normalizeArea, estimate, encode, decode, lineById };
});
