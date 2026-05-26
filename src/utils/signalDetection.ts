/**
 * Client-side signal detection engine — 9 indicator professional set.
 * Each indicator produces a per-bar signal array (1=bullish, -1=bearish, 0=neutral).
 * Signal EVENTS are emitted on transitions (prev != curr && curr != 0).
 */

import type { OHLCVData } from '../api/borsaApi';
import {
  computeRSI,
  computeMACD,
  computeBollingerBands,
  computeStochRSI,
  computeADX,
  computeSuperTrend,
  computeIchimoku,
  computeOBV,
  computeWilliamsPasa,
  computeNizamiCedid,
} from './indicators';

export const HOLDING_PERIODS = [5, 10, 20, 60] as const;
export type SignalType = 'bullish' | 'bearish';
export type PositionType = 'long' | 'short';
export type PositionMode = 'long-only' | 'short-only' | 'both';

export interface SignalEvent {
  barIndex: number;
  date: string;
  signalType: SignalType;
  entryPrice: number;
  returns: Record<number, number | null>;
  positionAction?: 'long-entry' | 'long-exit' | 'short-entry' | 'short-exit';
}

export interface IndicatorSignals {
  key: string;
  label: string;
  events: SignalEvent[];
}
export interface SymbolSignalResult {
  indicators: IndicatorSignals[];
}

// ── Per-indicator config interfaces ──────────────

export interface RSISignalConfig {
  enabled: boolean;
  period: number;
  oversold: number; // default 30
  overbought: number; // default 70
  conditions: {
    threshold: boolean; // RSI < oversold / > overbought
    midLine: boolean; // RSI > 50 / < 50
  };
}

export interface MACDSignalConfig {
  enabled: boolean;
  fast: number;
  slow: number;
  signalPeriod: number;
  conditions: {
    histogram: boolean; // histogram > 0 / < 0
    macdVsSignal: boolean; // MACD > Signal / < Signal
    macdVsZero: boolean; // MACD > 0 / < 0
  };
}

export interface BollingerSignalConfig {
  enabled: boolean;
  period: number;
  mult: number;
  conditions: {
    bandBreak: boolean; // close < lower (bull) / > upper (bear)
    pctB: boolean; // %B < 0.2 (bull) / > 0.8 (bear)
    squeeze: boolean; // bandwidth narrowing filter
  };
}

export interface StochRSISignalConfig {
  enabled: boolean;
  rsiPeriod: number;
  stochPeriod: number;
  kSmooth: number;
  dSmooth: number;
  conditions: {
    threshold: boolean; // K < 20 (bull) / > 80 (bear)
    crossover: boolean; // K > D (bull) / K < D (bear)
  };
}

export interface ADXSignalConfig {
  enabled: boolean;
  period: number;
  trendThreshold: number; // default 25
  conditions: {
    diCross: boolean; // +DI > -DI (bull) / < (bear)
    strongTrend: boolean; // ADX > threshold filter
  };
}

export interface SuperTrendSignalConfig {
  enabled: boolean;
  atrPeriod: number;
  multiplier: number;
  conditions: {
    direction: boolean; // direction = 1 (bull) / -1 (bear)
  };
}

export interface IchimokuSignalConfig {
  enabled: boolean;
  tenkan: number;
  kijun: number;
  senkouB: number;
  conditions: {
    tkCross: boolean; // Tenkan > Kijun (bull) / < (bear)
    priceVsCloud: boolean; // price above cloud (bull) / below (bear)
    cloudColor: boolean; // Span A > Span B (bull) / < (bear)
  };
}

export interface OBVSignalConfig {
  enabled: boolean;
  emaPeriod: number;
  conditions: {
    obvVsEma: boolean; // OBV > EMA (bull) / < (bear)
  };
}

export interface WilliamsPasaSignalConfig {
  enabled: boolean;
  length: number;
  emaLen: number;
  conditions: {
    threshold: boolean; // %R < 5 (bull) / > 98 (bear)
  };
}

export interface NizamiCedidSignalConfig {
  enabled: boolean;
  fast: number;
  slow: number;
  signalLen: number;
  vwmaLen: number;
  conditions: {
    deltaCross: boolean; // delta > 0 (bull) / < 0 (bear)
  };
}

