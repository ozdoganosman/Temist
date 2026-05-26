/**
 * Signal Optimizer — 4-phase advanced optimisation engine.
 *
 * Phase 1: Cached grid search for each indicator independently
 * Phase 2: Genetic algorithm fine-tuning around top candidates
 * Phase 3: Multi-indicator combination search (AND/OR)
 * Phase 4: Walk-forward validation with robustness grading
 *
 * Uses cooperative async scheduling (yieldToMain) to keep UI responsive.
 */

import type { OHLCVData } from '../api/borsaApi';
import type {
  SignalConfig,
  PairedTradeStats,
  RSISignalConfig,
  MACDSignalConfig,
  BollingerSignalConfig,
  StochRSISignalConfig,
  ADXSignalConfig,
  SuperTrendSignalConfig,
  IchimokuSignalConfig,
  OBVSignalConfig,
} from './signalDetection';
import { computeCombinedSignals, pairTrades, DEFAULT_SIGNAL_CONFIG } from './signalDetection';
import type {
  OptimizerSettings,
  EnhancedOptimizerResult,
  EnhancedOptimizerProgress,
  EnhancedTradeStats,
} from './optimizerTypes';
import { DEFAULT_OPTIMIZER_SETTINGS } from './optimizerTypes';
import { computeEnhancedStats } from './optimizerMetrics';
import { advancedFitness, computeRobustnessScore, monteCarloValidation } from './optimizerFitness';

// ── Re-exports for backward compat ────────────

export type { EnhancedOptimizerResult, EnhancedOptimizerProgress };

/** @deprecated use EnhancedOptimizerResult */
export type OptimizerResult = EnhancedOptimizerResult;
/** @deprecated use EnhancedOptimizerProgress */
export type OptimizerProgress = EnhancedOptimizerProgress;

// ── Helpers ───────────────────────────────────

export const yieldToMain = () => new Promise<void>((r) => setTimeout(r, 0));

export function base(): SignalConfig {
  return {
    rsi: { ...DEFAULT_SIGNAL_CONFIG.rsi, enabled: false, conditions: { ...DEFAULT_SIGNAL_CONFIG.rsi.conditions } },
    macd: { ...DEFAULT_SIGNAL_CONFIG.macd, enabled: false, conditions: { ...DEFAULT_SIGNAL_CONFIG.macd.conditions } },
    bollinger: {
      ...DEFAULT_SIGNAL_CONFIG.bollinger,
      enabled: false,
      conditions: { ...DEFAULT_SIGNAL_CONFIG.bollinger.conditions },
    },
    stochRsi: {
      ...DEFAULT_SIGNAL_CONFIG.stochRsi,
      enabled: false,
      conditions: { ...DEFAULT_SIGNAL_CONFIG.stochRsi.conditions },
    },
    adx: { ...DEFAULT_SIGNAL_CONFIG.adx, enabled: false, conditions: { ...DEFAULT_SIGNAL_CONFIG.adx.conditions } },
    supertrend: {
      ...DEFAULT_SIGNAL_CONFIG.supertrend,
      enabled: false,
      conditions: { ...DEFAULT_SIGNAL_CONFIG.supertrend.conditions },
    },
    ichimoku: {
      ...DEFAULT_SIGNAL_CONFIG.ichimoku,
      enabled: false,
      conditions: { ...DEFAULT_SIGNAL_CONFIG.ichimoku.conditions },
    },
    obv: { ...DEFAULT_SIGNAL_CONFIG.obv, enabled: false, conditions: { ...DEFAULT_SIGNAL_CONFIG.obv.conditions } },
    williamsPasa: {
      ...DEFAULT_SIGNAL_CONFIG.williamsPasa,
      enabled: false,
      conditions: { ...DEFAULT_SIGNAL_CONFIG.williamsPasa.conditions },
    },
    nizamiCedid: {
      ...DEFAULT_SIGNAL_CONFIG.nizamiCedid,
      enabled: false,
      conditions: { ...DEFAULT_SIGNAL_CONFIG.nizamiCedid.conditions },
    },
    mode: 'OR',
    positionMode: 'long-only',
  };
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Evaluate a config ─────────────────────────

interface EvalResult {
  stats: PairedTradeStats;
  enhanced: EnhancedTradeStats;
  fitness: number;
}

export function evaluate(
  data: OHLCVData[],
  config: SignalConfig,
  dateRange: { start?: string; end?: string },
  settings: OptimizerSettings,
): EvalResult | null {
  const combined = computeCombinedSignals(data, config);
  const stats = pairTrades(combined, data, dateRange.start, dateRange.end, config.positionMode);
  const enhanced = computeEnhancedStats(stats.trades, settings.transactionCostPct);
  const f = advancedFitness(enhanced, settings);
  if (f <= 0) return null;
  return { stats, enhanced, fitness: f };
}

export function toResult(
  config: SignalConfig,
  evalResult: EvalResult,
  source: EnhancedOptimizerResult['source'],
): EnhancedOptimizerResult {
  return {
    config,
    label: '',
    fitness: evalResult.fitness,
    inSample: evalResult.enhanced,
    outOfSample: null,
    robustnessScore: 0,
    robustnessGrade: 'F',
    monteCarloScore: null,
    source,
  };
}

export function topN(results: EnhancedOptimizerResult[], n: number): EnhancedOptimizerResult[] {
  return results.sort((a, b) => b.fitness - a.fitness).slice(0, n);
}

// ── Condition combinations ────────────────────

function allCondCombos<T>(keys: string[]): T[] {
  const combos: T[] = [];
  const n = keys.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const cond: Record<string, boolean> = {};
    for (let i = 0; i < n; i++) cond[keys[i]] = !!(mask & (1 << i));
    combos.push(cond as T);
  }
  return combos;
}

