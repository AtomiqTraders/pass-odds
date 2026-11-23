// Free, keyless price data. Both feeds allow browser calls (CORS: *).
// MyFundedPerps' own quote endpoint needs a key, so we read the venue the
// market is sourced from instead. Prices can differ slightly from the
// firm's mark, so always check before trading.

const TIMEOUT_MS = 8000;

async function getJSON(url, init) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const hlPost = (body) =>
  getJSON("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function priceSupported(market) {
  return market && (market.provider === "binance" || market.provider === "hyperliquid");
}

/** Latest price for a market, or throws. Returns { price, source }. */
export async function fetchPrice(market) {
  if (market.provider === "binance") {
    const sym = encodeURIComponent(market.coin);
    try {
      const d = await getJSON(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${sym}`);
      return { price: Number(d.price), source: "Binance futures" };
    } catch {
      const d = await getJSON(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`);
      return { price: Number(d.price), source: "Binance spot" };
    }
  }
  if (market.provider === "hyperliquid") {
    const dex = market.coin.includes(":") ? market.coin.split(":")[0] : undefined;
    const mids = await hlPost(dex ? { type: "allMids", dex } : { type: "allMids" });
    const p = Number(mids[market.coin]);
    if (!(p > 0)) throw new Error("No price for this market");
    return { price: p, source: "Hyperliquid" };
  }
  throw new Error("No free price feed for this venue. Type the price in.");
}

/** Last `limit` 1-hour candles as [{h, l, c}], oldest first. */
export async function fetchCandles(market, limit = 40) {
  if (market.provider === "binance") {
    const sym = encodeURIComponent(market.coin);
    let rows;
    try {
      rows = await getJSON(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1h&limit=${limit}`);
    } catch {
      rows = await getJSON(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=${limit}`);
    }
    return rows.map((r) => ({ h: Number(r[2]), l: Number(r[3]), c: Number(r[4]) }));
  }
  if (market.provider === "hyperliquid") {
    const end = Date.now();
    const rows = await hlPost({
      type: "candleSnapshot",
      req: { coin: market.coin, interval: "1h", startTime: end - limit * 3600e3, endTime: end },
    });
    return rows.map((r) => ({ h: Number(r.h), l: Number(r.l), c: Number(r.c) }));
  }
  throw new Error("No free candle feed for this venue.");
}
