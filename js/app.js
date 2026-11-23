import { PLANS, RULES_SOURCE, RULES_AS_OF, simulate, rankPlans } from "./sim.js";
import { sizePosition, atr } from "./sizer.js";
import { fetchPrice, fetchCandles, priceSupported } from "./market.js";
import { drawCard } from "./card.js";

const $ = (id) => document.getElementById(id);
const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
const money = (x, d = 0) => "$" + Number(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const num = (x, d = 2) => Number(x).toLocaleString("en-US", { maximumFractionDigits: d });
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/* ---------- theme ---------- */
const savedTheme = store.get("theme");
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
$("theme").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  store.set("theme", next);
  if (lastResult) { drawPaths(lastResult); }
});

/* ---------- tabs ---------- */
const tabs = [["tab-odds", "view-odds"], ["tab-size", "view-size"]];
function showTab(id) {
  for (const [t, v] of tabs) {
    const on = t === id;
    $(t).setAttribute("aria-selected", String(on));
    $(v).hidden = !on;
  }
  if (id === "tab-odds" && lastResult) drawPaths(lastResult);
}
for (const [t] of tabs) $(t).addEventListener("click", () => showTab(t));

/* ---------- rules footer ---------- */
$("rules-link").href = RULES_SOURCE;
$("rules-date").textContent = RULES_AS_OF;

/* ---------- plan selects ---------- */
for (const sel of [$("plan"), $("s-plan")]) {
  for (const p of PLANS) sel.add(new Option(p.name, p.id));
}
const planById = (id) => PLANS.find((p) => p.id === id) || PLANS[0];
function planHint(p) {
  const b = Number($("balance").value) || 0;
  const amt = (x) => (b ? ` (${money(x * b)})` : "");
  return `Make ${pct(p.target)}${amt(p.target)} to pass. ` +
    (p.dll == null ? "No daily loss limit. " : `Lose ${pct(p.dll)}${amt(p.dll)} in a day and you're out. `) +
    `Fall ${pct(p.maxDD)}${amt(p.maxDD)} below the start and you're out.`;
}

/* ---------- odds form <-> URL ---------- */
const FIELDS = {
  plan: "plan", bal: "balance", wr: "winRate", rk: "riskPct", aw: "avgWinR",
  al: "avgLossR", tpd: "tradesPerDay", stop: "maxLossesPerDay", c: "costR", d: "days",
};
const PRESETS = {
  scalper: { winRate: 55, avgWinR: 1.2, avgLossR: 1, riskPct: 0.25, tradesPerDay: 8, maxLossesPerDay: 0, costR: 0.1 },
  swing:   { winRate: 40, avgWinR: 3, avgLossR: 1, riskPct: 0.75, tradesPerDay: 1, maxLossesPerDay: 0, costR: 0.03 },
  yolo:    { winRate: 45, avgWinR: 2, avgLossR: 1, riskPct: 2, tradesPerDay: 4, maxLossesPerDay: 0, costR: 0.05 },
};

function loadFromHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  for (const [k, id] of Object.entries(FIELDS)) {
    const v = q.get(k);
    if (v == null) continue;
    if (id === "plan") { if (PLANS.some((p) => p.id === v)) $(id).value = v; }
    else if (v !== "" && Number.isFinite(Number(v))) $(id).value = v;
  }
}
function writeHash() {
  const q = new URLSearchParams();
  for (const [k, id] of Object.entries(FIELDS)) q.set(k, $(id).value);
  history.replaceState(null, "", "#" + q.toString());
}

function readOdds() {
  const v = (id) => Number($(id).value);
  return {
    plan: planById($("plan").value),
    startBalance: v("balance"),
    winRate: v("winRate") / 100,
    riskPct: v("riskPct") / 100,
    avgWinR: v("avgWinR"),
    avgLossR: v("avgLossR"),
    tradesPerDay: v("tradesPerDay"),
    maxLossesPerDay: v("maxLossesPerDay"),
    costR: v("costR"),
    days: v("days"),
    runs: 10000,
    seed: 20261124,
  };
}

