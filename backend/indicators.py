"""
Extensible indicator framework for BIST market scanning.

9-indicator professional set:
  1. RSI (Relative Strength Index)
  2. MACD (Moving Average Convergence Divergence)
  3. Bollinger Bands
  4. Stochastic RSI
  5. ADX / DMI (Average Directional Index)
  6. SuperTrend
  7. Ichimoku Cloud
  8. OBV (On Balance Volume)
  9. ATR (Average True Range)

To add a new indicator:
  1. Create a class extending BaseIndicator
  2. Implement the compute() method
  3. Append an instance to INDICATOR_REGISTRY
"""

from __future__ import annotations

import math
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

import numpy as np


# ──────────────────────────────────────────────
# Data classes
# ──────────────────────────────────────────────

@dataclass
class IndicatorResult:
    """Standardized result from any indicator."""
    name: str
    label: str
    score: float
    signal: str        # "bullish" | "bearish" | "neutral"
    details: dict[str, Any] = field(default_factory=dict)


class BaseIndicator(ABC):
    """Abstract base — every indicator must implement compute()."""

    @property
    @abstractmethod
    def name(self) -> str: ...

    @property
    @abstractmethod
    def label(self) -> str: ...

    @abstractmethod
    def compute(
        self,
        opens: np.ndarray,
        highs: np.ndarray,
        lows: np.ndarray,
        closes: np.ndarray,
        volumes: np.ndarray,
    ) -> IndicatorResult | None:
        """Return result or None if insufficient data."""
        ...


# ──────────────────────────────────────────────
# Helper functions
# ──────────────────────────────────────────────

def ema(src: np.ndarray, period: int) -> np.ndarray:
    """Exponential moving average."""
    out = np.full(len(src), np.nan)
    k = 2.0 / (period + 1)
    prev = None
    for i in range(len(src)):
        v = src[i]
        if np.isnan(v):
            continue
        if prev is None:
            prev = v
        else:
            prev = v * k + prev * (1 - k)
        out[i] = prev
    return out


def sma(src: np.ndarray, period: int) -> np.ndarray:
    """Simple moving average."""
    n = len(src)
    out = np.full(n, np.nan)
    for i in range(period - 1, n):
        window = src[i - period + 1:i + 1]
        if np.any(np.isnan(window)):
            continue
        out[i] = np.mean(window)
    return out


def wilder_smooth(src: np.ndarray, period: int) -> np.ndarray:
    """Wilder's smoothing method (used in RSI, ADX, ATR)."""
    out = np.full(len(src), np.nan)
    k = 1.0 / period
    prev = None
    for i in range(len(src)):
        v = src[i]
        if np.isnan(v):
            continue
        if prev is None:
            prev = v
        else:
            prev = v * k + prev * (1 - k)
        out[i] = prev
    return out


def true_range(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray) -> np.ndarray:
    """True Range: max(H-L, |H-prevC|, |L-prevC|)."""
    n = len(closes)
    tr = np.full(n, np.nan)
    tr[0] = highs[0] - lows[0]
    for i in range(1, n):
        hl = highs[i] - lows[i]
        hc = abs(highs[i] - closes[i - 1])
        lc = abs(lows[i] - closes[i - 1])
        tr[i] = max(hl, hc, lc)
    return tr


def rolling_highest(highs: np.ndarray, period: int) -> np.ndarray:
    """Rolling highest high."""
    n = len(highs)
    out = np.full(n, np.nan)
    for i in range(period - 1, n):
        out[i] = np.max(highs[max(0, i - period + 1):i + 1])
    return out


def rolling_lowest(lows: np.ndarray, period: int) -> np.ndarray:
    """Rolling lowest low."""
    n = len(lows)
    out = np.full(n, np.nan)
    for i in range(period - 1, n):
        out[i] = np.min(lows[max(0, i - period + 1):i + 1])
    return out