const RSI_ALL_CONDS = allCondCombos<RSISignalConfig['conditions']>(['threshold', 'midLine']);
const MACD_ALL_CONDS = allCondCombos<MACDSignalConfig['conditions']>(['histogram', 'macdVsSignal', 'macdVsZero']);
const BOLL_ALL_CONDS = allCondCombos<BollingerSignalConfig['conditions']>(['bandBreak', 'pctB', 'squeeze']);
const STOCH_ALL_CONDS = allCondCombos<StochRSISignalConfig['conditions']>(['threshold', 'crossover']);
const ADX_ALL_CONDS = allCondCombos<ADXSignalConfig['conditions']>(['diCross', 'strongTrend']);
const ST_ALL_CONDS = allCondCombos<SuperTrendSignalConfig['conditions']>(['direction']);
const ICHI_ALL_CONDS = allCondCombos<IchimokuSignalConfig['conditions']>(['tkCross', 'priceVsCloud', 'cloudColor']);
const OBV_ALL_CONDS = allCondCombos<OBVSignalConfig['conditions']>(['obvVsEma']);

// ── Grid generators ────────────────────────────

export function generateRSIConfigs(): SignalConfig[] {
  const periods = [7, 10, 14, 21, 28];
  const oversolds = [20, 25, 30, 35];
  const overboughts = [65, 70, 75, 80];
  const configs: SignalConfig[] = [];
  for (const period of periods)
    for (const oversold of oversolds)
      for (const overbought of overboughts)
        for (const conditions of RSI_ALL_CONDS) {
          const b = base();
          b.rsi = { enabled: true, period, oversold, overbought, conditions };
          configs.push(b);
        }
  return configs;
}

export function generateMACDConfigs(): SignalConfig[] {
  const fasts = [8, 10, 12, 15];
  const slows = [20, 26, 30, 35];
  const signals = [5, 7, 9, 12];
  const configs: SignalConfig[] = [];
  for (const fast of fasts)
    for (const slow of slows)
      for (const signalPeriod of signals)
        for (const conditions of MACD_ALL_CONDS) {
          if (fast >= slow) continue;
          const b = base();
          b.macd = { enabled: true, fast, slow, signalPeriod, conditions };
          configs.push(b);
        }
  return configs;
}

export function generateBollingerConfigs(): SignalConfig[] {
  const periods = [15, 20, 25, 30];
  const mults = [1.5, 2.0, 2.5, 3.0];
  const configs: SignalConfig[] = [];
  for (const period of periods)
    for (const mult of mults)
      for (const conditions of BOLL_ALL_CONDS) {
        const b = base();
        b.bollinger = { enabled: true, period, mult, conditions };
        configs.push(b);
      }
  return configs;
}

