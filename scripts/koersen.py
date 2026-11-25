"""Haalt koersen op bij Yahoo Finance (via yfinance) voor de aandelen in
data/tickers.enc en schrijft ze versleuteld naar koersen.enc.

Draait in GitHub Actions, waar Yahoo wel bereikbaar is (vanuit een webpagina
blokkeert Yahoo directe verzoeken). Versleuteling: AES-256-GCM met de sleutel
uit het repository-secret KOERS_KEY, zodat in deze openbare repository niet te
zien is welke aandelen je volgt.

Gebruik:
  python scripts/koersen.py                  # normaal (in de workflow)
  python scripts/koersen.py --selftest A B   # test zonder versleuteling
"""
import base64
import gzip
import json
import os
import sys
from datetime import datetime, timezone

import yfinance as yf

START = "2000-01-01"
TYPES = {"EQUITY", "ETF", "INDEX", "MUTUALFUND"}


def b64(b): return base64.b64encode(b).decode()
def unb64(s): return base64.b64decode(s)


def encrypt(key, obj):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    iv = os.urandom(12)
    raw = gzip.compress(json.dumps(obj, separators=(",", ":")).encode())
    return {"versie": 1, "iv": b64(iv), "data": b64(AESGCM(key).encrypt(iv, raw, None))}


def decrypt(key, f):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    return json.loads(gzip.decompress(AESGCM(key).decrypt(unb64(f["iv"]), unb64(f["data"]), None)))


def search(query):
    """Kandidaten bij een naam of onvolledige ticker, bijv. 'Rheinmetall' of 'RHM'."""
    try:
        quotes = yf.Search(query, max_results=10, news_count=0).quotes
    except Exception as e:  # zoeken is een hulpmiddel; falen mag
        print(f"  zoeken '{query}' mislukt: {e}")
        return []
    out = []
    for q in quotes:
        if q.get("quoteType") not in TYPES or not q.get("symbol"):
            continue
        out.append({
            "symbol": q["symbol"],
            "name": q.get("longname") or q.get("shortname") or "",
            "exchange": q.get("exchDisp") or q.get("exchange") or "",
            "type": q.get("quoteType"),
        })
    return out[:8]


def fetch(ticker):
    t = yf.Ticker(ticker)
    h = t.history(start=START, auto_adjust=True, raise_errors=False)
    closes = h["Close"].dropna() if h is not None and not h.empty else None
    if closes is None or closes.empty:
        return {"error": "niet gevonden", "candidates": search(ticker)}
    meta = getattr(t, "history_metadata", {}) or {}
    days, vals = [], []
    for ts, v in closes.items():
        d = ts.strftime("%Y-%m-%d")
        if days and days[-1] == d:
            vals[-1] = float(f"{v:.6g}")
            continue
        days.append(d)
        vals.append(float(f"{v:.6g}"))
    return {
        "name": meta.get("longName") or meta.get("shortName"),
        "currency": meta.get("currency"),
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"),
        "days": days,
        "close": vals,
    }


def build(tickers):
    items = {}
    for t in tickers:
        print(f"- {t}")
        try:
            items[t] = fetch(t)
        except Exception as e:
            items[t] = {"error": f"ophalen mislukt: {e}", "candidates": []}
        it = items[t]
        print(f"  {len(it.get('days', []))} koersen" if "days" in it else f"  {it['error']}, {len(it['candidates'])} kandidaten")
    return {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "items": items}


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--selftest":
        res = build(sys.argv[2:])
        summary = {t: ({"n": len(v["days"]), "eerste": v["days"][0], "laatste": v["days"][-1], "slot": v["close"][-1], "naam": v["name"], "valuta": v["currency"]}
                       if "days" in v else v) for t, v in res["items"].items()}
        os.makedirs("out", exist_ok=True)
        with open("out/selftest.json", "w") as f:
            json.dump({"generated": res["generated"], "yfinance": yf.__version__, "items": summary}, f, indent=1)
        return

    key_b64 = os.environ.get("KOERS_KEY", "").strip()
    if not key_b64:
        print("KOERS_KEY ontbreekt: de centrale lijst is nog niet ingesteld in de app. Niets te doen.")
        return
    key = unb64(key_b64)
    path = "data/tickers.enc"
    if not os.path.exists(path):
        print("Nog geen data/tickers.enc. Niets te doen.")
        return
    with open(path) as f:
        tickers = decrypt(key, json.load(f)).get("tickers", [])
    print(f"{len(tickers)} aandelen")
    res = build(tickers)
    os.makedirs("out", exist_ok=True)
    with open("out/koersen.enc", "w") as f:
        json.dump(encrypt(key, res), f)


if __name__ == "__main__":
    main()