export interface SignalConfig {
  rsi: RSISignalConfig;
  macd: MACDSignalConfig;
  bollinger: BollingerSignalConfig;
  stochRsi: StochRSISignalConfig;
  adx: ADXSignalConfig;
  supertrend: SuperTrendSignalConfig;
  ichimoku: IchimokuSignalConfig;
  obv: OBVSignalConfig;
  williamsPasa: WilliamsPasaSignalConfig;
  nizamiCedid: NizamiCedidSignalConfig;
  mode: 'AND' | 'OR';
  positionMode: PositionMode;
}

export const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  rsi: {
    enabled: true,
    period: 14,
    oversold: 30,
    overbought: 70,
    conditions: { threshold: true, midLine: false },
  },
  macd: {
    enabled: true,
    fast: 12,
    slow: 26,
    signalPeriod: 9,
    conditions: { histogram: true, macdVsSignal: true, macdVsZero: false },
  },
  bollinger: {
    enabled: true,
    period: 20,
    mult: 2.0,
    conditions: { bandBreak: true, pctB: false, squeeze: false },
  },
  stochRsi: {
    enabled: true,
    rsiPeriod: 14,
    stochPeriod: 14,
    kSmooth: 3,
    dSmooth: 3,
    conditions: { threshold: true, crossover: false },
  },
  adx: {
    enabled: true,
    period: 14,
    trendThreshold: 25,
    conditions: { diCross: true, strongTrend: true },
  },
  supertrend: {
    enabled: true,
    atrPeriod: 10,
    multiplier: 3.0,
    conditions: { direction: true },
  },
  ichimoku: {
    enabled: true,
    tenkan: 9,
    kijun: 26,
    senkouB: 52,
    conditions: { tkCross: true, priceVsCloud: true, cloudColor: false },
  },
  obv: {
    enabled: true,
    emaPeriod: 20,
    conditions: { obvVsEma: true },
  },
  williamsPasa: {
    enabled: true,
    length: 260,
    emaLen: 260,
    conditions: { threshold: true },
  },
  nizamiCedid: {
    enabled: true,
    fast: 120,
    slow: 260,
    signalLen: 50,
    vwmaLen: 185,
    conditions: { deltaCross: true },
  },
  mode: 'OR',
  positionMode: 'long-only',
};

// ── Per-bar signal arrays ───────────────────────

export function rsiSignals(closes: number[], cfg?: Partial<RSISignalConfig>): number[] {
  const c: RSISignalConfig = {
    enabled: true,
    period: 14,
    oversold: 30,
    overbought: 70,
    ...cfg,
    conditions: { threshold: true, midLine: false, ...cfg?.conditions },
  };
  const cond = c.conditions;
  const n = closes.length;
  const { rsi } = computeRSI(closes, c.period);
  const sig = new Array<number>(n).fill(0);
  if (!cond.threshold && !cond.midLine) return sig;

  for (let i = 0; i < n; i++) {
    const r = rsi[i];
    if (r === null) continue;
    let bullish = true,
      bearish = true;

    if (cond.threshold) {
      if (r >= c.oversold) bullish = false;
      if (r <= c.overbought) bearish = false;
    }
    if (cond.midLine) {
      if (r <= 50) bullish = false;
      if (r >= 50) bearish = false;
    }
    if (bullish) sig[i] = 1;
    else if (bearish) sig[i] = -1;
  }
  return sig;
}

