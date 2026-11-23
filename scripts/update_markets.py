#!/usr/bin/env python3
"""Refresh data/markets.json from MyFundedPerps' public market catalog.

The endpoint needs no API key. Browsers can't call it directly (its CORS
policy only allows the docs site), so a scheduled GitHub Action runs this
script and commits the result next to the page.

Usage: python3 scripts/update_markets.py [output_path]
"""
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

URL = "https://developers.myfundedperpetuals.com/v1/markets"

SAFE_TEXT = re.compile(r"^[A-Za-z0-9:|._-]{1,40}$")
PROVIDERS = {"binance", "hyperliquid", "veranta", "ostium", "bybit", "lighter", "fpx", "synthetic"}
NUMERIC = ("max_leverage", "min_notional", "min_size", "size_step", "contract_size")


def clean(m: dict):
    """Keep only well-formed markets. The page renders these fields, so
    anything that isn't a short plain symbol or a positive number is dropped."""
    for k in ("market_id", "symbol", "coin"):
        if not isinstance(m.get(k), str) or not SAFE_TEXT.match(m[k]):
            return None
    if m.get("provider") not in PROVIDERS:
        return None
    for k in NUMERIC:
        v = m.get(k)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not (0 < v < 1e9):
            return None
    d = m.get("size_decimals")
    if isinstance(d, bool) or not isinstance(d, int) or not (0 <= d <= 12):
        return None
    return m


KEEP = (
    "market_id", "symbol", "coin", "provider", "max_leverage",
    "min_notional", "min_size", "size_step", "size_decimals", "contract_size",
)


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "data" / "markets.json"
    req = urllib.request.Request(URL, headers={"User-Agent": "pass-odds-market-sync", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.load(resp)

    raw = [{k: m.get(k) for k in KEEP} for m in payload.get("data", []) if isinstance(m, dict)]
    markets = [m for m in (clean(x) for x in raw) if m]
    if len(raw) != len(markets):
        print(f"Dropped {len(raw) - len(markets)} malformed market(s).", file=sys.stderr)
    if not markets:
        print("No markets returned; leaving the existing file alone.", file=sys.stderr)
        return 1
    markets.sort(key=lambda m: (m["symbol"] or "", m["provider"] or ""))

    doc = {
        "source": URL,
        "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(markets),
        "markets": markets,
    }
    new_text = json.dumps(doc, indent=1, sort_keys=False) + "\n"

    # Skip the write when only the timestamp would change, so the Action doesn't commit every hour.
    if out.exists():
        try:
            old = json.loads(out.read_text())
            if old.get("markets") == markets:
                print(f"No change ({len(markets)} markets).")
                return 0
        except json.JSONDecodeError:
            pass
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(new_text)
    print(f"Wrote {len(markets)} markets to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
