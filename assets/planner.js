// Turf Planner UI. Mounts into any element and reads three globals:
//   window.TurfRules    (rules.js)
//   window.TURF_CATALOG (the brand catalog, trimmed by build_demo.py)
//   window.TURF_DEALER  (the dealer's prices, metro, phone, name)
// No framework, no build step. The engine port wraps the same logic in React.
(function () {
  "use strict";
  // Product photos in the catalog use paths relative to the site root; pages in a subfolder set window.TURF_BASE ("../").
  const asset = (u) => (/^(https?:)?\/|^data:/.test(u || "") ? u : (window.TURF_BASE || "") + u);
  const R = window.TurfRules, C = window.TURF_CATALOG, D = window.TURF_DEALER || {};
  // Site-owned SVG icons (no emoji or Unicode glyphs as UI, per the build SOP).
  const svg = (d, fill) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${d}</svg>`;
  const USE_ICONS = {
    landscape: svg('<path d="M3 20h18M5 20c0-4 1-7 2-9M9 20c0-5 .5-9 1.5-12M13 20c0-5 1-8 2.5-11M17 20c0-3 1-6 2.5-8"/>'),
    pet: svg('<ellipse cx="6" cy="10" rx="2" ry="2.6"/><ellipse cx="10" cy="6" rx="2" ry="2.6"/><ellipse cx="14" cy="6" rx="2" ry="2.6"/><ellipse cx="18" cy="10" rx="2" ry="2.6"/><path d="M12 11c3 0 5.5 3.6 5.5 6 0 2-1.8 2.5-3 2.1-1-.4-1.6-.7-2.5-.7s-1.5.3-2.5.7c-1.2.4-3-.1-3-2.1 0-2.4 2.5-6 5.5-6z"/>', true),
    putting: svg('<path d="M7 21V3l10 4-10 4"/><ellipse cx="9" cy="20.5" rx="6" ry="1.5"/>'),
    play: svg('<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/>'),
    sport: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/><circle cx="12" cy="12" r="3"/>'),
  };
  const X_ICON = svg('<path d="M6 6l12 12M18 6L6 18"/>');
  const PLUS_ICON = svg('<path d="M12 5v14M5 12h14"/>');
  const USE_LABEL = { landscape: "Yard", pet: "Pets", putting: "Putting green", play: "Play area", sport: "Sports" };
  const $ = (s, el = document) => el.querySelector(s);
  const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const specLine = (l) => [l.specs.pileHeightIn && `${l.specs.pileHeightIn}" pile`, l.specs.faceWeightOz && `${l.specs.faceWeightOz} oz`, l.specs.warrantyYears && `${l.specs.warrantyYears}-yr warranty`].filter(Boolean).join(" · ");

  // Explicit checks: browser minlength/pattern rules are skipped for autofilled values and vary by engine.
  function validField(el) {
    const v = (el.value || "").trim();
    if (el.name === "name") return v.length >= 2;
    if (el.name === "phone") return v.replace(/\D/g, "").length >= 10;
    if (el.name === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
    if (el.name === "address") return v.length >= 5;
    return true;
  }

  function mount(root) {
    const fromLink = new URLSearchParams(location.hash.slice(1)).get("plan");
    let state = fromLink ? R.decode(fromLink) : null;
    if (!state || !state.areas.length) state = { metro: D.metro || "phoenix", lawnCarePerMonth: 0, areas: [{ name: "Backyard", use: "landscape", sqft: 600 }] };
    state.metro = state.metro || D.metro || "phoenix";
    let openArea = 0;

    root.classList.add("tp");
    root.innerHTML = `
      <div class="tp-main">
        <div class="tp-areas" aria-label="Areas in your project"></div>
        <button type="button" class="tp-add">${PLUS_ICON}<span>Add another area</span></button>
      </div>
      <aside class="tp-summary" aria-live="polite"></aside>
      <div class="tp-bar"><div><small>Your estimate</small><strong class="tp-bar-total"></strong></div><button type="button" class="tp-cta" data-act="lead">Get my exact quote</button></div>
      <dialog class="tp-dialog" aria-labelledby="tp-lead-title"></dialog>`;

    function render() {
      const keep = (root.querySelector(".tp-products") || {}).scrollLeft || 0;
      const est = R.estimate(C, state, D);
      $(".tp-areas", root).innerHTML = state.areas.map((a, i) => areaHTML(a, i, est.areas[i])).join("");
      $(".tp-summary", root).innerHTML = summaryHTML(est);
      $(".tp-bar-total", root).textContent = est.low === est.high ? money(est.low) : `${money(est.low)} to ${money(est.high)}`;
      $(".tp-add", root).hidden = state.areas.length >= 6;
      history.replaceState(null, "", "#plan=" + R.encode(state));
      const row = root.querySelector(".tp-products"); if (row) row.scrollLeft = keep;
    }

    function areaHTML(a, i, ea) {
      const n = R.normalizeArea(C, a, D);
      const opts = R.recommend(C, n.use, a.prefs || {}, D).slice(0, 6);
      const open = i === openArea;
      const r = n.lineId ? R.rate(C, D, n.lineId, n.use) : null;
      const line = R.lineById(C, n.lineId);
      return `
      <section class="tp-area ${open ? "is-open" : ""}" data-i="${i}">
        <header class="tp-area-head">
          <button type="button" class="tp-toggle" data-act="open" aria-expanded="${open}">
            <span class="tp-area-icon" aria-hidden="true">${USE_ICONS[n.use] || USE_ICONS.landscape}</span>
            <span class="tp-head-txt"><strong>${esc(n.name)}</strong><small>${n.sqft.toLocaleString()} sq ft · ${line ? esc(line.name) : "pick a turf"}</small></span>
            ${ea ? `<span class="tp-area-price">${ea.low === ea.high ? money(ea.low) : money(ea.low) + " to " + money(ea.high)}</span>` : ""}
          </button>
          ${state.areas.length > 1 ? `<button type="button" class="tp-remove" data-act="remove" aria-label="Remove ${esc(n.name)}">${X_ICON}</button>` : ""}
        </header>
        ${open ? `
        <div class="tp-area-body">
          <div class="tp-top">
            <label class="tp-field tp-name"><span>Area name</span><input data-k="name" value="${esc(n.name)}" maxlength="30"></label>
            <fieldset class="tp-uses"><legend>What is it for?</legend>
              ${Object.keys(USE_LABEL).map((u) => `<button type="button" data-act="use" data-use="${u}" aria-pressed="${n.use === u}">${USE_ICONS[u]}<span>${USE_LABEL[u]}</span></button>`).join("")}
            </fieldset>
          </div>
          <div class="tp-size">
            <label class="tp-field"><span>Square feet</span><input data-k="sqft" type="number" inputmode="numeric" min="0" max="50000" step="10" value="${n.sqft}"></label>
            <span class="tp-or">or</span>
            <label class="tp-field tp-small"><span>Length ft</span><input data-k="lengthFt" type="number" inputmode="decimal" min="0" value="${a.lengthFt || ""}"></label>
            <span class="tp-x">&times;</span>
            <label class="tp-field tp-small"><span>Width ft</span><input data-k="widthFt" type="number" inputmode="decimal" min="0" value="${a.widthFt || ""}"></label>
          </div>
          <input class="tp-range" data-k="sqft" type="range" min="50" max="3000" step="10" value="${Math.min(n.sqft, 3000)}" aria-label="Square feet slider">
          <div class="tp-flags" role="group" aria-label="About this area">
            <label class="tp-pill"><input type="checkbox" data-k="removeGrass" ${n.removeGrass ? "checked" : ""}><span>Replacing living grass</span></label>
            <label class="tp-pill"><input type="checkbox" data-pref="pets" ${a.prefs && a.prefs.pets ? "checked" : ""}><span>Dogs use it</span></label>
            <label class="tp-pill"><input type="checkbox" data-pref="heat" ${a.prefs && a.prefs.heat ? "checked" : ""}><span>Full afternoon sun</span></label>
            <label class="tp-pill"><input type="checkbox" data-pref="plush" ${a.prefs && a.prefs.plush ? "checked" : ""}><span>Extra soft</span></label>
          </div>
          <div class="tp-picker-head"><b>Recommended turf <i>${opts.length}</i></b><span class="tp-arrows"><button type="button" data-act="nav" data-dir="-1" aria-label="Scroll turf options left">&lsaquo;</button><button type="button" data-act="nav" data-dir="1" aria-label="Scroll turf options right">&rsaquo;</button></span></div>
          <div class="tp-products" role="radiogroup" aria-label="Turf for ${esc(n.name)}">
            ${opts.map((l) => {
              const rr = R.rate(C, D, l.id, n.use);
              return `<button type="button" role="radio" class="tp-prod" data-act="line" data-line="${l.id}" aria-checked="${l.id === n.lineId}">
                <img src="${esc(asset(l.image))}" alt="" loading="lazy" width="120" height="90">
                <span class="tp-prod-name">${esc(l.name)}</span>
                <span class="tp-prod-spec">${l.specs.pileHeightIn ? l.specs.pileHeightIn + '" pile' : ""}${l.specs.faceWeightOz ? " · " + l.specs.faceWeightOz + " oz" : ""}</span>
                <span class="tp-prod-price">${rr.source === "dealer" ? money(rr.low) + "/sq ft" : money(rr.low) + " to " + money(rr.high)}</span>
              </button>`;
            }).join("")}
          </div>
          ${line ? `<p class="tp-why"><b>${esc(line.name)}:</b> ${esc(line.tagline.split(". ")[0])}. ${specLine(line)}.</p>` : ""}
          ${r && r.source === "range" ? `<p class="tp-note">${esc(D.businessName || "The installer")} prices this turf on site, so this shows a planning range.</p>` : ""}
        </div>` : ""}
      </section>`;
    }

    function summaryHTML(e) {
      if (!e.areas.length) return `<h3>Your estimate</h3><p class="tp-note">Add a size to see your price.</p>`;
      const price = e.low === e.high ? money(e.low) : `${money(e.low)} to ${money(e.high)}`;
      const pay = e.paybackYears && e.paybackYears.high <= 12 ? e.paybackYears : null; // a 25-year water payback undersells the sale, so it is hidden
      return `
        <h3>Your estimate</h3>
        <p class="tp-total">${price}</p>
        <p class="tp-sub">${e.totalSqft.toLocaleString()} sq ft installed${e.minimumApplied ? " · job minimum applies" : ""}</p>
        <ul class="tp-lines">${e.areas.map((a) => `<li><span>${esc(a.name)} <small>${a.sqft.toLocaleString()} sq ft${a.removeGrass ? " + grass removal" : ""}</small></span><b>${a.low === a.high ? money(a.low) : money(a.low) + " to " + money(a.high)}</b></li>`).join("")}</ul>
        ${e.rebate ? `<p class="tp-rebate">Rebate: −${money(e.rebate)}</p>` : ""}
        <div class="tp-water">
          <p><b>${e.water.gallonsPerYear.toLocaleString()}</b> gallons of water saved a year</p>
          <p class="tp-sub">About ${money(e.water.dollarsPerYear)} a year on your water bill in ${esc((R.METROS[state.metro] || {}).name || "your area")}.</p>
          <label class="tp-field tp-inline"><span>Paying for lawn care now? $/month</span><input data-k="lawnCarePerMonth" type="number" inputmode="numeric" min="0" max="2000" step="10" value="${state.lawnCarePerMonth || 0}"></label>
          ${pay ? `<p class="tp-sub">Pays for itself in about <b>${pay.low === pay.high ? pay.low : pay.low + " to " + pay.high}</b> years${state.lawnCarePerMonth ? "" : " on water alone. Add lawn care above for the full picture"}.</p>` : ""}
        </div>
        <button type="button" class="tp-cta" data-act="lead">Get my exact quote</button>
        <button type="button" class="tp-share" data-act="share">Copy a link to this plan</button>
        <p class="tp-fine">${e.exact ? "Prices from " + esc(D.businessName || "the installer") + "'s published list." : "Turf prices from " + esc(D.businessName || "the installer") + "'s list where published; removal and anything marked as a range are estimates until a site visit."} Water use is an estimate for ${esc((R.METROS[state.metro] || {}).name || "your area")}.</p>`;
    }

    function leadHTML() {
      const e = R.estimate(C, state, D);
      return `
        <form method="dialog" class="tp-lead" novalidate>
          <h3 id="tp-lead-title">Send this plan to ${esc(D.businessName || "the installer")}</h3>
          <p class="tp-sub">${e.totalSqft.toLocaleString()} sq ft · ${e.low === e.high ? money(e.low) : money(e.low) + " to " + money(e.high)}. ${esc(D.ownerFirstName || "They")} will confirm the exact price, usually after a quick measure.</p>
          <label class="tp-field"><span>Name</span><input name="name" autocomplete="name" required minlength="2"></label>
          <label class="tp-field"><span>Phone</span><input name="phone" type="tel" autocomplete="tel" required></label>
          <label class="tp-field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
          <label class="tp-field"><span>Street address or ZIP</span><input name="address" autocomplete="street-address" required minlength="5"></label>
          <p class="tp-error" role="alert" hidden></p>
          <div class="tp-lead-actions"><button type="button" class="tp-ghost" data-act="close">Cancel</button><button type="submit" class="tp-cta">Send my plan</button></div>
          <p class="tp-fine">Demo preview: nothing is sent. On the live site this goes straight to ${esc(D.businessName || "the installer")}'s phone and CRM.</p>
        </form>`;
    }

    root.addEventListener("click", async (ev) => {
      const b = ev.target.closest("[data-act]");
      if (!b) return;
      const sec = b.closest(".tp-area");
      const i = sec ? +sec.dataset.i : -1;
      const act = b.dataset.act;
      if (act === "nav") { const row = b.closest(".tp-area-body").querySelector(".tp-products"); row.scrollBy({ left: Number(b.dataset.dir) * row.clientWidth * 0.8, behavior: "smooth" }); return; }
      if (act === "open") openArea = openArea === i ? -1 : i;
      if (act === "remove") { state.areas.splice(i, 1); openArea = Math.max(0, i - 1); }
      if (act === "use") { state.areas[i].use = b.dataset.use; state.areas[i].lineId = undefined; if (b.dataset.use === "pet") state.areas[i].prefs = { ...(state.areas[i].prefs || {}), pets: true }; }
      if (act === "line") state.areas[i].lineId = b.dataset.line;
      if (act === "share") {
        window.dispatchEvent(new CustomEvent("site:event", { detail: { event: "planner_share" } }));
        try { await navigator.clipboard.writeText(location.href); b.textContent = "Link copied"; } catch (e) { b.textContent = "Copy the address bar to share"; }
        setTimeout(() => (b.textContent = "Copy a link to this plan"), 2500);
        return;
      }
      if (act === "lead") { window.dispatchEvent(new CustomEvent("site:event", { detail: { event: "planner_lead_open" } })); const dlg = $(".tp-dialog", root); dlg.innerHTML = leadHTML(); dlg.showModal(); $("input", dlg).focus(); return; }
      if (act === "close") { $(".tp-dialog", root).close(); return; }
      render();
      // Keep keyboard focus on the control the person just used.
      const sel = { open: ".tp-toggle", use: `[data-use="${b.dataset.use}"]`, line: `[data-line="${b.dataset.line}"]` }[act];
      const again = sel && root.querySelector(`.tp-area[data-i="${i}"] ${sel}`);
      if (again) again.focus({ preventScroll: true });
    });

    root.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const f = ev.target, err = $(".tp-error", f);
      const bad = [...f.elements].filter((el) => el.name && !validField(el));
      if (bad.length) { err.hidden = false; err.textContent = "Please check: " + bad.map((el) => el.closest("label").querySelector("span").textContent).join(", ") + "."; bad[0].focus(); return; }
      const lead = Object.fromEntries(new FormData(f));
      try { sessionStorage.setItem("turfPlanLead", JSON.stringify({ lead, plan: state, estimate: R.estimate(C, state, D), source: window.leadSource ? window.leadSource() : null, at: new Date().toISOString() })); } catch (e) { /* storage blocked: demo only */ }
      window.dispatchEvent(new CustomEvent("site:event", { detail: { event: "planner_lead_submit", sqft: R.estimate(C, state, D).totalSqft } }));
      f.innerHTML = `<h3>Plan saved</h3><p>Thanks, ${esc(lead.name.split(" ")[0])}. In the live site ${esc(D.ownerFirstName || "the installer")} gets this plan instantly and calls you back.</p><p class="tp-fine">Demo preview: nothing was sent.</p><div class="tp-lead-actions"><button type="button" class="tp-cta" data-act="close">Close</button></div>`;
    });

    let typing;
    root.addEventListener("input", (ev) => {
      const el = ev.target;
      if (el.dataset.k === "lawnCarePerMonth") { state.lawnCarePerMonth = Math.max(0, +el.value || 0); clearTimeout(typing); typing = setTimeout(() => { $(".tp-summary", root).innerHTML = summaryHTML(R.estimate(C, state, D)); const inp = $('[data-k="lawnCarePerMonth"]', root); inp.focus(); inp.setSelectionRange && inp.type === "text" && inp.setSelectionRange(99, 99); history.replaceState(null, "", "#plan=" + R.encode(state)); }, 400); return; }
      const sec = el.closest(".tp-area");
      if (!sec) return;
      const a = state.areas[+sec.dataset.i], k = el.dataset.k;
      if (k === "name") { a.name = el.value; sec.querySelector(".tp-toggle strong").textContent = el.value || "Area"; history.replaceState(null, "", "#plan=" + R.encode(state)); return; }
      if (k === "sqft") { a.sqft = +el.value || 0; delete a.lengthFt; delete a.widthFt; }
      if (k === "lengthFt" || k === "widthFt") { a[k] = +el.value || 0; if (a.lengthFt && a.widthFt) a.sqft = Math.round(a.lengthFt * a.widthFt); }
      if (el.dataset.pref) { a.prefs = { ...(a.prefs || {}), [el.dataset.pref]: el.checked }; a.lineId = undefined; }
      if (k === "removeGrass") a.removeGrass = el.checked;
      const focusKey = k || el.dataset.pref, isRange = el.type === "range";
      clearTimeout(typing);
      const redraw = () => {
        render();
        const again = root.querySelector(`.tp-area[data-i="${sec.dataset.i}"] ${isRange ? ".tp-range" : focusKey && el.dataset.pref ? `[data-pref="${focusKey}"]` : `input[data-k="${focusKey}"]:not(.tp-range)`}`);
        if (again) { again.focus({ preventScroll: true }); }
      };
      if (el.type === "checkbox" || isRange) redraw(); else typing = setTimeout(redraw, 350);
    });

    $(".tp-add", root).addEventListener("click", () => {
      const used = new Set(state.areas.map((a) => a.use));
      const next = ["pet", "putting", "landscape", "play"].find((u) => !used.has(u)) || "landscape";
      state.areas.push({ name: { pet: "Dog run", putting: "Putting green", landscape: "Front yard", play: "Play area" }[next], use: next, sqft: next === "putting" ? 200 : 300, removeGrass: next !== "putting", prefs: next === "pet" ? { pets: true } : {} });
      openArea = state.areas.length - 1;
      render();
    });

    render();
  }

  window.TurfPlanner = { mount };
  document.querySelectorAll("[data-turf-planner]").forEach(mount);
})();