def stdev(src: np.ndarray, period: int) -> np.ndarray:
    """Rolling standard deviation."""
    n = len(src)
    out = np.full(n, np.nan)
    for i in range(period - 1, n):
        window = src[i - period + 1:i + 1]
        if np.any(np.isnan(window)):
            continue
        out[i] = np.std(window, ddof=0)
    return out


# ──────────────────────────────────────────────
# 1. RSI (Relative Strength Index)
# ──────────────────────────────────────────────

class RSIIndicator(BaseIndicator):
    """RSI — momentum oscillator (0-100). <30 oversold, >70 overbought."""

    def __init__(self, period: int = 14):
        self._period = period

    @property
    def name(self) -> str:
        return "rsi"

    @property
    def label(self) -> str:
        return "RSI"

    def compute(self, opens, highs, lows, closes, volumes) -> IndicatorResult | None:
        n = len(closes)
        if n < self._period + 1:
            return None

        # Calculate gains and losses
        deltas = np.diff(closes)
        gains = np.where(deltas > 0, deltas, 0.0)
        losses = np.where(deltas < 0, -deltas, 0.0)

        avg_gain = wilder_smooth(gains, self._period)
        avg_loss = wilder_smooth(losses, self._period)

        rsi_vals = np.full(n, np.nan)
        for i in range(len(avg_gain)):
            ag = avg_gain[i]
            al = avg_loss[i]
            if np.isnan(ag) or np.isnan(al):
                continue
            if al == 0:
                rsi_vals[i + 1] = 100.0
            else:
                rs = ag / al
                rsi_vals[i + 1] = 100.0 - 100.0 / (1.0 + rs)

        last_rsi = float(rsi_vals[-1]) if not np.isnan(rsi_vals[-1]) else None
        if last_rsi is None:
            return None

        # Score: normalize 0-100 to -1..+1
        score = (last_rsi - 50) / 50.0

        if last_rsi < 30:
            signal = "bullish"  # oversold
        elif last_rsi > 70:
            signal = "bearish"  # overbought
        else:
            signal = "neutral"

        return IndicatorResult(
            name=self.name, label=self.label,
            score=round(score, 4), signal=signal,
            details={"rsi": round(last_rsi, 2)},
        )


# ──────────────────────────────────────────────
# 2. MACD
# ──────────────────────────────────────────────

class MACDIndicator(BaseIndicator):
    """MACD — trend + momentum. Standard 12/26/9."""

    def __init__(self, fast: int = 12, slow: int = 26, signal_period: int = 9):
        self._fast = fast
        self._slow = slow
        self._signal = signal_period

    @property
    def name(self) -> str:
        return "macd"

    @property
    def label(self) -> str:
        return "MACD"

    def compute(self, opens, highs, lows, closes, volumes) -> IndicatorResult | None:
        n = len(closes)
        if n < self._slow + self._signal:
            return None

        fast_ema = ema(closes, self._fast)
        slow_ema = ema(closes, self._slow)
        macd_line = fast_ema - slow_ema
        signal_line = ema(macd_line, self._signal)
        histogram = macd_line - signal_line

        last_macd = float(macd_line[-1]) if not np.isnan(macd_line[-1]) else None
        last_signal = float(signal_line[-1]) if not np.isnan(signal_line[-1]) else None
        last_hist = float(histogram[-1]) if not np.isnan(histogram[-1]) else None

        if last_macd is None or last_hist is None:
            return None

        # Normalize score by price for comparability
        last_close = float(closes[-1])
        norm_hist = last_hist / last_close if last_close > 0 else 0
        score = max(-1.0, min(1.0, norm_hist * 100))

        if last_hist > 0 and last_macd > 0:
            signal = "bullish"
        elif last_hist < 0 and last_macd < 0:
            signal = "bearish"
        else:
            signal = "neutral"

        return IndicatorResult(
            name=self.name, label=self.label,
            score=round(score, 4), signal=signal,
            details={
                "macd": round(last_macd, 4),
                "signal_line": round(last_signal, 4) if last_signal else None,
                "histogram": round(last_hist, 4),
            },
        )