export function generateStochRSIConfigs(): SignalConfig[] {
  const rsiPeriods = [10, 14, 21];
  const stochPeriods = [10, 14, 21];
  const kSmooths = [3, 5];
  const dSmooths = [3, 5];
  const configs: SignalConfig[] = [];
  for (const rsiPeriod of rsiPeriods)
    for (const stochPeriod of stochPeriods)
      for (const kSmooth of kSmooths)
        for (const dSmooth of dSmooths)
          for (const conditions of STOCH_ALL_CONDS) {
            const b = base();
            b.stochRsi = { enabled: true, rsiPeriod, stochPeriod, kSmooth, dSmooth, conditions };
            configs.push(b);
          }
  return configs;
}

export function generateADXConfigs(): SignalConfig[] {
  const periods = [10, 14, 20, 28];
  const thresholds = [20, 25, 30, 35];
  const configs: SignalConfig[] = [];
  for (const period of periods)
    for (const trendThreshold of thresholds)
      for (const conditions of ADX_ALL_CONDS) {
        const b = base();
        b.adx = { enabled: true, period, trendThreshold, conditions };
        configs.push(b);
      }
  return configs;
}

export function generateSuperTrendConfigs(): SignalConfig[] {
  const atrPeriods = [7, 10, 14, 20];
  const multipliers = [2.0, 2.5, 3.0, 3.5, 4.0];
  const configs: SignalConfig[] = [];
  for (const atrPeriod of atrPeriods)
    for (const multiplier of multipliers)
      for (const conditions of ST_ALL_CONDS) {
        const b = base();
        b.supertrend = { enabled: true, atrPeriod, multiplier, conditions };
        configs.push(b);
      }
  return configs;
}

export function generateIchimokuConfigs(): SignalConfig[] {
  const tenkans = [7, 9, 12];
  const kijuns = [22, 26, 30];
  const senkous = [44, 52, 60];
  const configs: SignalConfig[] = [];
  for (const tenkan of tenkans)
    for (const kijun of kijuns)
      for (const senkouB of senkous)
        for (const conditions of ICHI_ALL_CONDS) {
          const b = base();
          b.ichimoku = { enabled: true, tenkan, kijun, senkouB, conditions };
          configs.push(b);
        }
  return configs;
}

export function generateOBVConfigs(): SignalConfig[] {
  const emaPeriods = [10, 15, 20, 30, 50];
  const configs: SignalConfig[] = [];
  for (const emaPeriod of emaPeriods)
    for (const conditions of OBV_ALL_CONDS) {
      const b = base();
      b.obv = { enabled: true, emaPeriod, conditions };
      configs.push(b);
    }
  return configs;
}

// ── Label builder ─────────────────────────────

function condList(obj: Record<string, boolean>): string {
  return Object.entries(obj)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(',');
}

export function describeConfig(c: SignalConfig): string {
  const parts: string[] = [];
  if (c.rsi.enabled)
    parts.push(`RSI(${c.rsi.period},${c.rsi.oversold}/${c.rsi.overbought})[${condList(c.rsi.conditions)}]`);
  if (c.macd.enabled)
    parts.push(`MACD(${c.macd.fast},${c.macd.slow},${c.macd.signalPeriod})[${condList(c.macd.conditions)}]`);
  if (c.bollinger.enabled)
    parts.push(`BB(${c.bollinger.period},${c.bollinger.mult})[${condList(c.bollinger.conditions)}]`);
  if (c.stochRsi.enabled)
    parts.push(`StochRSI(${c.stochRsi.rsiPeriod},${c.stochRsi.stochPeriod})[${condList(c.stochRsi.conditions)}]`);
  if (c.adx.enabled) parts.push(`ADX(${c.adx.period},${c.adx.trendThreshold})[${condList(c.adx.conditions)}]`);
  if (c.supertrend.enabled)
    parts.push(`ST(${c.supertrend.atrPeriod},${c.supertrend.multiplier})[${condList(c.supertrend.conditions)}]`);
  if (c.ichimoku.enabled)
    parts.push(
      `Ichi(${c.ichimoku.tenkan},${c.ichimoku.kijun},${c.ichimoku.senkouB})[${condList(c.ichimoku.conditions)}]`,
    );
  if (c.obv.enabled) parts.push(`OBV(${c.obv.emaPeriod})[${condList(c.obv.conditions)}]`);
  const modeTag = parts.length > 1 ? ` [${c.mode === 'AND' ? 'VE' : 'VEYA'}]` : '';
  return parts.join(' + ') + modeTag;
}

// ── Tournament selection ──────────────────────