/* ---------- run + render ---------- */
let lastResult = null;
let timer = 0;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(runOdds, 150);
}

/* sliders mirror their number box both ways */
const sliders = [...document.querySelectorAll("input[type=range][data-sync]")];
function syncSliders() {
  for (const r of sliders) r.value = $(r.dataset.sync).value;
}
for (const r of sliders) {
  r.addEventListener("input", () => { $(r.dataset.sync).value = r.value; });
}

/* ---------- motion helpers ---------- */
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
function tween(ms, onFrame, key) {
  cancelAnimationFrame(tween[key]);
  if (reduceMotion.matches || ms <= 0) { onFrame(1); return; }
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    onFrame(easeOut(t));
    if (t < 1) tween[key] = requestAnimationFrame(step);
  };
  tween[key] = requestAnimationFrame(step);
}

let shownPass = 0;
function animatePass(to) {
  const from = shownPass;
  shownPass = to;
  const el = $("pass-pct");
  tween(Math.min(900, 250 + Math.abs(to - from) * 1200), (k) => {
    el.innerHTML = `${Math.round((from + (to - from) * k) * 100)}<small>%</small>`;
  }, "pass");
  el.dataset.tone = to >= 0.6 ? "good" : to >= 0.35 ? "mid" : "bad";
  if (!reduceMotion.matches && Math.round(from * 100) !== Math.round(to * 100)) {
    el.classList.remove("bump");
    void el.offsetWidth; // restart the CSS animation
    el.classList.add("bump");
  }
}

function runOdds(animate = false) {
  document.body.classList.toggle("replay", animate);
  writeHash();
  syncSliders();
  const opts = readOdds();
  $("plan-hint").textContent = planHint(opts.plan);
  let res;
  try {
    res = simulate({ ...opts, keepPaths: 50 });
  } catch (e) {
    $("odds-error").textContent = e.message;
    $("odds-error").hidden = false;
    return;
  }
  $("odds-error").hidden = true;
  lastResult = res;
  renderHero(res);
  if (animate) tween(1400, (k) => drawPaths(res, k), "paths");
  else { cancelAnimationFrame(tween.paths); drawPaths(res, 1); }
  renderTips(opts, res);
  renderPlans(opts);
  drawCard($("card-preview"), res, { siteUrl: siteUrl() });
}

