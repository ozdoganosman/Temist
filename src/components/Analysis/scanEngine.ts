import { fetchHistory, fetchScanResults, type OHLCVData } from '../../api/borsaApi';
import { computeWilliamsPasa, computeNizamiCedid, ema } from '../../utils/indicators';
import { computePearsonChannel, DEFAULT_PEARSON_CONFIGS, type PearsonConfig } from '../../utils/pearsonChannels';
import { getCacheItem, setCacheItem } from '../../utils/indexedDbCache';
import { computeKPIs } from '../../utils/computeFinancialMetrics';

export interface ScannedStock {
  symbol: string;
  close: number;
  changePercent: number;
  volume: number;
  overallScore: number; // 0-100 (Technical Score)
  fundamentalScore: number; // 0-10
  piotroskiScore: number; // 0-9
  combinedScore: number; // 0-100 (60% Tech + 40% Fund)
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
      extra_short_r: number;
      extra_short_pos: number;
      extra_short_slope_pct: number;
      short_r: number;
      short_pos: number;
      short_slope_pct: number;
      long_r: number;
      long_pos: number;
      long_slope_pct: number;
      extra_long_r: number;
      extra_long_pos: number;
      extra_long_slope_pct: number;
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

/** Calculate Pearson 4-channel score client side */
function calculatePearsonLast(closes: number[]): { 
  avgR: number; 
  avgPos: number; 
  score: number; 
  signal: 'bullish' | 'bearish' | 'neutral';
  channels: Record<string, { r: number; pos: number; slopePct: number }>;
} {
  const configs: PearsonConfig[] = DEFAULT_PEARSON_CONFIGS;
  let sumScore = 0;
  let sumR = 0;
  let sumPos = 0;
  let validChannels = 0;
  const channels: Record<string, { r: number; pos: number; slopePct: number }> = {};

  // Initialize defaults for all 4 configs
  for (const cfg of DEFAULT_PEARSON_CONFIGS) {
    channels[cfg.id] = { r: 0, pos: 0, slopePct: 0 };
  }

  for (const cfg of configs) {
    const res = computePearsonChannel(closes, cfg);
    if (res) {
      const lastClose = closes[closes.length - 1];
      const rmse = res.rmse;
      const pos = rmse > 0 ? (lastClose - res.B) / rmse : 0;
      const r = res.r;
      const slopePct = (res.B - res.A) / res.p;

      sumR += r;
      sumPos += pos;

      channels[cfg.id] = { r, pos, slopePct };

      let chanScore = 0.5 + 0.3 * r;
      if (r > 0) {
        chanScore += pos < -0.3 ? 0.2 * (1.3 + pos) : pos > 0.8 ? 0.2 : 0.2 * (1 - pos);
      } else {
        chanScore += pos > 0.5 ? 0.2 : 0.0;
      }

      sumScore += clamp(chanScore, 0, 1);
      validChannels++;
    }
  }

  if (validChannels === 0) {
    return { avgR: 0, avgPos: 0, score: 10, signal: 'neutral', channels };
  }

  const avgR = sumR / validChannels;
  const avgPos = sumPos / validChannels;
  const finalScore = (sumScore / validChannels) * 20;

  let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (avgR > 0.2 && avgPos > -0.8) signal = 'bullish';
  else if (avgR < -0.2 && avgPos < 0.8) signal = 'bearish';

  return { avgR, avgPos, score: Math.round(finalScore), signal, channels };
}

function calculateSMA(data: number[], period: number): number | null {
  if (data.length < period) return null;
  let sum = 0;
  for (let i = data.length - period; i < data.length; i++) {
    sum += data[i];
  }
  return sum / period;
}

/** Fetch historical price data with IndexedDB caching support */
async function fetchHistoryWithCache(symbol: string, forceRefresh: boolean): Promise<OHLCVData[] | null> {
  if (!forceRefresh) {
    const cached = await getCacheItem<OHLCVData[]>('history', symbol);
    if (cached && cached.length > 0) return cached;
  }
  const history = await fetchHistory(symbol);
  if (history && history.length > 0) {
    await setCacheItem('history', symbol, history);
  }
  return history;
}

/** Fetch stock financials JSON with IndexedDB caching support */
async function fetchFinancialsWithCache(symbol: string, forceRefresh: boolean): Promise<any | null> {
  if (!forceRefresh) {
    const cached = await getCacheItem<any>('financials', symbol);
    if (cached) return cached;
  }
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/financials/${symbol}.json`);
    if (!res.ok) return null;
    const json = await res.json();
    await setCacheItem('financials', symbol, json);
    return json;
  } catch (e) {
    console.warn(`Failed to fetch financials for ${symbol}:`, e);
    return null;
  }
}

/**
 * Calculates dynamic fundamental score (0-10) and Piotroski F-Score (0-9)
 */
function calculateFundamentalScores(allFin: any, ohlcv: OHLCVData[]): { fundamentalScore: number; piotroskiScore: number } {
  const periods = allFin.income_stmt?.periods || [];
  if (periods.length === 0) {
    return { fundamentalScore: 5, piotroskiScore: 5 }; // defaults
  }

  const p1 = periods[periods.length - 1];

  // Find same quarter/month of the previous year (YoY comparison period)
  const parts = p1.split('/');
  const year = parseInt(parts[0]);
  const month = parts[1];
  const p2Target = `${year - 1}/${month}`;
  const p2 = periods.includes(p2Target) ? p2Target : (periods.length > 1 ? periods[periods.length - 2] : null);

  const kpis = computeKPIs(allFin, ohlcv);

  // 1. Calculate Fundamental Health Score (0-10)
  let fundScore = 0;

  // F/K (P/E) points (max 2)
  if (kpis.fk !== null && kpis.fk > 0 && kpis.fk < 15) fundScore += 2;
  else if (kpis.fk !== null && kpis.fk > 0 && kpis.fk < 25) fundScore += 1;

  // PD/DD (P/B) points (max 2)
  if (kpis.pddd !== null && kpis.pddd > 0 && kpis.pddd < 2.0) fundScore += 2;
  else if (kpis.pddd !== null && kpis.pddd > 0 && kpis.pddd < 4.0) fundScore += 1;

  // ROE points (max 2)
  if (kpis.roe !== null && kpis.roe > 20) fundScore += 2;
  else if (kpis.roe !== null && kpis.roe > 10) fundScore += 1;

  // Margin points (max 1)
  if (kpis.netKarMarji !== null && kpis.netKarMarji > 15) fundScore += 1;
  else if (kpis.netKarMarji !== null && kpis.netKarMarji > 5) fundScore += 0.5;

  // Revenue Growth points (max 1.5)
  const revRow = allFin.income_stmt.data.find((r: any) => r.item === 'Satış Gelirleri');
  const rev1 = revRow && p1 ? revRow[p1] : null;
  const rev2 = revRow && p2 ? revRow[p2] : null;
  let revGrowth = null;
  if (rev1 !== null && rev2 !== null && rev2 !== 0) {
    revGrowth = ((rev1 - rev2) / rev2) * 100;
  }
  if (revGrowth !== null && revGrowth > 20) fundScore += 1.5;
  else if (revGrowth !== null && revGrowth > 5) fundScore += 0.5;

  // Debt/Equity points (max 1.5)
  if (kpis.borcOzkaynak !== null && kpis.borcOzkaynak < 1.0 && kpis.borcOzkaynak >= 0) fundScore += 1.5;
  else if (kpis.borcOzkaynak !== null && kpis.borcOzkaynak < 2.0 && kpis.borcOzkaynak >= 0) fundScore += 0.5;

  // 2. Calculate Piotroski F-Score (0-9)
  let fScore = 0;

  const netIncomeRow = allFin.income_stmt.data.find((r: any) => r.item === 'Ana Ortaklık Payları' || r.item === 'DÖNEM KARI (ZARARI)');
  const netIncome1 = netIncomeRow && p1 ? netIncomeRow[p1] : null;
  const netIncome2 = netIncomeRow && p2 ? netIncomeRow[p2] : null;

  const grossProfitRow = allFin.income_stmt.data.find((r: any) => r.item === 'BRÜT KAR (ZARAR)');
  const grossProfit1 = grossProfitRow && p1 ? grossProfitRow[p1] : null;
  const grossProfit2 = grossProfitRow && p2 ? grossProfitRow[p2] : null;

  const caRow = allFin.balance_sheet.data.find((r: any) => r.item === 'Dönen Varlıklar');
  const ncaRow = allFin.balance_sheet.data.find((r: any) => r.item === 'Duran Varlıklar');
  const assets1 = (caRow && p1 ? caRow[p1] || 0 : 0) + (ncaRow && p1 ? ncaRow[p1] || 0 : 0) || null;
  const assets2 = (caRow && p2 ? caRow[p2] || 0 : 0) + (ncaRow && p2 ? ncaRow[p2] || 0 : 0) || null;

  const ltDebtRow = allFin.balance_sheet.data.find((r: any) => r.item === 'Uzun Yükümlülükler' || r.item === 'Uzun Vadeli Yükümlülükler');
  const ltDebt1 = ltDebtRow && p1 ? ltDebtRow[p1] : null;
  const ltDebt2 = ltDebtRow && p2 ? ltDebtRow[p2] : null;

  const stLiabRow = allFin.balance_sheet.data.find((r: any) => r.item === 'Kısa Vadeli Yükümlülükler');

  const picRow = allFin.balance_sheet.data.find((r: any) => r.item === 'Ödenmiş Sermaye');
  const pic1 = picRow && p1 ? picRow[p1] : null;
  const pic2 = picRow && p2 ? picRow[p2] : null;

  const cfoRow = allFin.cashflow?.data.find((r: any) => r.item === 'İşletme Faaliyetlerinden Kaynaklanan Net Nakit' || r.item === 'Net Nakit Girişi');
  const cfo1 = cfoRow && p1 ? cfoRow[p1] : null;

  // F1: ROA > 0 (Profitability)
  const roa1 = netIncome1 !== null && assets1 ? netIncome1 / assets1 : null;
  const roa2 = netIncome2 !== null && assets2 ? netIncome2 / assets2 : null;
  if (roa1 !== null && roa1 > 0) fScore += 1;

  // F2: Operating Cash Flow > 0 (Profitability)
  if (cfo1 !== null && cfo1 > 0) fScore += 1;

  // F3: Change in ROA (Profitability)
  if (roa1 !== null && roa2 !== null && roa1 > roa2) fScore += 1;

  // F4: Accruals: CFO > Net Income (Profitability)
  if (cfo1 !== null && netIncome1 !== null && cfo1 > netIncome1) fScore += 1;

  // F5: Change in Leverage (Total Debt / Assets decreased)
  const lev1 = ltDebt1 !== null && assets1 ? ltDebt1 / assets1 : 0;
  const lev2 = ltDebt2 !== null && assets2 ? ltDebt2 / assets2 : 0;
  if (lev1 < lev2) fScore += 1;

  // F6: Change in Liquidity (Current ratio increased)
  const cr1 = caRow && stLiabRow && p1 && stLiabRow[p1] ? caRow[p1] / stLiabRow[p1] : 0;
  const cr2 = caRow && stLiabRow && p2 && stLiabRow[p2] ? caRow[p2] / stLiabRow[p2] : 0;
  if (cr1 > cr2) fScore += 1;

  // F7: No Dilution (Shares outstanding did not increase)
  if (pic1 !== null && pic2 !== null && pic1 <= pic2) fScore += 1;

  // F8: Change in Gross Margin (Gross Margin increased)
  const gm1 = grossProfit1 !== null && rev1 ? grossProfit1 / rev1 : 0;
  const gm2 = grossProfit2 !== null && rev2 ? grossProfit2 / rev2 : 0;
  if (gm1 > gm2) fScore += 1;

  // F9: Change in Asset Turnover (Asset Turnover increased)
  const at1 = rev1 !== null && assets1 ? rev1 / assets1 : 0;
  const at2 = rev2 !== null && assets2 ? rev2 / assets2 : 0;
  if (at1 > at2) fScore += 1;

  return {
    fundamentalScore: Math.round(clamp(fundScore, 0, 10)),
    piotroskiScore: fScore
  };
}

/** Compute the combined score and indicators for a single symbol */
export async function scanSingleSymbol(symbol: string, forceRefresh = false): Promise<ScannedStock | null> {
  try {
    const history = await fetchHistoryWithCache(symbol, forceRefresh);
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

    // 1. Williams Paşa (%R)
    const wp = computeWilliamsPasa(highs, lows, closes);
    const wpR = wp.percentR[n - 1] ?? 50;
    const wpEma = wp.emaWil[n - 1] ?? 50;
    const wpDiff = wpR - wpEma;
    const wpScore = clamp(10 + wpDiff * 0.2, 0, 20);
    const wpSignal = wpDiff > 5 ? 'bullish' : wpDiff < -5 ? 'bearish' : 'neutral';

    // 2. Nizami Cedid
    const nc = computeNizamiCedid(closes, volumes);
    const ncDelta = nc.delta[n - 1] ?? 0;
    const ncMacd = nc.macd[n - 1] ?? 0;
    const ncMacdSignal = nc.signal[n - 1] ?? 0;
    const ncEmacd = nc.emacd[n - 1] ?? 0;
    const ncScore = clamp(10 + ncDelta * 400, 0, 20);
    const ncSignal = ncDelta > 0.002 ? 'bullish' : ncDelta < -0.002 ? 'bearish' : 'neutral';

    // 3. EMA Ribbon
    const ribbon = calculateEMARibbonLast(closes);

    // 4. Pearson Channels
    const pearson = calculatePearsonLast(closes);

    const overallScore = Math.round((wpScore + ncScore + ribbon.score + pearson.score) * 1.25);

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

    // 7. Dynamic Financial KPIs & Scores (Piotroski & Fundamental Health)
    let fundamentalScore = 5;
    let piotroskiScore = 5;

    const financials = await fetchFinancialsWithCache(symbol, forceRefresh);
    if (financials) {
      const scores = calculateFundamentalScores(financials, history);
      fundamentalScore = scores.fundamentalScore;
      piotroskiScore = scores.piotroskiScore;
    }

    const techScoreClamped = clamp(overallScore, 0, 100);
    
    // Scale Fundamental Health Score (0-10) to 0-100: fundamentalScore * 10
    // Scale Piotroski F-Score (0-9) to 0-100: (piotroskiScore * 100) / 9
    const scaledFundHealth = fundamentalScore * 10;
    const scaledPiotroski = (piotroskiScore * 100) / 9;
    
    // Combined Fundamental Score: 50% Health + 50% Piotroski F-Score
    const avgFundamentalScore = (scaledFundHealth + scaledPiotroski) / 2;

    // Combined score: 60% Technical + 40% Combined Fundamental
    const combinedScore = Math.round(techScoreClamped * 0.6 + avgFundamentalScore * 0.4);

    return {
      symbol,
      close: lastClose,
      changePercent,
      volume: lastVolume,
      overallScore: techScoreClamped,
      fundamentalScore,
      piotroskiScore,
      combinedScore,
      indicators: {
        williamsPasa: { value: wpR, ema: wpEma, signal: wpSignal, score: Math.round(wpScore) },
        nizamiCedid: { 
          value: ncDelta, 
          signal: ncSignal, 
          score: Math.round(ncScore), 
          macd: ncMacd,
          macdSignal: ncMacdSignal,
          emacd: ncEmacd
        },
        emaRibbon: { value: ribbon.spread, signal: ribbon.signal, score: ribbon.score },
        pearson: { 
          value: pearson.avgR, 
          signal: pearson.signal, 
          score: pearson.score, 
          pos: pearson.avgPos,
          extra_short_r: pearson.channels.extra_short?.r ?? 0,
          extra_short_pos: pearson.channels.extra_short?.pos ?? 0,
          extra_short_slope_pct: pearson.channels.extra_short?.slopePct ?? 0,
          short_r: pearson.channels.short?.r ?? 0,
          short_pos: pearson.channels.short?.pos ?? 0,
          short_slope_pct: pearson.channels.short?.slopePct ?? 0,
          long_r: pearson.channels.long?.r ?? 0,
          long_pos: pearson.channels.long?.pos ?? 0,
          long_slope_pct: pearson.channels.long?.slopePct ?? 0,
          extra_long_r: pearson.channels.extra_long?.r ?? 0,
          extra_long_pos: pearson.channels.extra_long?.pos ?? 0,
          extra_long_slope_pct: pearson.channels.extra_long?.slopePct ?? 0,
        },
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
  const SCANNER_CODE_VERSION = 'v4_5';
  const storedVersion = localStorage.getItem('temist_scanner_code_version');
  
  let actualForceRefresh = forceRefresh;
  if (storedVersion !== SCANNER_CODE_VERSION) {
    actualForceRefresh = true;
    localStorage.setItem('temist_scanner_code_version', SCANNER_CODE_VERSION);
    localStorage.removeItem('temist_scanner_scan_results_cache_v4');
    localStorage.removeItem('temist_scanner_scan_results_timestamp_v4');
    cachedResults = null;
  }

  if (!actualForceRefresh && cachedResults && cachedResults.length > 0) {
    return cachedResults;
  }

  // Get symbol list from scan results structure
  const scanData = await fetchScanResults();
  const rawSymbols = scanData.results.map(r => r.symbol);
  
  if (rawSymbols.length === 0) {
    return [];
  }

  // Check localStorage cache first to avoid heavy network operations on deployed page
  const savedCache = localStorage.getItem('temist_scanner_scan_results_cache_v4');
  const savedTimestamp = localStorage.getItem('temist_scanner_scan_results_timestamp_v4');
  const serverTimestamp = String(scanData.timestamp || 0);

  if (!actualForceRefresh && savedCache && savedTimestamp && savedTimestamp === serverTimestamp) {
    try {
      const parsed = JSON.parse(savedCache);
      if (parsed && parsed.length > 0 && parsed[0].indicators.extra && parsed[0].combinedScore !== undefined) {
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
    const batchPromises = batch.map(sym => scanSingleSymbol(sym, forceRefresh));
    const batchResults = await Promise.all(batchPromises);

    for (let j = 0; j < batch.length; j++) {
      const res = batchResults[j];
      if (res) {
        results.push(res);
      }
    }

    onProgress(Math.min(i + BATCH_SIZE, total), total, batch[batch.length - 1]);
  }

  // Sort by overall score descending (putting high-quality tech stocks at the top)
  results.sort((a, b) => b.overallScore - a.overallScore);

  cachedResults = results;
  cachedTimestamp = Date.now();

  try {
    localStorage.setItem('temist_scanner_scan_results_cache_v4', JSON.stringify(results));
    localStorage.setItem('temist_scanner_scan_results_timestamp_v4', serverTimestamp);
    window.dispatchEvent(new Event('temist_scanner_updated'));
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
