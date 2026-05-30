"""
Data Builder — Pre-fetch all BIST data and save as static JSON.

Outputs go to ../public/data/ for Vite to serve as static assets:
  symbols.json            — full symbol list
  history/{symbol}.json   — OHLCV per symbol (daily, max period)
  scan.json               — indicator analysis for all symbols
  financials/{symbol}.json — income_stmt + balance_sheet + cashflow
  backtest.json           — backtest stats aggregated across all symbols

Usage:
  cd borsa/scripts
  python build_data.py                   # all steps
  python build_data.py --skip-financials # skip slow financial fetch
  python build_data.py --skip-backtest   # skip backtest
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np

# Add backend to sys.path so we can import indicators / backtest
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

import borsapy as bp
from indicators import compute_all_indicators
from backtest import (
    BACKTEST_INDICATORS,
    HOLDING_PERIODS,
    extract_signal_events,
    aggregate_stats,
)

# ── Paths ──────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data"
HISTORY_DIR = OUT / "history"
FINANCIALS_DIR = OUT / "financials"

# ── Config ─────────────────────────────────────
MAX_WORKERS = 5


# ──────────────────────────────────────────────
# Step 1: Symbols
# ──────────────────────────────────────────────

def build_symbols():
    """Copy bist_symbols.json to public/data/symbols.json."""
    src = BACKEND_DIR / "bist_symbols.json"
    dst = OUT / "symbols.json"
    with open(src, "r", encoding="utf-8") as f:
        data = json.load(f)
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    n_stocks = len(data.get("stocks", []))
    n_indices = len(data.get("indices", []))
    print(f"[symbols] {n_stocks} stocks + {n_indices} indices -> {dst.name}")
    return data


# ──────────────────────────────────────────────
# Step 2: History (OHLCV)
# ──────────────────────────────────────────────

def _fetch_one_history(symbol: str) -> tuple[str, list[dict] | None]:
    """Fetch OHLCV for one symbol. Returns (symbol, data_list | None)."""
    import time
    for attempt in range(4):
        try:
            t = bp.Ticker(symbol)
            df = t.history(period="max", interval="1d")
            if df is None or df.empty or len(df) < 5:
                return symbol, None

            records = []
            for idx, row in df.iterrows():
                dt = str(idx)
                if "T" in dt:
                    dt = dt.split("T")[0]
                elif " " in dt:
                    dt = dt.split(" ")[0]
                records.append({
                    "date": dt,
                    "open": round(float(row["Open"]), 2),
                    "high": round(float(row["High"]), 2),
                    "low": round(float(row["Low"]), 2),
                    "close": round(float(row["Close"]), 2),
                    "volume": int(row["Volume"]) if not np.isnan(row["Volume"]) else 0,
                })
            return symbol, records
        except Exception as e:
            if attempt < 3:
                # Add delay before retrying
                time.sleep(1.0 * (attempt + 1))
            else:
                return symbol, None
    return symbol, None


def build_history(symbols: list[str]):
    """Fetch OHLCV for all symbols in parallel, save per-symbol JSON."""
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    total = len(symbols)
    ok = 0
    fail = 0

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_fetch_one_history, sym): sym for sym in symbols}
        done = 0
        for future in as_completed(futures):
            done += 1
            sym, records = future.result()
            if records:
                outpath = HISTORY_DIR / f"{sym}.json"
                with open(outpath, "w", encoding="utf-8") as f:
                    json.dump({"data": records}, f)
                ok += 1
            else:
                fail += 1

            if done % 25 == 0 or done == total:
                print(f"[history] {done}/{total}  ok={ok} fail={fail}")

    print(f"[history] Done. {ok} saved, {fail} failed.")


# ──────────────────────────────────────────────
# Step 3: Scan (indicators)
# ──────────────────────────────────────────────

def _analyze_from_file(symbol: str) -> dict | None:
    """Read pre-fetched history JSON and compute indicators."""
    hist_path = HISTORY_DIR / f"{symbol}.json"
    if not hist_path.exists():
        return None
    try:
        with open(hist_path, "r", encoding="utf-8") as f:
            records = json.load(f)["data"]
        if len(records) < 30:
            return None

        opens = np.array([r["open"] for r in records], dtype=float)
        highs = np.array([r["high"] for r in records], dtype=float)
        lows = np.array([r["low"] for r in records], dtype=float)
        closes = np.array([r["close"] for r in records], dtype=float)
        volumes = np.array([r["volume"] for r in records], dtype=float)
        volumes = np.nan_to_num(volumes, nan=0.0)

        results = compute_all_indicators(opens, highs, lows, closes, volumes)

        row: dict = {
            "symbol": symbol,
            "close": round(float(closes[-1]), 2),
            "volume": int(volumes[-1]),
            "data_points": len(closes),
        }
        for r in results:
            row[f"{r.name}_score"] = round(r.score, 4)
            row[f"{r.name}_signal"] = r.signal
            for k, v in r.details.items():
                if isinstance(v, bool):
                    row[f"{r.name}_{k}"] = v
                elif isinstance(v, (int, float)):
                    row[f"{r.name}_{k}"] = round(float(v), 4) if isinstance(v, float) else v
        return row
    except Exception:
        return None


def build_scan(symbols: list[str]):
    """Compute indicators for all symbols using pre-fetched history."""
    total = len(symbols)
    results = []
    done = 0

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_analyze_from_file, sym): sym for sym in symbols}
        for future in as_completed(futures):
            done += 1
            row = future.result()
            if row:
                results.append(row)
            if done % 50 == 0 or done == total:
                print(f"[scan] {done}/{total}  found={len(results)}")

    results.sort(key=lambda r: r["symbol"])

    scan_data = {
        "type": "complete",
        "results": results,
        "total_symbols": total,
        "analyzed": len(results),
        "timestamp": time.time(),
    }

    outpath = OUT / "scan.json"
    with open(outpath, "w", encoding="utf-8") as f:
        json.dump(scan_data, f)
    print(f"[scan] {len(results)} symbols analyzed -> {outpath.name}")


# ──────────────────────────────────────────────
# Step 4: Financials
# ──────────────────────────────────────────────

BANK_SYMBOLS = {
    "GARAN", "AKBNK", "YKBNK", "HALKB", "VAKBN", "ISCTR", "TSKB", "ALBRK",
    "SKBNK", "ICBCT", "QNBTR", "KLNMA", "ISATR", "ISBTR", "ISKUR",
}

INSURANCE_SYMBOLS = {
    "AGESA", "AKGRT", "ANSGR", "TURSG", "RAYSG", "ANHYT",
}

FACTORING_SYMBOLS = {
    "GARFA", "LIDFA", "VAKFN", "ISFIN", "CRDFA", "ULUFA", "SEKFK", "QNBFK", "DSTKF", "VAKFA",
}

# Filter map: report_name -> FINANCIAL_ITEM_CODE prefix check
REPORT_FILTERS = {
    "income_stmt": lambda code: code.startswith("3") or code.startswith("A3"),
    "balance_sheet": lambda code: (code[0] in ("1", "2") or code.startswith("A1") or code.startswith("A2")) if code else False,
    "cashflow": lambda code: code.startswith("4C") or code.startswith("A4"),
}


def _setup_ssl_bypass():
    """Disable SSL verification for isyatirimhisse (same as main.py)."""
    import requests as _requests
    import urllib3
    import isyatirimhisse.FetchFinancials as _ff_mod
    import urllib.parse as urlparse

    _ff_mod._SSL_VERIFY = False
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    _orig_get = _requests.get

    _no_ssl_session = _requests.Session()
    _no_ssl_session.verify = False
    _no_ssl_session.trust_env = False

    def _get_no_ssl(*args, **kwargs):
        kwargs["verify"] = False
        url = args[0] if args else kwargs.get("url")
        if url and "companyCode=" in url:
            parsed = urlparse.urlparse(url)
            params = urlparse.parse_qs(parsed.query)
            company_code = params.get("companyCode", [None])[0]
            if company_code in FACTORING_SYMBOLS:
                query_dict = {k: v[0] for k, v in params.items()}
                query_dict["financialGroup"] = "XI_29K"
                new_query = urlparse.urlencode(query_dict)
                new_url = parsed._replace(query=new_query).geturl()
                if args:
                    args = (new_url,) + args[1:]
                else:
                    kwargs["url"] = new_url
        return _no_ssl_session.get(*args, **kwargs)

    _ff_mod.requests.get = _get_no_ssl


def _process_financials_df(df, report_name: str) -> dict:
    """Filter DataFrame by FINANCIAL_ITEM_CODE and convert to JSON-friendly dict."""
    if df is None or df.empty:
        return {"periods": [], "data": []}

    # Filter by code prefix
    if "FINANCIAL_ITEM_CODE" in df.columns:
        code_col = df["FINANCIAL_ITEM_CODE"].astype(str)
        mask = code_col.apply(REPORT_FILTERS[report_name])
        df = df[mask]

    # Extract period columns (keep both annual /12 and quarterly /3, /6, /9)
    period_cols = [c for c in df.columns if "/" in str(c)]

    def sort_key(col):
        parts = str(col).split("/")
        return (int(parts[0]), int(parts[1]))
    period_cols.sort(key=sort_key)

    records = []
    for _, row in df.iterrows():
        item_name = str(row.get("FINANCIAL_ITEM_NAME_TR", ""))
        if not item_name:
            continue
        rec = {"item": item_name}
        for col in period_cols:
            val = row.get(col)
            if val is None or (isinstance(val, float) and val != val):
                rec[str(col)] = None
            else:
                try:
                    rec[str(col)] = float(val)
                except (ValueError, TypeError):
                    rec[str(col)] = None
        records.append(rec)

    return {
        "periods": [str(c) for c in period_cols],
        "data": records,
    }


def _fetch_one_financial(symbol: str) -> tuple[str, dict | None]:
    """Fetch financials for one symbol and split into 3 reports."""
    from isyatirimhisse import fetch_financials as isy_fetch
    from datetime import datetime

    if symbol in INSURANCE_SYMBOLS:
        fg = "2" if symbol == "RAYSG" else "3"
    elif symbol in FACTORING_SYMBOLS:
        fg = "3"
    elif symbol in BANK_SYMBOLS:
        fg = "2"
    else:
        fg = "1"

    try:
        df = isy_fetch(
            symbols=symbol,
            start_year=2005,
            end_year=datetime.now().year,
            exchange="TRY",
            financial_group=fg,
        )
        if df is None or df.empty:
            return symbol, None

        result = {}
        for report_name in ("income_stmt", "balance_sheet", "cashflow"):
            result[report_name] = _process_financials_df(df.copy(), report_name)

        return symbol, result
    except Exception as e:
        return symbol, None


def build_financials(symbols: list[str]):
    """Fetch financial statements for all symbols."""
    _setup_ssl_bypass()
    FINANCIALS_DIR.mkdir(parents=True, exist_ok=True)

    total = len(symbols)
    ok = 0
    fail = 0

    # Sequential to avoid overwhelming the API
    for i, sym in enumerate(symbols, 1):
        sym_name, data = _fetch_one_financial(sym)
        if data:
            outpath = FINANCIALS_DIR / f"{sym}.json"
            with open(outpath, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            ok += 1
        else:
            fail += 1

        if i % 10 == 0 or i == total:
            print(f"[financials] {i}/{total}  ok={ok} fail={fail}")

    print(f"[financials] Done. {ok} saved, {fail} failed.")


# ──────────────────────────────────────────────
# Step 5: Backtest
# ──────────────────────────────────────────────

def _backtest_from_file(symbol: str) -> tuple[str, dict | None]:
    """Read pre-fetched history and run backtest."""
    hist_path = HISTORY_DIR / f"{symbol}.json"
    if not hist_path.exists():
        return symbol, None
    try:
        with open(hist_path, "r", encoding="utf-8") as f:
            records = json.load(f)["data"]
        if len(records) < 260:
            return symbol, None

        opens = np.array([r["open"] for r in records], dtype=float)
        highs = np.array([r["high"] for r in records], dtype=float)
        lows = np.array([r["low"] for r in records], dtype=float)
        closes = np.array([r["close"] for r in records], dtype=float)
        volumes = np.array([r["volume"] for r in records], dtype=float)
        volumes = np.nan_to_num(volumes, nan=0.0)

        indicator_results = {}
        for ind in BACKTEST_INDICATORS:
            try:
                sig_arr = ind["fn"](opens, highs, lows, closes, volumes)
                events = extract_signal_events(sig_arr, closes)
                stats = aggregate_stats(ind["name"], ind["label"], events)
                indicator_results[ind["name"]] = {
                    "label": ind["label"],
                    "event_count": len(events),
                    "stats": [
                        {
                            "signal_type": s.signal_type,
                            "holding_period": s.holding_period,
                            "total_signals": s.total_signals,
                            "win_rate": round(s.win_rate, 4),
                            "avg_return": round(s.avg_return, 6),
                            "avg_win": round(s.avg_win, 6),
                            "avg_loss": round(s.avg_loss, 6),
                            "profit_factor": round(s.profit_factor, 4),
                            "max_win": round(s.max_win, 6),
                            "max_loss": round(s.max_loss, 6),
                        }
                        for s in stats
                    ],
                }
            except Exception:
                indicator_results[ind["name"]] = {"label": ind["label"], "event_count": 0, "stats": []}

        return symbol, indicator_results
    except Exception:
        return symbol, None


def build_backtest(symbols: list[str]):
    """Run backtest across all symbols and aggregate."""
    total = len(symbols)
    per_symbol = {}
    done = 0

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_backtest_from_file, sym): sym for sym in symbols}
        for future in as_completed(futures):
            done += 1
            sym, result = future.result()
            if result:
                per_symbol[sym] = result
            if done % 50 == 0 or done == total:
                print(f"[backtest] {done}/{total}  analyzed={len(per_symbol)}")

    # Aggregate stats across all symbols per indicator
    aggregated = {}
    for ind in BACKTEST_INDICATORS:
        name = ind["name"]
        all_stats_map: dict[str, list] = {}
        for sym, sym_data in per_symbol.items():
            if name not in sym_data:
                continue
            for s in sym_data[name]["stats"]:
                key = f"{s['signal_type']}_{s['holding_period']}"
                if key not in all_stats_map:
                    all_stats_map[key] = []
                if s["total_signals"] > 0:
                    all_stats_map[key].append(s)

        agg_stats = []
        for key, stat_list in all_stats_map.items():
            if not stat_list:
                continue
            n = len(stat_list)
            agg_stats.append({
                "signal_type": stat_list[0]["signal_type"],
                "holding_period": stat_list[0]["holding_period"],
                "symbols_count": n,
                "avg_win_rate": round(sum(s["win_rate"] for s in stat_list) / n, 4),
                "avg_return": round(sum(s["avg_return"] for s in stat_list) / n, 6),
                "avg_profit_factor": round(sum(s["profit_factor"] for s in stat_list) / n, 4),
                "total_signals": sum(s["total_signals"] for s in stat_list),
            })

        aggregated[name] = {
            "label": ind["label"],
            "stats": agg_stats,
        }

    backtest_data = {
        "per_symbol": per_symbol,
        "aggregated": aggregated,
        "timestamp": time.time(),
    }

    outpath = OUT / "backtest.json"
    with open(outpath, "w", encoding="utf-8") as f:
        json.dump(backtest_data, f)
    print(f"[backtest] {len(per_symbol)} symbols -> {outpath.name}")


# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Build static data for BIST app")
    parser.add_argument("--skip-financials", action="store_true", help="Skip financial statement fetch")
    parser.add_argument("--skip-backtest", action="store_true", help="Skip backtest computation")
    parser.add_argument("--skip-history", action="store_true", help="Skip OHLCV history fetch (use existing)")
    parser.add_argument("--symbols", type=str, help="Comma-separated symbols to process (default: all)")
    args = parser.parse_args()

    # Ensure output dirs exist
    OUT.mkdir(parents=True, exist_ok=True)
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    FINANCIALS_DIR.mkdir(parents=True, exist_ok=True)

    start = time.time()

    # 1. Symbols
    print("=" * 60)
    print("STEP 1: Symbols")
    print("=" * 60)
    sym_data = build_symbols()

    all_stocks = [s["name"] for s in sym_data.get("stocks", [])]
    if args.symbols:
        requested = [s.strip().upper() for s in args.symbols.split(",")]
        all_stocks = [s for s in all_stocks if s in requested]
        print(f"Filtered to {len(all_stocks)} symbols: {all_stocks[:10]}...")

    # 2. History
    if not args.skip_history:
        print("\n" + "=" * 60)
        print(f"STEP 2: History ({len(all_stocks)} symbols)")
        print("=" * 60)
        build_history(all_stocks)
    else:
        print("\n[history] Skipped (--skip-history)")

    # 3. Scan
    print("\n" + "=" * 60)
    print(f"STEP 3: Scan / Indicators ({len(all_stocks)} symbols)")
    print("=" * 60)
    build_scan(all_stocks)

    # 4. Financials
    if not args.skip_financials:
        print("\n" + "=" * 60)
        print(f"STEP 4: Financials ({len(all_stocks)} symbols)")
        print("=" * 60)
        build_financials(all_stocks)
    else:
        print("\n[financials] Skipped (--skip-financials)")

    # 5. Backtest
    if not args.skip_backtest:
        print("\n" + "=" * 60)
        print(f"STEP 5: Backtest ({len(all_stocks)} symbols)")
        print("=" * 60)
        build_backtest(all_stocks)
    else:
        print("\n[backtest] Skipped (--skip-backtest)")

    elapsed = time.time() - start
    print(f"\n{'=' * 60}")
    print(f"DONE in {elapsed:.1f}s")
    print(f"Output: {OUT}")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
