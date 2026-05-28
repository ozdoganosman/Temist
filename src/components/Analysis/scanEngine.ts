import { fetchHistory, fetchScanResults, type OHLCVData } from '../../api/borsaApi';
import { computeWilliamsPasa, computeNizamiCedid, ema } from '../../utils/indicators';
import { computePearsonChannel, DEFAULT_PEARSON_CONFIGS, type PearsonConfig } from '../../utils/pearsonChannels';
import { computeMATLRNS } from '../../utils/matlrns';

export interface ScannedStock {
  symbol: string;
  close: number;
  changePercent: number;
  volume: number;
  overallScore: number; // 0-100
  indicators: {
    williamsPasa: {
      value: number;
      ema: number;
      signal: 'bullish' | 'bearish' | 'neutral';
      score: number; // 0-20
    };
    nizamiCedid: {
      value: number;
      signal: 'bullish' | 'bearish' | 'neutral';
      score: number; // 0-20
      condition: boolean;
      macd: number;
      macdSignal: number;
      emacd: number;
    };
    emaRibbon: {
      value: number; // average spread ratio
      signal: 'bullish' | 'bearish' | 'neutral';
      score: number; // 0-20
    };
    pearson: {
      value: number; // average r
      signal: 'bullish' | 'bearish' | 'neutral';
      score: number; // 0-20
      pos: number; // average position
    };
    matlrns: {
      value: number; // -2 to +2
      signal: 'bullish' | 'bearish' | 'neutral';
      score: number; // 0-20
    };
    extra: {
      sma50: number | null;
      sma200: number | null;
      ema21: number | null;
      ema100: number | null;
      avgVolume5: number | null;
      avgVolume10: number | null;
      volumeRatio: number | null;
    };
  };
}

// Memory cache for the scan results
let cachedResults: ScannedStock[] | null = null;
let cachedTimestamp: number | null = null;

/** Helper to clamp number between min and max */
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** Compute EMA Ribbon score client side */
function calculateEMARibbonLast(closes: number[]): { spread: number; score: number; signal: 'bullish' | 'bearish' | 'neutral' } {
  const n = closes.length;
  const periods = [8, 13, 21, 34, 55, 89, 144, 233, 377, 610].filter(p => n >= p);
  if (periods.length < 2) {
    return { spread: 0, score: 10, signal: 'neutral' };
  }

  const closesN = closes as (number | null)[];
  const emas = periods.map(p => ema(closesN, p));
  const lastIdx = n - 1;

  let sumClamped = 0;
  let validPairs = 0;
  const spreadMultiplier = 0.003;

  for (let j = 0; j < periods.length - 1; j++) {
    const emaCurr = emas[j][lastIdx];
    const emaNext = emas[j + 1][lastIdx];
    if (emaCurr !== null && emaNext !== null && emaNext !== 0) {
      const diffRatio = (emaCurr - emaNext) / emaNext;
      const clamped = clamp(diffRatio / spreadMultiplier, -1, 1);
      sumClamped += clamped;
      validPairs++;
    }
  }

  const avgSpread = validPairs > 0 ? sumClamped / validPairs : 0;
  const score = ((avgSpread + 1) / 2) * 20;

  let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (avgSpread > 0.2) signal = 'bullish';
  else if (avgSpread < -0.2) signal = 'bearish';

  return { spread: avgSpread, score: Math.round(score), signal };
}