export function macdSignals(closes: number[], cfg?: Partial<MACDSignalConfig>): number[] {
  const c: MACDSignalConfig = {
    enabled: true,
    fast: 12,
    slow: 26,
    signalPeriod: 9,
    ...cfg,
    conditions: { histogram: true, macdVsSignal: true, macdVsZero: false, ...cfg?.conditions },
  };
  const cond = c.conditions;
  const n = closes.length;
  const mc = computeMACD(closes, c.fast, c.slow, c.signalPeriod);
  const sig = new Array<number>(n).fill(0);
  if (!cond.histogram && !cond.macdVsSignal && !cond.macdVsZero) return sig;

  for (let i = 0; i < n; i++) {
    const h = mc.histogram[i];
    const m = mc.macd[i];
    const s = mc.signal[i];
    if (m === null) continue;
    let bullish = true,
      bearish = true;

    if (cond.histogram) {
      if (h === null || h <= 0) bullish = false;
      if (h === null || h >= 0) bearish = false;
    }
    if (cond.macdVsSignal) {
      if (s === null) {
        bullish = false;
        bearish = false;
      } else {
        if (m <= s) bullish = false;
        if (m >= s) bearish = false;
      }
    }
    if (cond.macdVsZero) {
      if (m <= 0) bullish = false;
      if (m >= 0) bearish = false;
    }
    if (bullish) sig[i] = 1;
    else if (bearish) sig[i] = -1;
  }
  return sig;
}

export function bollingerSignals(closes: number[], cfg?: Partial<BollingerSignalConfig>): number[] {
  const c: BollingerSignalConfig = {
    enabled: true,
    period: 20,
    mult: 2.0,
    ...cfg,
    conditions: { bandBreak: true, pctB: false, squeeze: false, ...cfg?.conditions },
  };
  const cond = c.conditions;
  const n = closes.length;
  const bb = computeBollingerBands(closes, c.period, c.mult);
  const sig = new Array<number>(n).fill(0);
  if (!cond.bandBreak && !cond.pctB && !cond.squeeze) return sig;

  for (let i = 0; i < n; i++) {
    const u = bb.upper[i],
      l = bb.lower[i],
      pb = bb.pctB[i],
      mid = bb.middle[i];
    if (u === null || l === null) continue;
    let bullish = true,
      bearish = true;

    if (cond.squeeze) {
      // Squeeze filter: bandwidth narrowing indicates potential breakout
      if (mid === null || mid === 0) {
        bullish = false;
        bearish = false;
        continue;
      }
      const bandwidth = (u - l) / mid;
      // Look back 20 bars to check if bandwidth is contracting
      const lookback = Math.min(20, i);
      if (lookback < 2) {
        bullish = false;
        bearish = false;
        continue;
      }
      let prevBW = 0;
      let count = 0;
      for (let j = i - lookback; j < i; j++) {
        const pu = bb.upper[j],
          pl = bb.lower[j],
          pm = bb.middle[j];
        if (pu !== null && pl !== null && pm !== null && pm !== 0) {
          prevBW += (pu - pl) / pm;
          count++;
        }
      }
      if (count === 0) {
        bullish = false;
        bearish = false;
        continue;
      }
      const avgBW = prevBW / count;
      // If current bandwidth is not narrower than average, filter out
      if (bandwidth >= avgBW) {
        bullish = false;
        bearish = false;
        continue;
      }
    }

    if (cond.bandBreak) {
      if (closes[i] >= l!) bullish = false;
      if (closes[i] <= u!) bearish = false;
    }
    if (cond.pctB) {
      if (pb === null) {
        bullish = false;
        bearish = false;
      } else {
        if (pb >= 0.2) bullish = false;
        if (pb <= 0.8) bearish = false;
      }
    }
    if (bullish) sig[i] = 1;
    else if (bearish) sig[i] = -1;
  }
  return sig;
}

export function stochRsiSignals(closes: number[], cfg?: Partial<StochRSISignalConfig>): number[] {
  const c: StochRSISignalConfig = {
    enabled: true,
    rsiPeriod: 14,
    stochPeriod: 14,
    kSmooth: 3,
    dSmooth: 3,
    ...cfg,
    conditions: { threshold: true, crossover: false, ...cfg?.conditions },
  };
  const cond = c.conditions;
  const n = closes.length;
  const sr = computeStochRSI(closes, c.rsiPeriod, c.stochPeriod, c.kSmooth, c.dSmooth);
  const sig = new Array<number>(n).fill(0);
  if (!cond.threshold && !cond.crossover) return sig;

  for (let i = 0; i < n; i++) {
    const k = sr.k[i],
      d = sr.d[i];
    if (k === null) continue;
    let bullish = true,
      bearish = true;

    if (cond.threshold) {
      if (k >= 20) bullish = false;
      if (k <= 80) bearish = false;
    }
    if (cond.crossover) {
      if (d === null) {
        bullish = false;
        bearish = false;
      } else {
        if (k <= d) bullish = false;
        if (k >= d) bearish = false;
      }
    }
    if (bullish) sig[i] = 1;
    else if (bearish) sig[i] = -1;
  }
  return sig;
}

