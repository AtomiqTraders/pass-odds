import { PLANS, RULES_SOURCE, RULES_AS_OF, SIZES } from "./sim.js";
import { sizePosition, atr } from "./sizer.js";
import { fetchPrice, fetchCandles, priceSupported } from "./market.js";
import { drawCard } from "./card.js";

const $ = (id) => document.getElementById(id);
const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
const money = (x, d = 0) => "$" + Number(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const num = (x, d = 2) => Number(x).toLocaleString("en-US", { maximumFractionDigits: d });
/** Escape text before it goes into innerHTML. Every non-constant value passes through this. */
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
  themeLabel();
  if (lastResult) { drawPaths(lastResult); }
});

function themeLabel() {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  $("theme").textContent = dark ? "Day edition" : "Night edition";
}
themeLabel();

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

/* ---------- plan + size selects ---------- */
for (const p of PLANS) {
  $("s-plan").add(new Option(p.name, p.id));
  $("view-plan").add(new Option(p.name, p.id));
}
for (const s of SIZES) $("view-size").add(new Option(sizeName(s), String(s)));
const planById = (id) => PLANS.find((p) => p.id === id) || PLANS[0];
function sizeName(s) { return s >= 1000 ? `$${s / 1000}K` : money(s); }
function ruleLine(p, b) {
  const amt = (x) => (b ? ` (${money(x * b)})` : "");
  return `Make ${pct(p.target)}${amt(p.target)} to pass. ` +
    (p.dll == null ? "No daily loss limit. " : `Lose ${pct(p.dll)}${amt(p.dll)} in a day and you're out. `) +
    `Fall ${pct(p.maxDD)}${amt(p.maxDD)} below the start and you're out.`;
}

/* ---------- odds form <-> URL ---------- */
const FIELDS = {
  wr: "winRate", rk: "riskPct", ru: "riskUsd", aw: "avgWinR", al: "avgLossR",
  tpd: "tradesPerDay", stop: "maxLossesPerDay", c: "costR", d: "days",
};
const PRESETS = {
  scalper: { winRate: 55, avgWinR: 1.2, avgLossR: 1, riskPct: 0.25, tradesPerDay: 8, maxLossesPerDay: 0, costR: 0.1 },
  swing:   { winRate: 40, avgWinR: 3, avgLossR: 1, riskPct: 0.75, tradesPerDay: 1, maxLossesPerDay: 0, costR: 0.03 },
  yolo:    { winRate: 45, avgWinR: 2, avgLossR: 1, riskPct: 2, tradesPerDay: 4, maxLossesPerDay: 0, costR: 0.05 },
};
const unit = () => document.querySelector("input[name=unit]:checked").value;
const sizeBoxes = () => [...document.querySelectorAll("#sizes input")];

function loadFromHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  for (const [k, id] of Object.entries(FIELDS)) {
    const v = q.get(k);
    if (v == null || v === "" || !Number.isFinite(Number(v))) continue;
    const el = $(id);
    const lo = el.min === "" ? -Infinity : Number(el.min), hi = el.max === "" ? Infinity : Number(el.max);
    el.value = String(Math.min(hi, Math.max(lo, Number(v))));
  }
  if (q.get("u") === "usd") document.querySelector("input[name=unit][value=usd]").checked = true;
  if (q.get("sz")) {
    const want = q.get("sz").split(",");
    for (const b of sizeBoxes()) b.checked = want.includes(b.value);
  }
  if (PLANS.some((p) => p.id === q.get("vp"))) $("view-plan").value = q.get("vp");
  if (SIZES.map(String).includes(q.get("vs"))) $("view-size").value = q.get("vs");
  applyUnit();
}
function writeHash() {
  const q = new URLSearchParams();
  for (const [k, id] of Object.entries(FIELDS)) q.set(k, $(id).value);
  q.set("u", unit());
  q.set("sz", sizeBoxes().filter((b) => b.checked).map((b) => b.value).join(","));
  if ($("view-plan").value !== "auto") q.set("vp", $("view-plan").value);
  if ($("view-size").value !== "auto") q.set("vs", $("view-size").value);
  history.replaceState(null, "", "#" + q.toString());
}
function applyUnit() {
  const usd = unit() === "usd";
  $("risk-pct-field").hidden = usd;
  $("risk-usd-field").hidden = !usd;
}