function renderHero(r) {
  const p = r.probability;
  const o = r.options;
  const passLabel = `chance to pass within ${o.days} days`;
  animatePass(p.pass);
  $("pass-label").textContent = passLabel;
  $("oddsbar-pct").textContent = pct(p.pass);
  $("oddsbar-label").textContent = `to pass in ${o.days} days`;
  const rd = r.room.lossesToDailyBreach;
  $("risk-hint").textContent = `${money(o.riskPct * o.startBalance)} a trade · ` +
    (rd == null ? `${r.room.lossesToMaxDDBreach} losers in a row end the challenge` : `${rd} losers in one day end the challenge`);
  const parts = [
    ["Passed", p.pass, "--pass"],
    ["Daily loss breach", p.dll, "--dll"],
    ["Max drawdown breach", p.maxdd, "--maxdd"],
    [`Still going at day ${o.days}`, p.open, "--open"],
  ];
  // Reuse the bar segments so width changes glide instead of jumping.
  const bar = $("stackbar");
  if (bar.children.length !== parts.length) {
    bar.innerHTML = parts.map(([, , c]) => `<span style="width:0;background:var(${c})"></span>`).join("");
    void bar.offsetWidth;
  }
  parts.forEach(([, v], i) => { bar.children[i].style.width = `${v * 100}%`; });
  $("legend").innerHTML = parts
    .filter(([label, v]) => v > 0 || label === "Passed")
    .map(([label, v, c]) => `<li><i style="background:var(${c})"></i>${label} <b>${pct(v, v > 0 && v < 0.01 ? 1 : 0)}</b></li>`)
    .join("");
  $("verdict").textContent = verdict(r);

  const rm = r.room;
  const s = [
    ["Edge per trade", `${r.expectancyR >= 0 ? "+" : ""}${num(r.expectancyR)}R`, `about ${money(r.expectancyR * o.riskPct * o.startBalance)} a trade on average`],
    ["Typical days to pass", r.passDays.median ?? "–", r.passDays.count ? `most passes land in days ${r.passDays.p25}–${r.passDays.p75}` : "no passes in this window"],
    badDay(rm, o),
    ["Bad run that ends it", `${rm.lossesToMaxDDBreach} losers`, "in a row from the start hit the floor"],
    ["Clean run to pass", Number.isFinite(rm.winnersToTarget) ? `${rm.winnersToTarget} winners` : "never", "in a row reach the target"],
  ];
  $("stats").innerHTML = s.map(([k, v, sub]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`).join("");

  const warns = [];
  if (rm.singleLossBreachesDaily) warns.push("One full loss at this risk reaches the daily loss limit. A single bad trade ends the challenge.");
  else if (rm.lossesToDailyBreach != null && rm.lossesToDailyBreach <= 2) warns.push(`Two losers in a row hit the daily loss limit at this risk.`);
  if (o.avgWinR <= o.costR) warns.push("Your costs are as big as your average win, so winners add nothing.");
  if (p.open > 0.2) warns.push(`${pct(p.open)} of runs are still going after ${o.days} days. There's no time limit, so try more days.`);
  $("room-warn").hidden = !warns.length;
  $("room-warn").innerHTML = warns.join("<br>");
}

function badDay(rm, o) {
  const k = "Bad day that ends it";
  if (rm.lossesToDailyBreach == null) return [k, "none", "no daily loss limit on this plan"];
  const n = rm.lossesToDailyBreach;
  const byOwnStop = o.maxLossesPerDay && o.maxLossesPerDay < o.tradesPerDay;
  const maxLossesInDay = byOwnStop ? o.maxLossesPerDay : o.tradesPerDay;
  if (maxLossesInDay < n) {
    const why = byOwnStop
      ? `you stop after ${maxLossesInDay} loss${maxLossesInDay > 1 ? "es" : ""}`
      : `you take ${maxLossesInDay} trade${maxLossesInDay > 1 ? "s" : ""} a day`;
    return [k, "None", `it takes ${n} losers; ${why}`];
  }
  return [k, `${n} losers`, "in a single day hit the daily limit"];
}

function verdict(r) {
  const p = r.probability;
  const o = r.options;
  const lines = [];
  if (r.expectancyR <= 0) {
    lines.push(`These stats lose ${num(-r.expectancyR)}R a trade on average. No plan can fix that; the rules only decide how fast the account runs out.`);
  } else if (p.pass >= 0.6) lines.push("Strong odds. Your edge survives these rules most of the time.");
  else if (p.pass >= 0.35) lines.push("Close to a coin flip. The small changes below move it a lot.");
  else if (p.fail < 0.2) lines.push("Safe but slow: few runs fail, most just haven't reached the target yet. Look further ahead or trade a bit bigger.");
  else lines.push("Long odds as you trade now. See what would change them below.");
  const fail = p.dll + p.maxdd;
  if (fail > 0.05) {
    if (o.plan.dll == null || p.maxdd > p.dll) lines.push(`When it goes wrong, it's a slow bleed to the drawdown floor (${pct(p.maxdd)} of runs).`);
    else lines.push(`When it goes wrong, it's one bad day hitting the daily loss limit (${pct(p.dll)} of runs).`);
  }
  return lines.join(" ");
}

function drawPaths(r, progress = 1) {
  const cv = $("paths");
  if (!cv.offsetWidth) return; // tab hidden
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const o = r.options, S = o.startBalance;
  const target = S * (1 + o.plan.target), floor = S * (1 - o.plan.maxDD);
  let lo = floor, hi = target;
  for (const p of r.paths) for (const e of p.equity) { if (e < lo) lo = e; if (e > hi) hi = e; }
  const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const L = 58, R = 10, T = 10, B = 24;
  const X = (d) => L + (d / o.days) * (W - L - R);
  const Y = (e) => T + (1 - (e - lo) / (hi - lo)) * (H - T - B);

  ctx.font = `12px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillStyle = css("--muted");
  ctx.textBaseline = "middle";
  const line = (y, color, label, dash, labelColor = color) => {
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(L, Y(y)); ctx.lineTo(W - R, Y(y)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = labelColor; ctx.textAlign = "right"; ctx.fillText(label, L - 6, Y(y));
  };
  line(S, css("--border"), "start", [], css("--muted"));

  const colors = { pass: css("--pass"), dll: css("--dll"), maxdd: css("--maxdd"), open: css("--open") };
  const counts = { pass: 0, dll: 0, maxdd: 0, open: 0 };
  ctx.lineWidth = 1.25;
  ctx.globalAlpha = 0.55;
  const cutoff = progress * o.days;
  const ends = [];
  for (const p of r.paths) {
    counts[p.outcome]++;
    ctx.strokeStyle = colors[p.outcome];
    ctx.beginPath();
    let prev = null;
    for (let i = 0; i < p.equity.length; i++) {
      // the last point of a finished run sits on its end day
      const d = i === p.equity.length - 1 && p.outcome !== "open" ? p.endDay : i;
      const e = p.equity[i];
      if (d > cutoff && prev) {
        const f = (cutoff - prev[0]) / (d - prev[0] || 1);
        ctx.lineTo(X(cutoff), Y(prev[1] + (e - prev[1]) * f));
        break;
      }
      prev ? ctx.lineTo(X(d), Y(e)) : ctx.moveTo(X(d), Y(e));
      prev = [d, e];
      if (i === p.equity.length - 1 && p.outcome !== "open") ends.push([X(d), Y(e), colors[p.outcome]]);
    }
    ctx.stroke();
  }
  // a dot where each run finished (passed or breached)
  ctx.globalAlpha = 0.9;
  for (const [x, y, c] of ends) {
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  line(target, colors.pass, "target", [6, 4]);
  line(floor, colors.maxdd, "floor", [6, 4]);

  ctx.fillStyle = css("--muted"); ctx.textBaseline = "alphabetic";
  [[0, "left"], [Math.round(o.days / 2), "center"], [o.days, "right"]].forEach(([d, align]) => {
    ctx.textAlign = align;
    ctx.fillText(`day ${d}`, X(d), H - 6);
  });

  $("paths-legend").textContent =
    `Green passed (${counts.pass}), orange hit the daily loss limit (${counts.dll}), red hit max drawdown (${counts.maxdd}), grey still going (${counts.open}). Dashed lines: profit target and drawdown floor.`;
}

function renderTips(opts, base) {
  const variants = [];
  const rm = base.room;
  if (opts.riskPct > 0.001) variants.push([`Risk ${num(opts.riskPct * 50)}% a trade instead of ${num(opts.riskPct * 100)}%`, { riskPct: opts.riskPct / 2 }]);
  variants.push([`Risk ${num(opts.riskPct * 150)}% a trade`, { riskPct: opts.riskPct * 1.5 }]);
  if (!opts.maxLossesPerDay && rm.lossesToDailyBreach && rm.lossesToDailyBreach > 1 && opts.tradesPerDay >= rm.lossesToDailyBreach) {
    const n = rm.lossesToDailyBreach - 1;
    variants.push([`Stop for the day after ${n} loss${n > 1 ? "es" : ""}`, { maxLossesPerDay: n }]);
  }
  if (opts.winRate <= 0.95) variants.push([`Win 5 more trades in 100 (${Math.round(opts.winRate * 100 + 5)}%)`, { winRate: opts.winRate + 0.05 }]);
  if (opts.costR >= 0.02) variants.push([`Halve your costs (better fills, fewer fees)`, { costR: opts.costR / 2 }]);
  if (opts.tradesPerDay > 1) variants.push([`Take ${opts.tradesPerDay - 1} trade${opts.tradesPerDay - 1 > 1 ? "s" : ""} a day`, { tradesPerDay: opts.tradesPerDay - 1 }]);

  const rows = variants.map(([label, change]) => {
    const r = simulate({ ...opts, ...change, runs: 4000 });
    return {
      label,
      passPts: Math.round((r.probability.pass - base.probability.pass) * 100),
      failPts: Math.round((r.probability.fail - base.probability.fail) * 100),
      pass: r.probability.pass,
      fail: r.probability.fail,
    };
  }).sort((a, b) => (b.passPts - b.failPts) - (a.passPts - a.failPts));

  const sign = (n) => (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n);
  $("tips").innerHTML = rows.map(({ label, passPts, failPts, pass, fail }) => {
    const passCls = passPts > 0 ? "delta-up" : passPts < 0 ? "delta-down" : "muted";
    const failCls = failPts < 0 ? "delta-up" : failPts > 0 ? "delta-down" : "muted";
    return `<li><span>${label}</span><span class="small"><span class="${passCls}">pass ${pct(pass)} (${sign(passPts)})</span> · <span class="${failCls}">fail ${pct(fail)} (${sign(failPts)})</span></span></li>`;
  }).join("");
  const slow = rows.some((r) => r.passPts < 0 && r.failPts < 0);
  $("tips-note").textContent = slow
    ? `Changes that lower both numbers make you slower, not worse: fewer failures, but more runs still going at day ${opts.days}. There's no time limit, so a slower pass still counts.`
    : "";
}

function renderPlans(opts) {
  const ranked = rankPlans({ ...opts, runs: 6000 });
  const bestId = ranked[0].plan.id;
  $("plans-table").tBodies[0].innerHTML = ranked.map(({ plan, result }) => {
    const p = result.probability;
    const cls = [plan.id === bestId ? "best" : "", plan.id === opts.plan.id ? "current" : ""].join(" ");
    return `<tr class="${cls}"><td>${plan.name}</td><td class="num">${pct(plan.target)}</td><td class="num">${plan.dll == null ? "none" : pct(plan.dll)}</td><td class="num">${pct(plan.maxDD)}</td><td class="num">${pct(p.pass)}</td><td class="num">${pct(p.fail)}</td><td class="num">${result.passDays.median ?? "–"}</td></tr>`;
  }).join("");
  const best = ranked[0];
  $("plans-note").textContent = best.plan.id === opts.plan.id
    ? `Your plan is already the best fit for these stats. Prices differ between plans; check them on the site.`
    : `${best.plan.name} gives these stats the best odds. Prices differ between plans; check them on the site.`;
}

/* ---------- share ---------- */
function siteUrl() {
  return /^https?:$/.test(location.protocol) ? location.origin + location.pathname : "";
}
function shareText() {
  const r = lastResult;
  if (!r) return "";
  return `I ran my stats through 10,000 simulated ${r.options.plan.name} challenges: ${pct(r.probability.pass)} chance to pass within ${r.options.days} days. What are your odds?`;
}
$("dl-card").addEventListener("click", () => {
  $("card-preview").toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pass-odds.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, "image/png");
});
$("copy-link").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    $("share-status").textContent = "Link copied. It opens with these exact stats.";
  } catch {
    $("share-status").textContent = "Couldn't copy. Copy the address bar instead.";
  }
});
$("post-x").addEventListener("click", () => {
  const u = new URL("https://x.com/intent/post");
  u.searchParams.set("text", shareText());
  if (siteUrl()) u.searchParams.set("url", location.href);
  window.open(u.toString(), "_blank", "noopener");
});

