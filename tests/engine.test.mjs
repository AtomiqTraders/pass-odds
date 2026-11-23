import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate, room, rankPlans, PLANS, mulberry32, expectancyR } from "../js/sim.js";
import { sizePosition, floorToStep, atr } from "../js/sizer.js";

const select = PLANS.find((p) => p.id === "select");
const nodll = PLANS.find((p) => p.id === "elite-nodll");

test("PRNG is deterministic", () => {
  const a = mulberry32(7), b = mulberry32(7);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test("probabilities add up to 1", () => {
  const r = simulate({ plan: select, runs: 3000 });
  const p = r.probability;
  assert.ok(Math.abs(p.pass + p.dll + p.maxdd + p.open - 1) < 1e-12);
});

test("always winning passes on the exact winner count", () => {
  // 1% risk, 2R winners, no costs: +2% a trade, 9% target -> 5th winner, on day 2 at 3 trades/day.
  const r = simulate({ plan: select, winRate: 1, riskPct: 0.01, avgWinR: 2, costR: 0, tradesPerDay: 3, runs: 50 });
  assert.equal(r.probability.pass, 1);
  assert.equal(r.passDays.median, 2);
  assert.equal(room({ plan: select, riskPct: 0.01, avgWinR: 2, costR: 0 }).winnersToTarget, 5);
});

test("always losing breaches: daily limit when it is tighter, the floor when they coincide", () => {
  // Signature: 3% daily, 6% max DD. 1% risk -> 3rd loss on day 1 reaches the daily limit.
  const sig = PLANS.find((p) => p.id === "signature");
  const r = simulate({ plan: sig, winRate: 0, riskPct: 0.01, costR: 0, tradesPerDay: 5, runs: 20 });
  assert.equal(r.probability.dll, 1);
  assert.equal(r.failDays.median, 1);
  // Select: 3% daily and 3% static floor. Both hit on the same trade -> counted as max drawdown.
  const s = simulate({ plan: select, winRate: 0, riskPct: 0.01, costR: 0, tradesPerDay: 5, runs: 20 });
  assert.equal(s.probability.maxdd, 1);
});

test("no-DLL plan can only fail on max drawdown", () => {
  const r = simulate({ plan: nodll, winRate: 0, riskPct: 0.01, costR: 0, tradesPerDay: 2, runs: 20 });
  assert.equal(r.probability.dll, 0);
  assert.equal(r.probability.maxdd, 1);
  assert.equal(r.failDays.median, 3); // 5% floor -> 5th loss, at 2 trades/day that's day 3
});

test("daily loss resets each day", () => {
  // 2 losses/day at 1% = 2%/day: never hits the 3% daily limit; the 6% floor goes on day 3.
  const sig = PLANS.find((p) => p.id === "signature");
  const r = simulate({ plan: sig, winRate: 0, riskPct: 0.01, costR: 0, tradesPerDay: 2, runs: 10 });
  assert.equal(r.probability.dll, 0);
  assert.equal(r.probability.maxdd, 1);
  assert.equal(r.failDays.median, 3);
});

test("own daily stop prevents a daily breach", () => {
  const sig = PLANS.find((p) => p.id === "signature");
  const r = simulate({ plan: sig, winRate: 0, riskPct: 0.01, costR: 0, tradesPerDay: 5, maxLossesPerDay: 2, runs: 10 });
  assert.equal(r.probability.dll, 0);
});

test("horizon too short leaves runs open", () => {
  const r = simulate({ plan: select, winRate: 0.5, avgWinR: 1, avgLossR: 1, costR: 0, riskPct: 0.001, days: 2, runs: 200 });
  assert.equal(r.probability.open, 1);
});

test("room: losses to breach and single-loss warning", () => {
  const rm = room({ plan: select, riskPct: 0.01, costR: 0 });
  assert.equal(rm.lossesToDailyBreach, 3);
  assert.equal(rm.lossesToMaxDDBreach, 3);
  assert.equal(room({ plan: select, riskPct: 0.03, costR: 0 }).singleLossBreachesDaily, true);
  assert.equal(room({ plan: nodll, riskPct: 0.01 }).lossesToDailyBreach, null);
});

test("expectancy and plan ranking", () => {
  assert.ok(Math.abs(expectancyR({ winRate: 0.5, avgWinR: 2, avgLossR: 1, costR: 0.1 }) - 0.4) < 1e-12);
  const ranked = rankPlans({ runs: 2000 });
  assert.equal(ranked.length, PLANS.length);
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].result.probability.pass >= ranked[i].result.probability.pass);
  }
});

test("input validation", () => {
  assert.throws(() => simulate({ plan: select, winRate: 1.5 }), /Win rate/);
  assert.throws(() => simulate({}), /plan/);
});

const btc = { market_id: "binance|BTCUSDT", symbol: "BTC", max_leverage: 2, min_notional: 10, min_size: 0.001, size_step: 0.001, size_decimals: 3, contract_size: 1 };

test("floorToStep has no float drift", () => {
  assert.equal(floorToStep(0.3, 0.1, 1), 0.3);
  assert.equal(floorToStep(1.23456, 0.001, 3), 1.234);
  assert.equal(floorToStep(7.9999, 1, 0), 7);
});

test("sizer: risk-limited long", () => {
  // $500 risk, $1,000 stop -> 0.5 BTC, $50k notional on $100k = 0.5x.
  const s = sizePosition({ equity: 100000, riskUsd: 500, entry: 100000, stop: 99000, market: btc });
  assert.equal(s.ok, true);
  assert.equal(s.side, "long");
  assert.equal(s.qty, 0.5);
  assert.equal(s.lossAtStop, 500);
  assert.equal(s.limitedBy, "your risk");
});

test("sizer: leverage cap binds on a tight stop", () => {
  // $500 risk with a $50 stop wants 10 BTC = $1M; 2x on $100k caps at 2 BTC.
  const s = sizePosition({ equity: 100000, riskUsd: 500, entry: 100000, stop: 100050, market: btc });
  assert.equal(s.side, "short");
  assert.equal(s.qty, 2);
  assert.match(s.limitedBy, /leverage/);
  assert.equal(s.lossAtStop, 100);
});

test("sizer: daily room caps the risk", () => {
  const s = sizePosition({ equity: 100000, riskUsd: 500, entry: 100000, stop: 99000, market: btc, dailyRoomUsd: 300 });
  assert.equal(s.qty, 0.3);
  assert.equal(s.limitedBy, "daily loss room");
  assert.equal(s.lossesUntilDaily, 1);
});

test("sizer: rejects below minimums and bad input", () => {
  const tiny = sizePosition({ equity: 1000, riskUsd: 0.5, entry: 100000, stop: 99000, market: btc });
  assert.equal(tiny.ok, false);
  assert.equal(sizePosition({ equity: 1000, riskUsd: 10, entry: 100, stop: 100, market: btc }).ok, false);
});

test("ATR", () => {
  const c = Array.from({ length: 20 }, (_, i) => ({ h: 102 + i, l: 100 + i, c: 101 + i }));
  assert.equal(atr(c, 14), 2);
  assert.equal(atr(c.slice(0, 5), 14), null);
});