/** The strategy: everything about how you trade, nothing about which account. */
function readStrategy() {
  const v = (id) => Number($(id).value);
  return {
    unit: unit(),
    riskPct: v("riskPct") / 100,
    riskUsd: v("riskUsd"),
    sizes: sizeBoxes().filter((b) => b.checked).map((b) => Number(b.value)),
    winRate: v("winRate") / 100,
    avgWinR: v("avgWinR"),
    avgLossR: v("avgLossR"),
    tradesPerDay: v("tradesPerDay"),
    maxLossesPerDay: v("maxLossesPerDay"),
    costR: v("costR"),
    days: v("days"),
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

/* ---------- compute in a worker so sliders stay smooth ---------- */
let worker = null;
try {
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
} catch { worker = null; }
let reqId = 0;
const pending = new Map();
if (worker) {
  worker.onmessage = (e) => {
    const cb = pending.get(e.data.id);
    pending.delete(e.data.id);
    if (cb) cb(e.data);
  };
  worker.onerror = () => { worker = null; };
}
function compute(input) {
  if (!worker) {
    return import("./engine.js").then(({ analyze }) => {
      try { return { out: analyze(input) }; } catch (err) { return { error: err.message }; }
    });
  }
  const id = ++reqId;
  return new Promise((resolve) => { pending.set(id, resolve); worker.postMessage({ id, input }); });
}

// Canvas text only uses web fonts once they're loaded, so wait for the faces the card uses.
const cardFonts = Promise.all(
  ['400 40px "Instrument Serif"', 'italic 400 40px "Instrument Serif"', '400 20px "IBM Plex Sans"', '600 20px "IBM Plex Sans"']
    .map((f) => document.fonts.load(f).catch(() => null)),
).catch(() => null);

let latest = 0;
let lastRec = null;
async function runOdds(animate = false) {
  writeHash();
  syncSliders();
  applyUnit();
  const ticket = ++latest;
  $("results").classList.add("busy");
  const msg = await compute({ strategy: readStrategy(), viewPlan: $("view-plan").value, viewSize: $("view-size").value });
  if (ticket !== latest) return; // a newer change is on its way
  $("results").classList.remove("busy");
  if (msg.error) {
    $("odds-error").textContent = msg.error;
    $("odds-error").hidden = false;
    return;
  }
  $("odds-error").hidden = true;
  const { rec, view, result: res, tips } = msg.out;
  document.body.classList.toggle("replay", animate);
  lastResult = res;
  lastRec = { rec, view };
  renderPick(rec, view, res, animate);
  renderHero(res);
  if (animate) tween(1400, (k) => drawPaths(res, k), "paths");
  else { cancelAnimationFrame(tween.paths); drawPaths(res, 1); }
  renderTips(tips, res.options);
  renderRanking(rec, view);
  cardFonts.then(() => drawCard($("card-preview"), res, { siteUrl: siteUrl(), isBest: view.isBest, sizeMatters: rec.sizeMatters }));
}

const acctName = (rec, c) => (rec.sizeMatters ? `${c.plan.name} · ${sizeName(c.size)}` : c.plan.name);
function renderPick(rec, view, res, animate) {
  const best = rec.ranked[0];
  const name = (c) => acctName(rec, c);
  $("pick-k").textContent = view.isBest ? "Our pick for how you trade" : "You're comparing";
  $("pick-name").textContent = name(view);
  $("pick").classList.toggle("is-best", view.isBest);
  const n = rec.ranked.length;
  const runner = rec.ranked[1];
  let why;
  if (view.isBest) {
    const same = (a, b) => Math.round(a * 100) === Math.round(b * 100);
    why = `#1 of ${n} ${rec.sizeMatters ? "accounts" : "plans"} for your strategy`;
    if (!runner) why += ".";
    else if (!same(best.pass, runner.pass)) why += `, ahead of ${name(runner)} (${pct(best.pass)} vs ${pct(runner.pass)} chance to pass).`;
    else if (!same(best.fail, runner.fail)) why += `. Same pass chance as ${name(runner)}, but fewer breaches.`;
    else if ((best.median ?? 0) !== (runner.median ?? 0)) why += `. Same odds as ${name(runner)}, but a faster pass.`;
    else why += `. ${name(runner)} is just as good for you, so pick whichever is cheaper.`;
    if (!rec.sizeMatters) why += " You risk a % of the account, so every size has the same odds: buy the size that fits your budget.";
  } else {
    const gap = Math.round((best.pass - res.probability.pass) * 100);
    why = `Our pick is ${name(best)}` + (gap > 0 ? `, about ${gap} points more likely to pass.` : "; this one is about as good.");
  }
  $("pick-why").textContent = `${why} ${ruleLine(view.plan, view.size)}`;
  if (animate && !reduceMotion.matches) {
    const el = $("pick-name");
    el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop");
  }
}

function renderHero(r) {
  const p = r.probability;
  const o = r.options;
  const noLimit = o.days >= 365;
  const passLabel = noLimit ? "chance to pass (no time limit)" : `chance to pass within ${o.days} days`;
  animatePass(p.pass);
  $("pass-label").textContent = passLabel;
  $("oddsbar-pct").textContent = pct(p.pass);
  $("oddsbar-label").textContent = noLimit ? "to pass" : `to pass in ${o.days} days`;
  const rd = r.room.lossesToDailyBreach;
  const riskText = unit() === "usd"
    ? `${num(o.riskPct * 100)}% of a ${sizeName(o.startBalance)} account`
    : `${money(o.riskPct * o.startBalance)} on a ${sizeName(o.startBalance)} account`;
  $("risk-hint").textContent = `${riskText} · ` +
    (rd == null ? `${r.room.lossesToMaxDDBreach} losers in a row end the ${o.plan.name} challenge` : `${rd} losers in one day end the ${o.plan.name} challenge`);
  $("view-size").hidden = !(lastRec && lastRec.rec.sizeMatters);
  const parts = [
    ["Passed", p.pass, "pass"],
    ["Hit the daily loss limit", p.dll, "dll"],
    ["Hit max drawdown", p.maxdd, "maxdd"],
    [noLimit ? "Still going after a year" : `Still going at day ${o.days}`, p.open, "open"],
  ];
  // The bar segments live in the HTML; only their widths change, so they glide.
  const bar = $("stackbar");
  parts.forEach(([, v], i) => { bar.children[i].style.width = `${v * 100}%`; });
  $("legend").innerHTML = parts
    .filter(([label, v]) => v > 0 || label === "Passed")
    .map(([label, v, k]) => `<li><i class="k-${k}"></i>${esc(label)}<b>${pct(v, v > 0 && v < 0.01 ? 1 : 0)}</b></li>`)
    .join("");
  $("price").textContent = fairPrice(p.pass);
  $("price").title = "The same odds written the way a bookmaker would.";
  $("verdict").textContent = verdict(r);

  const rm = r.room;
  const s = [
    ["Edge per trade", `${r.expectancyR >= 0 ? "+" : ""}${num(r.expectancyR)}R`, `about ${money(r.expectancyR * o.riskPct * o.startBalance)} a trade on average`],
    ["Typical days to pass", r.passDays.median ?? "–", r.passDays.count ? `most passes land in days ${r.passDays.p25}–${r.passDays.p75}` : "no passes in this window"],
    badDay(rm, o),
    ["Bad run that ends it", `${rm.lossesToMaxDDBreach} losers`, "in a row from the start hit the floor"],
    ["Clean run to pass", Number.isFinite(rm.winnersToTarget) ? `${rm.winnersToTarget} winners` : "never", "in a row reach the target"],
  ];
  $("stats").innerHTML = s.map(([k, v, sub]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd><div class="s">${esc(sub)}</div></div>`).join("");

  const warns = [];
  if (rm.singleLossBreachesDaily) warns.push("One full loss at this risk reaches the daily loss limit. A single bad trade ends the challenge.");
  else if (rm.lossesToDailyBreach != null && rm.lossesToDailyBreach <= 2) warns.push(`Two losers in a row hit the daily loss limit at this risk.`);
  if (o.avgWinR <= o.costR) warns.push("Your costs are as big as your average win, so winners add nothing.");
  if (p.open > 0.2) warns.push(`${pct(p.open)} of runs are still going after ${o.days} days. There's no time limit, so try more days.`);
  $("room-warn").hidden = !warns.length;
  $("room-warn").innerHTML = warns.map(esc).join("<br>");
}

const PRICES = ["1/100","1/50","1/33","1/25","1/20","1/16","1/12","1/10","1/8","1/6","1/5","2/9","1/4","2/7","1/3","2/5","4/9","1/2","4/7","4/6","4/5","10/11","evens","11/10","5/4","6/4","7/4","2/1","5/2","3/1","7/2","4/1","5/1","6/1","8/1","10/1","12/1","16/1","20/1","25/1","33/1","50/1","100/1"];
function fairPrice(pass) {
  if (pass >= 0.995) return "Fair price: a near certainty";
  if (pass <= 0.005) return "Fair price: no chance";
  const against = (1 - pass) / pass;
  let best = PRICES[0], gap = Infinity;
  for (const f of PRICES) {
    const v = f === "evens" ? 1 : f.split("/").reduce((a, b) => a / b);
    const g = Math.abs(Math.log(v) - Math.log(against));
    if (g < gap) { gap = g; best = f; }
  }
  return `Fair price: ${best}${best === "evens" ? "" : against < 1 ? " on" : " against"}`;
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
  // Zoom the x axis to where the runs actually end, so a 365-day window isn't mostly empty.
  let xMax = 0;
  for (const p of r.paths) xMax = Math.max(xMax, p.outcome === "open" ? o.days : p.endDay);
  xMax = Math.max(5, Math.min(o.days, Math.ceil(xMax * 1.05)));
  const X = (d) => L + (Math.min(d, xMax) / xMax) * (W - L - R);
  const Y = (e) => T + (1 - (e - lo) / (hi - lo)) * (H - T - B);

  ctx.font = `12px "IBM Plex Sans", Arial, sans-serif`;
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
  const cutoff = progress * xMax;
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
  [[0, "left"], [Math.round(xMax / 2), "center"], [xMax, "right"]].forEach(([d, align]) => {
    ctx.textAlign = align;
    ctx.fillText(`day ${d}`, X(d), H - 6);
  });

  $("paths-legend").textContent =
    `Green passed (${counts.pass}), orange hit the daily loss limit (${counts.dll}), red hit max drawdown (${counts.maxdd}), grey still going (${counts.open}). Dashed lines: profit target and drawdown floor.`;
}

function renderTips(rows, opts) {
  const sign = (n) => (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n);
  $("tips").innerHTML = rows.map(({ label, passPts, failPts, pass, fail, dayDelta }) => {
    const passCls = passPts > 0 ? "up" : passPts < 0 ? "down" : "muted";
    const failCls = failPts < 0 ? "up" : failPts > 0 ? "down" : "muted";
    const speed = dayDelta == null || Math.abs(dayDelta) < 2 ? ""
      : ` · <span class="${dayDelta < 0 ? "up" : "down"}">${Math.abs(dayDelta)}d ${dayDelta < 0 ? "faster" : "slower"}</span>`;
    return `<li><span class="what">${esc(label)}</span><span class="fx"><span class="${passCls}">pass ${pct(pass)} (${sign(passPts)})</span> · <span class="${failCls}">breach ${pct(fail)} (${sign(failPts)})</span>${speed}</span></li>`;
  }).join("");
  const slow = rows.some((r) => r.passPts < 0 && r.failPts < 0);
  $("tips-note").textContent = slow
    ? (opts.days >= 365 ? "Changes that lower both numbers mostly make you slower: fewer failures, more runs still going after a year." : `Changes that lower both numbers make you slower, not worse: fewer failures, but more runs still going at day ${opts.days}.`)
    : "";
}

function renderRanking(rec, view) {
  const label = (c) => acctName(rec, c);
  $("plans-table").tBodies[0].innerHTML = rec.ranked.map((c, i) => {
    const p = c;
    const isView = c.plan.id === view.plan.id && (!rec.sizeMatters || c.size === view.size);
    const cls = [i === 0 ? "best" : "", isView && !view.isBest ? "current" : ""].join(" ");
    const key = `${c.plan.id}|${c.size}`;
    return `<tr class="${cls}" data-key="${esc(key)}" tabindex="0" title="Show this account"><td>${i + 1}</td><td>${esc(label(c))}</td><td class="r">${pct(c.plan.target)}</td><td class="r">${c.plan.dll == null ? "none" : pct(c.plan.dll)}</td><td class="r">${pct(c.plan.maxDD)}</td><td class="r">${pct(p.pass)}</td><td class="r">${pct(p.fail)}</td><td class="r">${c.median ?? "–"}</td></tr>`;
  }).join("");
  const notes = [];
  notes.push(rec.sizeMatters
    ? "You risk a fixed dollar amount, so a bigger account gives you more room."
    : "You risk a % of the account, so size doesn't change the odds.");
  if (rec.skipped) notes.push(`Left out ${rec.skipped} account${rec.skipped > 1 ? "s" : ""} where your dollar risk is half the account or more.`);
  notes.push("Prices differ between plans and sizes; check them on the site.");
  $("plans-note").textContent = notes.join(" ");
}
$("plans-table").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-key]");
  if (!tr || !lastRec) return;
  const [planId, size] = tr.dataset.key.split("|");
  const isBest = tr.classList.contains("best");
  $("view-plan").value = isBest ? "auto" : planId;
  $("view-size").value = isBest || !lastRec.rec.sizeMatters ? "auto" : size;
  clearTimeout(timer);
  runOdds(true);
  $("results").scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
});
$("plans-table").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.closest("tr[data-key]")?.click(); });

