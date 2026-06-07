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

// ── Grid generators ────────────────────────────

export function generateWilliamsPasaConfigs(): SignalConfig[] {
  const lengths = [130, 200, 260, 365];
  const emaLens = [130, 200, 260, 365];
  const configs: SignalConfig[] = [];
  for (const length of lengths)
    for (const emaLen of emaLens) {
      const b = base();
      b.williamsPasa = { enabled: true, length, emaLen, conditions: { threshold: true } };
      configs.push(b);
    }
  return configs;
}

export function generateNizamiCedidConfigs(): SignalConfig[] {
  const fasts = [80, 100, 120, 150];
  const slows = [200, 260, 300, 365];
  const configs: SignalConfig[] = [];
  for (const fast of fasts)
    for (const slow of slows) {
      if (fast >= slow) continue;
      const b = base();
      b.nizamiCedid = { enabled: true, fast, slow, signalLen: 50, vwmaLen: 185, conditions: { deltaCross: true } };
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
  if (c.williamsPasa?.enabled)
    parts.push(`WP(${c.williamsPasa.length},${c.williamsPasa.emaLen})[${condList(c.williamsPasa.conditions)}]`);
  if (c.nizamiCedid?.enabled)
    parts.push(`NC(${c.nizamiCedid.fast},${c.nizamiCedid.slow})[${condList(c.nizamiCedid.conditions)}]`);
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

  if (c.williamsPasa?.enabled && Math.random() < rate) {
    c.williamsPasa.length = clamp(c.williamsPasa.length + randomInt(-20, 20), 50, 500);
    c.williamsPasa.emaLen = clamp(c.williamsPasa.emaLen + randomInt(-20, 20), 50, 500);
  }

  if (c.nizamiCedid?.enabled && Math.random() < rate) {
    c.nizamiCedid.fast = clamp(c.nizamiCedid.fast + randomInt(-10, 10), 50, 200);
    c.nizamiCedid.slow = clamp(c.nizamiCedid.slow + randomInt(-20, 20), 100, 400);
    if (c.nizamiCedid.fast >= c.nizamiCedid.slow) c.nizamiCedid.slow = c.nizamiCedid.fast + 50;
  }

  if (Math.random() < rate * 0.5) {
    c.mode = c.mode === 'AND' ? 'OR' : 'AND';
  }

  return c;
}

export function crossover(a: SignalConfig, b: SignalConfig): SignalConfig {
  return {
    williamsPasa: Math.random() < 0.5 ? deepClone(a.williamsPasa) : deepClone(b.williamsPasa),
    nizamiCedid: Math.random() < 0.5 ? deepClone(a.nizamiCedid) : deepClone(b.nizamiCedid),
    mode: Math.random() < 0.5 ? a.mode : b.mode,
    positionMode: Math.random() < 0.5 ? a.positionMode : b.positionMode,
  };
}

// ── Phase 3: Multi-indicator combinations ─────

export type IndKey = 'williamsPasa' | 'nizamiCedid';

export const IND_KEYS: IndKey[] = ['williamsPasa', 'nizamiCedid'];

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
    { configs: generateWilliamsPasaConfigs(), label: 'Williams Pasa' },
    { configs: generateNizamiCedidConfigs(), label: 'Nizami Cedid' },
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