/* ---------- wire odds ---------- */
loadFromHash();
$("odds-form").addEventListener("input", schedule);
$("odds-form").addEventListener("submit", (e) => e.preventDefault());
for (const b of document.querySelectorAll("[data-preset]")) {
  b.addEventListener("click", () => {
    for (const [k, v] of Object.entries(PRESETS[b.dataset.preset])) $(k).value = v;
    for (const x of document.querySelectorAll("[data-preset]")) x.classList.toggle("active", x === b);
    clearTimeout(timer);
    runOdds(true);
  });
}
$("plan").addEventListener("change", () => { clearTimeout(timer); runOdds(true); });
window.addEventListener("resize", () => lastResult && drawPaths(lastResult));

// First impression: let the page settle in, then count up and draw the runs.
requestAnimationFrame(() => setTimeout(() => runOdds(true), reduceMotion.matches ? 0 : 350));

// Reveal panels as they scroll into view.
const revealer = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); revealer.unobserve(e.target); }
}, { rootMargin: "0px 0px -8% 0px" });
document.querySelectorAll(".panel").forEach((el, i) => {
  el.classList.add("reveal");
  el.style.setProperty("--d", `${Math.min(i, 4) * 70}ms`);
  revealer.observe(el);
});

/* mobile odds pill: visible while the results panel is off screen */
let resultsVisible = true;
function updateOddsbar() {
  $("oddsbar").hidden = resultsVisible || $("view-odds").hidden;
}
new IntersectionObserver(([e]) => { resultsVisible = e.isIntersecting; updateOddsbar(); }).observe($("results"));
for (const [t] of tabs) $(t).addEventListener("click", updateOddsbar);