export function tournamentSelect<T extends { fitness: number }>(pool: T[], k = 3): T {
  let best = pool[Math.floor(Math.random() * pool.length)];
  for (let i = 1; i < k; i++) {
    const candidate = pool[Math.floor(Math.random() * pool.length)];
    if (candidate.fitness > best.fitness) best = candidate;
  }
  return best;
}

// ── Phase 2: Genetic Algorithm ────────────────

export function mutateConfig(config: SignalConfig, rate: number): SignalConfig {
  const c = deepClone(config);

  if (c.rsi.enabled && Math.random() < rate) {
    c.rsi.period = clamp(c.rsi.period + randomInt(-5, 5), 5, 50);
    c.rsi.oversold = clamp(c.rsi.oversold + randomInt(-5, 5), 10, 45);
    c.rsi.overbought = clamp(c.rsi.overbought + randomInt(-5, 5), 55, 90);
    if (Math.random() < 0.3) {
      const keys = Object.keys(c.rsi.conditions) as (keyof RSISignalConfig['conditions'])[];
      const key = randomChoice(keys);
      (c.rsi.conditions as Record<string, boolean>)[key] = !c.rsi.conditions[key];
      if (!Object.values(c.rsi.conditions).some((v) => v))
        (c.rsi.conditions as Record<string, boolean>)[randomChoice(keys)] = true;
    }
  }

  if (c.macd.enabled && Math.random() < rate) {
    c.macd.fast = clamp(c.macd.fast + randomInt(-3, 3), 5, 20);
    c.macd.slow = clamp(c.macd.slow + randomInt(-5, 5), 15, 50);
    if (c.macd.fast >= c.macd.slow) c.macd.slow = c.macd.fast + 5;
    c.macd.signalPeriod = clamp(c.macd.signalPeriod + randomInt(-3, 3), 3, 20);
    if (Math.random() < 0.3) {
      const keys = Object.keys(c.macd.conditions) as (keyof MACDSignalConfig['conditions'])[];
      const key = randomChoice(keys);
      (c.macd.conditions as Record<string, boolean>)[key] = !c.macd.conditions[key];
      if (!Object.values(c.macd.conditions).some((v) => v))
        (c.macd.conditions as Record<string, boolean>)[randomChoice(keys)] = true;
    }
  }

  if (c.bollinger.enabled && Math.random() < rate) {
    c.bollinger.period = clamp(c.bollinger.period + randomInt(-5, 5), 10, 50);
    c.bollinger.mult = clamp(c.bollinger.mult + (Math.random() - 0.5), 1.0, 4.0);
    if (Math.random() < 0.3) {
      const keys = Object.keys(c.bollinger.conditions) as (keyof BollingerSignalConfig['conditions'])[];
      const key = randomChoice(keys);
      (c.bollinger.conditions as Record<string, boolean>)[key] = !c.bollinger.conditions[key];
      if (!Object.values(c.bollinger.conditions).some((v) => v))
        (c.bollinger.conditions as Record<string, boolean>)[randomChoice(keys)] = true;
    }
  }

  if (c.stochRsi.enabled && Math.random() < rate) {
    c.stochRsi.rsiPeriod = clamp(c.stochRsi.rsiPeriod + randomInt(-4, 4), 5, 30);
    c.stochRsi.stochPeriod = clamp(c.stochRsi.stochPeriod + randomInt(-4, 4), 5, 30);
    c.stochRsi.kSmooth = clamp(c.stochRsi.kSmooth + randomInt(-1, 1), 1, 10);
    c.stochRsi.dSmooth = clamp(c.stochRsi.dSmooth + randomInt(-1, 1), 1, 10);
    if (Math.random() < 0.3) {
      const keys = Object.keys(c.stochRsi.conditions) as (keyof StochRSISignalConfig['conditions'])[];
      const key = randomChoice(keys);
      (c.stochRsi.conditions as Record<string, boolean>)[key] = !c.stochRsi.conditions[key];
      if (!Object.values(c.stochRsi.conditions).some((v) => v))
        (c.stochRsi.conditions as Record<string, boolean>)[randomChoice(keys)] = true;
    }
  }

  if (c.adx.enabled && Math.random() < rate) {
    c.adx.period = clamp(c.adx.period + randomInt(-4, 4), 7, 40);
    c.adx.trendThreshold = clamp(c.adx.trendThreshold + randomInt(-5, 5), 15, 50);
    if (Math.random() < 0.3) {
      const keys = Object.keys(c.adx.conditions) as (keyof ADXSignalConfig['conditions'])[];
      const key = randomChoice(keys);
      (c.adx.conditions as Record<string, boolean>)[key] = !c.adx.conditions[key];
      if (!Object.values(c.adx.conditions).some((v) => v))
        (c.adx.conditions as Record<string, boolean>)[randomChoice(keys)] = true;
    }
  }

  if (c.supertrend.enabled && Math.random() < rate) {
    c.supertrend.atrPeriod = clamp(c.supertrend.atrPeriod + randomInt(-3, 3), 5, 30);
    c.supertrend.multiplier = clamp(c.supertrend.multiplier + (Math.random() - 0.5), 1.0, 6.0);
  }

  if (c.ichimoku.enabled && Math.random() < rate) {
    c.ichimoku.tenkan = clamp(c.ichimoku.tenkan + randomInt(-3, 3), 5, 20);
    c.ichimoku.kijun = clamp(c.ichimoku.kijun + randomInt(-5, 5), 15, 40);
    c.ichimoku.senkouB = clamp(c.ichimoku.senkouB + randomInt(-8, 8), 30, 80);
    if (Math.random() < 0.3) {
      const keys = Object.keys(c.ichimoku.conditions) as (keyof IchimokuSignalConfig['conditions'])[];
      const key = randomChoice(keys);
      (c.ichimoku.conditions as Record<string, boolean>)[key] = !c.ichimoku.conditions[key];
      if (!Object.values(c.ichimoku.conditions).some((v) => v))
        (c.ichimoku.conditions as Record<string, boolean>)[randomChoice(keys)] = true;
    }
  }

  if (c.obv.enabled && Math.random() < rate) {
    c.obv.emaPeriod = clamp(c.obv.emaPeriod + randomInt(-5, 5), 5, 80);
  }

  if (Math.random() < rate * 0.5) {
    c.mode = c.mode === 'AND' ? 'OR' : 'AND';
  }

  return c;
}