export function adxSignals(
  highs: number[],
  lows: number[],
  closes: number[],
  cfg?: Partial<ADXSignalConfig>,
): number[] {
  const c: ADXSignalConfig = {
    enabled: true,
    period: 14,
    trendThreshold: 25,
    ...cfg,
    conditions: { diCross: true, strongTrend: true, ...cfg?.conditions },
  };
  const cond = c.conditions;
  const n = closes.length;
  const ax = computeADX(highs, lows, closes, c.period);
  const sig = new Array<number>(n).fill(0);
  if (!cond.diCross) return sig;

  for (let i = 0; i < n; i++) {
    const a = ax.adx[i],
      pd = ax.plusDI[i],
      md = ax.minusDI[i];
    if (pd === null || md === null) continue;
    let bullish = true,
      bearish = true;

    if (cond.strongTrend) {
      if (a === null || a < c.trendThreshold) {
        bullish = false;
        bearish = false;
        continue;
      }
    }
    if (cond.diCross) {
      if (pd <= md) bullish = false;
      if (md <= pd) bearish = false;
    }
    if (bullish) sig[i] = 1;
    else if (bearish) sig[i] = -1;
  }
  return sig;
}

export function supertrendSignals(
  highs: number[],
  lows: number[],
  closes: number[],
  cfg?: Partial<SuperTrendSignalConfig>,
): number[] {
  const c: SuperTrendSignalConfig = {
    enabled: true,
    atrPeriod: 10,
    multiplier: 3.0,
    ...cfg,
    conditions: { direction: true, ...cfg?.conditions },
  };
  const n = closes.length;
  const st = computeSuperTrend(highs, lows, closes, c.atrPeriod, c.multiplier);
  const sig = new Array<number>(n).fill(0);
  if (!c.conditions.direction) return sig;

  for (let i = 0; i < n; i++) {
    const d = st.direction[i];
    if (d === null) continue;
    if (d === 1) sig[i] = 1;
    else if (d === -1) sig[i] = -1;
  }
  return sig;
}

export function ichimokuSignals(
  highs: number[],
  lows: number[],
  closes: number[],
  cfg?: Partial<IchimokuSignalConfig>,
): number[] {
  const c: IchimokuSignalConfig = {
    enabled: true,
    tenkan: 9,
    kijun: 26,
    senkouB: 52,
    ...cfg,
    conditions: { tkCross: true, priceVsCloud: true, cloudColor: false, ...cfg?.conditions },
  };
  const cond = c.conditions;
  const n = closes.length;
  const ich = computeIchimoku(highs, lows, closes, c.tenkan, c.kijun, c.senkouB);
  const sig = new Array<number>(n).fill(0);
  if (!cond.tkCross && !cond.priceVsCloud && !cond.cloudColor) return sig;

  for (let i = 0; i < n; i++) {
    const t = ich.tenkan[i],
      k = ich.kijun[i];
    const sa = ich.senkouA[i],
      sb = ich.senkouB[i];
    if (t === null || k === null) continue;
    let bullish = true,
      bearish = true;

    if (cond.tkCross) {
      if (t <= k) bullish = false;
      if (t >= k) bearish = false;
    }
    if (cond.priceVsCloud && sa !== null && sb !== null) {
      const cloudTop = Math.max(sa, sb);
      const cloudBottom = Math.min(sa, sb);
      if (closes[i] <= cloudTop) bullish = false;
      if (closes[i] >= cloudBottom) bearish = false;
    }
    if (cond.cloudColor && sa !== null && sb !== null) {
      if (sa <= sb) bullish = false;
      if (sa >= sb) bearish = false;
    }
    if (bullish) sig[i] = 1;
    else if (bearish) sig[i] = -1;
  }
  return sig;
}

