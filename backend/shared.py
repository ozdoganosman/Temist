"""Shared state, constants, and utilities used across router modules."""
import asyncio
import json
import os
import pickle
import re
import threading
from datetime import datetime
from pathlib import Path

import requests as _requests
import urllib3
import isyatirimhisse.FetchFinancials as _ff_mod

from config import CACHE_DIR, CACHE_TTL
from log import get_logger

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Load all BIST symbols from JSON file
# ---------------------------------------------------------------------------
_symbols_file = Path(__file__).parent / "bist_symbols.json"
with open(_symbols_file, "r", encoding="utf-8") as _f:
    _symbols_data = json.load(_f)

BIST_SYMBOLS = _symbols_data["stocks"]
BIST_INDICES = _symbols_data["indices"]

# ---------------------------------------------------------------------------
# Symbols that use UFRS/IFRS financial group (banks, insurance, leasing etc.)
# ---------------------------------------------------------------------------
BANK_SYMBOLS = {
    "GARAN", "AKBNK", "YKBNK", "HALKB", "VAKBN", "ISCTR", "TSKB", "ALBRK",
    "SKBNK", "ICBCT", "QNBFK", "QNBTR", "KLNMA", "ISATR", "ISBTR", "ISKUR",
    "ISFIN", "SEKFK", "VAKFN",
}

# ---------------------------------------------------------------------------
# Symbol validation
# ---------------------------------------------------------------------------
_SYMBOL_RE = re.compile(r'^[A-Za-z0-9._-]+$')


def _validate_symbol(symbol: str) -> str:
    """Validate and sanitize a symbol name to prevent path traversal."""
    if not _SYMBOL_RE.match(symbol):
        raise ValueError(f"Invalid symbol: {symbol}")
    return symbol


# ---------------------------------------------------------------------------
# Active WebSocket connections for streaming
# ---------------------------------------------------------------------------
active_connections: dict[str, set] = {}
_connections_lock = threading.Lock()
stream_tasks: dict[str, asyncio.Task] = {}

# ---------------------------------------------------------------------------
# SSL bypass setup for isyatirimhisse
# ---------------------------------------------------------------------------
_ff_mod._SSL_VERIFY = False
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

_orig_requests_get = _requests.get

# Reusable session for SSL-bypassed requests
_no_ssl_session = _requests.Session()
_no_ssl_session.verify = False
_no_ssl_session.trust_env = False  # Ignore REQUESTS_CA_BUNDLE, SSL_CERT_FILE, proxy env


def _get_no_ssl(*args, **kwargs):
    """requests.get wrapper that fully bypasses SSL verification."""
    kwargs["verify"] = False
    return _no_ssl_session.get(*args, **kwargs)


_ff_mod.requests.get = _get_no_ssl

from isyatirimhisse import fetch_financials as isy_fetch_financials

# Ensure cache directory exists
CACHE_DIR.mkdir(exist_ok=True)


# ---------------------------------------------------------------------------
# Cached financials helper
# ---------------------------------------------------------------------------
def _get_cached_financials(symbol: str, fg: str):
    """Return cached DataFrame if fresh, else fetch from API and cache."""
    symbol = _validate_symbol(symbol)
    cache_file = CACHE_DIR / f"{symbol}_{fg}.pkl"

    # Check if cache exists and is fresh
    if cache_file.exists():
        age = datetime.now().timestamp() - cache_file.stat().st_mtime
        if age < CACHE_TTL:
            try:
                with open(cache_file, "rb") as f:
                    df = pickle.load(f)
                logger.debug("Cache hit: %s (age %ds)", symbol, int(age))
                return df
            except Exception:
                pass  # corrupted cache, re-fetch

    # Fetch from API (SSL verification disabled globally above)
    logger.info("Fetching financials for %s", symbol)
    df = isy_fetch_financials(
        symbols=symbol,
        start_year=2005,
        end_year=datetime.now().year,
        exchange="TRY",
        financial_group=fg,
    )

    # Save to cache
    if df is not None and not df.empty:
        try:
            with open(cache_file, "wb") as f:
                pickle.dump(df, f)
            logger.debug("Cached %s (%d rows)", symbol, len(df))
        except Exception as e:
            logger.warning("Cache write error: %s", e)

    return df