/* ================= POSITION SIZER ================= */
let markets = [];
const marketById = (id) => markets.find((m) => m.market_id === id);
const PROVIDER_NAMES = { binance: "Crypto (Binance)", hyperliquid: "Stocks & more (Hyperliquid)", veranta: "Forex & more (Veranta)", ostium: "Ostium" };

async function loadMarkets() {
  try {
    const res = await fetch("data/markets.json", { cache: "no-cache" });
    const doc = await res.json();
    markets = doc.markets;
    $("markets-date").textContent = `updated ${doc.fetched_at.slice(0, 10)}`;
  } catch {
    $("market-hint").textContent = "Couldn't load the market list.";
    return;
  }
  const sel = $("market");
  const groups = {};
  for (const m of markets) (groups[m.provider] ||= []).push(m);
  for (const [prov, list] of Object.entries(groups)) {
    const og = document.createElement("optgroup");
    og.label = PROVIDER_NAMES[prov] || prov;
    for (const m of list) og.append(new Option(`${m.symbol} · ${m.max_leverage}x max`, m.market_id));
    sel.append(og);
  }
  const btc = markets.find((m) => m.market_id === "binance|BTCUSDT");
  if (btc) sel.value = btc.market_id;
  onMarket();
}

function onMarket() {
  const m = marketById($("market").value);
  if (!m) return;
  $("market-hint").textContent = `Max leverage ${m.max_leverage}x · min order $${m.min_notional} · size step ${m.size_step}`;
  const live = priceSupported(m);
  $("live-price").disabled = !live;
  $("atr-stop").disabled = !live;
  $("price-status").textContent = live ? "" : "No free price feed for this venue. Type the prices in.";
  $("s-entry").value = "";
  $("s-stop").value = "";
  if (live) getLivePrice();
  else renderSize();
}