export function crossover(a: SignalConfig, b: SignalConfig): SignalConfig {
  return {
    rsi: Math.random() < 0.5 ? deepClone(a.rsi) : deepClone(b.rsi),
    macd: Math.random() < 0.5 ? deepClone(a.macd) : deepClone(b.macd),
    bollinger: Math.random() < 0.5 ? deepClone(a.bollinger) : deepClone(b.bollinger),
    stochRsi: Math.random() < 0.5 ? deepClone(a.stochRsi) : deepClone(b.stochRsi),
    adx: Math.random() < 0.5 ? deepClone(a.adx) : deepClone(b.adx),
    supertrend: Math.random() < 0.5 ? deepClone(a.supertrend) : deepClone(b.supertrend),
    ichimoku: Math.random() < 0.5 ? deepClone(a.ichimoku) : deepClone(b.ichimoku),
    obv: Math.random() < 0.5 ? deepClone(a.obv) : deepClone(b.obv),
    williamsPasa: Math.random() < 0.5 ? deepClone(a.williamsPasa) : deepClone(b.williamsPasa),
    nizamiCedid: Math.random() < 0.5 ? deepClone(a.nizamiCedid) : deepClone(b.nizamiCedid),
    mode: Math.random() < 0.5 ? a.mode : b.mode,
    positionMode: Math.random() < 0.5 ? a.positionMode : b.positionMode,
  };
}

// ── Phase 3: Multi-indicator combinations ─────

export type IndKey =
  | 'rsi'
  | 'macd'
  | 'bollinger'
  | 'stochRsi'
  | 'adx'
  | 'supertrend'
  | 'ichimoku'
  | 'obv'
  | 'williamsPasa'
  | 'nizamiCedid';

export const IND_KEYS: IndKey[] = [
  'rsi',
  'macd',
  'bollinger',
  'stochRsi',
  'adx',
  'supertrend',
  'ichimoku',
  'obv',
  'williamsPasa',
  'nizamiCedid',
];

export function mergeConfigs(configs: SignalConfig[], mode: 'AND' | 'OR'): SignalConfig {
  const b = base();
  for (const c of configs) {
    for (const key of IND_KEYS) {
      if ((c[key] as { enabled: boolean }).enabled) {
        (b as any)[key] = { ...(c[key] as object) };
      }
    }
  }
  b.mode = mode;
  return b;
}

