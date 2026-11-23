// Position sizer: turns "risk $X with this stop" into an order size that the
// MyFundedPerps market will actually accept (size step, minimum size, minimum
// notional, max leverage), using the public market catalog.

const EPS = 1e-9;

/** Round down to the market's size step without float drift. */
export function floorToStep(qty, step, decimals) {
  if (!(step > 0)) return qty;
  const units = Math.floor(qty / step + EPS);
  const d = Number.isInteger(decimals) ? decimals : Math.max(0, -Math.floor(Math.log10(step)));
  return Number((units * step).toFixed(d));
}

/**
 * @param {object} p
 * @param {number} p.equity       account equity used for the leverage check
 * @param {number} p.riskUsd      dollars you are willing to lose at the stop
 * @param {number} p.entry        planned entry price
 * @param {number} p.stop         stop price
 * @param {object} p.market       one entry from data/markets.json
 * @param {number} [p.dailyRoomUsd] dollars left before today's daily loss limit
 * @param {number} [p.ddRoomUsd]  dollars left above the max drawdown floor
 */
export function sizePosition({ equity, riskUsd, entry, stop, market, dailyRoomUsd = Infinity, ddRoomUsd = Infinity }) {
  const errors = [];
  if (!market) errors.push("Pick a market.");
  if (!(equity > 0)) errors.push("Equity must be above 0.");
  if (!(riskUsd > 0)) errors.push("Risk must be above $0.");
  if (!(entry > 0)) errors.push("Entry price must be above 0.");
  if (!(stop > 0)) errors.push("Stop price must be above 0.");
  if (entry > 0 && stop > 0 && Math.abs(entry - stop) < EPS) errors.push("The stop can't equal the entry.");
  if (errors.length) return { ok: false, errors };

  const side = stop < entry ? "long" : "short";
  const contract = market.contract_size || 1;
  const stopDist = Math.abs(entry - stop);
  const stopPct = stopDist / entry;

  // Never size past what the rules leave you today.
  const budget = Math.min(riskUsd, dailyRoomUsd, ddRoomUsd);
  let limitedBy = budget < riskUsd ? (dailyRoomUsd <= ddRoomUsd ? "daily loss room" : "max drawdown room") : "your risk";

  let qty = floorToStep(budget / (stopDist * contract), market.size_step, market.size_decimals);

  const maxLev = market.max_leverage || Infinity;
  const maxQtyByLev = floorToStep((equity * maxLev) / (entry * contract), market.size_step, market.size_decimals);
  if (qty > maxQtyByLev) {
    qty = maxQtyByLev;
    limitedBy = `max leverage (${maxLev}x)`;
  }

  const notional = qty * entry * contract;
  const lossAtStop = qty * stopDist * contract;
  const warnings = [];
  if (qty < (market.min_size || 0) - EPS || qty <= 0) {
    return { ok: false, errors: [`Too small: the size works out below this market's minimum of ${market.min_size}. Widen the risk or tighten the stop.`], side, stopPct };
  }
  if (notional < (market.min_notional || 0) - EPS) {
    return { ok: false, errors: [`Too small: $${notional.toFixed(2)} is below this market's $${market.min_notional} minimum order.`], side, stopPct };
  }
  if (limitedBy.startsWith("max leverage")) {
    warnings.push(`Leverage capped this trade: you risk $${lossAtStop.toFixed(2)}, not $${budget.toFixed(2)}. A wider stop would need less size.`);
  }
  if (stopPct < 0.001) warnings.push("This stop is under 0.1% away; the spread and fees alone can hit it.");

  return {
    ok: true,
    side,
    qty,
    notional,
    leverage: notional / equity,
    maxLeverage: maxLev,
    lossAtStop,
    stopDist,
    stopPct,
    limitedBy,
    riskBudget: budget,
    lossesUntilDaily: Number.isFinite(dailyRoomUsd) ? Math.floor(dailyRoomUsd / lossAtStop + EPS) : null,
    warnings,
  };
}

/** Average True Range over `period` bars. candles: [{h, l, c}] oldest first. */
export function atr(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const { h, l } = candles[i];
    const pc = candles[i - 1].c;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const recent = trs.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}