async function getLivePrice() {
  const m = marketById($("market").value);
  if (!m) return;
  $("live-price").disabled = true;
  $("price-status").textContent = "Getting price…";
  try {
    const { price, source } = await fetchPrice(m);
    $("s-entry").value = price;
    $("price-status").textContent = `${source} price at ${new Date().toLocaleTimeString()}. It can differ slightly from the firm's mark.`;
  } catch (e) {
    $("price-status").textContent = `Couldn't get a price: ${e.message}`;
  } finally {
    $("live-price").disabled = !priceSupported(m);
    renderSize();
  }
}

async function atrStop() {
  const m = marketById($("market").value);
  const entry = Number($("s-entry").value);
  if (!m || !(entry > 0)) { $("price-status").textContent = "Enter an entry price first."; return; }
  $("atr-stop").disabled = true;
  $("price-status").textContent = "Reading 1-hour candles…";
  try {
    const a = atr(await fetchCandles(m), 14);
    if (!a) throw new Error("not enough candles");
    const short = Number($("s-stop").value) > entry;
    const stop = short ? entry + 1.5 * a : entry - 1.5 * a;
    $("s-stop").value = Number(stop.toPrecision(8));
    $("price-status").textContent = `1-hour ATR is ${num(a, 6)}. Stop set 1.5 ATR ${short ? "above" : "below"} the entry.`;
  } catch (e) {
    $("price-status").textContent = `Couldn't read candles: ${e.message}`;
  } finally {
    $("atr-stop").disabled = !priceSupported(m);
    renderSize();
  }
}

