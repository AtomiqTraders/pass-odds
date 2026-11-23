#!/usr/bin/env python3
"""Refresh data/markets.json from MyFundedPerps' public market catalog.

The endpoint needs no API key. Browsers can't call it directly (its CORS
policy only allows the docs site), so a scheduled GitHub Action runs this
script and commits the result next to the page.

Usage: python3 scripts/update_markets.py [output_path]
"""
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

URL = "https://developers.myfundedperpetuals.com/v1/markets"
KEEP = (
    "market_id", "symbol", "coin", "provider", "max_leverage",
    "min_notional", "min_size", "size_step", "size_decimals", "contract_size",
)


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "data" / "markets.json"
    req = urllib.request.Request(URL, headers={"User-Agent": "pass-odds-market-sync", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.load(resp)

    markets = [{k: m.get(k) for k in KEEP} for m in payload.get("data", []) if m.get("market_id")]
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