# ──────────────────────────────────────────────
# 3. Bollinger Bands
# ──────────────────────────────────────────────

class BollingerBandsIndicator(BaseIndicator):
    """Bollinger Bands — volatility channels around SMA."""

    def __init__(self, period: int = 20, mult: float = 2.0):
        self._period = period
        self._mult = mult

    @property
    def name(self) -> str:
        return "bollinger"

    @property
    def label(self) -> str:
        return "Bollinger Bands"

    def compute(self, opens, highs, lows, closes, volumes) -> IndicatorResult | None:
        n = len(closes)
        if n < self._period:
            return None

        middle = sma(closes, self._period)
        sd = stdev(closes, self._period)

        upper = middle + self._mult * sd
        lower = middle - self._mult * sd

        last_close = float(closes[-1])
        last_upper = float(upper[-1]) if not np.isnan(upper[-1]) else None
        last_lower = float(lower[-1]) if not np.isnan(lower[-1]) else None
        last_middle = float(middle[-1]) if not np.isnan(middle[-1]) else None

        if last_upper is None or last_lower is None or last_middle is None:
            return None

        band_width = last_upper - last_lower
        if band_width == 0:
            return None

        # %B = (close - lower) / (upper - lower)
        pct_b = (last_close - last_lower) / band_width

        # Score: %B centered at 0.5, normalize to -1..+1
        score = max(-1.0, min(1.0, (pct_b - 0.5) * 2))

        # Bandwidth for squeeze detection
        bandwidth = band_width / last_middle if last_middle > 0 else 0

        if pct_b < 0.0:
            signal = "bullish"   # below lower band = oversold
        elif pct_b > 1.0:
            signal = "bearish"   # above upper band = overbought
        else:
            signal = "neutral"

        return IndicatorResult(
            name=self.name, label=self.label,
            score=round(score, 4), signal=signal,
            details={
                "upper": round(last_upper, 2),
                "middle": round(last_middle, 2),
                "lower": round(last_lower, 2),
                "pct_b": round(pct_b, 4),
                "bandwidth": round(bandwidth, 4),
            },
        )


# ──────────────────────────────────────────────
# 4. Stochastic RSI
# ──────────────────────────────────────────────

class StochRSIIndicator(BaseIndicator):
    """Stochastic RSI — RSI of RSI. More sensitive momentum oscillator."""

    def __init__(self, rsi_period: int = 14, stoch_period: int = 14,
                 k_smooth: int = 3, d_smooth: int = 3):
        self._rsi_period = rsi_period
        self._stoch_period = stoch_period
        self._k_smooth = k_smooth
        self._d_smooth = d_smooth

    @property
    def name(self) -> str:
        return "stoch_rsi"

    @property
    def label(self) -> str:
        return "Stochastic RSI"

    def compute(self, opens, highs, lows, closes, volumes) -> IndicatorResult | None:
        n = len(closes)
        if n < self._rsi_period + self._stoch_period + self._k_smooth:
            return None

        # Step 1: Compute RSI
        deltas = np.diff(closes)
        gains = np.where(deltas > 0, deltas, 0.0)
        losses = np.where(deltas < 0, -deltas, 0.0)
        avg_gain = wilder_smooth(gains, self._rsi_period)
        avg_loss = wilder_smooth(losses, self._rsi_period)

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

        # Step 2: Stochastic of RSI
        stoch_k_raw = np.full(n, np.nan)
        for i in range(self._stoch_period - 1, n):
            window = rsi_vals[max(0, i - self._stoch_period + 1):i + 1]
            valid = window[~np.isnan(window)]
            if len(valid) < self._stoch_period:
                continue
            hi = np.max(valid)
            lo = np.min(valid)
            rng = hi - lo
            if rng == 0:
                stoch_k_raw[i] = 50.0
            else:
                stoch_k_raw[i] = ((rsi_vals[i] - lo) / rng) * 100.0

        # Step 3: Smooth K and D
        k_line = sma(stoch_k_raw, self._k_smooth)
        d_line = sma(k_line, self._d_smooth)

        last_k = float(k_line[-1]) if not np.isnan(k_line[-1]) else None
        last_d = float(d_line[-1]) if not np.isnan(d_line[-1]) else None

        if last_k is None:
            return None

        score = (last_k - 50) / 50.0

        if last_k < 20:
            signal = "bullish"
        elif last_k > 80:
            signal = "bearish"
        else:
            signal = "neutral"

        return IndicatorResult(
            name=self.name, label=self.label,
            score=round(score, 4), signal=signal,
            details={
                "k": round(last_k, 2),
                "d": round(last_d, 2) if last_d is not None else None,
            },
        )


