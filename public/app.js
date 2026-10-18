/* TR Equity Monitor – dashboard (vanilla JS, hash routing) */
(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const app = $("#app");
  const statusEl = $("#status");
  const api = async (path, opts = {}) => {
    const r = await fetch(path, opts);
    if (!r.ok) { let m = r.statusText; try { m = (await r.json()).error || m; } catch {} throw new Error(`${r.status} ${m}`); }
    return r.json();
  };
  const adminHeaders = () => { const t = localStorage.getItem("adminToken"); return t ? { "X-Admin-Token": t, "Content-Type": "application/json" } : { "Content-Type": "application/json" }; };

  const SECTOR_JA = { Banking: "銀行", Insurance: "保険", Financials: "金融・証券", Industrial: "航空・防衛・持株・建設", Auto: "自動車", Consumer: "消費・家電", Staples: "食品・小売", Tech: "IT・通信機器", Telecom: "通信", Healthcare: "ヘルスケア", Property: "不動産", Utilities: "電力", Energy: "エネルギー・石油", Materials: "鉄鋼・化学・セメント", Index: "指数" };
  const sectorJa = (s) => SECTOR_JA[s] || s || "";
  let SIGNALS = {};
  let ME = { user: null, settings: null, oauthConfigured: false, emailConfigured: false };
  const loginUrl = () => `/auth/google/login?next=${encodeURIComponent(location.hash ? "/" + location.hash : "/")}`;
  const renderUserBox = () => {
    const el = $("#userbox");
    if (!el) return;
    if (ME.user) el.innerHTML = `${ME.user.picture ? `<img src="${esc(ME.user.picture)}" alt="" style="width:22px;height:22px;border-radius:50%;vertical-align:middle;margin-right:6px">` : ""}<span class="muted" style="font-size:12px">${esc(ME.user.name || ME.user.email)}</span> <a href="/auth/logout" style="font-size:12px">ログアウト</a>`;
    else el.innerHTML = ME.oauthConfigured ? `<a class="login" href="${loginUrl()}">Google でログイン</a>` : `<span class="muted" style="font-size:12px" title="GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を Worker に設定してください">ログイン未設定</span>`;
  };
  // ---------- Favorites (watchlist) ----------
  // Loaded once per page session from /api/watchlist/ids (symbols only) and kept in memory.
  // Public list data stays cacheable for everyone; stars are overlaid on the client.
  let FAVS = null; // Set<symbol> once loaded
  let favsLoading = null;
  const loadFavs = async () => {
    if (!ME.user) { FAVS = new Set(); return FAVS; }
    if (FAVS) return FAVS;
    if (!favsLoading) favsLoading = api("/api/watchlist/ids").then((d) => (FAVS = new Set(d.symbols || []))).catch(() => (FAVS = new Set())).finally(() => { favsLoading = null; });
    return favsLoading;
  };
  const isFav = (sym) => Boolean(FAVS && FAVS.has(sym));
  const symOf = (code) => (/^(BIST100|XU100\.IS)$/i.test(code) ? "XU100.IS" : /\.IS$/i.test(code) ? code.toUpperCase() : `${code.toUpperCase()}.IS`);
  const star = (code, extra = "") => {
    const on = isFav(symOf(code));
    return `<button type="button" class="star${on ? " on" : ""}${extra ? " " + extra : ""}" data-code="${esc(code)}" aria-pressed="${on}" title="${on ? "ウォッチリストから外す" : "ウォッチリストに追加"}" aria-label="${on ? "ウォッチリストから外す" : "ウォッチリストに追加"}">${on ? "★" : "☆"}</button>`;
  };
  const paintStars = (code) => {
    const on = isFav(symOf(code));
    document.querySelectorAll(`.star[data-code="${CSS.escape(code)}"]`).forEach((b) => {
      b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); b.textContent = on ? "★" : "☆";
      const t = on ? "ウォッチリストから外す" : "ウォッチリストに追加"; b.title = t; b.setAttribute("aria-label", t);
    });
  };
  const toast = (msg, isErr = false) => {
    let el = $("#toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = msg; el.className = isErr ? "show err" : "show";
    clearTimeout(el._t); el._t = setTimeout(() => (el.className = ""), 2600);
  };
  let onFavChange = null; // set by the current page; reset on every route change
  async function toggleFav(code) {
    if (!ME.user) {
      if (ME.oauthConfigured) { if (confirm("ウォッチリストに追加するには Google でログインしてください。ログインしますか？")) location.href = loginUrl(); }
      else toast("ログイン機能が未設定です", true);
      return;
    }
    await loadFavs();
    const sym = symOf(code);
    const wasOn = FAVS.has(sym);
    if (wasOn) {
      // the note is deleted with the entry: ask first when there is one
      const noteEl = document.querySelector("#wNote");
      let note = noteEl && noteEl.dataset.code === code ? noteEl.value.trim() : null;
      if (note == null) { try { note = ((await api(`/api/watchlist/${encodeURIComponent(code)}`)).note || "").trim(); } catch { note = ""; } }
      if (note && !confirm("ウォッチリストから外すとメモも削除されます。よろしいですか？")) return;
    }
    wasOn ? FAVS.delete(sym) : FAVS.add(sym);
    paintStars(code); // optimistic
    try {
      await api(`/api/watchlist/${encodeURIComponent(code)}`, wasOn ? { method: "DELETE" } : { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" });
      toast(wasOn ? "ウォッチリストから外しました" : "ウォッチリストに追加しました");
      if (onFavChange) onFavChange(code, !wasOn);
    } catch (e) {
      wasOn ? FAVS.add(sym) : FAVS.delete(sym);
      paintStars(code);
      toast("保存できませんでした: " + e.message, true);
    }
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".star[data-code]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (b.disabled) return;
    b.disabled = true;
    toggleFav(b.dataset.code).finally(() => { b.disabled = false; });
  });

  // ---------- Watchlist alert conditions ----------
  // values: close from metrics, dividend yield (%) and trailing PER from fundamentals
  const alertVals = (m, f) => ({ close: m?.close ?? null, yield: f?.dividendYield ?? null, pe: f?.trailingPE > 0 ? f.trailingPE : null });
  const ALERTS = [
    { k: "alert_yield_above", label: "配当利回り", unit: "% 以上", step: "0.1", v: (x) => x.yield, met: (x, v) => x.yield != null && x.yield >= v, d: 2 },
    { k: "alert_price_below", label: "株価", unit: "以下", step: "0.01", v: (x) => x.close, met: (x, v) => x.close != null && x.close <= v, d: 3 },
    { k: "alert_price_above", label: "株価", unit: "以上", step: "0.01", v: (x) => x.close, met: (x, v) => x.close != null && x.close >= v, d: 3 },
    { k: "alert_pe_below", label: "PER", unit: "倍以下", step: "0.1", v: (x) => x.pe, met: (x, v) => x.pe != null && x.pe <= v, d: 1 },
  ];
  const condText = (a, v) => `${a.label} ${v}${a.unit.startsWith("%") ? "" : " "}${a.unit}`;
  const condChips = (w, x) => ALERTS.filter((a) => w[a.k] != null).map((a) => { const on = a.met(x, w[a.k]); return `<span class="chip${on ? " hit" : ""}" title="${on ? "到達中" : "未到達"}">${on ? "✓ " : ""}${esc(condText(a, w[a.k]))}</span>`; }).join(" ");
  const loginPrompt = (msg) => `<div class="panel">${esc(msg)} ${ME.oauthConfigured ? `<a class="login" href="${loginUrl()}">Google でログイン</a>` : `<span class="muted">（Google OAuth が未設定です。Worker に GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を設定してください）</span>`}</div>`;

  const fmt = {
    pct: (v, d = 2) => v == null ? '<span class="muted">–</span>' : `<span class="${v > 0 ? "up" : v < 0 ? "down" : ""}">${v > 0 ? "+" : ""}${v.toFixed(d)}%</span>`,
    num: (v, d = 2) => v == null ? "–" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }),
    int: (v) => v == null ? "–" : Math.round(v).toLocaleString("en-US"),
    mn: (v) => v == null ? "–" : v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(0) + "K" : String(Math.round(v)),
    x: (v) => v == null ? "–" : v.toFixed(2) + "x",
    chips: (sigs) => (sigs || []).map((s) => `<span class="chip ${/HIGH|BREAKOUT|GOLDEN|RECLAIM|UPTREND|BIG_UP|OVERSOLD/.test(s) ? "pos" : /LOW|BREAKDOWN|DEAD|LOSE|DOWNTREND|BIG_DOWN|OVERBOUGHT|DRAWDOWN/.test(s) ? "neg" : ""}">${SIGNALS[s] || s}</span>`).join(""),
    name: (r) => { const full = (r.name || r.code).replace(/\s+\((Singapore|S|Holdings|Hong Kong|H Shares?|Australia)\)/gi, "").replace(/,\s*S\.A\.,.*$/i, "").replace(/\s+/g, " ").trim(); let n = full; for (let i = 0; i < 3; i++) { const cut = n.replace(/[\s,]+(Public Company Limited|Group Holdings? (Limited|Ltd\.?)|Holdings? (Limited|Ltd\.?|plc)|Group (Limited|Ltd\.?|plc)|Company (Limited|Ltd\.?)|Co\.,? Ltd\.?|Corporation (Limited|Ltd\.?)|Limited|Ltd\.?|plc|Corporation|Corp\.?|Inc\.?|N\.V\.|S\.p\.A\.|SpA|S\.A\.D\.?|SAD|S\.G\.P\.S\.|SGPS|S\.A\.|SA|SE)\s*$/i, "").trim(); if (!cut || cut === n) break; n = cut; } return n || full; },
    cur: (r) => r.currency || "TRY",
    date: (iso) => iso ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Europe/Istanbul", hour12: false }) + " イスタンブール" : "–",
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const link = (code, label) => `<a href="#/stock/${code}">${esc(label)}</a>`;

  const isDark = () => document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  // the chart library formats with navigator.language unless told otherwise; a tag like "en-US@posix" throws in Intl
  const chartTheme = () => ({ localization: { locale: "ja-JP" }, ...(isDark()
    ? { layout: { background: { color: "#171b22" }, textColor: "#9aa3b2" }, grid: { vertLines: { color: "#2a3040" }, horzLines: { color: "#2a3040" } } }
    : { layout: { background: { color: "#ffffff" }, textColor: "#6b7280" }, grid: { vertLines: { color: "#eef0f3" }, horzLines: { color: "#eef0f3" } } }) });

  // ---------- Overview ----------
  async function renderOverview() {
    const [d] = await Promise.all([api("/api/market"), loadFavs()]);
    const s = d.snapshot;
    if (!s) { app.innerHTML = `<div class="panel">まだデータがありません。<a href="#/status">状態</a>ページから更新を実行してください。</div>`; return; }
    const b = s.breadth, i = s.index;
    const p = (x) => b.n ? Math.round((x / b.n) * 100) : 0;
    app.innerHTML = `
      <h1>マーケット概況 <span class="muted" style="font-size:13px;font-weight:400">${s.date} 時点（更新 ${fmt.date(d.generatedAt)}）</span></h1>
      <div class="tiles">
        <div class="tile"><div class="label">BIST 100（BIST 100 指数）</div><div class="value">${i ? fmt.num(i.close) : "–"}</div><div class="sub">${i ? fmt.pct(i.chg1d) : ""} 1日 / ${i ? fmt.pct(i.chg1w) : ""} 週</div></div>
        <div class="tile"><div class="label">BIST100 月間 / 年初来</div><div class="value">${i ? fmt.pct(i.chg1m) : "–"}</div><div class="sub">YTD ${i ? fmt.pct(i.chgYtd) : ""} / 1年 ${i ? fmt.pct(i.chg12m) : ""}</div></div>
        <div class="tile"><div class="label">52週高値からの距離</div><div class="value">${i ? fmt.pct(i.fromHi52) : "–"}</div><div class="sub">${i ? `${fmt.num(i.lo52)} – ${fmt.num(i.hi52)}` : ""}</div></div>
        <div class="tile"><div class="label">上昇 / 下落</div><div class="value"><span class="up">${b.advancers}</span> / <span class="down">${b.decliners}</span></div><div class="sub">中央値 ${fmt.pct(b.medianChg1d)}（${b.n} 銘柄）</div></div>
        <div class="tile"><div class="label">200日線上の銘柄</div><div class="value">${p(b.aboveSma200)}%</div><div class="bar"><i style="width:${p(b.aboveSma200)}%"></i></div><div class="sub">50日線上 ${p(b.aboveSma50)}% / 20日線上 ${p(b.aboveSma20)}%</div></div>
        <div class="tile"><div class="label">トレンド（上昇 / 下降）</div><div class="value"><span class="up">${b.uptrend}</span> / <span class="down">${b.downtrend}</span></div><div class="sub">52週高値 ${b.newHi52} / 安値 ${b.newLo52}</div></div>
      </div>
      <div class="grid cols-2" style="margin-top:14px">
        <div class="panel"><h2>BIST 100（1年）</h2><div id="idxChart" class="chart"></div></div>
        <div class="panel"><h2>デイリーブリーフ</h2>
          ${s.aiBrief ? `<div class="brief">${esc(s.aiBrief)}</div><p class="note">AI コメント（Workers AI ${esc((s.aiModel || "").replace("@cf/meta/", ""))}、${fmt.date(s.aiGeneratedAt)}）。数値のみに基づく自動生成で、投資助言ではありません。</p><details><summary class="note" style="cursor:pointer">数値サマリーを表示</summary><div class="brief" style="font-size:13px;margin-top:6px">${esc(s.brief)}</div></details>` : `<div class="brief">${esc(s.brief)}</div>`}
        </div>
      </div>
      ${s.aiStocks?.length ? `<div class="panel" style="margin-top:14px"><h2>注目銘柄コメント（AI）</h2><div class="grid cols-2">${s.aiStocks.map((x) => `<div>${star(x.code)} <b>${link(x.code, fmt.name(x))}</b> <span class="muted">${x.code}</span><div style="margin-top:2px">${esc(x.text)}</div></div>`).join("")}</div></div>` : ""}
      <div class="grid cols-2" style="margin-top:14px">
        <div class="panel"><h2>本日のシグナル</h2><table><thead><tr><th>シグナル</th><th class="num">件数</th><th>銘柄例</th></tr></thead><tbody>
          ${Object.entries(s.signalCounts).sort((a, c) => c[1] - a[1]).map(([k, n]) => `<tr><td>${fmt.chips([k])}</td><td class="num">${n}</td><td class="muted">${(s.signalExamples[k] || []).map((x) => { const m = x.match(/\((\w+)\)$/); return m ? link(m[1], x) : esc(x); }).join("、")}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">なし</td></tr>`}
        </tbody></table><p class="note"><a href="#/screener">スクリーナー</a>でシグナル別に絞り込めます。</p></div>
        <div class="panel"><h2>セクター（1日 / 1週 / 1ヶ月 / 3ヶ月）</h2><table><thead><tr><th>セクター</th><th class="num">銘柄</th><th class="num">1日</th><th class="num">1週</th><th class="num">1ヶ月</th><th class="num">3ヶ月</th><th class="num">200日線上</th></tr></thead><tbody>
          ${s.sectors.map((x) => `<tr class="clickable" onclick="location.hash='#/screener?sector=${x.sector}'"><td>${sectorJa(x.sector)}</td><td class="num">${x.n}</td><td class="num">${fmt.pct(x.chg1d)}</td><td class="num">${fmt.pct(x.chg1w)}</td><td class="num">${fmt.pct(x.chg1m)}</td><td class="num">${fmt.pct(x.chg3m)}</td><td class="num">${x.aboveSma200Pct == null ? "–" : x.aboveSma200Pct.toFixed(0) + "%"}</td></tr>`).join("")}
        </tbody></table></div>
      </div>
      <div class="grid cols-2" style="margin-top:14px">
        <div class="panel"><h2>値上がり上位</h2><table><tbody>${s.gainers.map((g) => `<tr><td class="star-cell">${star(g.code)}</td><td>${link(g.code, fmt.name(g))} <span class="muted">${g.code}</span></td><td class="num">${fmt.num(g.close)}</td><td class="num">${fmt.pct(g.chg1d)}</td></tr>`).join("")}</tbody></table></div>
        <div class="panel"><h2>値下がり上位</h2><table><tbody>${s.losers.map((g) => `<tr><td class="star-cell">${star(g.code)}</td><td>${link(g.code, fmt.name(g))} <span class="muted">${g.code}</span></td><td class="num">${fmt.num(g.close)}</td><td class="num">${fmt.pct(g.chg1d)}</td></tr>`).join("")}</tbody></table></div>
      </div>
      ${d.history.length > 5 ? `<div class="panel" style="margin-top:14px"><h2>ブレッドス推移（200日線上 / 50日線上の銘柄比率 %）</h2><div id="breadthChart" class="chart small"></div><p class="note">緑: 200日線上の比率、青: 50日線上の比率。${d.history.length} 営業日分。</p></div>` : ""}
      <p class="note">データ: Yahoo Finance（終値ベース・遅延あり）。投資判断は自己責任で。</p>`;
    drawIndexChart($("#idxChart"), d.indexBars);
    if (d.history.length > 5) drawBreadthChart($("#breadthChart"), d.history);
  }

  function drawIndexChart(el, bars) {
    if (!el || !window.LightweightCharts || !bars?.length) return;
    const chart = LightweightCharts.createChart(el, { ...chartTheme(), autoSize: true, rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false } });
    const s = chart.addAreaSeries({ lineColor: "#1d4ed8", topColor: "rgba(29,78,216,.25)", bottomColor: "rgba(29,78,216,0)", lineWidth: 2 });
    s.setData(bars.map((b) => ({ time: b.date, value: b.close })));
    chart.timeScale().fitContent();
  }
  function drawBreadthChart(el, history) {
    const chart = LightweightCharts.createChart(el, { ...chartTheme(), autoSize: true, rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false } });
    const fmtP = { type: "custom", formatter: (v) => v.toFixed(0) + "%" };
    const s200 = chart.addLineSeries({ color: "#0f8a5f", lineWidth: 2, priceFormat: fmtP, title: "200日" });
    const s50 = chart.addLineSeries({ color: "#3b82f6", lineWidth: 1, priceFormat: fmtP, title: "50日" });
    s200.setData(history.filter((h) => h.aboveSma200 != null).map((h) => ({ time: h.date, value: h.aboveSma200 })));
    s50.setData(history.filter((h) => h.aboveSma50 != null).map((h) => ({ time: h.date, value: h.aboveSma50 })));
    chart.timeScale().fitContent();
  }
  function drawLineChart(el, data, suffix = "") {
    const chart = LightweightCharts.createChart(el, { ...chartTheme(), autoSize: true, rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false } });
    const s = chart.addLineSeries({ color: "#0f8a5f", lineWidth: 2, priceFormat: { type: "custom", formatter: (v) => v.toFixed(0) + suffix } });
    s.setData(data.filter((d) => d.value != null));
    chart.timeScale().fitContent();
  }

  // ---------- Screener ----------
  const PRESETS = {
    all: { label: "すべて", f: () => true },
    momentum: { label: "モメンタム上位", f: (r) => r.momScore != null && r.momScore >= 75 && (r.m.vsSma200 ?? -1) > 0, sort: ["momScore", -1] },
    breakout: { label: "ブレイクアウト", f: (r) => r.m.signals.some((s) => s === "52W_HIGH" || s === "BREAKOUT_20D"), sort: ["volRatio", -1] },
    volume: { label: "出来高急増", f: (r) => (r.m.volRatio ?? 0) >= 1.8, sort: ["volRatio", -1] },
    oversold: { label: "押し目（RSI<35・上昇トレンド）", f: (r) => (r.m.rsi14 ?? 100) < 35 && (r.m.vsSma200 ?? -1) > -3, sort: ["rsi14", 1] },
    reversal: { label: "反転候補（200日線回復/GC）", f: (r) => r.m.signals.some((s) => s === "RECLAIM_SMA200" || s === "GOLDEN_CROSS"), sort: ["chg1m", -1] },
    drawdown: { label: "大幅調整（高値-30%超）", f: (r) => (r.m.fromHi52 ?? 0) <= -30, sort: ["fromHi52", 1] },
    value: { label: "高配当・低PER", f: (r) => r.f && (r.f.dividendYield ?? 0) >= 4 && r.f.trailingPE != null && r.f.trailingPE > 0 && r.f.trailingPE <= 15, sort: ["divYield", -1] },
    watch: { label: "★ ウォッチ中", f: (r) => isFav(r.symbol) },
  };
  const COLS = [
    { k: "fav", l: "★", v: (r) => (isFav(r.symbol) ? 1 : 0), html: (r) => star(r.code), cls: "star-cell" },
    { k: "code", l: "コード", v: (r) => r.code, html: (r) => `<span class="muted">${r.code}</span>` },
    { k: "name", l: "銘柄", v: (r) => fmt.name(r), html: (r) => link(r.code, fmt.name(r)) },
    { k: "sector", l: "セクター", v: (r) => r.sector, html: (r) => `<span class="muted">${sectorJa(r.sector)}</span>` },
    { k: "close", l: "終値", num: true, v: (r) => r.m.close, html: (r) => fmt.num(r.m.close, r.m.close < 1 ? 3 : 2) },
    { k: "chg1d", l: "1日", num: true, v: (r) => r.m.chg1d, html: (r) => fmt.pct(r.m.chg1d) },
    { k: "chg1w", l: "1週", num: true, v: (r) => r.m.chg1w, html: (r) => fmt.pct(r.m.chg1w, 1) },
    { k: "chg1m", l: "1ヶ月", num: true, v: (r) => r.m.chg1m, html: (r) => fmt.pct(r.m.chg1m, 1) },
    { k: "chg3m", l: "3ヶ月", num: true, v: (r) => r.m.chg3m, html: (r) => fmt.pct(r.m.chg3m, 1) },
    { k: "chg12m", l: "1年", num: true, v: (r) => r.m.chg12m, html: (r) => fmt.pct(r.m.chg12m, 1) },
    { k: "momScore", l: "モメンタム", num: true, v: (r) => r.momScore, html: (r) => r.momScore == null ? "–" : `<b>${r.momScore}</b>` },
    { k: "rsi14", l: "RSI", num: true, v: (r) => r.m.rsi14, html: (r) => r.m.rsi14 == null ? "–" : `<span class="${r.m.rsi14 <= 30 ? "up" : r.m.rsi14 >= 70 ? "down" : ""}">${r.m.rsi14.toFixed(0)}</span>` },
    { k: "vsSma50", l: "vs 50日", num: true, v: (r) => r.m.vsSma50, html: (r) => fmt.pct(r.m.vsSma50, 1) },
    { k: "vsSma200", l: "vs 200日", num: true, v: (r) => r.m.vsSma200, html: (r) => fmt.pct(r.m.vsSma200, 1) },
    { k: "fromHi52", l: "52週高値比", num: true, v: (r) => r.m.fromHi52, html: (r) => fmt.pct(r.m.fromHi52, 1) },
    { k: "volRatio", l: "出来高比", num: true, v: (r) => r.m.volRatio, html: (r) => `<span class="${(r.m.volRatio ?? 0) >= 2 ? "up" : ""}">${fmt.x(r.m.volRatio)}</span>` },
    { k: "turnover", l: "売買代金/日", num: true, v: (r) => r.m.turnover, html: (r) => `${fmt.mn(r.m.turnover)}${r.currency && r.currency !== "TRY" ? ` <span class="muted">${r.currency}</span>` : ""}` },
    { k: "pe", l: "PER", num: true, v: (r) => r.f?.trailingPE ?? null, html: (r) => r.f?.trailingPE == null ? "–" : r.f.trailingPE.toFixed(1) },
    { k: "divYield", l: "配当利回り", num: true, v: (r) => r.f?.dividendYield ?? null, html: (r) => r.f?.dividendYield == null ? "–" : r.f.dividendYield.toFixed(2) + "%" },
    { k: "mcap", l: "時価総額", num: true, v: (r) => r.f?.marketCap ?? null, html: (r) => fmt.mn(r.f?.marketCap) },
    { k: "signals", l: "シグナル", v: (r) => r.m.signals.length, html: (r) => fmt.chips(r.m.signals.filter((s) => s !== "UPTREND" && s !== "DOWNTREND")) },
  ];
  let screener = { rows: null, preset: "all", sector: "", signal: "", q: "", sortKey: "momScore", sortDir: -1, minTurnover: 0 };

  async function renderScreener(query) {
    if (!screener.rows) {
      const [d] = await Promise.all([api("/api/screener"), loadFavs()]);
      screener.rows = d.rows.filter((r) => r.kind === "equity");
    } else await loadFavs();
    if (query.get("sector")) screener.sector = query.get("sector");
    if (query.get("preset")) screener.preset = query.get("preset");
    if (query.get("signal")) screener.signal = query.get("signal");
    const sectors = [...new Set(screener.rows.map((r) => r.sector))].sort();
    app.innerHTML = `
      <h1>スクリーナー <span class="muted" style="font-size:13px;font-weight:400">${screener.rows.length} 銘柄</span></h1>
      <div class="toolbar">${Object.entries(PRESETS).map(([k, p]) => `<button class="preset ${screener.preset === k ? "active" : ""}" data-preset="${k}">${p.label}</button>`).join("")}</div>
      <div class="toolbar">
        <select id="fSector"><option value="">全セクター</option>${sectors.map((s) => `<option value="${s}" ${screener.sector === s ? "selected" : ""}>${sectorJa(s)}</option>`).join("")}</select>
        <select id="fSignal"><option value="">全シグナル</option>${Object.entries(SIGNALS).map(([k, l]) => `<option value="${k}" ${screener.signal === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select id="fTurnover"><option value="0">売買代金: 指定なし</option><option value="50000000" ${screener.minTurnover == 50000000 ? "selected" : ""}>≥ TRY 50M/日</option><option value="250000000" ${screener.minTurnover == 250000000 ? "selected" : ""}>≥ TRY 250M/日</option><option value="1000000000" ${screener.minTurnover == 1000000000 ? "selected" : ""}>≥ TRY 1B/日</option></select>
        <input id="fQ" type="text" placeholder="銘柄名・コード" value="${esc(screener.q)}" style="width:160px">
        <span class="note" id="fCount"></span>
      </div>
      <div class="panel table-wrap"><table id="scr"><thead><tr>${COLS.map((c) => `<th class="${c.num ? "num" : c.cls || ""} ${screener.sortKey === c.k ? "sorted" + (screener.sortDir > 0 ? " asc" : "") : ""}" data-k="${c.k}">${c.l}</th>`).join("")}</tr></thead><tbody></tbody></table></div>
      <p class="note">モメンタム = 3/6/12ヶ月リターンのユニバース内パーセンタイル平均（0–100）。PER・配当利回り・時価総額は Yahoo Finance の直近値。売買代金・時価総額は TRY 建て。</p>`;
    const rerender = () => {
      const p = PRESETS[screener.preset];
      let rows = screener.rows.filter(p.f);
      if (screener.sector) rows = rows.filter((r) => r.sector === screener.sector);
      if (screener.signal) rows = rows.filter((r) => r.m.signals.includes(screener.signal));
      if (screener.minTurnover) rows = rows.filter((r) => (r.m.turnover ?? 0) >= screener.minTurnover);
      if (screener.q) { const q = screener.q.toLowerCase(); rows = rows.filter((r) => r.code.toLowerCase().includes(q) || (r.name || "").toLowerCase().includes(q)); }
      const col = COLS.find((c) => c.k === screener.sortKey) || COLS.find((c) => c.k === "momScore");
      rows.sort((a, b) => { const x = col.v(a), y = col.v(b); if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * screener.sortDir; });
      $("#scr tbody").innerHTML = rows.map((r) => `<tr>${COLS.map((c) => `<td class="${c.num ? "num" : c.cls || ""}">${c.html(r)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${COLS.length}" class="muted">該当なし</td></tr>`;
      $("#fCount").textContent = `${rows.length} 件`;
      document.querySelectorAll("#scr th").forEach((th) => th.classList.toggle("sorted", th.dataset.k === screener.sortKey) || th.classList.toggle("asc", th.dataset.k === screener.sortKey && screener.sortDir > 0));
    };
    app.querySelectorAll("[data-preset]").forEach((b) => b.onclick = () => { screener.preset = b.dataset.preset; const ps = PRESETS[screener.preset]; if (ps.sort) { screener.sortKey = ps.sort[0]; screener.sortDir = ps.sort[1]; } app.querySelectorAll("[data-preset]").forEach((x) => x.classList.toggle("active", x === b)); rerender(); });
    $("#fSector").onchange = (e) => { screener.sector = e.target.value; rerender(); };
    $("#fSignal").onchange = (e) => { screener.signal = e.target.value; rerender(); };
    $("#fTurnover").onchange = (e) => { screener.minTurnover = Number(e.target.value); rerender(); };
    $("#fQ").oninput = (e) => { screener.q = e.target.value; rerender(); };
    app.querySelectorAll("#scr th").forEach((th) => th.onclick = () => { if (screener.sortKey === th.dataset.k) screener.sortDir *= -1; else { screener.sortKey = th.dataset.k; screener.sortDir = COLS.find((c) => c.k === th.dataset.k)?.num ? -1 : 1; } rerender(); });
    onFavChange = () => { if (screener.preset === "watch" || screener.sortKey === "fav") rerender(); };
    rerender();
  }

  // ---------- Stock detail ----------
  async function renderStock(code) {
    const [d] = await Promise.all([api(`/api/stock/${encodeURIComponent(code)}`), loadFavs()]);
    const t = d.ticker, m = d.metrics, f = d.fundamentals;
    const isIdx = t.kind === "index";
    app.innerHTML = `
      <p><a href="#/screener">← スクリーナー</a></p>
      <div class="title-row"><h1>${esc(t.name || t.code)} <span class="muted" style="font-size:14px;font-weight:400">${t.code} · ${sectorJa(t.sector)}${isIdx ? "" : ` · Borsa Istanbul · ${fmt.cur(t)}`}</span></h1>${isIdx ? "" : star(t.code, "big")}</div>
      ${m ? `<div class="tiles">
        <div class="tile"><div class="label">終値（${m.date}）</div><div class="value">${fmt.num(m.close, m.close < 1 ? 3 : 2)}</div><div class="sub">${fmt.pct(m.chg1d)} 1日</div></div>
        <div class="tile"><div class="label">1週 / 1ヶ月</div><div class="value">${fmt.pct(m.chg1w, 1)}</div><div class="sub">${fmt.pct(m.chg1m, 1)} 1ヶ月</div></div>
        <div class="tile"><div class="label">3ヶ月 / 1年</div><div class="value">${fmt.pct(m.chg3m, 1)}</div><div class="sub">${fmt.pct(m.chg12m, 1)} 1年 · YTD ${fmt.pct(m.chgYtd, 1)}</div></div>
        <div class="tile"><div class="label">RSI(14)</div><div class="value ${m.rsi14 <= 30 ? "up" : m.rsi14 >= 70 ? "down" : ""}">${m.rsi14 == null ? "–" : m.rsi14.toFixed(0)}</div><div class="sub">ボラ(20日) ${m.vol20 == null ? "–" : m.vol20.toFixed(0) + "%"}</div></div>
        <div class="tile"><div class="label">52週レンジ</div><div class="value">${fmt.pct(m.fromHi52, 1)}</div><div class="sub">${fmt.num(m.lo52)} – ${fmt.num(m.hi52)}</div></div>
        <div class="tile"><div class="label">出来高比（20日）</div><div class="value">${fmt.x(m.volRatio)}</div><div class="sub">${fmt.mn(m.volume)} / 平均 ${fmt.mn(m.avgVol20)}</div></div>
      </div>
      <div style="margin:10px 0">${fmt.chips(m.signals)}</div>` : `<p class="muted">指標は未計算です。</p>`}
      <div class="panel"><div class="toolbar"><h2 style="margin:0">価格チャート（SMA 20/50/200）</h2><span class="spacer"></span>${["6mo", "1y", "2y"].map((r) => `<button class="preset" data-range="${r}">${r}</button>`).join("")}</div><div id="chart" class="chart"></div></div>
      <div class="grid cols-2" style="margin-top:14px">
        <div class="panel"><h2>テクニカル</h2>${m ? `<div class="kv">
          <div><span>SMA20 / 距離</span><span>${fmt.num(m.sma20)} / ${fmt.pct(m.vsSma20, 1)}</span></div>
          <div><span>SMA50 / 距離</span><span>${fmt.num(m.sma50)} / ${fmt.pct(m.vsSma50, 1)}</span></div>
          <div><span>SMA200 / 距離</span><span>${fmt.num(m.sma200)} / ${fmt.pct(m.vsSma200, 1)}</span></div>
          <div><span>12-1ヶ月モメンタム</span><span>${fmt.pct(m.mom12_1, 1)}</span></div>
          <div><span>6ヶ月</span><span>${fmt.pct(m.chg6m, 1)}</span></div>
          <div><span>最大DD（1年）</span><span>${fmt.pct(m.mdd1y, 1)}</span></div>
          <div><span>ATR(14) / %</span><span>${fmt.num(m.atr14, 3)} / ${m.atrPct == null ? "–" : m.atrPct.toFixed(2) + "%"}</span></div>
          <div><span>売買代金/日（推定）</span><span>${fmt.cur(t)} ${fmt.mn(m.turnover)}</span></div>
          <div><span>データ本数</span><span>${m.bars}</span></div>
          ${m.goldenCrossDays != null ? `<div><span>ゴールデンクロス</span><span>${m.goldenCrossDays} 日前</span></div>` : ""}
          ${m.deadCrossDays != null ? `<div><span>デッドクロス</span><span>${m.deadCrossDays} 日前</span></div>` : ""}
        </div>` : ""}</div>
        <div class="panel"><h2>ファンダメンタル（Yahoo Finance）</h2>${f ? `<div class="kv">
          <div><span>時価総額</span><span>${fmt.cur(t)} ${fmt.mn(f.marketCap)}</span></div>
          <div><span>PER（実績 / 予想）</span><span>${f.trailingPE == null ? "–" : f.trailingPE.toFixed(1)} / ${f.forwardPE == null ? "–" : f.forwardPE.toFixed(1)}</span></div>
          <div><span>PBR</span><span>${f.priceToBook == null ? "–" : f.priceToBook.toFixed(2)}</span></div>
          <div><span>配当利回り</span><span>${f.dividendYield == null ? "–" : f.dividendYield.toFixed(2) + "%"}</span></div>
          <div><span>年間配当</span><span>${!(f.trailingAnnualDividendRate > 0) ? "–" : fmt.cur(t) + " " + f.trailingAnnualDividendRate.toFixed(3)}</span></div>
          <div><span>EPS（実績 / 予想）</span><span>${f.epsTrailing == null ? "–" : f.epsTrailing.toFixed(3)} / ${f.epsForward == null ? "–" : f.epsForward.toFixed(3)}</span></div>
          <div><span>次回決算</span><span>${f.earningsTimestamp ? new Date(f.earningsTimestamp * 1000).toLocaleDateString("ja-JP") : "–"}</span></div>
          <div><span>更新</span><span>${fmt.date(f.updatedAt)}</span></div>
        </div>` : `<p class="muted">${isIdx ? "指数のため対象外" : "未取得（状態ページから更新できます）"}</p>`}</div>
      </div>
      ${d.aiNotes?.length ? `<div class="panel" style="margin-top:14px"><h2>AI コメント</h2>${d.aiNotes.map((x) => `<p style="margin:4px 0"><span class="muted">${x.date}</span> ${esc(x.text)}</p>`).join("")}<p class="note">数値のみに基づく自動生成（Workers AI）。投資助言ではありません。</p></div>` : ""}
      ${isIdx ? "" : `<div class="panel" style="margin-top:14px" id="wPanel"><h2>ウォッチリスト・メモ</h2><div id="wBody"></div></div>`}
      <p class="note">${t.last_fetched_at ? `最終取得 ${fmt.date(t.last_fetched_at)}` : ""} ${t.fetch_error ? `<span class="error">取得エラー: ${esc(t.fetch_error)}</span>` : ""}</p>`;
    const chartEl = $("#chart");
    let chart;
    const draw = (range) => {
      const n = range === "6mo" ? 130 : range === "1y" ? 260 : 520;
      const bars = d.bars.slice(-n);
      if (chart) chart.remove();
      chart = LightweightCharts.createChart(chartEl, { ...chartTheme(), autoSize: true, rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false } });
      const cs = chart.addCandlestickSeries({ upColor: "#0f8a5f", downColor: "#d13a3a", wickUpColor: "#0f8a5f", wickDownColor: "#d13a3a", borderVisible: false });
      cs.setData(bars.map((b) => ({ time: b.date, open: b.open, high: b.high, low: b.low, close: b.close })));
      const all = d.bars.map((b) => b.close);
      const smaLine = (p, color) => { const out = []; let s = 0; for (let i = 0; i < all.length; i++) { s += all[i]; if (i >= p) s -= all[i - p]; if (i >= p - 1) out.push({ time: d.bars[i].date, value: s / p }); } const ls = chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }); ls.setData(out.slice(-n)); };
      smaLine(20, "#f59e0b"); smaLine(50, "#3b82f6"); smaLine(200, "#a855f7");
      if (!isIdx) { const vs = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol" }); chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } }); vs.setData(bars.map((b) => ({ time: b.date, value: b.volume, color: b.close >= b.open ? "rgba(15,138,95,.4)" : "rgba(209,58,58,.4)" }))); }
      chart.timeScale().fitContent();
      app.querySelectorAll("[data-range]").forEach((b) => b.classList.toggle("active", b.dataset.range === range));
    };
    app.querySelectorAll("[data-range]").forEach((b) => b.onclick = () => draw(b.dataset.range));
    draw("1y");
    if (!isIdx) {
      const body = $("#wBody");
      const paintNote = async () => {
        if (!ME.user) {
          body.innerHTML = ME.oauthConfigured ? `<p class="note">右上の ☆ でウォッチリストに追加できます（<a href="${loginUrl()}">Google でログイン</a>が必要です）。</p>` : `<p class="note">ウォッチリストは Google ログイン後に使えます（OAuth 未設定）。</p>`;
          return;
        }
        if (!isFav(symOf(t.code))) {
          body.innerHTML = `<p class="note">右上の ☆ でウォッチリストに追加すると、メモと条件（配当利回り・株価・PER）を設定できます。通知を有効にしていれば、条件の到達・シグナル・急変動がメールで届きます。</p>`;
          return;
        }
        // only starred stocks fetch their note (one primary-key lookup)
        let w = { note: null, added_at: null };
        try { w = await api(`/api/watchlist/${encodeURIComponent(t.code)}`); } catch {}
        const x = alertVals(m, f);
        const status = () => { const chips = condChips(w, x); return chips ? `現在の条件: ${chips}` : "条件は未設定です。"; };
        body.innerHTML = `<div class="toolbar"><input id="wNote" data-code="${esc(t.code)}" type="text" maxlength="500" placeholder="メモ（例: 押し目で検討、決算待ち）" value="${esc(w.note || "")}" style="flex:1;min-width:240px"></div>
          <div class="alert-grid">${ALERTS.map((a) => `<label>${a.label}<input type="number" min="0" step="${a.step}" id="${a.k}" value="${w[a.k] ?? ""}" placeholder="${a.v(x) != null ? Number(a.v(x)).toFixed(a.d) : ""}">${a.unit}</label>`).join("")}</div>
          <div class="toolbar"><button class="primary" id="wSave">保存</button><span class="note" id="wStatus">${status()}</span></div>
          <p class="note" id="wMsg">条件は毎営業日の確定後に判定し、新たに条件を満たした日に、通知を有効にしている場合はメールで知らせます（保存時点ですでに満たしている条件はメールしません）。空欄で解除。${w.added_at ? ` 追加日 ${fmt.date(w.added_at)}` : ""}</p>`;
        $("#wSave").onclick = async () => {
          const payload = { note: $("#wNote").value };
          for (const a of ALERTS) { const v = $("#" + a.k).value.trim(); payload[a.k] = v === "" ? null : Number(v); }
          try {
            await api(`/api/watchlist/${encodeURIComponent(t.code)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            Object.assign(w, payload); $("#wStatus").innerHTML = status(); $("#wMsg").textContent = "保存しました";
          } catch (e) { $("#wMsg").innerHTML = `<span class="error">${esc(e.message)}</span>`; }
        };
      };
      onFavChange = (c2) => { if (c2 === t.code) paintNote(); };
      paintNote();
    }
  }

  // ---------- Watchlist ----------
  async function renderWatchlist() {
    if (!ME.user) { app.innerHTML = `<h1>ウォッチリスト</h1>` + loginPrompt("ウォッチリストはログイン後に表示されます。"); return; }
    const [d] = await Promise.all([api("/api/watchlist"), loadFavs()]);
    app.innerHTML = `<h1>ウォッチリスト <span class="muted" style="font-size:13px;font-weight:400">${d.items.length} 銘柄</span></h1>
      <div class="panel table-wrap"><table><thead><tr><th class="star-cell">★</th><th>コード</th><th>銘柄</th><th>セクター</th><th class="num">終値</th><th class="num">1日</th><th class="num">1ヶ月</th><th class="num">3ヶ月</th><th class="num">RSI</th><th class="num">vs 200日</th><th class="num">52週高値比</th><th>シグナル</th><th>条件</th><th>メモ</th></tr></thead><tbody>
      ${d.items.map((r) => `<tr data-row="${esc(r.code)}"><td class="star-cell">${star(r.code)}</td><td class="muted">${r.code}</td><td>${link(r.code, fmt.name(r))}</td><td class="muted">${sectorJa(r.sector)}</td><td class="num">${r.m ? fmt.num(r.m.close) : "–"}</td><td class="num">${fmt.pct(r.m?.chg1d)}</td><td class="num">${fmt.pct(r.m?.chg1m, 1)}</td><td class="num">${fmt.pct(r.m?.chg3m, 1)}</td><td class="num">${r.m?.rsi14 == null ? "–" : r.m.rsi14.toFixed(0)}</td><td class="num">${fmt.pct(r.m?.vsSma200, 1)}</td><td class="num">${fmt.pct(r.m?.fromHi52, 1)}</td><td>${fmt.chips(r.m?.signals)}</td><td>${condChips(r, alertVals(r.m, r.f)) || '<span class="muted">–</span>'}</td><td>${esc(r.note || "")}</td></tr>`).join("") || `<tr><td colspan="14" class="muted">まだありません。スクリーナーや銘柄ページの ☆ から追加できます。</td></tr>`}
      </tbody></table></div>`;
    onFavChange = (c2, on) => { const tr = document.querySelector(`tr[data-row="${CSS.escape(c2)}"]`); if (tr) tr.style.opacity = on ? "" : "0.4"; };
  }

  // ---------- Sectors ----------
  async function renderSectors() {
    const d = await api("/api/market");
    const s = d.snapshot;
    if (!s) { app.innerHTML = `<div class="panel">データなし</div>`; return; }
    const color = (v) => v == null ? "#6b7280" : v >= 0 ? `rgba(15,138,95,${Math.min(0.25 + Math.abs(v) / 4, 1)})` : `rgba(209,58,58,${Math.min(0.25 + Math.abs(v) / 4, 1)})`;
    const block = (title, key) => `<div class="panel"><h2>${title}</h2><div class="sector-grid">${[...s.sectors].sort((a, b) => (b[key] ?? -999) - (a[key] ?? -999)).map((x) => `<a class="sector-cell" style="background:${color(x[key])}" href="#/screener?sector=${x.sector}"><div class="n">${sectorJa(x.sector)} · ${x.n}</div><div class="v">${x[key] == null ? "–" : (x[key] >= 0 ? "+" : "") + x[key].toFixed(2) + "%"}</div></a>`).join("")}</div></div>`;
    app.innerHTML = `<h1>セクター・ヒートマップ <span class="muted" style="font-size:13px;font-weight:400">${s.date}</span></h1><div class="grid cols-2">${block("1日", "chg1d")}${block("1週", "chg1w")}${block("1ヶ月", "chg1m")}${block("3ヶ月", "chg3m")}</div><p class="note">セクター内の単純平均リターン。クリックでスクリーナーに移動。</p>`;
  }

  // ---------- Settings (notifications) ----------
  async function renderSettings() {
    if (!ME.user) { app.innerHTML = `<h1>設定</h1>` + loginPrompt("通知設定はログイン後に変更できます。"); return; }
    const st = ME.settings;
    const n = await api("/api/me/notifications");
    const sigOpts = ["52W_HIGH", "BREAKOUT_20D", "GOLDEN_CROSS", "VOLUME_SPIKE", "RECLAIM_SMA200", "RSI_OVERSOLD", "52W_LOW", "DEAD_CROSS", "LOSE_SMA200", "DEEP_DRAWDOWN", "BREAKDOWN_20D", "RSI_OVERBOUGHT"];
    app.innerHTML = `<h1>設定・通知</h1>
      <div class="grid cols-2">
        <div class="panel"><h2>アカウント</h2><div class="kv"><div><span>メール</span><span>${esc(ME.user.email)}</span></div><div><span>名前</span><span>${esc(ME.user.name || "–")}</span></div><div><span>権限</span><span>${ME.user.admin ? "管理者" : "一般"}</span></div></div>
          <p class="note"><a href="/auth/logout">ログアウト</a></p></div>
        <div class="panel"><h2>メール通知</h2>
          ${ME.emailConfigured ? "" : `<p class="error">メール送信（Cloudflare Email Service）が未設定のため、通知はまだ送信されません。</p>`}
          <label style="display:block;margin:6px 0"><input type="checkbox" id="nEmail" ${st.notify_email ? "checked" : ""}> <b>メール通知を有効にする</b>（毎営業日の引け後 1 通）</label>
          <div style="margin-left:22px">
            <label style="display:block;margin:4px 0"><input type="checkbox" id="nDaily" ${st.notify_daily ? "checked" : ""}> 日次マーケットブリーフを含める</label>
            <label style="display:block;margin:4px 0"><input type="checkbox" id="nWatch" ${st.notify_watchlist ? "checked" : ""}> ウォッチリスト銘柄のシグナル・急変動を含める（しきい値 <input type="number" id="nMove" value="${st.notify_move_pct}" min="0.5" max="50" step="0.5" style="width:70px"> %）</label>
            <div class="note" style="margin-top:8px">市場全体のシグナルダイジェストに含めるシグナル:</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px 14px;margin:4px 0">${sigOpts.map((k) => `<label><input type="checkbox" class="nSig" value="${k}" ${st.notify_signals.includes(k) ? "checked" : ""}> ${SIGNALS[k] || k}</label>`).join("")}</div>
          </div>
          <div class="toolbar" style="margin-top:10px"><button class="primary" id="nSave">保存</button><button id="nTest">今すぐテスト送信</button><a href="/api/me/notifications/preview" target="_blank"><button type="button">プレビュー</button></a><span class="note" id="nMsg"></span></div>
          <p class="note">ブリーフ・ウォッチ銘柄のアラート・選択したシグナルのいずれかがある日だけ送信されます（送信元 notifications@equity.0xkaz.com）。</p>
        </div>
      </div>
      <div class="panel" style="margin-top:14px"><h2>送信履歴</h2><table><thead><tr><th>対象日</th><th>送信</th><th>状態</th><th>詳細</th></tr></thead><tbody>${n.items.map((x) => `<tr><td>${x.ref_date}</td><td class="muted">${fmt.date(x.sent_at)}</td><td class="${x.status === "sent" ? "up" : x.status === "error" ? "down" : "muted"}">${x.status}</td><td class="note">${esc((x.detail || "").slice(0, 160))}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">まだありません</td></tr>`}</tbody></table></div>`;
    const collect = () => ({ notify_email: $("#nEmail").checked, notify_daily: $("#nDaily").checked, notify_watchlist: $("#nWatch").checked, notify_move_pct: Number($("#nMove").value), notify_signals: [...document.querySelectorAll(".nSig:checked")].map((x) => x.value) });
    $("#nSave").onclick = async () => { try { await api("/api/me/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(collect()) }); ME = await api("/api/me"); $("#nMsg").textContent = "保存しました"; } catch (e) { $("#nMsg").textContent = "エラー: " + e.message; } };
    $("#nTest").onclick = async () => { $("#nMsg").textContent = "送信中…"; try { await api("/api/me/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(collect()) }); const r = await api("/api/me/notifications/test", { method: "POST" }); $("#nMsg").textContent = r.sent ? "送信しました" : r.errors?.length ? "エラー: " + r.errors.join("; ") : "送信対象なし（内容が空）"; renderSettings(); } catch (e) { $("#nMsg").textContent = "エラー: " + e.message; } };
  }

  // ---------- Status / admin ----------
  async function renderStatus() {
    const [j, u, meta] = await Promise.all([api("/api/jobs"), api("/api/universe"), api("/api/meta")]);
    const tok = localStorage.getItem("adminToken") || "";
    app.innerHTML = `<h1>状態・管理</h1>
      <div class="grid cols-2">
        <div class="panel"><h2>データ更新</h2>
          <div class="kv"><div><span>監視銘柄</span><span>${u.tickers.length}</span></div><div><span>未更新（stale）</span><span>${j.stale}</span></div><div><span>取得エラー</span><span>${j.errors.length}</span></div><div><span>管理権限</span><span>${j.isAdmin ? "あり" : "なし"}</span></div></div>
          <p class="note">毎営業日 現地時間 18:20〜20:50 に Cron で自動更新（25銘柄ずつ）。全銘柄が揃うと通知メールを送信。手動更新は下のボタンから（管理者ログインまたは管理トークン）。</p>
          ${j.isAdmin && ME.user ? "" : `<div class="toolbar"><input id="tok" type="password" placeholder="管理トークン" value="${esc(tok)}" style="min-width:220px"><button id="tokSave">保存</button></div>`}
          <div class="toolbar"><button class="primary" id="btnRefresh">未更新分を取得（25件）</button><button id="btnRefreshAll">全銘柄を強制取得</button><button id="btnSnap">スナップショット再構築</button><button id="btnFund">ファンダ更新</button><button id="btnRecompute">指標再計算</button><button id="btnBreadth">ブレッドス履歴バックフィル</button><button id="btnNotify">通知を再送</button><button id="btnAi">AIコメント再生成</button></div>
          <pre id="adminOut" class="note" style="white-space:pre-wrap;max-height:220px;overflow:auto"></pre>
        </div>
        ${j.users ? `<div class="panel"><h2>ユーザー</h2><table><tbody>${j.users.map((x) => `<tr><td>${esc(x.email)}</td><td class="muted">${esc(x.name || "")}</td><td class="muted">${fmt.date(x.last_login_at)}</td><td>${x.notify_email ? "通知ON" : "通知OFF"}</td></tr>`).join("")}</tbody></table></div>` : ""}
        <div class="panel"><h2>取得エラー</h2>${j.errors.length ? `<table><tbody>${j.errors.map((e) => `<tr><td>${e.code}</td><td class="error">${esc(e.fetch_error)}</td><td class="muted">${fmt.date(e.last_fetched_at)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">なし</p>`}</div>
      </div>
      <div class="panel" style="margin-top:14px"><h2>ジョブ履歴</h2><div class="table-wrap"><table><thead><tr><th>開始</th><th>種別</th><th>結果</th></tr></thead><tbody>${j.jobs.map((x) => { let d = {}; try { d = JSON.parse(x.detail); } catch {} return `<tr><td class="muted">${fmt.date(x.started_at)}</td><td>${x.kind}</td><td class="note">処理 ${d.processed?.length ?? 0} / 失敗 ${d.failed?.length ?? 0} / 残り ${d.remainingStale ?? "–"}${d.snapshotBuilt ? " / snapshot ✓" : ""}${d.fundamentals != null ? ` / fund ${d.fundamentals}` : ""}${d.notifications ? ` / mail ${typeof d.notifications === "string" ? d.notifications : `sent ${d.notifications.sent} skip ${d.notifications.skipped}${d.notifications.errors?.length ? " err " + d.notifications.errors.length : ""}`}` : ""}${d.ai ? ` / ai ${typeof d.ai === "string" ? d.ai : `brief ${d.ai.brief ? "✓" : "✗"} notes ${d.ai.notes}${d.ai.errors?.length ? " err " + d.ai.errors.length : ""}`}` : ""}</td></tr>`; }).join("") || `<tr><td colspan="3" class="muted">なし</td></tr>`}</tbody></table></div></div>
      <div class="panel" style="margin-top:14px"><h2>ユニバース</h2><div class="table-wrap"><table><thead><tr><th>コード</th><th>銘柄</th><th>セクター</th><th>最終価格日</th><th>最終取得</th></tr></thead><tbody>${u.tickers.map((t) => `<tr><td class="muted">${t.code}</td><td>${link(t.code, t.name || t.symbol)}</td><td class="muted">${sectorJa(t.sector)}</td><td>${t.last_price_date || "–"}</td><td class="muted">${fmt.date(t.last_fetched_at)}</td></tr>`).join("")}</tbody></table></div></div>`;
    const tokSave = $("#tokSave"); if (tokSave) tokSave.onclick = () => { localStorage.setItem("adminToken", $("#tok").value.trim()); $("#adminOut").textContent = "トークンを保存しました（このブラウザのみ）。"; };
    const run = async (path) => { $("#adminOut").textContent = "実行中…"; try { const r = await api(path, { method: "POST", headers: adminHeaders() }); $("#adminOut").textContent = JSON.stringify(r, null, 2); screener.rows = null; } catch (e) { $("#adminOut").textContent = "エラー: " + e.message; } };
    $("#btnRefresh").onclick = () => run("/api/admin/refresh");
    $("#btnRefreshAll").onclick = () => run("/api/admin/refresh?force=1&limit=40");
    $("#btnSnap").onclick = () => run("/api/admin/snapshot");
    $("#btnFund").onclick = () => run("/api/admin/fundamentals");
    $("#btnRecompute").onclick = () => run("/api/admin/recompute");
    $("#btnBreadth").onclick = () => run("/api/admin/breadth-backfill?days=260");
    $("#btnNotify").onclick = () => run("/api/admin/notify");
    $("#btnAi").onclick = () => run("/api/admin/ai");
  }

  // ---------- Router ----------
  async function route() {
    const hash = location.hash.replace(/^#/, "") || "/";
    const [path, qs] = hash.split("?");
    const query = new URLSearchParams(qs || "");
    document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === path || (path.startsWith("/stock") && a.dataset.route === "/screener")));
    app.innerHTML = `<p class="muted">読み込み中…</p>`;
    try {
      if (!Object.keys(SIGNALS).length) { const [meta, me] = await Promise.all([api("/api/meta"), api("/api/me")]); SIGNALS = meta.signals; ME = me; }
      renderUserBox();
      onFavChange = null;
      if (ME.user && !FAVS) loadFavs(); // starts now, in parallel with the page's own request
      if (path === "/") await renderOverview();
      else if (path === "/screener") await renderScreener(query);
      else if (path.startsWith("/stock/")) await renderStock(path.split("/")[2]);
      else if (path === "/watchlist") await renderWatchlist();
      else if (path === "/sectors") await renderSectors();
      else if (path === "/status") await renderStatus();
      else if (path === "/settings") await renderSettings();
      else app.innerHTML = `<div class="panel">ページが見つかりません</div>`;
    } catch (e) {
      app.innerHTML = `<div class="panel error">エラー: ${esc(e.message)}</div>`;
    }
  }
  window.addEventListener("hashchange", route);
  route();
})();
