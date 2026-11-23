// Pass Odds simulation engine. Pure functions, no DOM, so the same file runs
// in the browser and under `node --test`.
//
// Rule model (from MyFundedPerps' "Challenges and rules" guide, read 2026-11-24):
//  - Profit target, daily loss limit and max drawdown are percentages of the
//    STARTING balance, not of current equity.
//  - Max drawdown is static: the floor is start * (1 - maxDD) and never trails.
//  - Daily loss is measured from the balance at the start of the day (the day
//    resets at midnight New York time) and includes open P&L.
//  - Reaching a limit counts as a breach (conservative reading).
// Trade model: each trade either wins avgWinR or loses avgLossR (in R, where
// 1R = the dollar risk per trade), minus a fixed cost in R. A losing trade is
// assumed to travel straight to its stop, so its worst open P&L equals its loss.

export const PLANS = [
  { id: "select",      name: "Select",           target: 0.09, dll: 0.03, maxDD: 0.03 },
  { id: "signature",   name: "Signature",        target: 0.10, dll: 0.03, maxDD: 0.06 },
  { id: "elite-dll",   name: "Elite (3% DLL)",   target: 0.10, dll: 0.03, maxDD: 0.05 },
  { id: "elite-nodll", name: "Elite (no DLL)",   target: 0.10, dll: null, maxDD: 0.05 },
];

export const RULES_SOURCE = "https://docs.myfundedperpetuals.com/guides/challenges-and-rules";
export const RULES_AS_OF = "2026-11-24";

/** Small, fast, seedable PRNG so results are reproducible and testable. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EPS = 1e-9;

export const DEFAULTS = {
  startBalance: 100000,
  winRate: 0.45,       // 0..1
  avgWinR: 2,          // R gained on a winner
  avgLossR: 1,         // R lost on a loser
  costR: 0.05,         // fees + slippage per trade, in R
  riskPct: 0.005,      // dollar risk per trade as a share of the starting balance
  tradesPerDay: 3,
  maxLossesPerDay: 0,  // your own rule: stop for the day after N losses (0 = off)
  days: 30,
  runs: 10000,
  seed: 42,
  keepPaths: 0,        // how many equity paths to return for charting
};

/** Expectancy per trade in R, after costs. */
export function expectancyR({ winRate, avgWinR, avgLossR, costR }) {
  return winRate * avgWinR - (1 - winRate) * avgLossR - costR;
}

/** Validate and fill options. Throws with a readable message on bad input. */
export function normalize(opts) {
  const o = { ...DEFAULTS, ...opts };
  const plan = o.plan;
  if (!plan || !(plan.target > 0) || !(plan.maxDD > 0)) throw new Error("Pick a plan.");
  if (!(o.startBalance > 0)) throw new Error("Starting balance must be above 0.");
  if (!(o.winRate >= 0 && o.winRate <= 1)) throw new Error("Win rate must be between 0% and 100%.");
  if (!(o.avgWinR > 0) || !(o.avgLossR > 0)) throw new Error("Average win and loss must be above 0R.");
  if (!(o.costR >= 0)) throw new Error("Costs can't be negative.");
  if (!(o.riskPct > 0 && o.riskPct < 1)) throw new Error("Risk per trade must be between 0% and 100%.");
  if (!(o.tradesPerDay >= 1)) throw new Error("Trade at least once a day.");
  if (!(o.days >= 1)) throw new Error("Simulate at least one day.");
  o.tradesPerDay = Math.floor(o.tradesPerDay);
  o.days = Math.floor(o.days);
  o.runs = Math.max(1, Math.floor(o.runs));
  o.maxLossesPerDay = Math.max(0, Math.floor(o.maxLossesPerDay || 0));
  return o;
}

/**
 * Run the Monte Carlo. Returns probabilities, timing stats and optional paths.
 * outcome per run: "pass" | "dll" (daily loss breach) | "maxdd" | "open" (still running at the horizon)
 */