function renderSize() {
  const m = marketById($("market").value);
  const v = (id) => Number($(id).value);
  const plan = planById($("s-plan").value);
  const start = v("s-start"), equity = v("s-equity");
  const dailyRoom = plan.dll == null ? Infinity : Math.max(0, plan.dll * start - v("s-lost"));
  const ddRoom = Math.max(0, equity - start * (1 - plan.maxDD));
  const out = $("size-out");

  if (!(v("s-entry") > 0) || !(v("s-stop") > 0)) {
    out.innerHTML = `<p class="muted">Enter an entry and a stop to size the trade.</p>${roomHtml(plan, dailyRoom, ddRoom)}`;
    return;
  }
  const s = sizePosition({ equity, riskUsd: v("s-risk"), entry: v("s-entry"), stop: v("s-stop"), market: m, dailyRoomUsd: dailyRoom, ddRoomUsd: ddRoom });
  if (!s.ok) {
    out.innerHTML = `<div class="err">${s.errors.join("<br>")}</div>${roomHtml(plan, dailyRoom, ddRoom)}`;
    return;
  }
  const dec = m.size_decimals ?? 4;
  out.innerHTML = `
    <div class="muted small">${s.side === "long" ? "Long" : "Short"} ${m.symbol}</div>
    <div class="bigline">${s.qty.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })} <span class="unit">${m.symbol}</span></div>
    <div class="stats">
      <div class="stat"><div class="k">Loss at stop</div><div class="v">${money(s.lossAtStop, 2)}</div><div class="s">limited by ${s.limitedBy}</div></div>
      <div class="stat"><div class="k">Position value</div><div class="v">${money(s.notional)}</div><div class="s">${num(s.leverage)}x of ${s.maxLeverage}x max</div></div>
      <div class="stat"><div class="k">Stop distance</div><div class="v">${pct(s.stopPct, 2)}</div><div class="s">${num(s.stopDist, 6)} per ${m.symbol}</div></div>
      <div class="stat"><div class="k">Losses like this until the daily limit</div><div class="v">${s.lossesUntilDaily ?? "no limit"}</div><div class="s">${plan.name}</div></div>
    </div>
    ${s.warnings.map((w) => `<div class="warn">${w}</div>`).join("")}
    ${roomHtml(plan, dailyRoom, ddRoom)}
    <p class="small muted">Copy the size into the order ticket yourself. This tool never places orders.</p>`;
}

function roomHtml(plan, dailyRoom, ddRoom) {
  return `<h3>Room left today</h3><p class="small">Daily loss limit: <b>${Number.isFinite(dailyRoom) ? money(dailyRoom) : "none on this plan"}</b> · Above the drawdown floor: <b>${money(ddRoom)}</b></p>`;
}

$("market").addEventListener("change", onMarket);
$("live-price").addEventListener("click", getLivePrice);
$("atr-stop").addEventListener("click", atrStop);
$("size-form").addEventListener("input", (e) => { if (e.target.id !== "market") renderSize(); });
$("size-form").addEventListener("submit", (e) => e.preventDefault());
$("s-plan").addEventListener("change", renderSize);
loadMarkets();