export function generateCombinations(topGroups: EnhancedOptimizerResult[][]): SignalConfig[] {
  const combos: SignalConfig[] = [];

  // 2-indicator pairs (top-6 × top-6 × 2 modes)
  for (let i = 0; i < topGroups.length; i++)
    for (let j = i + 1; j < topGroups.length; j++)
      for (const a of topGroups[i].slice(0, 6))
        for (const b of topGroups[j].slice(0, 6))
          for (const mode of ['AND', 'OR'] as const) combos.push(mergeConfigs([a.config, b.config], mode));

  // 3-indicator triples (top-3 × top-3 × top-3 × 2 modes) — limit to avoid explosion
  for (let i = 0; i < topGroups.length; i++)
    for (let j = i + 1; j < topGroups.length; j++)
      for (let k = j + 1; k < topGroups.length; k++) {
        const gi = topGroups[i].slice(0, 3);
        const gj = topGroups[j].slice(0, 3);
        const gk = topGroups[k].slice(0, 3);
        for (const a of gi)
          for (const b of gj)
            for (const c of gk)
              for (const mode of ['AND', 'OR'] as const)
                combos.push(mergeConfigs([a.config, b.config, c.config], mode));
      }

  return combos;
}

// ── Progress helper ───────────────────────────

function estimateSecondsLeft(startTime: number, current: number, total: number): number {
  if (current <= 0) return 0;
  const elapsed = (Date.now() - startTime) / 1000;
  const rate = current / elapsed;
  return rate > 0 ? (total - current) / rate : 0;
}

// ── Main optimiser ────────────────────────────

