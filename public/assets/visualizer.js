// Turf Visualizer UI: upload a yard photo, pick a TurfHub turf (and optionally a putting-green
// design), get an AI render of the same photo with the turf installed, color-locked to the real
// product. Mounts into [data-turf-visualizer]. Needs window.TurfPrompt, window.TurfColorLock,
// window.TURF_CATALOG (with swatchLab) and window.TURF_DEALER.
(function () {
  "use strict";
  // Same rule as leadProblems() in render-core.mjs (the server enforces it too).
  const RC = { leadProblems(l) {
    const d = String(l.phone || "").replace(/\D/g, ""), out = [];
    if (String(l.name || "").trim().length < 2) out.push("your name");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(l.email || "").trim())) out.push("a valid email");
    if (!(d.length === 10 || (d.length === 11 && d[0] === "1"))) out.push("a phone number with 10 digits");
    if (!/^\d{5}(-\d{4})?$/.test(String(l.zip || "").trim())) out.push("a 5-digit ZIP code");
    return out;
  } };
  const asset = (u) => (/^(https?:)?\/|^data:/.test(u || "") ? u : (window.TURF_BASE || "") + u);
  const P = window.TurfPrompt, L = window.TurfColorLock, C = window.TURF_CATALOG, D = window.TURF_DEALER || {};
  const ENDPOINT = D.renderEndpoint || "/api/turf-render";
  const MAX_EDGE = 1536;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const icon = {
    upload: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 4v12M7 11l5 5 5-5M5 20h14"/></svg>',
  };
  // Putting-green plan views. Each path is drawn in a box 100 wide by 100/aspect tall (the aspect in prompt.js),
  // so the same drawing is the card icon, the outline placed on the homeowner's photo and the guide sent to the model.
  const SHAPES = {
    kidney: { h: 52.6, d: "M3 38C0 24 10 14 24 12C36 10 42 18 52 22C62 26 70 14 82 12C94 10 100 22 97 34C94 46 82 50 68 48C56 46 50 40 40 42C30 44 24 52 14 50C7 48 4 44 3 38Z", cups: [[18, 30], [82, 26], [48, 34], [32, 22], [64, 22]] },
    freeform: { h: 58.8, d: "M4 30C2 18 14 12 26 14C36 16 40 6 54 6C68 6 70 18 82 18C94 18 99 28 95 40C91 52 78 54 66 50C56 47 50 55 38 54C24 53 20 48 12 46C6 44 5 38 4 30Z", cups: [[22, 28], [50, 24], [78, 32], [56, 42], [34, 40]] },
    oval: { h: 74, d: "M2 37C2 17 22 3 50 3S98 17 98 37 78 71 50 71 2 57 2 37Z", cups: [[36, 30], [62, 44], [60, 24], [40, 50], [50, 37]] },
    ell: { h: 66.7, d: "M14 4H40C46 4 50 8 50 14V42C50 43 51 44 52 44H88C94 44 98 48 98 54C98 60 94 64 88 64H14C8 64 4 60 4 54V14C4 8 8 4 14 4Z", cups: [[27, 16], [76, 54], [27, 36], [58, 54], [27, 26]] },
    ribbon: { h: 46, d: "M5 24C10 12 26 9 44 13C60 17 74 18 90 12C97 10 99 20 97 28C94 38 78 42 62 38C46 34 30 32 16 38C7 41 2 34 5 24Z", cups: [[18, 26], [48, 25], [82, 24], [66, 32], [32, 30]] },
    lobes: { h: 58.8, d: "M6 30C4 14 16 4 30 4C42 4 46 11 52 11C58 11 62 8 72 8C86 8 96 17 96 29C96 41 86 50 72 50C62 50 58 47 52 47C46 47 42 54 30 54C16 54 8 46 6 30Z", cups: [[22, 28], [40, 32], [62, 26], [80, 30], [52, 29]] },
  };
  // Illustrated plan view: soft lawn backdrop, a drop shadow, a light collar, a graded turf surface with faint mowing
  // stripes, and cups with a flagstick and pennant. One uniform scale so every shape keeps its true proportions.
  const planIcon = (k, cupCount) => {
    const s = SHAPES[k], sc = Math.min(94 / 100, 62 / s.h), w = 100 * sc, hh = s.h * sc, x0 = (112 - w) / 2, y0 = (84 - hh) / 2 + 1;
    const n = cupCount || (P.footprint ? P.footprint(k, "m").cups : 3);
    const cups = s.cups.slice(0, n).map(([cx, cy]) => `<g transform="translate(${cx} ${cy})"><ellipse cx="0" cy="1.1" rx="3.1" ry="1.5" fill="#102a12" opacity=".9"/><ellipse cx="0" cy=".8" rx="3.1" ry="1.4" fill="none" stroke="#e9f3dc" stroke-width=".7" opacity=".85"/><path d="M0 .8V-12" stroke="#f4f4ee" stroke-width="1.1" stroke-linecap="round"/><path d="M.5-12L8-9.6.5-7.2Z" fill="#fff" stroke="#d9d9d0" stroke-width=".4"/><path d="M2 1.6l4 .9" stroke="#000" stroke-opacity=".18" stroke-width="1.1" stroke-linecap="round"/></g>`).join("");
    const id = "pi" + k;
    return `<svg viewBox="0 0 112 84" aria-hidden="true">
      <defs>
        <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9f1da"/><stop offset="1" stop-color="#d2e1b9"/></linearGradient>
        <linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4d9a3f"/><stop offset="1" stop-color="#2c7430"/></linearGradient>
        <pattern id="${id}s" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="5" height="10" fill="#fff" opacity=".07"/></pattern>
        <filter id="${id}f" x="-10%" y="-10%" width="125%" height="135%"><feGaussianBlur stdDeviation="1.6"/></filter>
        <clipPath id="${id}c"><path d="${s.d}"/></clipPath>
      </defs>
      <rect width="112" height="84" rx="9" fill="url(#${id}b)"/>
      <rect width="112" height="84" rx="9" fill="url(#${id}s)"/>
      <g transform="translate(${x0.toFixed(2)} ${y0.toFixed(2)}) scale(${sc.toFixed(4)})">
        <path d="${s.d}" transform="translate(1.6 3)" fill="#183a1a" opacity=".28" filter="url(#${id}f)"/>
        <path d="${s.d}" fill="#9cc873" stroke="#9cc873" stroke-width="7" stroke-linejoin="round"/>
        <path d="${s.d}" fill="#b7d98e" stroke="#b7d98e" stroke-width="3.2" stroke-linejoin="round"/>
        <path d="${s.d}" fill="url(#${id}g)"/>
        <g clip-path="url(#${id}c)"><rect x="-10" y="-10" width="130" height="${(s.h + 20).toFixed(1)}" fill="url(#${id}s)"/><path d="${s.d}" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="2.2" transform="translate(.6 .9)"/></g>
        ${cups}
      </g>
    </svg>`;
  };
  const flagIcon = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21V3l11 4-11 4"/></svg>';
  // Border swatches: green on the left, the ground on the right, the border between them.
  const borderIcon = (k) => {
    const strip = {
      metal: '<rect x="30" y="0" width="2.4" height="40" fill="#5b6168"/><rect x="31.2" y="0" width="1" height="40" fill="#aeb4ba"/>',
      paver: [0, 1, 2, 3, 4, 5].map((i) => `<rect x="${24 + (i % 2) * 1}" y="${i * 7 + 1}" width="13" height="6" rx="1" fill="${["#b9825f", "#a56f50", "#c9946f"][i % 3]}"/>`).join(""),
      rock: Array.from({ length: 14 }, (_, i) => `<ellipse cx="${26 + (i * 7) % 11}" cy="${3 + i * 2.7}" rx="3.2" ry="2.5" fill="${["#46413e", "#5a534f", "#37322f"][i % 3]}"/>`).join(""),
      curb: '<rect x="26" y="0" width="9" height="40" fill="#cfc6b4"/><rect x="26" y="0" width="1.4" height="40" fill="#e8e1d2"/><rect x="33.6" y="0" width="1.4" height="40" fill="#b3a993"/>',
      none: '<path d="M30 0v40" stroke="#6aa04c" stroke-width="1" stroke-dasharray="2 2" opacity=".5"/>',
    }[k];
    if (k === "auto") return `<svg viewBox="0 0 60 40" aria-hidden="true"><rect width="60" height="40" fill="#cdbba0"/><rect width="30" height="40" fill="#3f8a38"/><rect width="20" height="40" fill="#4aa042"/><rect x="30" y="0" width="2.4" height="13" fill="#5b6168"/>${[0, 1, 2, 3].map((i) => `<ellipse cx="${27 + (i % 2) * 5}" cy="${16 + i * 2.5}" rx="3" ry="2.3" fill="#46413e"/>`).join("")}<path d="M30 27v13" stroke="#6aa04c" stroke-width="1" stroke-dasharray="2 2"/><path d="M46 6l1.6 3.4 3.4 1.6-3.4 1.6L46 16l-1.6-3.4L41 11l3.4-1.6z" fill="#fff" opacity=".9"/></svg>`;
    return `<svg viewBox="0 0 60 40" aria-hidden="true"><rect width="60" height="40" fill="#cdbba0"/><rect width="60" height="40" fill="#bfae92" opacity=".5"/><rect width="30" height="40" fill="#3f8a38"/><rect width="20" height="40" fill="#4aa042"/>${strip}</svg>`;
  };
  const lineOf = (id) => C.lines.find((l) => l.id === id);
  const priced = Object.keys(D.prices || {});

  function mount(root) {
    const st = { photo: null, w: 0, h: 0, area: "backyard", lineId: priced[0] || "sierra-blend-pro", mode: "lawn", border: "auto", preset: "none", size: "m", puttingId: "tour-platinum", raw: null, locked: null, showLocked: true, busy: false, rawBlob: null, baseKey: null };
    // One AI render per photo + area + putting design. Turf swaps after that are recolored in the browser.
    const curId = () => (st.mode === "putt" ? st.puttingId : st.lineId);   // the product being shown: the lawn turf, or the putting turf for a green-only project
    const baseKey = () => st.photo ? [st.photo.length, st.photo.slice(-64), st.mode, st.border, st.area, st.preset, st.preset === "none" ? "" : [st.puttingId, st.size].join(":")].join("|") : null;
    const landscape = C.lines.filter((l) => l.uses.includes("landscape") || l.uses.includes("pet"));
    // Only offer what the installer actually sells (the priced lines). A site with no price list shows the whole lawn and pet range.
    const firstLines = priced.length ? priced.map(lineOf).filter(Boolean) : landscape;
    let showAll = false;

    root.classList.add("tv");
    const chev = '<svg class="tv-chev" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
    const step = (n, title, body, opts = {}) => `<section class="tv-step" data-step="${n}"><button type="button" class="tv-hd" aria-expanded="false" aria-controls="tv-b${n}"><span class="tv-num">${n}</span><span class="tv-ttl">${title}${opts.optional ? " <em>optional</em>" : ""}</span><span class="tv-sum" data-sum="${n}"></span>${chev}</button><div class="tv-body" id="tv-b${n}" hidden>${body}</div></section>`;
    root.innerHTML = `
      <div class="tv-controls">
        ${step(1, "Your yard photo", `<label class="tv-drop"><input type="file" accept="image/jpeg,image/png,image/webp" class="tv-file">
            <span class="tv-drop-in">${icon.upload}<b>Upload a photo of your yard</b><small>Stand where you'd take a picture to show a friend. JPG or PNG.</small></span>
            <img class="tv-thumb" alt="Your uploaded yard photo" hidden></label>`)}
        ${step(2, "What are you installing?", `<div class="tv-modes" role="radiogroup" aria-label="What are you installing"></div><p class="tv-where">Where does it go?</p><div class="tv-chips tv-areas"></div>`)}
        ${step(3, "Pick your turf", `<div class="tv-cat"><div class="tv-tabs" role="tablist" aria-label="Turf categories"></div></div><div class="tv-swatches"></div><div class="tv-foot"><p class="tv-fine tv-swipe">Reference product catalog from the original demo. Verify current specifications with the supplier.</p><div class="tv-arrows"><button type="button" data-nav="-1" aria-label="Scroll turf options left">&lsaquo;</button><button type="button" data-nav="1" aria-label="Scroll turf options right">&rsaquo;</button></div></div>`)}
        ${step(4, "Putting green", `<div class="tv-subs" hidden></div><button type="button" class="tv-link tv-addlawn" data-mode="both" data-goto="3" hidden>Want new lawn turf too? Add it</button><button type="button" class="tv-next" data-next="5">Continue</button>`)}
        ${step(5, "Preview details", `<div class="tv-lead"><label>Name<input name="name" autocomplete="name" required></label><label>Phone<input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(480) 555-0123" required></label><label>Email<input name="email" type="email" autocomplete="email" required></label><label>ZIP code<input name="zip" inputmode="numeric" autocomplete="postal-code" maxlength="10" placeholder="85040" required></label></div>
          <p class="tv-fine tv-privacy">These details support the original server validation and usage limits. This standalone page does not send emails or book jobs. Your photo is sent to the configured image provider only when you request a render.</p>`)}
        <button type="button" class="tv-go">See my yard with this turf</button>
        <p class="tv-msg" role="status" aria-live="polite"></p>
      </div>
      <div class="tv-stage" aria-live="polite">
        <div class="tv-empty"><p>Upload a yard photo to begin. Your AI preview appears here after you request a render.</p></div>
      </div>`;

    const $ = (s) => root.querySelector(s);

    // Accordion: one step open at a time; closed steps show what was chosen.
    st.open = 1; st.cat = "all"; st.sub = "shape";
    function setOpen(n, scroll) {
      st.open = n;
      root.querySelectorAll(".tv-step").forEach((s) => {
        const on = Number(s.dataset.step) === n;
        s.classList.toggle("is-open", on); s.querySelector(".tv-hd").setAttribute("aria-expanded", String(on)); s.querySelector(".tv-body").hidden = !on;
      });
      if (scroll && matchMedia("(max-width: 900px)").matches) root.querySelector(`[data-step="${n}"]`).scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // Which steps apply: a green-only project skips the lawn turf; a lawn-only project skips the putting green.
    const stepOn = (n) => !(n === 3 && st.mode === "putt") && !(n === 4 && st.mode === "lawn");
    const nextStep = (n) => { let k = n + 1; while (k < 5 && !stepOn(k)) k++; return k; };
    const MODES = { lawn: ["Turf lawn", "Replace grass or dirt with turf"], putt: ["Putting green only", "Just a green; the rest of the yard stays"], both: ["Lawn + putting green", "New turf with a green built in"] };
    function drawSummaries() {
      const pl = lineOf(st.puttingId) || {};
      const put = st.preset === "none" ? "None" : `${P.PRESETS[st.preset].label}, ${P.SIZES[st.size].label.toLowerCase()}, ${pl.name || ""}${st.mode === "putt" ? ", " + P.BORDERS[st.border].label.toLowerCase() : ""}`;
      const sums = { 1: st.photo ? "Photo added" : "Add a photo", 2: `${MODES[st.mode][0]} · ${st.mode === "putt" ? ({ backyard: "Backyard", front: "Front yard", dogrun: "Side yard", dirt: "Dirt or gravel" }[st.area] || P.AREAS[st.area].label) : P.AREAS[st.area].label}`, 3: (lineOf(st.lineId) || {}).name || "", 4: put, 5: "" };
      Object.entries(sums).forEach(([k, t]) => { const el = $(`[data-sum="${k}"]`); if (el) el.textContent = t; });
      let n = 0;
      root.querySelectorAll(".tv-step").forEach((s) => {
        const k = Number(s.dataset.step), on = stepOn(k);
        s.hidden = !on; if (on) { n++; s.querySelector(".tv-num").textContent = String(n); }
        s.classList.toggle("is-done", k === 1 ? !!st.photo : k < 4);
      });
      $(".tv-go").textContent = st.mode === "putt" ? "See my putting green" : "See my yard with this turf";
    }

    // Choosing what to install: lawn only has no green, green-only skips the lawn turf, both builds the green into new turf.
    function setMode(m) {
      if (m === st.mode) return;
      if (m === "lawn") { st.lastPreset = st.preset !== "none" ? st.preset : st.lastPreset; st.preset = "none"; }
      else if (st.preset === "none") { st.preset = st.lastPreset && st.lastPreset !== "none" ? st.lastPreset : "kidney"; st.sub = "shape"; }
      if (m === "putt" && st.area === "lawn") st.area = "backyard";   // "the whole lawn" makes no sense for one green
      st.mode = m;
    }

    // Tabs are separate buckets that add up to All, and every number is the count of turfs actually shown.
    const catLists = () => {
      const all = firstLines;
      return { all, landscape: all.filter((l) => l.uses.includes("landscape")), pet: all.filter((l) => l.uses.includes("pet")) };
    };
    const CAT_LABEL = { all: "All", landscape: "Lawn", pet: "Pet & play" };

    function drawChoices() {
      const keepScroll = [".tv-swatches", ".tv-pturf"].map((s) => [s, ($(s) || {}).scrollLeft || 0]);
      $(".tv-modes").innerHTML = Object.entries(MODES).map(([k, m]) => `<button type="button" role="radio" class="tv-mode" data-mode="${k}" aria-checked="${st.mode === k}"><b>${m[0]}</b><small>${m[1]}</small></button>`).join("");
      $(".tv-areas").innerHTML = Object.entries(P.AREAS).filter(([k]) => !(st.mode === "putt" && k === "lawn")).map(([k, a]) => `<button type="button" data-area="${k}" aria-pressed="${st.area === k}">${esc(st.mode === "putt" ? ({ backyard: "Backyard", front: "Front yard", dogrun: "Side yard", dirt: "Dirt or gravel area" }[k] || a.label) : a.label)}</button>`).join("");
      const lists = catLists(), list = lists[st.cat] || lists.all;
      $(".tv-tabs").innerHTML = Object.keys(CAT_LABEL).filter((k) => k === "all" || (lists[k].length && lists[k].length < lists.all.length)).map((k) => `<button type="button" role="tab" data-cat="${k}" aria-selected="${st.cat === k}">${CAT_LABEL[k]} <i>${lists[k].length}</i></button>`).join("") + `<button type="button" class="tv-tab-putt" data-mode="putt" data-goto="4" title="Skip the lawn turf and design just a putting green">${flagIcon}Putting green only</button>`;
      $(".tv-swatches").classList.toggle("is-all", false);
      $(".tv-swatches").innerHTML = list.map((l) => `<button type="button" class="tv-sw" data-line="${l.id}" aria-pressed="${st.lineId === l.id}" title="${esc(l.name)}">
          <img src="${esc(asset(l.image))}" alt="" loading="lazy" width="96" height="72"><b>${esc(l.name)}</b>
          <small>${l.specs.pileHeightIn}" · ${l.specs.faceWeightOz} oz${D.prices && D.prices[l.id] ? ` · $${D.prices[l.id]}/sq ft` : ""}</small></button>`).join("");
      const fp = (k, s = "m") => P.footprint(k, s);
      $(".tv-subs").hidden = st.preset === "none";
      $(".tv-addlawn").hidden = st.mode !== "putt";
      const putts = C.lines.filter((l) => l.uses.includes("putting") && !/tee|bunker/i.test(l.name));
      if (st.preset !== "none") {
        const f = fp(st.preset, st.size), pl = lineOf(st.puttingId) || {};
        if (st.size === "x" && st.mode !== "putt") st.size = "m";
        const sub = (key, n, title, summary, body) => `<div class="tv-sub-step${st.sub === key ? " is-open" : ""}" data-sub="${key}"><button type="button" class="tv-sub-hd" data-subhd="${key}" aria-expanded="${st.sub === key}"><span class="tv-sub-n">${n}</span><span class="tv-sub-t">${title}</span><span class="tv-sub-s">${esc(summary)}</span>${chev}</button><div class="tv-sub-body"${st.sub === key ? "" : " hidden"}>${body}</div></div>`;
        $(".tv-subs").innerHTML =
          sub("shape", "a", "Shape", P.PRESETS[st.preset].label, `<div class="tv-shapes">${Object.entries(P.PRESETS).filter(([k, p]) => k !== "none" && !p.hidden).map(([k, p]) => `<button type="button" class="tv-pre" data-preset="${k}" aria-pressed="${st.preset === k}" title="${esc(p.note)}">${planIcon(k)}<b>${esc(p.label)}</b></button>`).join("")}</div>`) +
          sub("size", "b", "Size", `${P.SIZES[st.size].label}, ${f.sqft} sq ft`, `<div class="tv-seg" role="group" aria-label="Putting green size">${Object.entries(P.SIZES).filter(([k]) => k !== "x" || st.mode === "putt").map(([k, s]) => `<button type="button" data-size="${k}" aria-pressed="${st.size === k}"><span>${s.label}</span><small>${s.fill ? "about " : ""}${fp(st.preset, k).sqft} sq ft</small></button>`).join("")}</div>
            <p class="tv-fine">${esc(P.PRESETS[st.preset].label)}, about ${f.widthFt} × ${f.lengthFt} ft with ${f.cups} cups. This is the size we price. We place it where it fits your yard best; final layout is set on site.</p>`) +
          sub("turf", "c", "Putting turf", pl.name || "", `<div class="tv-pturf">${putts.map((l) => `<button type="button" class="tv-sw tv-pt" data-pline="${l.id}" aria-pressed="${st.puttingId === l.id}" title="${esc(l.name)}"><img src="${esc(asset(l.image))}" alt="" loading="lazy" width="96" height="72"><b>${esc(l.name)}</b><small>${l.specs.pileHeightIn}" pile</small></button>`).join("")}</div>`)
          + (st.mode === "putt" ? sub("border", "d", "Border", P.BORDERS[st.border].label, `<div class="tv-borders" role="radiogroup" aria-label="Border around the green">${Object.entries(P.BORDERS).map(([k, bd]) => `<button type="button" role="radio" class="tv-bd" data-border="${k}" aria-checked="${st.border === k}">${borderIcon(k)}<b>${esc(bd.label)}</b><small>${esc(bd.note)}</small></button>`).join("")}</div><p class="tv-fine">The green gets a darker fringe 2 to 3 ft wide, then this border where it meets the rest of your yard, which stays as it is.</p>`) : "");
      }
      keepScroll.forEach(([s, x]) => { if ($(s)) $(s).scrollLeft = x; });
      drawSummaries();
    }

    function fileToPhoto(file) {
      return new Promise((resolve, reject) => {
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error("Please choose a JPG, PNG or WebP photo."));
        const img = new Image(), url = URL.createObjectURL(file);
        img.onload = () => {
          // Center-crop to the nearest aspect ratio the image model returns exactly, so the render comes back
          // the same shape as the photo (and the color match can line the two up pixel for pixel).
          const RATIOS = [[1, 1], [2, 3], [3, 2], [3, 4], [4, 3], [4, 5], [5, 4], [9, 16], [16, 9]];
          const a = img.naturalWidth / img.naturalHeight;
          const [rw, rh] = RATIOS.reduce((b, r) => (Math.abs(Math.log(r[0] / r[1] / a)) < Math.abs(Math.log(b[0] / b[1] / a)) ? r : b));
          let cw = img.naturalWidth, ch = img.naturalHeight;
          if (cw / ch > rw / rh) cw = Math.round(ch * rw / rh); else ch = Math.round(cw * rh / rw);
          const sx = (img.naturalWidth - cw) / 2, sy = (img.naturalHeight - ch) * 0.7; // trim mostly sky, keep the ground
          const s = Math.min(1, MAX_EDGE / Math.max(cw, ch));
          const c = document.createElement("canvas");
          c.width = Math.round(cw * s); c.height = Math.round(ch * s);
          c.getContext("2d").drawImage(img, sx, sy, cw, ch, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          resolve({ dataUrl: c.toDataURL("image/jpeg", 0.9), w: c.width, h: c.height });
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file couldn't be read as a photo.")); };
        img.src = url;
      });
    }

    const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

    // Quality gate: compare the render with the photo at 192 px (see checks.js). Skipped if the script isn't loaded.
    function runChecks(beforeCanvas, afterCanvas, partial) {
      if (!window.TurfChecks) return { ok: true, reasons: [] };
      const S = 192, d = (c) => { const k = document.createElement("canvas"); k.width = S; k.height = S; const x = k.getContext("2d", { willReadFrequently: true }); x.drawImage(c, 0, 0, S, S); return x.getImageData(0, 0, S, S).data; };
      try { return window.TurfChecks.check(d(beforeCanvas), d(afterCanvas), S, S, { partial: !!partial }); } catch (e) { return { ok: true, reasons: [] }; }
    }

    // Color-lock the render against the original photo. Returns { lockedUrl, report }.
    async function colorLock(beforeUrl, afterBlob, line, opts = {}) {
      const [bi, ai] = await Promise.all([loadImg(beforeUrl), loadImg(URL.createObjectURL(afterBlob))]);
      const w = bi.naturalWidth, h = bi.naturalHeight;
      const ratioOff = Math.abs(ai.naturalWidth / ai.naturalHeight - w / h) / (w / h);
      const cv = (img) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h); return { c, x, d: x.getImageData(0, 0, w, h) }; };
      const B = cv(bi), A = cv(ai);
      const jpg = (cnv) => cnv.toDataURL("image/jpeg", 0.92);
      const check = runChecks(B.c, A.c, opts.partial);
      let rawUrl = jpg(A.c);
      if (!line.swatchLab) return { rawUrl, lockedUrl: rawUrl, check, report: "This specialty turf's color is shown as rendered." };
      if (ratioOff > 0.03) return { rawUrl, lockedUrl: rawUrl, check, report: "The render came back at a different shape, so color matching was skipped." };
      const { mask, coverage } = L.turfMask(B.d.data, A.d.data);
      if (coverage < 0.02) return { rawUrl, lockedUrl: rawUrl, check, report: "We couldn't find the new turf area to color-match." };
      // Revert anything the model invented (a pool, edging, a wall) to the homeowner's own pixels. Computed on a
      // scaled-down copy for speed, then upsampled.
      const sc = Math.min(1, 640 / Math.max(w, h)), sw = Math.max(1, Math.round(w * sc)), sh = Math.max(1, Math.round(h * sc));
      const small = (cnv) => { const k = document.createElement("canvas"); k.width = sw; k.height = sh; const x = k.getContext("2d", { willReadFrequently: true }); x.drawImage(cnv, 0, 0, sw, sh); return x.getImageData(0, 0, sw, sh).data; };
      const softS = L.softRevert(L.revertMask(small(B.c), small(A.c), sw, sh), sw, sh);
      const soft = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) soft[y * w + x] = softS[Math.min(sh - 1, Math.floor(y * sc)) * sw + Math.min(sw - 1, Math.floor(x * sc))];
      const rawPix = new Uint8ClampedArray(A.d.data);
      if (opts.revert !== false) L.revert(B.d.data, rawPix, soft);
      A.x.putImageData(new ImageData(rawPix, w, h), 0, 0); rawUrl = jpg(A.c);
      const err0 = L.chromaError(A.d.data, mask, line.swatchLab);
      L.shiftTo(A.d.data, mask, line.swatchLab);
      const err1 = L.chromaError(A.d.data, mask, line.swatchLab);
      if (opts.revert !== false) L.revert(B.d.data, A.d.data, soft);   // a putting green adds flags and cups, which are not turf and must stay
      A.x.putImageData(A.d, 0, 0);
      if (check.reasons) { check.reasons = check.reasons.filter((r) => r !== "new object on the ground"); check.ok = check.reasons.length === 0; }
      return { rawUrl, lockedUrl: jpg(A.c), check, report: `Color matched to the real TurfHub ${line.name} sample (color difference ${err0.toFixed(0)} → ${err1.toFixed(0)}). Anything the render added besides turf is replaced with your original photo.` };
    }

    // Real TurfHub photos and specs of the exact product chosen, with pile height drawn to scale (0 to 2.25 in),
    // so the look and feel of THIS turf is shown from the manufacturer's own photos, not only from the AI render.
    function productHTML(line) {
      const s = line.specs, pct = Math.max(6, Math.min(100, (Number(s.pileHeightIn) / 2.25) * 100));
      const look = P.lookProfile ? P.lookProfile(line) : null;
      const photos = (line.photos || [line.image]).filter(Boolean).slice(0, 3);
      return `<section class="tv-product" aria-label="${esc(line.name)} up close">
        <h4>Up close: TurfHub ${esc(line.name)}</h4>
        <div class="tv-ph">${photos.map((u, i) => `<img src="${esc(asset(u))}" alt="TurfHub ${esc(line.name)} sample, view ${i + 1}" loading="lazy">`).join("")}</div>
        <div class="tv-gauge" role="img" aria-label="Pile height ${s.pileHeightIn} inches out of 2.25"><span style="height:${pct}%"></span><b>${s.pileHeightIn}"</b></div>
        <ul class="tv-specs"><li><b>${s.pileHeightIn}"</b> pile height</li><li><b>${s.faceWeightOz} oz</b> face weight</li>${s.bladeShape ? `<li><b>${esc(s.bladeShape)}</b> blade</li>` : ""}${s.yarnColor ? `<li><b>${esc(s.yarnColor)}</b> blades</li>` : ""}${s.thatchColor ? `<li><b>${esc(s.thatchColor)}</b> thatch</li>` : ""}</ul>
        ${look ? `<p class="tv-fine">${esc(look.text.split(". ")[0].replace(/^Pile height [^:]*: /, "Looks "))}.</p>` : ""}
      </section>`;
    }

    // The note and the product panel always follow the turf currently selected, even when a render exists for another one.
    function slotHTML() {
      const line = lineOf(curId()), stale = st.rawBlob && st.renderedLineId && st.renderedLineId !== curId();
      return (stale ? `<p class="tv-swapnote" role="status"><b>The picture above still shows ${esc(lineOf(st.renderedLineId).name)}.</b> Press <b>Render this exact turf</b> to see ${esc(line.name)} at its true height and texture. A quick color preview, when available, only changes the color.</p>` : "") + productHTML(line);
    }
    function refreshSlot() {
      const slot = root.querySelector(".tv-product-slot"), go = $(".tv-go");
      if (slot) slot.innerHTML = slotHTML();
      if (go) go.textContent = st.rawBlob && st.renderedLineId && st.renderedLineId !== curId() ? `Render this exact turf: ${lineOf(curId()).name}` : "See my yard with this turf";
    }

    function stageHTML(result) {
      const line = lineOf(curId()), preset = P.PRESETS[st.preset];
      return `
        <figure class="tv-compare" style="--pos:55%">
          <img class="tv-before" src="${st.photo}" alt="Your yard before">
          <img class="tv-after" src="${st.showLocked || result.swapped ? result.lockedUrl : result.rawUrl}" alt="Your yard with TurfHub ${esc(line.name)} installed (concept render)">
          <span class="tv-tag tv-tag-b">Before</span><span class="tv-tag tv-tag-a">After · concept</span>
          <span class="tv-handle" aria-hidden="true"></span>
        </figure>
        <div class="tv-cmp-ctl">
          <button type="button" data-pos="0">Before</button>
          <input type="range" min="0" max="100" value="55" aria-label="Compare before and after">
          <button type="button" data-pos="100">After</button>
        </div>
        <div class="tv-result">
          <div><b>TurfHub ${esc(line.name)}</b><small>${line.specs.pileHeightIn}" pile · ${line.specs.faceWeightOz} oz · ${esc(line.specs.yarnColor || "")}${line.specs.warrantyYears ? ` · ${line.specs.warrantyYears}-yr warranty` : ""}${preset.sqft ? ` · plus ${esc(preset.label.toLowerCase())} putting green, about ${P.footprint(st.preset, st.size).sqft} sq ft` : ""}</small></div>
          ${result.swapped ? "" : `<label class="tv-lock"><input type="checkbox" ${st.showLocked ? "checked" : ""}> Match exact product color</label>`}
          <p class="tv-fine">${esc(result.report)} This is an AI concept of your photo, not a photo of a finished job. Final layout is set on site.</p>
          <div class="tv-actions">
            <a class="tv-dl" download="my-yard-${line.id}.jpg" href="${st.showLocked || result.swapped ? result.lockedUrl : result.rawUrl}">${icon.download} Save image</a>
            <a class="tv-price" href="#" data-price>Save project plan</a>
          </div>
        </div>
        <div class="tv-product-slot">${slotHTML()}</div>`;
    }

    function wireStage(result) {
      const fig = $(".tv-compare"), range = $(".tv-cmp-ctl input");
      const set = (v) => { fig.style.setProperty("--pos", v + "%"); range.value = v; };
      range.addEventListener("input", () => set(range.value));
      root.querySelectorAll(".tv-cmp-ctl [data-pos]").forEach((b) => b.addEventListener("click", () => set(b.dataset.pos)));
      fig.addEventListener("pointerdown", (e) => {
        const move = (ev) => { const r = fig.getBoundingClientRect(); set(Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100)).toFixed(1)); };
        move(e); fig.setPointerCapture(e.pointerId);
        fig.onpointermove = move; fig.onpointerup = () => (fig.onpointermove = null);
      });
      if ($(".tv-lock input")) $(".tv-lock input").addEventListener("change", (e) => { st.showLocked = e.target.checked; $(".tv-stage").innerHTML = stageHTML(result); wireStage(result); });
      $("[data-price]").addEventListener("click", (e) => {
        e.preventDefault();
        const plan={format:"turf-studio",version:1,lineId:curId(),mode:st.mode,area:st.area,preset:st.preset,size:st.size,puttingLineId:st.puttingId,border:st.border};
        const u=URL.createObjectURL(new Blob([JSON.stringify(plan,null,2)],{type:"application/json"}));
        const a=document.createElement("a");a.href=u;a.download="turf-project-plan.json";a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);
      });
    }

    // Recolor the last render to another turf line without a new AI render (no cost, no network).
    async function swap() {
      const line = lineOf(curId()), msg = $(".tv-msg");
      if (!st.rawBlob || st.busy || st.baseKey !== baseKey()) return;
      if (!line.swatchLab) { msg.className = "tv-msg"; msg.textContent = "This specialty turf needs a fresh render: press the button below."; return; }
      const result = await colorLock(st.photo, st.rawBlob, line, { revert: st.preset === "none", partial: st.mode === "putt" });
      if (result.lockedUrl === result.rawUrl) { msg.className = "tv-msg"; msg.textContent = "We couldn't recolor this render. Press the button below for a fresh render with this turf."; return; }
      result.swapped = true;
      result.report = `Instant color preview from your render, no new render used. ${result.report}`;
      st.last = result;
      window.dispatchEvent(new CustomEvent("site:event", { detail: { event: "visualizer_instant_swap", line: curId() } }));
      $(".tv-stage").innerHTML = stageHTML(result);
      wireStage(result);
    }

    async function go() {
      const msg = $(".tv-msg"), val = (n) => $(`.tv-lead [name="${n}"]`).value.trim();
      const lead = { name: val("name"), phone: val("phone"), email: val("email"), zip: val("zip") };
      const need = RC.leadProblems(lead);
      const problems = (st.photo ? [] : ["a yard photo"]).concat(need);
      if (problems.length) { msg.className = "tv-msg is-err"; msg.textContent = "Please add " + problems.join(", ") + "."; setOpen(st.photo ? 5 : 1, true); return; }
      const name = lead.name, email = lead.email;
      st.busy = true; $(".tv-go").disabled = true; msg.className = "tv-msg"; msg.textContent = "";
      const t0 = Date.now();
      if (matchMedia("(max-width: 900px)").matches) $(".tv-stage").scrollIntoView({ behavior: "smooth", block: "start" }); // on a phone the result sits below the form
      $(".tv-stage").innerHTML = `<div class="tv-empty tv-working"><span class="tv-spin" aria-hidden="true"></span><p>Installing TurfHub ${esc(lineOf(curId()).name)}… <b class="tv-sec">0</b>s</p></div>`;
      const timer = setInterval(() => { const s = root.querySelector(".tv-sec"); if (s) s.textContent = Math.round((Date.now() - t0) / 1000); }, 1000);
      try {
        window.dispatchEvent(new CustomEvent("site:event", { detail: { event: "visualizer_render_request", line: curId(), preset: st.preset, mode: st.mode } }));
        const res = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ photo: st.photo, aspect: st.w / st.h, mode: st.mode === "putt" ? "putt" : "lawn", border: st.border, lineId: curId(), area: st.area, preset: st.preset, puttingLineId: st.puttingId, size: st.size, lead: { ...lead, source: window.leadSource ? window.leadSource() : null }, turnstile: window.turnstileToken || "" }) });
        if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Render failed (${res.status}).`); }
        const blob = await res.blob();
        const result = await colorLock(st.photo, blob, lineOf(curId()), { revert: st.preset === "none", partial: st.mode === "putt" });
        if (result.check && !result.check.ok) {
          window.dispatchEvent(new CustomEvent("site:event", { detail: { event: "visualizer_render_rejected", reasons: result.check.reasons.join("|") } }));
          $(".tv-stage").innerHTML = `<div class="tv-empty"><p><b>That preview didn't come out clean</b> (${esc(result.check.reasons.join(", "))}), so we're not showing it. We check every preview against your photo before you see it.</p><p>Press <b>See my yard with this turf</b> to try again.</p></div>`;
          return;
        }
        result.meta = { provider: res.headers.get("x-render-provider"), ms: Date.now() - t0 };
        st.last = result; st.rawBlob = blob; st.baseKey = baseKey(); st.renderedLineId = curId();
        msg.className = "tv-msg"; msg.textContent = "Tip: switching turf shows an instant color preview. For the exact blade height and texture of a different turf, press the render button again.";
        window.dispatchEvent(new CustomEvent("site:event", { detail: { event: "visualizer_render_success", provider: result.meta.provider } }));
        $(".tv-stage").innerHTML = stageHTML(result);
        wireStage(result);
        try { sessionStorage.setItem("turfRenderLead", JSON.stringify({ name, email, phone: lead.phone, zip: lead.zip, lineId: curId(), mode: st.mode, preset: st.preset, at: new Date().toISOString() })); } catch (e) { /* demo only */ }
      } catch (err) {
        window.dispatchEvent(new CustomEvent("site:event", { detail: { event: "visualizer_render_error" } }));
        $(".tv-stage").innerHTML = `<div class="tv-empty"><p class="is-err">${esc(err.message)}</p></div>`;
      } finally {
        clearInterval(timer); st.busy = false; $(".tv-go").disabled = false;
      }
    }

    root.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || !root.contains(b)) return;
      if (b.classList.contains("tv-hd")) { const n = Number(b.closest(".tv-step").dataset.step); setOpen(st.open === n ? 0 : n, true); return; }
      if (b.dataset.subhd) { st.sub = st.sub === b.dataset.subhd ? "" : b.dataset.subhd; drawChoices(); return; }
      if (b.dataset.next) { setOpen(Number(b.dataset.next), true); return; }
      if (b.dataset.nav) { const row = $(".tv-swatches"); row.scrollBy({ left: Number(b.dataset.nav) * row.clientWidth * 0.8, behavior: "smooth" }); return; }
      let advance = 0;
      if (b.dataset.cat) st.cat = b.dataset.cat;
      else if (b.dataset.mode) { setMode(b.dataset.mode); if (b.dataset.goto) advance = Number(b.dataset.goto); }
      else if (b.dataset.area) { st.area = b.dataset.area; advance = nextStep(2); }
      else if (b.dataset.line) { st.lineId = b.dataset.line; refreshSlot(); swap(); if (!st.rawBlob) advance = nextStep(3); }
      else if (b.dataset.preset) { st.preset = b.dataset.preset; st.sub = "size"; }
      else if (b.dataset.size) { st.size = b.dataset.size; st.sub = "turf"; }
      else if (b.dataset.pline) { st.puttingId = b.dataset.pline; if (st.mode === "putt") { st.sub = "border"; refreshSlot(); swap(); } }
      else if (b.dataset.border) st.border = b.dataset.border;
      else if (b.classList.contains("tv-go")) return go();
      else return;
      drawChoices();
      if (advance) setTimeout(() => setOpen(advance, true), 280);
      const key = ["mode", "cat", "area", "line", "preset", "size", "pline", "border"].find((k) => b.dataset[k] !== undefined);
      const again = key && root.querySelector(`[data-${key}="${b.dataset[key]}"]`);
      if (again) again.focus({ preventScroll: true });
    });
    root.addEventListener("change", async (e) => {
      if (!e.target.classList.contains("tv-file") || !e.target.files[0]) return;
      const msg = $(".tv-msg");
      try {
        const p = await fileToPhoto(e.target.files[0]);
        Object.assign(st, { photo: p.dataUrl, w: p.w, h: p.h });
        const t = $(".tv-thumb"); t.src = p.dataUrl; t.hidden = false; $(".tv-drop-in").hidden = true;
        msg.textContent = "";
        $(".tv-stage").innerHTML = `<figure class="photo-preview"><img src="${st.photo}" alt="Your original yard photo"><figcaption>Your original photo. Choose your turf to prepare a preview.</figcaption></figure>`;
        drawChoices(); setOpen(2, true);
      } catch (err) { msg.className = "tv-msg is-err"; msg.textContent = err.message; }
    });

    drawChoices(); setOpen(1);
  }

  window.TurfVisualizer = { mount };
  document.querySelectorAll("[data-turf-visualizer]").forEach(mount);
})();