/** Calculate Pearson 3-channel score client side */
function calculatePearsonLast(closes: number[]): { avgR: number; avgPos: number; score: number; signal: 'bullish' | 'bearish' | 'neutral' } {
  const configs: PearsonConfig[] = DEFAULT_PEARSON_CONFIGS.filter(c => c.id !== 'extra_short'); // Kısa, Uzun, En Uzun (3 Channels)
  let sumScore = 0;
  let sumR = 0;
  let sumPos = 0;
  let validChannels = 0;

  for (const cfg of configs) {
    const res = computePearsonChannel(closes, cfg);
    if (res) {
      const lastClose = closes[closes.length - 1];
      const rmse = res.rmse;
      const pos = rmse > 0 ? (lastClose - res.B) / rmse : 0;
      const r = res.r;

      sumR += r;
      sumPos += pos;

      // Score logic: 0.5 + 0.3 * r + position factor
      let chanScore = 0.5 + 0.3 * r;
      if (r > 0) {
        // In rising channel, buying at bottom (pos around -0.5) is great, breakout (pos > 1) is bullish
        chanScore += pos < -0.3 ? 0.2 * (1.3 + pos) : pos > 0.8 ? 0.2 : 0.2 * (1 - pos);
      } else {
        // In falling channel, breakouts above are bullish, otherwise bearish
        chanScore += pos > 0.5 ? 0.2 : 0.0;
      }

      sumScore += clamp(chanScore, 0, 1);
      validChannels++;
    }
  }

  if (validChannels === 0) {
    return { avgR: 0, avgPos: 0, score: 10, signal: 'neutral' };
  }

  const avgR = sumR / validChannels;
  const avgPos = sumPos / validChannels;
  const finalScore = (sumScore / validChannels) * 20;

  let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (avgR > 0.2 && avgPos > -0.8) signal = 'bullish';
  else if (avgR < -0.2 && avgPos < 0.8) signal = 'bearish';

  return { avgR, avgPos, score: Math.round(finalScore), signal };
}

function calculateSMA(data: number[], period: number): number | null {
  if (data.length < period) return null;
  let sum = 0;
  for (let i = data.length - period; i < data.length; i++) {
    sum += data[i];
  }
  return sum / period;
}

/** Compute the combined score and indicators for a single symbol */
export async function scanSingleSymbol(symbol: string): Promise<ScannedStock | null> {
  try {
    const history = await fetchHistory(symbol);
    if (!history || history.length < 50) return null;

    const closes = history.map(h => h.close);
    const highs = history.map(h => h.high);
    const lows = history.map(h => h.low);
    const volumes = history.map(h => h.volume);

    const n = closes.length;
    const lastClose = closes[n - 1];
    const prevClose = closes[n - 2];
    const lastVolume = volumes[n - 1];
    const changePercent = prevClose > 0 ? ((lastClose - prevClose) / prevClose) * 100 : 0;

    // 1. Williams Pasa (%R)
    const wp = computeWilliamsPasa(highs, lows, closes);
    const wpR = wp.percentR[n - 1] ?? 50;
    const wpEma = wp.emaWil[n - 1] ?? 50;
    const wpDiff = wpR - wpEma;
    const wpScore = clamp(10 + wpDiff * 0.2, 0, 20);
    const wpSignal = wpDiff > 5 ? 'bullish' : wpDiff < -5 ? 'bearish' : 'neutral';

    // 2. Nizami Cedid
    const nc = computeNizamiCedid(closes, volumes);
    const ncDelta = nc.delta[n - 1] ?? 0;
    const ncCondition = nc.condition[n - 1] ?? false;
    const ncMacd = nc.macd[n - 1] ?? 0;
    const ncMacdSignal = nc.signal[n - 1] ?? 0;
    const ncEmacd = nc.emacd[n - 1] ?? 0;
    const ncBase = ncCondition ? 12 : 5;
    const ncScore = clamp(ncBase + ncDelta * 200, 0, 20);
    const ncSignal = ncDelta > 0.002 && ncCondition ? 'bullish' : ncDelta < -0.002 || !ncCondition ? 'bearish' : 'neutral';

    // 3. EMA Ribbon
    const ribbon = calculateEMARibbonLast(closes);

    // 4. Pearson Channels
    const pearson = calculatePearsonLast(closes);

    // 5. MATLRNS
    const matResult = computeMATLRNS(closes, highs, lows, volumes);
    const matDir = matResult.direction[n - 1] ?? 0;
    let matBase = 10;
    if (matDir === 2) matBase = 18;
    else if (matDir === 1) matBase = 14;
    else if (matDir === -1) matBase = 6;
    else if (matDir === -2) matBase = 2;

    const fastMAVal = matResult.fastMA[n - 1];
    const matPriceFactor = fastMAVal !== null ? (lastClose > fastMAVal ? 2 : -2) : 0;
    const matScore = clamp(matBase + matPriceFactor, 0, 20);
    const matSignal = matDir > 0 ? 'bullish' : matDir < 0 ? 'bearish' : 'neutral';

    const overallScore = Math.round(wpScore + ncScore + ribbon.score + pearson.score + matScore);

    // 6. Advanced Technical Moving Averages & Volume metrics
    const sma50 = calculateSMA(closes, 50);
    const sma200 = calculateSMA(closes, 200);
    const closesN = closes.map(c => c as number | null);
    const ema21Arr = ema(closesN, 21);
    const ema100Arr = ema(closesN, 100);
    const ema21 = ema21Arr[n - 1] ?? null;
    const ema100 = ema100Arr[n - 1] ?? null;

    const avgVolume5 = calculateSMA(volumes, 5);
    const avgVolume10 = calculateSMA(volumes, 10);
    const volumeRatio = avgVolume10 && avgVolume10 !== 0 ? lastVolume / avgVolume10 : 1;

    return {
      symbol,
      close: lastClose,
      changePercent,
      volume: lastVolume,
      overallScore: clamp(overallScore, 0, 100),
      indicators: {
        williamsPasa: { value: wpR, ema: wpEma, signal: wpSignal, score: Math.round(wpScore) },
        nizamiCedid: { 
          value: ncDelta, 
          signal: ncSignal, 
          score: Math.round(ncScore), 
          condition: ncCondition,
          macd: ncMacd,
          macdSignal: ncMacdSignal,
          emacd: ncEmacd
        },
        emaRibbon: { value: ribbon.spread, signal: ribbon.signal, score: ribbon.score },
        pearson: { value: pearson.avgR, signal: pearson.signal, score: pearson.score, pos: pearson.avgPos },
        matlrns: { value: matDir, signal: matSignal, score: matScore },
        extra: {
          sma50,
          sma200,
          ema21,
          ema100,
          avgVolume5,
          avgVolume10,
          volumeRatio
        }
      },
    };
  } catch (err) {
    console.error(`Error scanning symbol ${symbol}:`, err);
    return null;
  }
}