export function obvSignals(closes: number[], volumes: number[], cfg?: Partial<OBVSignalConfig>): number[] {
  const c: OBVSignalConfig = {
    enabled: true,
    emaPeriod: 20,
    ...cfg,
    conditions: { obvVsEma: true, ...cfg?.conditions },
  };
  const n = closes.length;
  const ob = computeOBV(closes, volumes, c.emaPeriod);
  const sig = new Array<number>(n).fill(0);
  if (!c.conditions.obvVsEma) return sig;

  for (let i = 0; i < n; i++) {
    const o = ob.obv[i],
      e = ob.obvEma[i];
    if (o === null || e === null) continue;
    if (o > e) sig[i] = 1;
    else if (o < e) sig[i] = -1;
  }
  return sig;
}

export function williamsPasaSignals(
  highs: number[],
  lows: number[],
  closes: number[],
  cfg?: Partial<WilliamsPasaSignalConfig>
): number[] {
  const c: WilliamsPasaSignalConfig = {
    enabled: true,
    length: 260,
    emaLen: 260,
    ...cfg,
    conditions: { threshold: true, ...cfg?.conditions },
  };
  const n = closes.length;
  const { percentR } = computeWilliamsPasa(highs, lows, closes, c.length, c.emaLen);
  const sig = new Array<number>(n).fill(0);
  if (!c.conditions.threshold) return sig;
  for (let i = 0; i < n; i++) {
    const r = percentR[i];
    if (r === null) continue;
    if (r < 5) sig[i] = 1;
    else if (r > 98) sig[i] = -1;
  }
  return sig;
}

export function nizamiCedidSignals(
  closes: number[],
  volumes: number[],
  cfg?: Partial<NizamiCedidSignalConfig>
): number[] {
  const c: NizamiCedidSignalConfig = {
    enabled: true,
    fast: 120,
    slow: 260,
    signalLen: 50,
    vwmaLen: 185,
    ...cfg,
    conditions: { deltaCross: true, ...cfg?.conditions },
  };
  const n = closes.length;
  const { delta } = computeNizamiCedid(closes, volumes, c.fast, c.slow, c.signalLen, c.vwmaLen);
  const sig = new Array<number>(n).fill(0);
  if (!c.conditions.deltaCross) return sig;
  for (let i = 0; i < n; i++) {
    const d = delta[i];
    if (d === null) continue;
    if (d > 0) sig[i] = 1;
    else if (d < 0) sig[i] = -1;
  }
  return sig;
}

// ── Transition detection ────────────────────────

function extractSignalEvents(signals: number[], dates: string[], closes: number[]): SignalEvent[] {
  const events: SignalEvent[] = [];
  let prevSignal = 0;
  for (let i = 1; i < signals.length; i++) {
    const curr = signals[i];
    if (curr !== 0 && curr !== prevSignal) {
      const entryPrice = closes[i];
      if (entryPrice <= 0) {
        prevSignal = curr;
        continue;
      }
      const returns: Record<number, number | null> = {};
      for (const hp of HOLDING_PERIODS) {
        returns[hp] = i + hp < signals.length ? (closes[i + hp] - entryPrice) / entryPrice : null;
      }
      events.push({ barIndex: i, date: dates[i], signalType: curr === 1 ? 'bullish' : 'bearish', entryPrice, returns });
    }
    if (curr !== 0) prevSignal = curr;
  }
  return events;
}

// ── Backward compat entry point (BacktestDetail) ──