# ──────────────────────────────────────────────
# 5. ADX / DMI
# ──────────────────────────────────────────────

class ADXIndicator(BaseIndicator):
    """ADX — trend strength (0-100). >25 = strong trend. +DI/-DI for direction."""

    def __init__(self, period: int = 14):
        self._period = period

    @property
    def name(self) -> str:
        return "adx"

    @property
    def label(self) -> str:
        return "ADX"

    def compute(self, opens, highs, lows, closes, volumes) -> IndicatorResult | None:
        n = len(closes)
        if n < self._period * 2:
            return None

        # +DM and -DM
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

        # Smooth with Wilder
        atr = wilder_smooth(tr, self._period)
        smooth_plus = wilder_smooth(plus_dm, self._period)
        smooth_minus = wilder_smooth(minus_dm, self._period)

        # DI lines
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

        adx_line = wilder_smooth(dx, self._period)

        last_adx = float(adx_line[-1]) if not np.isnan(adx_line[-1]) else None
        last_plus = float(plus_di[-1]) if not np.isnan(plus_di[-1]) else None
        last_minus = float(minus_di[-1]) if not np.isnan(minus_di[-1]) else None

        if last_adx is None or last_plus is None or last_minus is None:
            return None

        # Score based on trend strength and direction
        direction = 1 if last_plus > last_minus else -1
        strength = min(last_adx / 50.0, 1.0)
        score = direction * strength

        if last_adx > 25 and last_plus > last_minus:
            signal = "bullish"
        elif last_adx > 25 and last_minus > last_plus:
            signal = "bearish"
        else:
            signal = "neutral"

        return IndicatorResult(
            name=self.name, label=self.label,
            score=round(score, 4), signal=signal,
            details={
                "adx": round(last_adx, 2),
                "plus_di": round(last_plus, 2),
                "minus_di": round(last_minus, 2),
            },
        )


# ──────────────────────────────────────────────
# 6. SuperTrend
# ──────────────────────────────────────────────