/**
 * Scan all symbols in batches to calculate scores client side.
 * Saves results to cache.
 */
export async function runClientScan(
  onProgress: (completed: number, total: number, currentSymbol: string) => void,
  forceRefresh = false
): Promise<ScannedStock[]> {
  if (!forceRefresh && cachedResults && cachedResults.length > 0) {
    return cachedResults;
  }

  // Get symbol list from scan results structure
  const scanData = await fetchScanResults();
  const rawSymbols = scanData.results.map(r => r.symbol);
  
  if (rawSymbols.length === 0) {
    return [];
  }

  // Check localStorage cache first to avoid heavy network operations on deployed page
  const savedCache = localStorage.getItem('temist_scanner_scan_results_cache');
  const savedTimestamp = localStorage.getItem('temist_scanner_scan_results_timestamp');
  const serverTimestamp = String(scanData.timestamp || 0);

  if (!forceRefresh && savedCache && savedTimestamp && savedTimestamp === serverTimestamp) {
    try {
      const parsed = JSON.parse(savedCache);
      if (parsed && parsed.length > 0 && parsed[0].indicators.extra) {
        cachedResults = parsed;
        cachedTimestamp = Date.now();
        return parsed;
      }
    } catch (e) {
      console.error('Failed to parse cached scan results from localStorage:', e);
    }
  }

  const results: ScannedStock[] = [];
  const BATCH_SIZE = 8;
  const total = rawSymbols.length;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = rawSymbols.slice(i, i + BATCH_SIZE);
    
    // Process batch in parallel
    const batchPromises = batch.map(sym => scanSingleSymbol(sym));
    const batchResults = await Promise.all(batchPromises);

    for (let j = 0; j < batch.length; j++) {
      const res = batchResults[j];
      if (res) {
        results.push(res);
      }
    }

    onProgress(Math.min(i + BATCH_SIZE, total), total, batch[batch.length - 1]);
  }

  // Sort by overall score descending
  results.sort((a, b) => b.overallScore - a.overallScore);

  cachedResults = results;
  cachedTimestamp = Date.now();

  try {
    localStorage.setItem('temist_scanner_scan_results_cache', JSON.stringify(results));
    localStorage.setItem('temist_scanner_scan_results_timestamp', serverTimestamp);
  } catch (e) {
    console.error('Failed to save scan results cache to localStorage:', e);
  }

  return results;
}

export function getCachedScanResults(): ScannedStock[] | null {
  return cachedResults;
}

export function clearScanCache() {
  cachedResults = null;
  cachedTimestamp = null;
}
