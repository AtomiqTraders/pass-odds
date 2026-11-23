# Pass Odds

**What are your odds of passing a MyFundedPerps challenge?**

Pass Odds runs your own trading stats through 10,000 simulated challenges under the plan's real rules, and shows how often you pass, how you fail, and what would change the odds. It also sizes trades so the order fits the market's limits and today's loss room.

Free. No login. No API key. Everything runs in your browser.

> Unofficial community tool. Not made by or affiliated with MyFundedPerps. Not financial advice. A simulation is not a promise.

## What it does

**Pass odds**
- Your chance to pass, fail on the daily loss limit, fail on max drawdown, or still be going after N days.
- 50 sample equity paths drawn against the profit target and the drawdown floor.
- "What would change your odds": the same stats with half the risk, an own daily stop, a few more winners, lower costs and so on, each shown as a change in pass chance.
- Plan picker: every plan (Select, Signature, Elite with and without a daily loss limit) run on your stats and ranked.
- Shareable 1200×675 image and a link that reopens the page with the same stats.

**Position sizer**
- Pick any of the firm's markets. The size is rounded down to the market's size step and checked against its minimum order and max leverage (from the firm's public market list).
- Live price and a 1.5 × ATR stop from free public feeds (Binance, Hyperliquid).
- Caps the risk at what's left before today's daily loss limit and above the drawdown floor.
- Never places orders.

## Rules model

From the MyFundedPerps [challenge guide](https://docs.myfundedperpetuals.com/guides/challenges-and-rules), read 2026-11-24:

| Plan | Profit target | Daily loss | Max drawdown |
|---|---|---|---|
| Select | 9% | 3% | 3% |
| Signature | 10% | 3% | 6% |
| Elite (3% DLL) | 10% | 3% | 5% |
| Elite (no DLL) | 10% | none | 5% |

- All limits are a share of the **starting** balance. Max drawdown is static (it doesn't trail).
- Daily loss counts from the balance at the start of each day (midnight New York time) and includes open P&L.
- Reaching a limit is treated as a breach.

Trade model: each trade wins your average win or loses your average loss (in R), minus a fixed cost. A losing trade is assumed to go straight to its stop. Real trades vary more than averages, so treat the result as a guide, not a forecast.

## Data sources

| Data | Source | Key needed |
|---|---|---|
| Market list (leverage, min order, size step) | `GET https://developers.myfundedperpetuals.com/v1/markets` | No |
| Crypto prices and candles | Binance public API | No |
| Stocks, commodities, indices | Hyperliquid public info API | No |

The firm's API only allows browser calls from its docs site, so a GitHub Action (`.github/workflows/update-markets.yml`) refreshes `data/markets.json` every hour.

## Run it locally

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080. (Opening `index.html` directly won't load the market list.)

## Tests

```bash
npm test
```

The engine (`js/sim.js`) and sizer (`js/sizer.js`) are plain modules with no DOM, tested with Node's built-in test runner.

## Roadmap

- **v0.1** Pass odds, plan picker, position sizer, share card.
- **v0.2** "Why did I fail?": read-only API key → replay your real fills against the limit lines and mark the trade that broke the account.
- **v0.3** Live odds from the account stream, plus an OBS overlay for streamers.
- Claude skill and MCP wrapper so traders can ask their own Claude for odds and sizes.

## License

MIT