class SuperTrendIndicator(BaseIndicator):
    """SuperTrend — ATR-based trend follower. Green = bullish, Red = bearish."""

    def __init__(self, atr_period: int = 10, multiplier: float = 3.0):
        self._atr_period = atr_period
        self._mult = multiplier

    @property
    def name(self) -> str:
        return "supertrend"

    @property
    def label(self) -> str:
        return "SuperTrend"

    def compute(self, opens, highs, lows, closes, volumes) -> IndicatorResult | None:
        n = len(closes)
        if n < self._atr_period + 1:
            return None

        tr = true_range(highs, lows, closes)
        atr = wilder_smooth(tr, self._atr_period)

        hl2 = (highs + lows) / 2.0
        upper_band = np.full(n, np.nan)
        lower_band = np.full(n, np.nan)
        supertrend = np.full(n, np.nan)
        direction = np.zeros(n, dtype=int)  # 1=up, -1=down

        for i in range(self._atr_period, n):
            if np.isnan(atr[i]):
                continue

            basic_upper = hl2[i] + self._mult * atr[i]
            basic_lower = hl2[i] - self._mult * atr[i]

            # Final upper band
            if i > self._atr_period and not np.isnan(upper_band[i - 1]):
                if basic_upper < upper_band[i - 1] or closes[i - 1] > upper_band[i - 1]:
                    upper_band[i] = basic_upper
                else:
                    upper_band[i] = upper_band[i - 1]
            else:
                upper_band[i] = basic_upper

            # Final lower band
            if i > self._atr_period and not np.isnan(lower_band[i - 1]):
                if basic_lower > lower_band[i - 1] or closes[i - 1] < lower_band[i - 1]:
                    lower_band[i] = basic_lower
                else:
                    lower_band[i] = lower_band[i - 1]
            else:
                lower_band[i] = basic_lower

            # Direction
            if i == self._atr_period:
                direction[i] = 1 if closes[i] > upper_band[i] else -1
            else:
                prev_dir = direction[i - 1]
                if prev_dir == -1 and closes[i] > upper_band[i]:
                    direction[i] = 1
                elif prev_dir == 1 and closes[i] < lower_band[i]:
                    direction[i] = -1
                else:
                    direction[i] = prev_dir

            supertrend[i] = lower_band[i] if direction[i] == 1 else upper_band[i]

        last_dir = int(direction[-1])
        last_st = float(supertrend[-1]) if not np.isnan(supertrend[-1]) else None

        if last_st is None:
            return None

        score = float(last_dir)

        signal = "bullish" if last_dir == 1 else "bearish"

        return IndicatorResult(
            name=self.name, label=self.label,
            score=round(score, 4), signal=signal,
            details={
                "supertrend": round(last_st, 2),
                "direction": last_dir,
            },
        )


# ──────────────────────────────────────────────
# 7. Ichimoku Cloud
# ──────────────────────────────────────────────

class IchimokuIndicator(BaseIndicator):
    """Ichimoku Cloud — multi-signal system."""

    def __init__(self, tenkan: int = 9, kijun: int = 26, senkou_b: int = 52, displacement: int = 26):
        self._tenkan = tenkan
        self._kijun = kijun
        self._senkou_b = senkou_b
        self._disp = displacement

    @property
    def name(self) -> str:
        return "ichimoku"

    @property
    def label(self) -> str:
        return "Ichimoku"

    def compute(self, opens, highs, lows, closes, volumes) -> IndicatorResult | None:
        n = len(closes)
        if n < self._senkou_b + self._disp:
            return None

        def midpoint(h, l, period):
            out = np.full(n, np.nan)
            for i in range(period - 1, n):
                out[i] = (np.max(h[i - period + 1:i + 1]) + np.min(l[i - period + 1:i + 1])) / 2
            return out

        tenkan = midpoint(highs, lows, self._tenkan)
        kijun = midpoint(highs, lows, self._kijun)

        # Senkou Span A = (tenkan + kijun) / 2, displaced forward
        senkou_a = np.full(n, np.nan)
        for i in range(n):
            if not np.isnan(tenkan[i]) and not np.isnan(kijun[i]):
                senkou_a[i] = (tenkan[i] + kijun[i]) / 2

        # Senkou Span B = midpoint(52), displaced forward
        senkou_b = midpoint(highs, lows, self._senkou_b)

        # Current values (not displaced for signal detection)
        last_close = float(closes[-1])
        last_tenkan = float(tenkan[-1]) if not np.isnan(tenkan[-1]) else None
        last_kijun = float(kijun[-1]) if not np.isnan(kijun[-1]) else None

        # Cloud values at current position (displaced by kijun period back)
        cloud_idx = n - 1 - self._disp
        if cloud_idx < 0:
            return None
        last_span_a = float(senkou_a[cloud_idx]) if not np.isnan(senkou_a[cloud_idx]) else None
        last_span_b = float(senkou_b[cloud_idx]) if not np.isnan(senkou_b[cloud_idx]) else None

        if last_tenkan is None or last_kijun is None:
            return None

        # Score: multiple signals combined
        score = 0.0
        signals = 0

        # Tenkan > Kijun
        if last_tenkan > last_kijun:
            score += 0.25
        elif last_tenkan < last_kijun:
            score -= 0.25
        signals += 1

        # Price above/below cloud
        if last_span_a is not None and last_span_b is not None:
            cloud_top = max(last_span_a, last_span_b)
            cloud_bottom = min(last_span_a, last_span_b)
            if last_close > cloud_top:
                score += 0.5
            elif last_close < cloud_bottom:
                score -= 0.5
            signals += 1

            # Cloud color (Span A vs Span B)
            if last_span_a > last_span_b:
                score += 0.25
            else:
                score -= 0.25
            signals += 1

        score = max(-1.0, min(1.0, score))

        if score > 0.3:
            signal = "bullish"
        elif score < -0.3:
            signal = "bearish"
        else:
            signal = "neutral"

        return IndicatorResult(
            name=self.name, label=self.label,
            score=round(score, 4), signal=signal,
            details={
                "tenkan": round(last_tenkan, 2),
                "kijun": round(last_kijun, 2),
                "span_a": round(last_span_a, 2) if last_span_a is not None else None,
                "span_b": round(last_span_b, 2) if last_span_b is not None else None,
            },
        )


