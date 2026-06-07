/**
 * Client-side signal detection engine — 9 indicator professional set.
 * Each indicator produces a per-bar signal array (1=bullish, -1=bearish, 0=neutral).
 * Signal EVENTS are emitted on transitions (prev != curr && curr != 0).
 */

import type { OHLCVData } from '../api/borsaApi';
import {
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
  williamsPasa: WilliamsPasaSignalConfig;
  nizamiCedid: NizamiCedidSignalConfig;
  mode: 'AND' | 'OR';
  positionMode: PositionMode;
}

export const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
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
  if (config.williamsPasa?.enabled) active.push(williamsPasaSignals(highs, lows, closes, config.williamsPasa));
  if (config.nizamiCedid?.enabled) active.push(nizamiCedidSignals(closes, volumes, config.nizamiCedid));

  if (active.length === 0) return new Array(n).fill(0);

  const combined = new Array<number>(n).fill(0);
  const m = active.length;
  for (let i = 0; i < n; i++) {
    if (config.mode === 'AND') {
      let allBull = true, allBear = true, anyZero = false;
      for (let k = 0; k < m; k++) {
        const v = active[k][i];
        if (v === 0) { anyZero = true; break; }
        if (v !== 1) allBull = false;
        if (v !== -1) allBear = false;
      }
      if (!anyZero) {
        if (allBull) combined[i] = 1;
        else if (allBear) combined[i] = -1;
      }
    } else {
      let bull = 0, bear = 0;
      for (let k = 0; k < m; k++) {
        const v = active[k][i];
        if (v === 1) bull++;
        else if (v === -1) bear++;
      }
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
