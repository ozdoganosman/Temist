"""
Backtest engine — compute indicator signals at every bar,
detect signal transitions, measure forward returns, aggregate stats.

Uses the same helper functions as indicators.py.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from indicators import (
    ema, sma, wilder_smooth, true_range,
    rolling_highest, rolling_lowest, stdev,
)

# ──────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────

HOLDING_PERIODS = [5, 10, 20, 60]


# ──────────────────────────────────────────────
# Data classes
# ──────────────────────────────────────────────

@dataclass
class SignalEvent:
    bar_index: int
    signal_type: str          # "bullish" | "bearish"
    entry_price: float
    returns: dict[int, float | None] = field(default_factory=dict)


@dataclass
class IndicatorStats:
    indicator_name: str
    indicator_label: str
    signal_type: str          # "bullish" | "bearish"
    holding_period: int
    total_signals: int
    win_rate: float
    avg_return: float
    avg_win: float
    avg_loss: float
    profit_factor: float
    max_win: float
    max_loss: float


# ──────────────────────────────────────────────
# Signal array functions
# Each returns np.ndarray of int8: 0=neutral, 1=bullish, -1=bearish
# ──────────────────────────────────────────────

def rsi_signals(closes: np.ndarray, period: int = 14) -> np.ndarray:
    """RSI signals at every bar. <30 bullish, >70 bearish."""
    n = len(closes)
    signals = np.zeros(n, dtype=np.int8)
    if n < period + 1:
        return signals

    deltas = np.diff(closes)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = wilder_smooth(gains, period)
    avg_loss = wilder_smooth(losses, period)

    for i in range(len(avg_gain)):
        ag = avg_gain[i]
        al = avg_loss[i]
        if np.isnan(ag) or np.isnan(al):
            continue
        if al == 0:
            rsi = 100.0
        else:
            rsi = 100.0 - 100.0 / (1.0 + ag / al)

        bar_idx = i + 1
        if bar_idx < n:
            if rsi < 30:
                signals[bar_idx] = 1
            elif rsi > 70:
                signals[bar_idx] = -1

    return signals


def macd_signals(
    closes: np.ndarray,
    fast: int = 12, slow: int = 26, signal_period: int = 9,
) -> np.ndarray:
    """MACD signals. Histogram > 0 + MACD > 0 = bullish."""
    n = len(closes)
    signals = np.zeros(n, dtype=np.int8)
    if n < slow + signal_period:
        return signals

    fast_ema = ema(closes, fast)
    slow_ema = ema(closes, slow)
    macd_line = fast_ema - slow_ema
    signal_line = ema(macd_line, signal_period)
    histogram = macd_line - signal_line

    for i in range(slow + signal_period, n):
        if np.isnan(histogram[i]) or np.isnan(macd_line[i]):
            continue
        if histogram[i] > 0 and macd_line[i] > 0:
            signals[i] = 1
        elif histogram[i] < 0 and macd_line[i] < 0:
            signals[i] = -1

    return signals


def bollinger_signals(
    closes: np.ndarray, period: int = 20, mult: float = 2.0,
) -> np.ndarray:
    """Bollinger Bands signals. Below lower = bullish, above upper = bearish."""
    n = len(closes)
    signals = np.zeros(n, dtype=np.int8)
    if n < period:
        return signals

    middle = sma(closes, period)
    sd = stdev(closes, period)

    for i in range(period - 1, n):
        if np.isnan(middle[i]) or np.isnan(sd[i]):
            continue
        upper = middle[i] + mult * sd[i]
        lower = middle[i] - mult * sd[i]
        if closes[i] < lower:
            signals[i] = 1
        elif closes[i] > upper:
            signals[i] = -1

    return signals


def stoch_rsi_signals(
    closes: np.ndarray,
    rsi_period: int = 14, stoch_period: int = 14,
    k_smooth: int = 3, d_smooth: int = 3,
) -> np.ndarray:
    """Stochastic RSI signals. K < 20 = bullish, K > 80 = bearish."""
    n = len(closes)
    signals = np.zeros(n, dtype=np.int8)
    if n < rsi_period + stoch_period + k_smooth:
        return signals

    # RSI
    deltas = np.diff(closes)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = wilder_smooth(gains, rsi_period)
    avg_loss = wilder_smooth(losses, rsi_period)

    rsi_vals = np.full(n, np.nan)
    for i in range(len(avg_gain)):
        ag = avg_gain[i]
        al = avg_loss[i]
        if np.isnan(ag) or np.isnan(al):
            continue
        if al == 0:
            rsi_vals[i + 1] = 100.0
        else:
            rsi_vals[i + 1] = 100.0 - 100.0 / (1.0 + ag / al)

    # Stochastic of RSI
    stoch_k_raw = np.full(n, np.nan)
    for i in range(stoch_period - 1, n):
        window = rsi_vals[max(0, i - stoch_period + 1):i + 1]
        valid = window[~np.isnan(window)]
        if len(valid) < stoch_period:
            continue
        hi = np.max(valid)
        lo = np.min(valid)
        rng = hi - lo
        if rng == 0:
            stoch_k_raw[i] = 50.0
        else:
            stoch_k_raw[i] = ((rsi_vals[i] - lo) / rng) * 100.0

    k_line = sma(stoch_k_raw, k_smooth)

    for i in range(n):
        if np.isnan(k_line[i]):
            continue
        if k_line[i] < 20:
            signals[i] = 1
        elif k_line[i] > 80:
            signals[i] = -1

    return signals


def adx_signals(
    highs: np.ndarray, lows: np.ndarray, closes: np.ndarray,
    period: int = 14,
) -> np.ndarray:
    """ADX signals. ADX > 25 + DI direction."""
    n = len(closes)
    signals = np.zeros(n, dtype=np.int8)
    if n < period * 2:
        return signals

    plus_dm = np.full(n, 0.0)
    minus_dm = np.full(n, 0.0)
    tr = true_range(highs, lows, closes)

    for i in range(1, n):
        up = highs[i] - highs[i - 1]
        down = lows[i - 1] - lows[i]
        if up > down and up > 0:
            plus_dm[i] = up
        if down > up and down > 0:
            minus_dm[i] = down

    atr = wilder_smooth(tr, period)
    smooth_plus = wilder_smooth(plus_dm, period)
    smooth_minus = wilder_smooth(minus_dm, period)

    plus_di = np.full(n, np.nan)
    minus_di = np.full(n, np.nan)
    dx = np.full(n, np.nan)

    for i in range(n):
        if np.isnan(atr[i]) or atr[i] == 0:
            continue
        plus_di[i] = (smooth_plus[i] / atr[i]) * 100
        minus_di[i] = (smooth_minus[i] / atr[i]) * 100
        di_sum = plus_di[i] + minus_di[i]
        if di_sum > 0:
            dx[i] = abs(plus_di[i] - minus_di[i]) / di_sum * 100

    adx_line = wilder_smooth(dx, period)

    for i in range(n):
        if np.isnan(adx_line[i]) or np.isnan(plus_di[i]) or np.isnan(minus_di[i]):
            continue
        if adx_line[i] > 25 and plus_di[i] > minus_di[i]:
            signals[i] = 1
        elif adx_line[i] > 25 and minus_di[i] > plus_di[i]:
            signals[i] = -1

    return signals


def supertrend_signals(
    highs: np.ndarray, lows: np.ndarray, closes: np.ndarray,
    atr_period: int = 10, multiplier: float = 3.0,
) -> np.ndarray:
    """SuperTrend signals. Direction 1 = bullish, -1 = bearish."""
    n = len(closes)
    signals = np.zeros(n, dtype=np.int8)
    if n < atr_period + 1:
        return signals

    tr = true_range(highs, lows, closes)
    atr = wilder_smooth(tr, atr_period)
    hl2 = (highs + lows) / 2.0

    upper_band = np.full(n, np.nan)
    lower_band = np.full(n, np.nan)
    direction = np.zeros(n, dtype=int)

    for i in range(atr_period, n):
        if np.isnan(atr[i]):
            continue

        basic_upper = hl2[i] + multiplier * atr[i]
        basic_lower = hl2[i] - multiplier * atr[i]

        if i > atr_period and not np.isnan(upper_band[i - 1]):
            upper_band[i] = basic_upper if (basic_upper < upper_band[i - 1] or closes[i - 1] > upper_band[i - 1]) else upper_band[i - 1]
        else:
            upper_band[i] = basic_upper

        if i > atr_period and not np.isnan(lower_band[i - 1]):
            lower_band[i] = basic_lower if (basic_lower > lower_band[i - 1] or closes[i - 1] < lower_band[i - 1]) else lower_band[i - 1]
        else:
            lower_band[i] = basic_lower

        if i == atr_period:
            direction[i] = 1 if closes[i] > upper_band[i] else -1
        else:
            prev_dir = direction[i - 1]
            if prev_dir == -1 and closes[i] > upper_band[i]:
                direction[i] = 1
            elif prev_dir == 1 and closes[i] < lower_band[i]:
                direction[i] = -1
            else:
                direction[i] = prev_dir

        signals[i] = direction[i]

    return signals


def ichimoku_signals(
    highs: np.ndarray, lows: np.ndarray, closes: np.ndarray,
    tenkan_p: int = 9, kijun_p: int = 26, senkou_b_p: int = 52,
) -> np.ndarray:
    """Ichimoku signals. Tenkan/Kijun cross + cloud position."""
    n = len(closes)
    signals = np.zeros(n, dtype=np.int8)
    if n < senkou_b_p:
        return signals

    def midpoint(h, l, period):
        out = np.full(n, np.nan)
        for i in range(period - 1, n):
            out[i] = (np.max(h[i - period + 1:i + 1]) + np.min(l[i - period + 1:i + 1])) / 2
        return out

    tenkan = midpoint(highs, lows, tenkan_p)
    kijun = midpoint(highs, lows, kijun_p)
    senkou_a = np.full(n, np.nan)
    for i in range(n):
        if not np.isnan(tenkan[i]) and not np.isnan(kijun[i]):
            senkou_a[i] = (tenkan[i] + kijun[i]) / 2
    senkou_b = midpoint(highs, lows, senkou_b_p)

    for i in range(senkou_b_p, n):
        if np.isnan(tenkan[i]) or np.isnan(kijun[i]):
            continue
        # Cloud at displaced position
        cloud_idx = i - kijun_p
        if cloud_idx < 0:
            continue
        sa = senkou_a[cloud_idx] if not np.isnan(senkou_a[cloud_idx]) else None
        sb = senkou_b[cloud_idx] if not np.isnan(senkou_b[cloud_idx]) else None

        bull_score = 0
        # Tenkan > Kijun
        if tenkan[i] > kijun[i]:
            bull_score += 1
        elif tenkan[i] < kijun[i]:
            bull_score -= 1
        # Price vs cloud
        if sa is not None and sb is not None:
            cloud_top = max(sa, sb)
            cloud_bottom = min(sa, sb)
            if closes[i] > cloud_top:
                bull_score += 1
            elif closes[i] < cloud_bottom:
                bull_score -= 1

        if bull_score >= 2:
            signals[i] = 1
        elif bull_score <= -2:
            signals[i] = -1

    return signals


def obv_signals(
    closes: np.ndarray, volumes: np.ndarray, ema_period: int = 20,
) -> np.ndarray:
    """OBV signals. OBV > EMA = bullish."""
    n = len(closes)
    signals = np.zeros(n, dtype=np.int8)
    if n < ema_period + 1:
        return signals

    obv = np.zeros(n)
    for i in range(1, n):
        if closes[i] > closes[i - 1]:
            obv[i] = obv[i - 1] + volumes[i]
        elif closes[i] < closes[i - 1]:
            obv[i] = obv[i - 1] - volumes[i]
        else:
            obv[i] = obv[i - 1]

    obv_ema = ema(obv, ema_period)

    for i in range(n):
        if np.isnan(obv_ema[i]):
            continue
        if obv[i] > obv_ema[i]:
            signals[i] = 1
        elif obv[i] < obv_ema[i]:
            signals[i] = -1

    return signals


def williams_pasa_signals(
    highs: np.ndarray, lows: np.ndarray, closes: np.ndarray,
    length: int = 260, ema_len: int = 260
) -> np.ndarray:
    """Williams Pasa signals at every bar. <5 bullish, >98 bearish."""
    n = len(closes)
    signals = np.zeros(n, dtype=np.int8)
    if n < length + ema_len:
        return signals

    hh = rolling_highest(highs, length)
    ll = rolling_lowest(lows, length)

    percent_r = np.full(n, np.nan)
    for i in range(length - 1, n):
        h_val = hh[i]
        l_val = ll[i]
        if np.isnan(h_val) or np.isnan(l_val):
            continue
        rng = h_val - l_val
        if rng == 0:
            percent_r[i] = 50.0
        else:
            percent_r[i] = 100.0 * (closes[i] - l_val) / rng

    for i in range(length - 1, n):
        r_val = percent_r[i]
        if np.isnan(r_val):
            continue
        if r_val < 5:
            signals[i] = 1
        elif r_val > 98:
            signals[i] = -1

    return signals


def nizami_cedid_signals(
    closes: np.ndarray, volumes: np.ndarray,
    fast: int = 120, slow: int = 260, signal: int = 50, vwma_len: int = 185
) -> np.ndarray:
    """NizamiCedid signals. delta = macd - eMacD. delta > 0 bullish, delta < 0 bearish."""
    n = len(closes)
    signals = np.zeros(n, dtype=np.int8)
    if n < slow + vwma_len:
        return signals

    fast_ma = ema(closes, fast)
    slow_ma = ema(closes, slow)
    macd = fast_ma - slow_ma

    vol_clean = np.nan_to_num(volumes, nan=0.0)
    macd_clean = np.nan_to_num(macd, nan=0.0)
    macd_vol = macd_clean * vol_clean
    
    sum_macd_vol = sma(macd_vol, vwma_len)
    sum_vol = sma(vol_clean, vwma_len)

    e_macd = np.full(n, np.nan)
    for i in range(n):
        sv = sum_vol[i]
        smv = sum_macd_vol[i]
        if not np.isnan(sv) and not np.isnan(smv) and sv > 0:
            e_macd[i] = smv / sv

    delta = macd - e_macd

    for i in range(n):
        d_val = delta[i]
        if np.isnan(d_val):
            continue
        if d_val > 0:
            signals[i] = 1
        elif d_val < 0:
            signals[i] = -1

    return signals


# ──────────────────────────────────────────────
# Backtest indicator registry
# ──────────────────────────────────────────────

BACKTEST_INDICATORS: list[dict] = [
    {
        "name": "rsi",
        "label": "RSI",
        "fn": lambda o, h, l, c, v: rsi_signals(c),
    },
    {
        "name": "macd",
        "label": "MACD",
        "fn": lambda o, h, l, c, v: macd_signals(c),
    },
    {
        "name": "bollinger",
        "label": "Bollinger Bands",
        "fn": lambda o, h, l, c, v: bollinger_signals(c),
    },
    {
        "name": "stoch_rsi",
        "label": "Stochastic RSI",
        "fn": lambda o, h, l, c, v: stoch_rsi_signals(c),
    },
    {
        "name": "adx",
        "label": "ADX",
        "fn": lambda o, h, l, c, v: adx_signals(h, l, c),
    },
    {
        "name": "supertrend",
        "label": "SuperTrend",
        "fn": lambda o, h, l, c, v: supertrend_signals(h, l, c),
    },
    {
        "name": "ichimoku",
        "label": "Ichimoku",
        "fn": lambda o, h, l, c, v: ichimoku_signals(h, l, c),
    },
    {
        "name": "obv",
        "label": "OBV",
        "fn": lambda o, h, l, c, v: obv_signals(c, v),
    },
    {
        "name": "williams_pasa",
        "label": "Williams Pasa",
        "fn": lambda o, h, l, c, v: williams_pasa_signals(h, l, c),
    },
    {
        "name": "nizami_cedid",
        "label": "Nizami Cedid",
        "fn": lambda o, h, l, c, v: nizami_cedid_signals(c, v),
    },
]


# ──────────────────────────────────────────────
# Signal event extraction
# ──────────────────────────────────────────────

def extract_signal_events(
    signals: np.ndarray,
    closes: np.ndarray,
    holding_periods: list[int] | None = None,
) -> list[SignalEvent]:
    """
    Detect signal transitions (neutral→bullish or neutral→bearish)
    and measure forward returns at each holding period.
    """
    if holding_periods is None:
        holding_periods = HOLDING_PERIODS

    events: list[SignalEvent] = []
    n = len(signals)
    prev_signal = 0

    for i in range(1, n):
        curr = int(signals[i])
        if curr != 0 and curr != prev_signal:
            entry_price = float(closes[i])
            if entry_price <= 0:
                prev_signal = curr
                continue

            returns: dict[int, float | None] = {}
            for hp in holding_periods:
                if i + hp < n:
                    exit_price = float(closes[i + hp])
                    returns[hp] = (exit_price - entry_price) / entry_price
                else:
                    returns[hp] = None

            events.append(SignalEvent(
                bar_index=i,
                signal_type="bullish" if curr == 1 else "bearish",
                entry_price=entry_price,
                returns=returns,
            ))

        if curr != 0:
            prev_signal = curr

    return events


# ──────────────────────────────────────────────
# Stats aggregation
# ──────────────────────────────────────────────

def aggregate_stats(
    indicator_name: str,
    indicator_label: str,
    events: list[SignalEvent],
    holding_periods: list[int] | None = None,
) -> list[IndicatorStats]:
    """Aggregate events into stats per signal_type x holding_period."""
    if holding_periods is None:
        holding_periods = HOLDING_PERIODS

    results: list[IndicatorStats] = []

    for sig_type in ("bullish", "bearish"):
        typed_events = [e for e in events if e.signal_type == sig_type]

        for hp in holding_periods:
            rets = [
                e.returns[hp]
                for e in typed_events
                if e.returns.get(hp) is not None
            ]

            if not rets:
                results.append(IndicatorStats(
                    indicator_name=indicator_name,
                    indicator_label=indicator_label,
                    signal_type=sig_type,
                    holding_period=hp,
                    total_signals=0,
                    win_rate=0.0,
                    avg_return=0.0,
                    avg_win=0.0,
                    avg_loss=0.0,
                    profit_factor=0.0,
                    max_win=0.0,
                    max_loss=0.0,
                ))
                continue

            wins = [r for r in rets if r > 0]
            losses = [r for r in rets if r <= 0]

            sum_wins = sum(wins) if wins else 0.0
            sum_losses = abs(sum(losses)) if losses else 0.0

            results.append(IndicatorStats(
                indicator_name=indicator_name,
                indicator_label=indicator_label,
                signal_type=sig_type,
                holding_period=hp,
                total_signals=len(rets),
                win_rate=len(wins) / len(rets),
                avg_return=sum(rets) / len(rets),
                avg_win=sum(wins) / len(wins) if wins else 0.0,
                avg_loss=sum(losses) / len(losses) if losses else 0.0,
                profit_factor=sum_wins / sum_losses if sum_losses > 0 else 9999.0,
                max_win=max(wins) if wins else 0.0,
                max_loss=min(losses) if losses else 0.0,
            ))

    return results


# ──────────────────────────────────────────────
# Per-symbol backtest worker
# ──────────────────────────────────────────────

def backtest_symbol(
    symbol: str,
    ticker_cls: Any,
) -> dict[str, list[SignalEvent]] | None:
    """
    Fetch full OHLCV for one symbol.
    Compute signals + events for each backtestable indicator.
    Returns {indicator_name: [SignalEvent, ...]} or None.
    """
    try:
        t = ticker_cls(symbol)
        df = t.history(period="max", interval="1d")
        if df is None or len(df) < 60:
            return None

        opens = df["Open"].to_numpy(dtype=float)
        highs = df["High"].to_numpy(dtype=float)
        lows = df["Low"].to_numpy(dtype=float)
        closes = df["Close"].to_numpy(dtype=float)
        volumes = np.nan_to_num(df["Volume"].to_numpy(dtype=float), nan=0.0)

        result: dict[str, list[SignalEvent]] = {}

        for ind in BACKTEST_INDICATORS:
            try:
                sig_arr = ind["fn"](opens, highs, lows, closes, volumes)
                events = extract_signal_events(sig_arr, closes)
                result[ind["name"]] = events
            except Exception:
                result[ind["name"]] = []

        return result
    except Exception:
        return None