export async function optimizeSignals(
  data: OHLCVData[],
  dateRange: { start?: string; end?: string },
  settings: OptimizerSettings = DEFAULT_OPTIMIZER_SETTINGS,
  onProgress: (p: EnhancedOptimizerProgress) => void,
  signal: AbortSignal,
): Promise<EnhancedOptimizerResult[]> {
  if (data.length < 100) return [];

  let bestSoFar: EnhancedOptimizerResult | null = null;

  function updateBest(r: EnhancedOptimizerResult) {
    if (!bestSoFar || r.fitness > bestSoFar.fitness) bestSoFar = r;
  }

  // ─── Phase 1: Grid Search ─────────────────

  const allGridConfigs: { configs: SignalConfig[]; label: string }[] = [
    { configs: generateRSIConfigs(), label: 'RSI' },
    { configs: generateMACDConfigs(), label: 'MACD' },
    { configs: generateBollingerConfigs(), label: 'Bollinger' },
    { configs: generateStochRSIConfigs(), label: 'StochRSI' },
    { configs: generateADXConfigs(), label: 'ADX' },
    { configs: generateSuperTrendConfigs(), label: 'SuperTrend' },
    { configs: generateIchimokuConfigs(), label: 'Ichimoku' },
    { configs: generateOBVConfigs(), label: 'OBV' },
  ];

  const phase1Total = allGridConfigs.reduce((sum, g) => sum + g.configs.length, 0);
  let phase1Done = 0;
  const phase1Start = Date.now();

  async function runGrid(
    configs: SignalConfig[],
    source: EnhancedOptimizerResult['source'] = 'grid',
  ): Promise<EnhancedOptimizerResult[]> {
    const results: EnhancedOptimizerResult[] = [];
    for (let i = 0; i < configs.length; i++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const ev = evaluate(data, configs[i], dateRange, settings);
      if (ev) {
        const r = toResult(configs[i], ev, source);
        r.label = describeConfig(configs[i]);
        results.push(r);
        updateBest(r);
      }
      phase1Done++;
      if (i % 100 === 0) {
        onProgress({
          phase: 1,
          phaseName: 'Tekli Tarama',
          current: phase1Done,
          total: phase1Total,
          bestSoFar,
          estimatedSecondsLeft: estimateSecondsLeft(phase1Start, phase1Done, phase1Total),
          startTime: phase1Start,
        });
        await yieldToMain();
      }
    }
    return results;
  }

  const gridResults: EnhancedOptimizerResult[][] = [];
  for (const group of allGridConfigs) {
    gridResults.push(await runGrid(group.configs));
  }

  const allPhase1 = gridResults.flat();

  // Top 15 from each for GA seeding and Phase 3
  const topPerIndicator = gridResults.map((r) => topN([...r], 15));

  // ─── Phase 2: Genetic Algorithm ───────────

  const phase2Start = Date.now();
  const gaSeeds = topN([...allPhase1], settings.eliteCount * 4);
  const phase2Total = settings.populationSize * settings.generations;
  let phase2Done = 0;

  onProgress({
    phase: 2,
    phaseName: 'Genetik Arama',
    current: 0,
    total: phase2Total,
    bestSoFar,
    estimatedSecondsLeft: 0,
    startTime: phase2Start,
  });

  let population: { config: SignalConfig; fitness: number; result: EnhancedOptimizerResult | null }[] = [];
  for (const seed of gaSeeds.slice(0, settings.eliteCount)) {
    population.push({ config: deepClone(seed.config), fitness: seed.fitness, result: seed });
  }
  while (population.length < settings.populationSize) {
    const parent = randomChoice(gaSeeds);
    const childConfig = mutateConfig(parent.config, settings.mutationRate);
    population.push({ config: childConfig, fitness: 0, result: null });
  }

  const allPhase2: EnhancedOptimizerResult[] = [];

  for (let gen = 0; gen < settings.generations; gen++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    // Adaptive mutation: high early (exploration) → low late (exploitation)
    const adaptiveRate = settings.mutationRate * (1 - (gen / settings.generations) * 0.6);

    for (const ind of population) {
      if (ind.result === null) {
        const ev = evaluate(data, ind.config, dateRange, settings);
        if (ev) {
          const r = toResult(ind.config, ev, 'genetic');
          r.label = describeConfig(ind.config);
          ind.fitness = r.fitness;
          ind.result = r;
          allPhase2.push(r);
          updateBest(r);
        } else {
          ind.fitness = 0;
        }
      }
      phase2Done++;
    }

    population.sort((a, b) => b.fitness - a.fitness);
    const elites = population.slice(0, settings.eliteCount);

    const nextGen = elites.map((e) => ({
      config: deepClone(e.config),
      fitness: e.fitness,
      result: e.result,
    }));

    while (nextGen.length < settings.populationSize) {
      // Tournament selection instead of random elite pick
      const p1 = tournamentSelect(population, 3);
      const p2 = tournamentSelect(population, 3);
      const childConfig = mutateConfig(crossover(p1.config, p2.config), adaptiveRate);
      nextGen.push({ config: childConfig, fitness: 0, result: null });
    }

    population = nextGen;

    onProgress({
      phase: 2,
      phaseName: 'Genetik Arama',
      current: phase2Done,
      total: phase2Total,
      bestSoFar,
      estimatedSecondsLeft: estimateSecondsLeft(phase2Start, phase2Done, phase2Total),
      startTime: phase2Start,
    });
    await yieldToMain();
  }

  // ─── Phase 3: Multi-indicator combinations ─

  const phase3Start = Date.now();

  // Merge Phase 1 + Phase 2 top performers per indicator
  const mergedGroups = topPerIndicator.map((group, idx) => {
    const key = IND_KEYS[idx];
    const phase2Singles = allPhase2.filter((r) => {
      const cfg = r.config;
      return (
        (cfg[key] as { enabled: boolean }).enabled &&
        IND_KEYS.filter((k) => k !== key).every((k) => !(cfg[k] as { enabled: boolean }).enabled)
      );
    });
    return topN([...group, ...phase2Singles], 6);
  });

  const combos = generateCombinations(mergedGroups);
  const phase3Total = combos.length;
  let phase3Done = 0;

  onProgress({
    phase: 3,
    phaseName: 'Kombinasyonlar',
    current: 0,
    total: phase3Total,
    bestSoFar,
    estimatedSecondsLeft: 0,
    startTime: phase3Start,
  });

  const allPhase3: EnhancedOptimizerResult[] = [];
  for (let i = 0; i < combos.length; i++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const ev = evaluate(data, combos[i], dateRange, settings);
    if (ev) {
      const r = toResult(combos[i], ev, 'combination');
      r.label = describeConfig(combos[i]);
      allPhase3.push(r);
      updateBest(r);
    }
    phase3Done++;
    if (i % 100 === 0) {
      onProgress({
        phase: 3,
        phaseName: 'Kombinasyonlar',
        current: phase3Done,
        total: phase3Total,
        bestSoFar,
        estimatedSecondsLeft: estimateSecondsLeft(phase3Start, phase3Done, phase3Total),
        startTime: phase3Start,
      });
      await yieldToMain();
    }
  }

  // ─── Merge + Deduplicate ──────────────────

  const all = [...allPhase1, ...allPhase2, ...allPhase3];
  const seen = new Set<string>();
  const unique: EnhancedOptimizerResult[] = [];
  for (const r of all.sort((a, b) => b.fitness - a.fitness)) {
    if (!seen.has(r.label)) {
      seen.add(r.label);
      unique.push(r);
    }
  }

  const top50 = unique.slice(0, 50);

  // ─── Phase 4: Walk-Forward Validation ─────

  if (!settings.walkForward) {
    return top50;
  }

  const phase4Start = Date.now();
  const splitIndex = Math.floor(data.length * settings.trainRatio);

  if (splitIndex < 50 || data.length - splitIndex < 30) {
    return top50;
  }

  const trainData = data.slice(0, splitIndex);
  const testData = data.slice(splitIndex);
  const phase4Total = top50.length;

  onProgress({
    phase: 4,
    phaseName: 'Walk-Forward',
    current: 0,
    total: phase4Total,
    bestSoFar,
    estimatedSecondsLeft: 0,
    startTime: phase4Start,
  });

  const validated: EnhancedOptimizerResult[] = [];
  for (let i = 0; i < top50.length; i++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const r = top50[i];

    const isCombined = computeCombinedSignals(trainData, r.config);
    const isStats = pairTrades(isCombined, trainData, dateRange.start, dateRange.end, r.config.positionMode);
    const isEnhanced = computeEnhancedStats(isStats.trades, settings.transactionCostPct);
    const isFitness = advancedFitness(isEnhanced, settings);

    const oosCombined = computeCombinedSignals(testData, r.config);
    const oosStats = pairTrades(oosCombined, testData, undefined, undefined, r.config.positionMode);
    const oosEnhanced = computeEnhancedStats(oosStats.trades, settings.transactionCostPct);
    const oosFitness = advancedFitness(oosEnhanced, settings);

    const rob = computeRobustnessScore(isFitness, oosFitness);

    const finalFitness = isFitness * 0.4 + oosFitness * 0.6;

    validated.push({
      config: r.config,
      label: r.label,
      fitness: finalFitness,
      inSample: isEnhanced,
      outOfSample: oosEnhanced,
      robustnessScore: rob.score,
      robustnessGrade: rob.grade,
      monteCarloScore: null,
      source: r.source,
    });

    onProgress({
      phase: 4,
      phaseName: 'Walk-Forward',
      current: i + 1,
      total: phase4Total,
      bestSoFar: validated.length > 0 ? validated.sort((a, b) => b.fitness - a.fitness)[0] : bestSoFar,
      estimatedSecondsLeft: estimateSecondsLeft(phase4Start, i + 1, phase4Total),
      startTime: phase4Start,
    });

    if (i % 5 === 0) await yieldToMain();
  }

  const sortedValidated = validated.sort((a, b) => b.fitness - a.fitness);
  const top30 = sortedValidated.slice(0, 30);

  // ─── Phase 5: Monte Carlo Validation ───────

  const phase5Start = Date.now();
  const phase5Total = top30.length;

  onProgress({
    phase: 5,
    phaseName: 'Monte Carlo',
    current: 0,
    total: phase5Total,
    bestSoFar,
    estimatedSecondsLeft: 0,
    startTime: phase5Start,
  });

  for (let i = 0; i < top30.length; i++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const r = top30[i];
    const allCombined = computeCombinedSignals(data, r.config);
    const allStats = pairTrades(allCombined, data, dateRange.start, dateRange.end, r.config.positionMode);
    const allEnhanced = computeEnhancedStats(allStats.trades, settings.transactionCostPct);

    // Build adjusted returns for MC shuffle
    const roundTripCost = (settings.transactionCostPct / 100) * 2;
    const adjReturns = allStats.trades.map((t) => t.returnPct - roundTripCost);

    r.monteCarloScore = monteCarloValidation(adjReturns, allEnhanced.totalReturn, 500);

    onProgress({
      phase: 5,
      phaseName: 'Monte Carlo',
      current: i + 1,
      total: phase5Total,
      bestSoFar: top30[0],
      estimatedSecondsLeft: estimateSecondsLeft(phase5Start, i + 1, phase5Total),
      startTime: phase5Start,
    });

    if (i % 3 === 0) await yieldToMain();
  }

  return top30;
}
