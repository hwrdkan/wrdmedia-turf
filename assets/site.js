// Shared site behavior: desktop dropdowns, full-screen mobile menu, lightbox, reveal-once
// motion, the quote form (preview: validates, sends nothing), and the Agency Logics note.
(function () {
  "use strict";
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // Lead source (necessary for delivering a lead to the right place; no cookies, no third parties):
  // first landing page, referrer and any utm_ tags, kept for this browser session.
  let src = null;
  try { src = JSON.parse(sessionStorage.getItem("leadSource") || "null"); } catch (e) { /* storage blocked */ }
  if (!src) {
    const q = new URLSearchParams(location.search), utm = {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((k) => { if (q.get(k)) utm[k] = q.get(k); });
    src = { landing: location.pathname, referrer: document.referrer || "", ...utm, at: new Date().toISOString() };
    try { sessionStorage.setItem("leadSource", JSON.stringify(src)); } catch (e) { /* storage blocked */ }
  }
  window.leadSource = () => ({ ...src, page: location.pathname });

  // Conversion events (SOP: every CTA has a destination and a stable event name). Events go to a
  // local dataLayer only; wire an analytics tool to it after the consent model is agreed.
  window.dataLayer = window.dataLayer || [];
  const track = (event, detail = {}) => window.dataLayer.push({ event, page: location.pathname, ...detail });
  window.addEventListener("site:event", (e) => track(e.detail.event, e.detail));
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    const h = a.getAttribute("href"), label = a.textContent.trim().slice(0, 40);
    if (h.startsWith("tel:")) track("call_click", { label });
    else if (h.includes("#planner")) track("cta_price", { label });
    else if (h.includes("#visualizer")) track("cta_preview", { label });
    else if (/contact\/?$/.test(h)) track("cta_quote", { label });
  });

  // Desktop dropdowns: click/tap/keyboard, announce state, close on Escape or outside click.
  const drops = $$(".drop-btn");
  const closeAll = (except) => drops.forEach((b) => { if (b !== except) b.setAttribute("aria-expanded", "false"); });
  drops.forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); const open = b.getAttribute("aria-expanded") === "true"; closeAll(b); b.setAttribute("aria-expanded", String(!open)); }));
  document.addEventListener("click", (e) => { if (!e.target.closest(".has-drop")) closeAll(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { const open = drops.find((b) => b.getAttribute("aria-expanded") === "true"); if (open) { closeAll(); open.focus(); } } });

  // Mobile menu: full-screen overlay, accordion sections, closes on link tap, X or Escape.
  const menu = document.getElementById("mobile-menu"), menuBtn = document.querySelector(".menu-btn");
  // While the full-screen menu is open, everything behind it is inert, so keyboard focus can't escape.
  const behind = () => [document.querySelector("main"), document.querySelector(".site-head"), document.querySelector(".site-foot"), document.querySelector(".sticky-call"), document.querySelector(".demo-cta")].filter(Boolean);
  const setMenu = (open) => {
    behind().forEach((el) => { el.inert = open; });
    menu.hidden = !open; menuBtn.setAttribute("aria-expanded", String(open));
    document.documentElement.classList.toggle("no-scroll", open);
    (open ? menu.querySelector(".mm-close") : menuBtn).focus();
  };
  if (menu && menuBtn) {
    menuBtn.addEventListener("click", () => setMenu(true));
    menu.querySelector(".mm-close").addEventListener("click", () => setMenu(false));
    menu.addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });
    menu.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });
    $$(".mm-acc", menu).forEach((b) => b.addEventListener("click", () => { const open = b.getAttribute("aria-expanded") === "true"; b.setAttribute("aria-expanded", String(!open)); document.getElementById(b.getAttribute("aria-controls")).hidden = open; }));
  }

  // Lightbox: one shared dialog. Enter/Space come free with <button>; Escape via <dialog>.
  const lb = document.querySelector(".lightbox");
  let opener = null;
  if (lb) {
    const img = lb.querySelector("img"), cap = lb.querySelector("figcaption");
    document.addEventListener("click", (e) => {
      const t = e.target.closest(".lb-trigger");
      if (!t) return;
      opener = t; img.src = t.dataset.full; img.alt = t.dataset.caption; cap.textContent = t.dataset.caption;
      lb.showModal(); document.documentElement.classList.add("no-scroll");
    });
    // Cleanup runs from every close path, not only the dialog "close" event, which some embedded
    // browsers never dispatch. It is idempotent, so running it twice is harmless.
    const cleanup = () => { document.documentElement.classList.remove("no-scroll"); img.removeAttribute("src"); if (opener) { opener.focus(); opener = null; } };
    const closeLb = () => { if (lb.open) lb.close(); cleanup(); };
    lb.querySelector(".lb-close").addEventListener("click", closeLb);
    lb.addEventListener("click", (e) => { if (e.target === lb) closeLb(); });
    lb.addEventListener("cancel", (e) => { e.preventDefault(); closeLb(); });
    lb.addEventListener("close", cleanup);
  }

  // Reveal once, below the fold only, respecting reduced motion, with a no-fail timeout.
  const reveals = $$(".reveal");
  const show = (el) => el.classList.add("is-in");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) reveals.forEach(show);
  else {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
    reveals.forEach((el) => { if (el.getBoundingClientRect().top < innerHeight) show(el); else io.observe(el); });
    setTimeout(() => reveals.forEach(show), 3000);
  }

  // Quote form (preview): explicit validation, clear error and success states, nothing sent.
  const form = document.querySelector(".quote-form");
  if (form) form.addEventListener("submit", (e) => {
    e.preventDefault();
    const msg = form.querySelector(".form-msg"), v = (n) => (form.querySelector(`[name="${n}"]`).value || "").trim();
    const bad = [];
    if (v("name").length < 2) bad.push("name");
    if (v("phone").replace(/\D/g, "").length < 10) bad.push("phone");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v("email"))) bad.push("email");
    msg.hidden = false;
    if (bad.length) { track("quote_error", { fields: bad.join(",") }); msg.className = "form-msg is-err"; msg.textContent = "Please check your " + bad.join(", ") + "."; form.querySelector(`[name="${bad[0]}"]`).focus(); return; }
    try { sessionStorage.setItem("quoteLead", JSON.stringify({ name: v("name"), phone: v("phone"), email: v("email"), source: window.leadSource() })); } catch (e) { /* demo only */ }
    track("quote_submit");
    msg.className = "form-msg is-ok"; msg.textContent = "Thanks! On the live site this goes straight to the owner. (Preview: nothing was sent.)";
    form.reset();
  });

  // Mobile sticky call bar: appears after the first screen, so it never covers the hero buttons.
  const bar = document.querySelector(".sticky-call");
  if (bar) { const onScroll = () => bar.classList.toggle("is-on", scrollY > innerHeight * 0.6); addEventListener("scroll", onScroll, { passive: true }); onScroll(); }

  // Agency Logics note: collapsible, remembered for the session.
  const cta = document.querySelector(".demo-cta");
  if (cta) {
    const btn = cta.querySelector(".demo-cta-min");
    const set = (open) => { cta.classList.toggle("is-min", !open); btn.setAttribute("aria-expanded", String(open)); btn.setAttribute("aria-label", open ? "Hide Agency Logics note" : "Show Agency Logics note"); try { sessionStorage.setItem("demoCta", open ? "1" : "0"); } catch (e) { /* ignore */ } };
    let saved = null; try { saved = sessionStorage.getItem("demoCta"); } catch (e) { /* ignore */ }
    // On phones it starts minimized so it never covers the first screen; a tap opens it.
    if (saved === "0" || (saved === null && matchMedia("(max-width: 700px)").matches)) set(false);
    btn.addEventListener("click", () => set(cta.classList.contains("is-min")));
  }

  // Hero video: play when allowed, fade it in, offer a pause button. Reduced motion keeps the photo only.
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll(".hero-vid").forEach((vid) => {
    const box = vid.parentElement, btn = box.querySelector(".hero-pause");
    if (reduce) { vid.remove(); if (btn) btn.remove(); return; }
    vid.addEventListener("playing", () => { vid.classList.add("is-playing"); if (btn) btn.hidden = false; }, { once: true });
    const p = vid.play(); if (p && p.catch) p.catch(() => { /* autoplay blocked: the photo stays */ });
    if (btn) btn.addEventListener("click", () => {
      const paused = vid.paused; if (paused) vid.play(); else vid.pause();
      btn.textContent = paused ? "Pause video" : "Play video"; btn.setAttribute("aria-label", paused ? "Pause background video" : "Play background video");
    });
  });
})();
