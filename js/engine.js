// Everything the "Find my account" view needs, computed in one pure call so it
// can run in a Web Worker (keeps sliders smooth) or directly as a fallback.
import { PLANS, simulate, recommend } from "./sim.js?v=6";

const RANK_RUNS = 2000;
const MAIN_RUNS = 10000;
const TIP_RUNS = 3000;

const money = (x) => "$" + Math.round(x).toLocaleString("en-US");
const num = (x) => Number(x).toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * @param {object} strategy  how the trader trades (see readStrategy in app.js)
 * @param {string} viewPlan  "auto" or a plan id to compare
 * @param {string|number} viewSize "auto" or a size to compare
 */
export function analyze({ strategy, viewPlan = "auto", viewSize = "auto" }) {
  const rec = recommend(strategy, { runs: RANK_RUNS });
  const view = pickView(rec, strategy, viewPlan, viewSize);
  const result = simulate({ ...view.opts, runs: MAIN_RUNS, keepPaths: 50 });
  const tips = tipRows(view.opts, result, strategy.unit);
  return {
    rec: {
      sizeMatters: rec.sizeMatters,
      skipped: rec.skipped.length,
      ranked: rec.ranked.map((c) => ({
        plan: c.plan,
        size: c.size,
        pass: c.result.probability.pass,
        fail: c.result.probability.fail,
        median: c.result.passDays.median,
        sample: thin(c.result.paths[0]),
      })),
    },
    view: { plan: view.plan, size: view.size, isBest: view.isBest },
    result,
    tips,
  };
}

/** One sample run, thinned to at most 40 points, for the ticker sparklines. */
function thin(path) {
  if (!path) return null;
  const e = path.equity;
  const step = Math.max(1, Math.ceil(e.length / 40));
  const pts = e.filter((_, i) => i % step === 0);
  if (pts[pts.length - 1] !== e[e.length - 1]) pts.push(e[e.length - 1]);
  return { outcome: path.outcome, equity: pts };
}

function pickView(rec, strategy, vp, vs) {
  const best = rec.best;
  if (vp === "auto" && (vs === "auto" || !rec.sizeMatters)) return { ...best, isBest: true };
  const plan = vp === "auto" ? best.plan : PLANS.find((p) => p.id === vp) || best.plan;
  const size = !rec.sizeMatters || vs === "auto" ? best.size : Number(vs);
  const hit = rec.ranked.find((c) => c.plan.id === plan.id && (!rec.sizeMatters || c.size === size));
  if (hit) return { ...hit, isBest: hit === best };
  // Not in the ranked pool (size unticked, or the risk is too big there): build it directly.
  const { unit, riskPct, riskUsd, sizes, ...rest } = strategy;
  const share = rec.sizeMatters ? riskUsd / size : riskPct;
  return { plan, size, opts: { ...rest, plan, startBalance: size, riskPct: share }, isBest: false };
}

function tipRows(opts, base, unit) {
  const fmtRisk = (share) => (unit === "usd" ? money(share * opts.startBalance) : `${num(share * 100)}%`);
  const variants = [];
  const rm = base.room;
  if (opts.riskPct > 0.001) variants.push([`Risk ${fmtRisk(opts.riskPct / 2)} a trade instead of ${fmtRisk(opts.riskPct)}`, { riskPct: opts.riskPct / 2 }]);
  if (opts.riskPct * 1.5 < 0.5) variants.push([`Risk ${fmtRisk(opts.riskPct * 1.5)} a trade`, { riskPct: opts.riskPct * 1.5 }]);
  if (!opts.maxLossesPerDay && rm.lossesToDailyBreach && rm.lossesToDailyBreach > 1 && opts.tradesPerDay >= rm.lossesToDailyBreach) {
    const n = rm.lossesToDailyBreach - 1;
    variants.push([`Stop for the day after ${n} loss${n > 1 ? "es" : ""}`, { maxLossesPerDay: n }]);
  }
  if (opts.winRate <= 0.95) variants.push([`Win 5 more trades in 100 (${Math.round(opts.winRate * 100 + 5)}%)`, { winRate: opts.winRate + 0.05 }]);
  if (opts.costR >= 0.02) variants.push(["Halve your costs (better fills, fewer fees)", { costR: opts.costR / 2 }]);
  if (opts.tradesPerDay > 1) variants.push([`Take ${opts.tradesPerDay - 1} trade${opts.tradesPerDay - 1 > 1 ? "s" : ""} a day`, { tradesPerDay: opts.tradesPerDay - 1 }]);

  return variants.map(([label, change]) => {
    const r = simulate({ ...opts, ...change, runs: TIP_RUNS });
    return {
      label,
      pass: r.probability.pass,
      fail: r.probability.fail,
      median: r.passDays.median,
      passPts: Math.round((r.probability.pass - base.probability.pass) * 100),
      failPts: Math.round((r.probability.fail - base.probability.fail) * 100),
      dayDelta: r.passDays.median != null && base.passDays.median != null ? r.passDays.median - base.passDays.median : null,
    };
  }).sort((a, b) => (b.passPts - b.failPts) - (a.passPts - a.failPts) || (a.dayDelta ?? 0) - (b.dayDelta ?? 0));
}