/* ---------- share ---------- */
function siteUrl() {
  return /^https?:$/.test(location.protocol) ? location.origin + location.pathname : "";
}
function shareText() {
  const r = lastResult;
  if (!r) return "";
  const acct = lastRec && lastRec.rec.sizeMatters ? `${r.options.plan.name} ${sizeName(r.options.startBalance)}` : r.options.plan.name;
  const when = r.options.days >= 365 ? "" : ` within ${r.options.days} days`;
  return lastRec && lastRec.view.isBest
    ? `Pass Odds says the best challenge for how I trade is ${acct}: ${pct(r.probability.pass)} chance to pass${when}. Which one fits yours?`
    : `I ran my strategy through 10,000 simulated ${acct} challenges: ${pct(r.probability.pass)} chance to pass${when}.`;
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
    document.querySelector("input[name=unit][value=pct]").checked = true;
    $("view-plan").value = "auto";
    $("view-size").value = "auto";
    for (const x of document.querySelectorAll("[data-preset]")) x.classList.toggle("active", x === b);
    clearTimeout(timer);
    runOdds(true);
  });
}
for (const id of ["view-plan", "view-size"]) $(id).addEventListener("change", () => { clearTimeout(timer); runOdds(true); });
for (const r of document.querySelectorAll("input[name=unit]")) r.addEventListener("change", () => { clearTimeout(timer); runOdds(true); });
$("sizes").addEventListener("change", () => { clearTimeout(timer); runOdds(true); });
window.addEventListener("resize", () => lastResult && drawPaths(lastResult));