export function computeAllSignals(data: OHLCVData[]): SymbolSignalResult {
  const dates = data.map((d) => d.date);
  const highs = data.map((d) => d.high);
  const lows = data.map((d) => d.low);
  const closes = data.map((d) => d.close);
  const volumes = data.map((d) => d.volume);
  return {
    indicators: [
      { key: 'rsi', label: 'RSI', events: extractSignalEvents(rsiSignals(closes), dates, closes) },
      { key: 'macd', label: 'MACD', events: extractSignalEvents(macdSignals(closes), dates, closes) },
      { key: 'bollinger', label: 'Bollinger', events: extractSignalEvents(bollingerSignals(closes), dates, closes) },
      { key: 'stoch_rsi', label: 'Stoch RSI', events: extractSignalEvents(stochRsiSignals(closes), dates, closes) },
      { key: 'adx', label: 'ADX', events: extractSignalEvents(adxSignals(highs, lows, closes), dates, closes) },
      {
        key: 'supertrend',
        label: 'SuperTrend',
        events: extractSignalEvents(supertrendSignals(highs, lows, closes), dates, closes),
      },
      {
        key: 'ichimoku',
        label: 'Ichimoku',
        events: extractSignalEvents(ichimokuSignals(highs, lows, closes), dates, closes),
      },
      { key: 'obv', label: 'OBV', events: extractSignalEvents(obvSignals(closes, volumes), dates, closes) },
      {
        key: 'williams_pasa',
        label: 'Williams Pasa',
        events: extractSignalEvents(williamsPasaSignals(highs, lows, closes), dates, closes),
      },
      {
        key: 'nizami_cedid',
        label: 'Nizami Cedid',
        events: extractSignalEvents(nizamiCedidSignals(closes, volumes), dates, closes),
      },
    ],
  };
}

// ── Combined Signals ────────────────────────────

export function computeCombinedSignals(data: OHLCVData[], config: SignalConfig): number[] {
  const n = data.length;
  const highs = data.map((d) => d.high);
  const lows = data.map((d) => d.low);
  const closes = data.map((d) => d.close);
  const volumes = data.map((d) => d.volume);

  const active: number[][] = [];
  if (config.rsi.enabled) active.push(rsiSignals(closes, config.rsi));
  if (config.macd.enabled) active.push(macdSignals(closes, config.macd));
  if (config.bollinger.enabled) active.push(bollingerSignals(closes, config.bollinger));
  if (config.stochRsi.enabled) active.push(stochRsiSignals(closes, config.stochRsi));
  if (config.adx.enabled) active.push(adxSignals(highs, lows, closes, config.adx));
  if (config.supertrend.enabled) active.push(supertrendSignals(highs, lows, closes, config.supertrend));
  if (config.ichimoku.enabled) active.push(ichimokuSignals(highs, lows, closes, config.ichimoku));
  if (config.obv.enabled) active.push(obvSignals(closes, volumes, config.obv));
  if (config.williamsPasa?.enabled) active.push(williamsPasaSignals(highs, lows, closes, config.williamsPasa));
  if (config.nizamiCedid?.enabled) active.push(nizamiCedidSignals(closes, volumes, config.nizamiCedid));

  if (active.length === 0) return new Array(n).fill(0);

  const combined = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const vals = active.map((s) => s[i]);
    if (config.mode === 'AND') {
      const nonZero = vals.filter((v) => v !== 0);
      if (nonZero.length === active.length) {
        if (nonZero.every((v) => v === 1)) combined[i] = 1;
        else if (nonZero.every((v) => v === -1)) combined[i] = -1;
      }
    } else {
      const bull = vals.filter((v) => v === 1).length;
      const bear = vals.filter((v) => v === -1).length;
      if (bull > 0 && bull >= bear) combined[i] = 1;
      else if (bear > 0 && bear > bull) combined[i] = -1;
    }
  }
  return combined;
}

export function extractCombinedSignalEvents(combinedSignals: number[], data: OHLCVData[]): SignalEvent[] {
  const events: SignalEvent[] = [];
  let prevSignal = 0;
  for (let i = 1; i < combinedSignals.length; i++) {
    const curr = combinedSignals[i];
    if (curr !== 0 && curr !== prevSignal) {
      events.push({
        barIndex: i,
        date: data[i].date,
        signalType: curr === 1 ? 'bullish' : 'bearish',
        entryPrice: data[i].close,
        returns: {},
      });
    }
    if (curr !== 0) prevSignal = curr;
  }
  return events;
}

// ── Paired Trade Model ──────────────────────────