# ──────────────────────────────────────────────
# 8. OBV (On Balance Volume)
# ──────────────────────────────────────────────

class OBVIndicator(BaseIndicator):
    """OBV — cumulative volume-based trend confirmation."""

    def __init__(self, ema_period: int = 20):
        self._ema_period = ema_period

    @property
    def name(self) -> str:
        return "obv"

    @property
    def label(self) -> str:
        return "OBV"

    def compute(self, opens, highs, lows, closes, volumes) -> IndicatorResult | None:
        n = len(closes)
        if n < self._ema_period + 1:
            return None

        obv = np.zeros(n)
        for i in range(1, n):
            if closes[i] > closes[i - 1]:
                obv[i] = obv[i - 1] + volumes[i]
            elif closes[i] < closes[i - 1]:
                obv[i] = obv[i - 1] - volumes[i]
            else:
                obv[i] = obv[i - 1]

        obv_ema = ema(obv, self._ema_period)

        last_obv = float(obv[-1])
        last_ema = float(obv_ema[-1]) if not np.isnan(obv_ema[-1]) else None

        if last_ema is None:
            return None

        # Score: OBV vs its EMA, normalized
        if last_ema != 0:
            diff_ratio = (last_obv - last_ema) / abs(last_ema)
            score = max(-1.0, min(1.0, diff_ratio * 10))
        else:
            score = 0.0

        if last_obv > last_ema:
            signal = "bullish"
        elif last_obv < last_ema:
            signal = "bearish"
        else:
            signal = "neutral"

        return IndicatorResult(
            name=self.name, label=self.label,
            score=round(score, 4), signal=signal,
            details={
                "obv": round(last_obv, 0),
                "obv_ema": round(last_ema, 0),
            },
        )


# ──────────────────────────────────────────────
# 9. ATR (Average True Range)
# ──────────────────────────────────────────────

