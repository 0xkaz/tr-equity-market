// GENERATED from 0xkaz/equity-hub core/market-switch.js (core 2026.10.06-3). Do not edit here: edit equity-hub/core and run scripts/sync-core.mjs.
/* Market switcher: sister dashboards from the shared registry (equity.0xkaz.com/sites.json).
   Non-blocking; on failure nothing is rendered and the dashboard is unaffected. */
(() => {
  const HUB = "https://equity.0xkaz.com/sites.json";
  const brand = document.querySelector(".nav .brand");
  if (!brand || !window.fetch || !window.AbortController) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  fetch(HUB, { signal: ctrl.signal, mode: "cors" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((d) => {
      const sites = (d && Array.isArray(d.sites) ? d.sites : []).filter((s) => s && typeof s.url === "string" && /^https:\/\//.test(s.url));
      if (sites.length < 2) return;
      const norm = (u) => u.replace(/\/+$/, "").toLowerCase();
      const here = norm(location.origin);
      const sel = document.createElement("select");
      sel.className = "market-switch";
      sel.title = "他のマーケットのダッシュボードへ切替";
      sel.setAttribute("aria-label", "マーケット切替");
      let current = false;
      for (const s of sites) {
        const o = document.createElement("option");
        o.value = s.url; o.textContent = `${s.flag || ""} ${s.label_ja || s.name || s.code || ""}`.trim();
        if (norm(s.url) === here) { o.selected = true; current = true; }
        sel.appendChild(o);
      }
      if (!current) { const o = document.createElement("option"); o.value = ""; o.textContent = "🌏 マーケット切替"; o.selected = true; sel.insertBefore(o, sel.firstChild); }
      sel.addEventListener("change", () => {
        const to = sel.value;
        if (!to || norm(to) === here) return;
        // keep list-type routes (screener / sectors / settings / status); stock pages differ per market
        const hash = /^#\/(screener|sectors|watchlist|settings|status)/.test(location.hash) ? location.hash.split("?")[0] : "";
        location.href = `${to.replace(/\/+$/, "")}/${hash}`;
      });
      brand.insertAdjacentElement("afterend", sel);
    })
    .catch(() => {})
    .finally(() => clearTimeout(timer));
})();

/* Agenda widget (financial calendar / upcoming earnings / news headlines), hosted by the hub so that
   improvements ship with hub deploys only. It adds a "📅 予定・ニュース" button next to the menu above. */
(() => {
  if (document.querySelector("script[data-equity-agenda]")) return;
  const s = document.createElement("script");
  s.src = "https://equity.0xkaz.com/widgets/agenda.js";
  s.defer = true;
  s.dataset.equityAgenda = "1";
  document.head.appendChild(s);
})();