export function simulate(opts) {
  const o = normalize(opts);
  const { plan, startBalance: S } = o;
  const rand = mulberry32(o.seed);
  const risk = o.riskPct * S;
  const winAmt = (o.avgWinR - o.costR) * risk;
  const lossAmt = (o.avgLossR + o.costR) * risk;
  const targetEq = S * (1 + plan.target);
  const floorEq = S * (1 - plan.maxDD);
  const dllAmt = plan.dll == null ? Infinity : plan.dll * S;

  const counts = { pass: 0, dll: 0, maxdd: 0, open: 0 };
  const passDays = [];
  const failDays = [];
  const paths = [];
  let tradesTaken = 0;

  for (let r = 0; r < o.runs; r++) {
    let eq = S;
    let outcome = "open";
    let endDay = o.days;
    const path = r < o.keepPaths ? [S] : null;

    dayLoop: for (let d = 1; d <= o.days; d++) {
      const dayStart = eq;
      let losses = 0;
      for (let t = 0; t < o.tradesPerDay; t++) {
        if (o.maxLossesPerDay && losses >= o.maxLossesPerDay) break;
        tradesTaken++;
        if (rand() < o.winRate) {
          eq += winAmt;
          if (eq >= targetEq - EPS) { outcome = "pass"; endDay = d; break dayLoop; }
        } else {
          eq -= lossAmt;
          losses++;
          // The account-level floor wins if both are hit by the same trade.
          if (eq <= floorEq + EPS) { outcome = "maxdd"; endDay = d; break dayLoop; }
          if (dayStart - eq >= dllAmt - EPS) { outcome = "dll"; endDay = d; break dayLoop; }
        }
      }
      if (path) path.push(eq);
    }

    counts[outcome]++;
    if (outcome === "pass") passDays.push(endDay);
    else if (outcome !== "open") failDays.push(endDay);
    if (path) {
      if (outcome !== "open") path.push(eq);
      paths.push({ outcome, endDay, equity: path });
    }
  }

  const n = o.runs;
  return {
    options: o,
    runs: n,
    probability: {
      pass: counts.pass / n,
      dll: counts.dll / n,
      maxdd: counts.maxdd / n,
      open: counts.open / n,
      fail: (counts.dll + counts.maxdd) / n,
    },
    counts,
    passDays: summarize(passDays),
    failDays: summarize(failDays),
    passDayHistogram: histogram(passDays, o.days),
    avgTradesPerRun: tradesTaken / n,
    expectancyR: expectancyR(o),
    room: room(o),
    paths,
  };
}

/** How many full losers in a row the rules allow, from a fresh day / fresh account. */
export function room(opts) {
  const o = normalize(opts);
  const lossShare = (o.avgLossR + o.costR) * o.riskPct; // share of starting balance per losing trade
  const firstBreach = (limit) => (limit == null ? null : Math.max(1, Math.ceil(limit / lossShare - EPS)));
  const toTarget = Math.ceil(o.plan.target / ((o.avgWinR - o.costR) * o.riskPct) - EPS);
  return {
    // Losing trades in a row that end in a breach (counting the breaching trade).
    lossesToDailyBreach: firstBreach(o.plan.dll),
    lossesToMaxDDBreach: firstBreach(o.plan.maxDD),
    // Winners needed to reach the target with no losers in between.
    winnersToTarget: toTarget > 0 ? toTarget : Infinity,
    singleLossBreachesDaily: o.plan.dll != null && lossShare >= o.plan.dll - EPS,
  };
}

/** Run every plan with the same seed and stats, best pass rate first. */
export function rankPlans(opts, plans = PLANS) {
  return plans
    .map((plan) => ({ plan, result: simulate({ ...opts, plan, keepPaths: 0 }) }))
    .sort((a, b) => b.result.probability.pass - a.result.probability.pass);
}

function summarize(arr) {
  if (!arr.length) return { count: 0, median: null, p25: null, p75: null, mean: null };
  const s = [...arr].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
  return { count: s.length, median: q(0.5), p25: q(0.25), p75: q(0.75), mean: s.reduce((x, y) => x + y, 0) / s.length };
}

function histogram(days, maxDay) {
  const h = new Array(maxDay + 1).fill(0);
  for (const d of days) h[d]++;
  return h.slice(1); // index 0 => day 1
}