// First impression: let the page settle in, then count up and draw the runs.
requestAnimationFrame(() => setTimeout(() => runOdds(true), reduceMotion.matches ? 0 : 350));

// Reveal panels as they scroll into view.
const revealer = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); revealer.unobserve(e.target); }
}, { rootMargin: "0px 0px -8% 0px" });
document.querySelectorAll(".sheet").forEach((el, i) => {
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
    out.innerHTML = `<div class="err">${s.errors.map(esc).join("<br>")}</div>${roomHtml(plan, dailyRoom, ddRoom)}`;
    return;
  }
  const dec = Number.isInteger(m.size_decimals) ? Math.min(12, Math.max(0, m.size_decimals)) : 4;
  const sym = esc(m.symbol);
  const item = (k, val, sub) => `<div><dt>${esc(k)}</dt><dd>${esc(val)}</dd><div class="s">${esc(sub)}</div></div>`;
  out.innerHTML = `
    <div class="side">${s.side === "long" ? "Long" : "Short"} ${sym}</div>
    <div class="bigline">${esc(s.qty.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }))}<span class="unit">${sym}</span></div>
    <dl class="stats">
      ${item("Loss at stop", money(s.lossAtStop, 2), `limited by ${s.limitedBy}`)}
      ${item("Position value", money(s.notional), `${num(s.leverage)}x of ${s.maxLeverage}x max`)}
      ${item("Stop distance", pct(s.stopPct, 2), `${num(s.stopDist, 6)} per ${m.symbol}`)}
      ${item("Losses like this to the daily limit", s.lossesUntilDaily ?? "no limit", plan.name)}
    </dl>
    ${s.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join("")}
    ${roomHtml(plan, dailyRoom, ddRoom)}
    <p class="small muted">Type the size into the order ticket yourself. This tool never places orders.</p>`;
}

function roomHtml(plan, dailyRoom, ddRoom) {
  return `<h3>Room left today</h3><p class="small">Daily loss limit: <b>${esc(Number.isFinite(dailyRoom) ? money(dailyRoom) : "none on this plan")}</b> · Above the drawdown floor: <b>${esc(money(ddRoom))}</b> · ${esc(plan.name)}</p>`;
}

$("market").addEventListener("change", onMarket);
$("live-price").addEventListener("click", getLivePrice);
$("atr-stop").addEventListener("click", atrStop);
$("size-form").addEventListener("input", (e) => { if (e.target.id !== "market") renderSize(); });
$("size-form").addEventListener("submit", (e) => e.preventDefault());
$("s-plan").addEventListener("change", renderSize);
loadMarkets();