export interface PairedTrade {
  buyDate: string;
  buyPrice: number;
  buyBarIndex: number;
  sellDate: string;
  sellPrice: number;
  sellBarIndex: number;
  returnPct: number;
  barsHeld: number;
  positionType: PositionType;
  entryDate: string;
  entryPrice: number;
  entryBarIndex: number;
  exitDate: string;
  exitPrice: number;
  exitBarIndex: number;
}

export interface PairedTradeStats {
  trades: PairedTrade[];
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  profitFactor: number;
  maxWin: number;
  maxLoss: number;
  totalReturn: number;
}

function makeTrade(data: OHLCVData[], entryIdx: number, exitIdx: number, posType: PositionType): PairedTrade {
  const ep = data[entryIdx].close,
    xp = data[exitIdx].close;
  const ret = posType === 'long' ? (xp - ep) / ep : (ep - xp) / ep;
  return {
    buyDate: data[entryIdx].date,
    buyPrice: ep,
    buyBarIndex: entryIdx,
    sellDate: data[exitIdx].date,
    sellPrice: xp,
    sellBarIndex: exitIdx,
    returnPct: ret,
    barsHeld: exitIdx - entryIdx,
    positionType: posType,
    entryDate: data[entryIdx].date,
    entryPrice: ep,
    entryBarIndex: entryIdx,
    exitDate: data[exitIdx].date,
    exitPrice: xp,
    exitBarIndex: exitIdx,
  };
}

export function pairTrades(
  combinedSignals: number[],
  data: OHLCVData[],
  startDate?: string,
  endDate?: string,
  positionMode: PositionMode = 'long-only',
): PairedTradeStats {
  const trades: PairedTrade[] = [];
  // State machine: 'flat' | 'long' | 'short'
  let state: 'flat' | 'long' | 'short' = 'flat';
  let entryIdx = -1;
  let prevSignal = 0;

  const allowLong = positionMode === 'long-only' || positionMode === 'both';
  const allowShort = positionMode === 'short-only' || positionMode === 'both';

  for (let i = 1; i < combinedSignals.length; i++) {
    const curr = combinedSignals[i];
    if (curr === 0 || curr === prevSignal) {
      if (curr !== 0) prevSignal = curr;
      continue;
    }
    const date = data[i].date;
    if (startDate && date < startDate) {
      prevSignal = curr;
      continue;
    }
    if (endDate && date > endDate) {
      prevSignal = curr;
      continue;
    }

    if (state === 'flat') {
      if (curr === 1 && allowLong) {
        state = 'long';
        entryIdx = i;
      } else if (curr === -1 && allowShort) {
        state = 'short';
        entryIdx = i;
      }
    } else if (state === 'long') {
      if (curr === -1) {
        trades.push(makeTrade(data, entryIdx, i, 'long'));
        if (allowShort) {
          state = 'short';
          entryIdx = i;
        } else {
          state = 'flat';
        }
      }
    } else if (state === 'short') {
      if (curr === 1) {
        trades.push(makeTrade(data, entryIdx, i, 'short'));
        if (allowLong) {
          state = 'long';
          entryIdx = i;
        } else {
          state = 'flat';
        }
      }
    }
    prevSignal = curr;
  }

  const t = trades.length;
  if (t === 0)
    return { trades, totalTrades: 0, winRate: 0, avgReturn: 0, profitFactor: 0, maxWin: 0, maxLoss: 0, totalReturn: 0 };

  const wins = trades.filter((x) => x.returnPct > 0);
  const losses = trades.filter((x) => x.returnPct <= 0);
  const totalWin = wins.reduce((s, x) => s + x.returnPct, 0);
  const totalLoss = Math.abs(losses.reduce((s, x) => s + x.returnPct, 0));
  return {
    trades,
    totalTrades: t,
    winRate: wins.length / t,
    avgReturn: trades.reduce((s, x) => s + x.returnPct, 0) / t,
    profitFactor: totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0,
    maxWin: Math.max(...trades.map((x) => x.returnPct)),
    maxLoss: Math.min(...trades.map((x) => x.returnPct)),
    totalReturn: trades.reduce((acc, x) => acc * (1 + x.returnPct), 1) - 1,
  };
}