class ATRIndicator(BaseIndicator):
    """ATR — volatility measurement. Used for risk/position sizing."""

    def __init__(self, period: int = 14):
        self._period = period

    @property
    def name(self) -> str:
        return "atr"

    @property
    def label(self) -> str:
        return "ATR"

    def compute(self, opens, highs, lows, closes, volumes) -> IndicatorResult | None:
        n = len(closes)
        if n < self._period + 1:
            return None

        tr = true_range(highs, lows, closes)
        atr_vals = wilder_smooth(tr, self._period)

        last_atr = float(atr_vals[-1]) if not np.isnan(atr_vals[-1]) else None
        last_close = float(closes[-1])

        if last_atr is None or last_close == 0:
            return None

        # ATR as percentage of price
        atr_pct = (last_atr / last_close) * 100

        # Score: low volatility = near 0, high volatility pushes toward extremes
        # ATR% < 2 = low vol, 2-5 = medium, >5 = high
        score = max(-1.0, min(1.0, (atr_pct - 3) / 3))

        if atr_pct < 2:
            signal = "neutral"     # low volatility
        elif atr_pct < 5:
            signal = "neutral"     # medium
        else:
            signal = "bearish"     # high volatility = risk

        return IndicatorResult(
            name=self.name, label=self.label,
            score=round(score, 4), signal=signal,
            details={
                "atr": round(last_atr, 4),
                "atr_pct": round(atr_pct, 2),
            },
        )


class WilliamsPasaIndicator(BaseIndicator):
    """Williams Pasa Indicator: 260-period Williams %R shifted to [0, 100], and its 260-period EMA."""

    def __init__(self, length: int = 260, ema_len: int = 260):
        self._length = length
        self._ema_len = ema_len

    @property
    def name(self) -> str:
        return "williams_pasa"

    @property
    def label(self) -> str:
        return "Williams Pasa"

    def compute(self, opens, highs, lows, closes, volumes) -> IndicatorResult | None:
        n = len(closes)
        if n < self._length + self._ema_len:
            return None

        # Williams %R shifted to 0-100: 100 * (close - min) / (max - min)
        hh = rolling_highest(highs, self._length)
        ll = rolling_lowest(lows, self._length)

        percent_r = np.full(n, np.nan)
        for i in range(self._length - 1, n):
            h_val = hh[i]
            l_val = ll[i]
            if np.isnan(h_val) or np.isnan(l_val):
                continue
            rng = h_val - l_val
            if rng == 0:
                percent_r[i] = 50.0
            else:
                percent_r[i] = 100.0 * (closes[i] - l_val) / rng

        ema_wil = ema(percent_r, self._ema_len)

        last_r = float(percent_r[-1]) if not np.isnan(percent_r[-1]) else None
        last_ema = float(ema_wil[-1]) if not np.isnan(ema_wil[-1]) else None

        if last_r is None:
            return None

        score = (last_r - 50.0) / 50.0

        if last_r < 5:
            signal = "bullish"
        elif last_r > 98:
            signal = "bearish"
        else:
            signal = "neutral"

        return IndicatorResult(
            name=self.name, label=self.label,
            score=round(score, 4), signal=signal,
            details={
                "r": round(last_r, 2),
                "ema": round(last_ema, 2) if last_ema is not None else None,
            },
        )


class NizamiCedidIndicator(BaseIndicator):
    """NizamiCedid Indicator: 3. Selim custom normalized MACD with VWMA and trend regime."""

    def __init__(self, fast: int = 120, slow: int = 260, signal: int = 50, vwma_len: int = 185, ema_long1: int = 377, ema_long2: int = 610):
        self._fast = fast
        self._slow = slow
        self._signal = signal
        self._vwma_len = vwma_len
        self._ema_long1 = ema_long1
        self._ema_long2 = ema_long2

    @property
    def name(self) -> str:
        return "nizami_cedid"

    @property
    def label(self) -> str:
        return "Nizami Cedid"

    def compute(self, opens, highs, lows, closes, volumes) -> IndicatorResult | None:
        n = len(closes)
        if n < self._ema_long2:
            return None

        fast_ma = ema(closes, self._fast)
        slow_ma = ema(closes, self._slow)
        macd = fast_ma - slow_ma
        signal_line = ema(macd, self._signal)
        histogram = macd - signal_line

        # VWMA of macd: sma(macd * vol, 185) / sma(vol, 185)
        vol_clean = np.nan_to_num(volumes, nan=0.0)
        macd_clean = np.nan_to_num(macd, nan=0.0)
        macd_vol = macd_clean * vol_clean
        
        sum_macd_vol = sma(macd_vol, self._vwma_len)
        sum_vol = sma(vol_clean, self._vwma_len)

        e_macd = np.full(n, np.nan)
        for i in range(n):
            sv = sum_vol[i]
            smv = sum_macd_vol[i]
            if not np.isnan(sv) and not np.isnan(smv) and sv > 0:
                e_macd[i] = smv / sv

        delta = macd - e_macd

        ema_long1_val = ema(closes, self._ema_long1)
        ema_long2_val = ema(closes, self._ema_long2)

        last_macd = float(macd[-1]) if not np.isnan(macd[-1]) else None
        last_sig = float(signal_line[-1]) if not np.isnan(signal_line[-1]) else None
        last_hist = float(histogram[-1]) if not np.isnan(histogram[-1]) else None
        last_emacd = float(e_macd[-1]) if not np.isnan(e_macd[-1]) else None
        last_delta = float(delta[-1]) if not np.isnan(delta[-1]) else None
        last_fast = float(fast_ma[-1]) if not np.isnan(fast_ma[-1]) else None

        last_long1 = float(ema_long1_val[-1]) if not np.isnan(ema_long1_val[-1]) else None
        last_long2 = float(ema_long2_val[-1]) if not np.isnan(ema_long2_val[-1]) else None

        if last_delta is None or last_fast == 0:
            return None

        norm_delta = last_delta / last_fast
        norm_macd = last_macd / last_fast if last_macd is not None else None
        norm_sig = last_sig / last_fast if last_sig is not None else None
        norm_emacd = last_emacd / last_fast if last_emacd is not None else None
        norm_hist = last_hist / last_fast if last_hist is not None else None

        score = max(-1.0, min(1.0, norm_delta * 100))

        if last_delta > 0:
            signal = "bullish"
        elif last_delta < 0:
            signal = "bearish"
        else:
            signal = "neutral"

        condition = bool(last_long1 > last_long2) if (last_long1 is not None and last_long2 is not None) else False

        return IndicatorResult(
            name=self.name, label=self.label,
            score=round(score, 4), signal=signal,
            details={
                "macd": round(norm_macd, 4) if norm_macd is not None else None,
                "signal_line": round(norm_sig, 4) if norm_sig is not None else None,
                "emacd": round(norm_emacd, 4) if norm_emacd is not None else None,
                "histogram": round(norm_hist, 4) if norm_hist is not None else None,
                "delta": round(norm_delta, 4),
                "condition": condition,
            },
        )


# ──────────────────────────────────────────────
# Indicator Registry
# ──────────────────────────────────────────────

INDICATOR_REGISTRY: list[BaseIndicator] = [
    RSIIndicator(14),
    MACDIndicator(12, 26, 9),
    BollingerBandsIndicator(20, 2.0),
    StochRSIIndicator(14, 14, 3, 3),
    ADXIndicator(14),
    SuperTrendIndicator(10, 3.0),
    IchimokuIndicator(9, 26, 52, 26),
    OBVIndicator(20),
    ATRIndicator(14),
    WilliamsPasaIndicator(260, 260),
    NizamiCedidIndicator(120, 260, 50, 185, 377, 610),
]


def compute_all_indicators(
    opens: np.ndarray,
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    volumes: np.ndarray,
) -> list[IndicatorResult]:
    """Run all registered indicators, returning only successful results."""
    results: list[IndicatorResult] = []
    for ind in INDICATOR_REGISTRY:
        try:
            r = ind.compute(opens, highs, lows, closes, volumes)
            if r is not None:
                results.append(r)
        except Exception:
            pass
    return results
