/**
 * Technical Indicators — 9 indicator professional set
 *
 * 1. RSI (Relative Strength Index)
 * 2. MACD (Moving Average Convergence Divergence)
 * 3. Bollinger Bands
 * 4. Stochastic RSI
 * 5. ADX / DMI
 * 6. SuperTrend
 * 7. Ichimoku Cloud
 * 8. OBV (On Balance Volume)
 * 9. ATR (Average True Range)
 */

// ── Helper functions ──────────────────────────

/** EMA (Exponential Moving Average) */
export function ema(src: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(src.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;

  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v === null) continue;
    if (prev === null) {
      prev = v;
    } else {
      prev = v * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

/** SMA (Simple Moving Average) */
export function smaCalc(src: (number | null)[], period: number): (number | null)[] {
  const n = src.length;
  const out: (number | null)[] = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    let valid = true;
    for (let j = i - period + 1; j <= i; j++) {
      if (src[j] === null) {
        valid = false;
        break;
      }
      sum += src[j]!;
    }
    if (valid) out[i] = sum / period;
  }
  return out;
}

/** Wilder's Smoothing (used in RSI, ADX, ATR) */
function wilderSmooth(src: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(src.length).fill(null);
  const k = 1 / period;
  let prev: number | null = null;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v === null) continue;
    if (prev === null) {
      prev = v;
    } else {
      prev = v * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

/** True Range */
function trueRange(highs: number[], lows: number[], closes: number[]): number[] {
  const n = closes.length;
  const tr: number[] = new Array(n).fill(0);
  tr[0] = highs[0] - lows[0];
  for (let i = 1; i < n; i++) {
    const hl = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    tr[i] = Math.max(hl, hc, lc);
  }
  return tr;
}

/** Rolling highest */
function rollingHighest(values: number[], period: number): (number | null)[] {
  const n = values.length;
  const out: (number | null)[] = new Array(n).fill(null);
  const deque: number[] = [];
  let head = 0;
  for (let i = 0; i < n; i++) {
    while (head < deque.length && deque[head] < i - period + 1) head++;
    while (deque.length > head && values[deque[deque.length - 1]] <= values[i]) deque.pop();
    deque.push(i);
    if (i >= period - 1) out[i] = values[deque[head]];
  }
  return out;
}

/** Rolling lowest */
function rollingLowest(values: number[], period: number): (number | null)[] {
  const n = values.length;
  const out: (number | null)[] = new Array(n).fill(null);
  const deque: number[] = [];
  let head = 0;
  for (let i = 0; i < n; i++) {
    while (head < deque.length && deque[head] < i - period + 1) head++;
    while (deque.length > head && values[deque[deque.length - 1]] >= values[i]) deque.pop();
    deque.push(i);
    if (i >= period - 1) out[i] = values[deque[head]];
  }
  return out;
}

/** Rolling standard deviation */
function rollingStdev(src: (number | null)[], period: number): (number | null)[] {
  const n = src.length;
  const out: (number | null)[] = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let sum = 0,
      sumSq = 0,
      count = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (src[j] === null) {
        count = -1;
        break;
      }
      sum += src[j]!;
      sumSq += src[j]! * src[j]!;
      count++;
    }
    if (count === period) {
      const mean = sum / period;
      const variance = sumSq / period - mean * mean;
      out[i] = Math.sqrt(Math.max(0, variance));
    }
  }
  return out;
}

// ── 1. RSI ──────────────────────────────────

export interface RSIResult {
  rsi: (number | null)[];
}

export function computeRSI(closes: number[], period = 14): RSIResult {
  const n = closes.length;
  const rsi: (number | null)[] = new Array(n).fill(null);

  if (n < period + 1) return { rsi };

  const gains: (number | null)[] = new Array(n - 1).fill(null);
  const losses: (number | null)[] = new Array(n - 1).fill(null);
  for (let i = 0; i < n - 1; i++) {
    const d = closes[i + 1] - closes[i];
    gains[i] = d > 0 ? d : 0;
    losses[i] = d < 0 ? -d : 0;
  }

  const avgGain = wilderSmooth(gains, period);
  const avgLoss = wilderSmooth(losses, period);

  for (let i = 0; i < avgGain.length; i++) {
    const ag = avgGain[i];
    const al = avgLoss[i];
    if (ag === null || al === null) continue;
    if (al === 0) {
      rsi[i + 1] = 100;
    } else {
      rsi[i + 1] = 100 - 100 / (1 + ag / al);
    }
  }

  return { rsi };
}

// ── 2. MACD ──────────────────────────────────

export interface MACDResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

export function computeMACD(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MACDResult {
  const n = closes.length;
  const closesN: (number | null)[] = closes as (number | null)[];
  const fastEma = ema(closesN, fast);
  const slowEma = ema(closesN, slow);

  const macdLine: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (fastEma[i] !== null && slowEma[i] !== null) {
      macdLine[i] = fastEma[i]! - slowEma[i]!;
    }
  }

  const signalLine = ema(macdLine, signalPeriod);

  const histogram: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (macdLine[i] !== null && signalLine[i] !== null) {
      histogram[i] = macdLine[i]! - signalLine[i]!;
    }
  }

  return { macd: macdLine, signal: signalLine, histogram };
}

// ── 3. Bollinger Bands ──────────────────────────

export interface BollingerResult {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
  pctB: (number | null)[];
  bandwidth: (number | null)[];
}

export function computeBollingerBands(closes: number[], period = 20, mult = 2.0): BollingerResult {
  const n = closes.length;
  const closesN: (number | null)[] = closes as (number | null)[];
  const middle = smaCalc(closesN, period);
  const sd = rollingStdev(closesN, period);

  const upper: (number | null)[] = new Array(n).fill(null);
  const lower: (number | null)[] = new Array(n).fill(null);
  const pctB: (number | null)[] = new Array(n).fill(null);
  const bandwidth: (number | null)[] = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    if (middle[i] !== null && sd[i] !== null) {
      upper[i] = middle[i]! + mult * sd[i]!;
      lower[i] = middle[i]! - mult * sd[i]!;
      const bw = upper[i]! - lower[i]!;
      if (bw > 0) {
        pctB[i] = (closes[i] - lower[i]!) / bw;
        bandwidth[i] = bw / middle[i]!;
      }
    }
  }

  return { upper, middle, lower, pctB, bandwidth };
}

// ── 4. Stochastic RSI ──────────────────────────

export interface StochRSIResult {
  k: (number | null)[];
  d: (number | null)[];
}

export function computeStochRSI(
  closes: number[],
  rsiPeriod = 14,
  stochPeriod = 14,
  kSmooth = 3,
  dSmooth = 3,
): StochRSIResult {
  const n = closes.length;
  const { rsi: rsiVals } = computeRSI(closes, rsiPeriod);

  // Stochastic of RSI
  const stochKRaw: (number | null)[] = new Array(n).fill(null);
  for (let i = stochPeriod - 1; i < n; i++) {
    let hi = -Infinity,
      lo = Infinity,
      count = 0;
    for (let j = i - stochPeriod + 1; j <= i; j++) {
      if (rsiVals[j] === null) continue;
      hi = Math.max(hi, rsiVals[j]!);
      lo = Math.min(lo, rsiVals[j]!);
      count++;
    }
    if (count < stochPeriod) continue;
    const rng = hi - lo;
    if (rng === 0) {
      stochKRaw[i] = 50;
    } else if (rsiVals[i] !== null) {
      stochKRaw[i] = ((rsiVals[i]! - lo) / rng) * 100;
    }
  }

  const k = smaCalc(stochKRaw, kSmooth);
  const d = smaCalc(k, dSmooth);

  return { k, d };
}

// ── 5. ADX / DMI ──────────────────────────────

export interface ADXResult {
  adx: (number | null)[];
  plusDI: (number | null)[];
  minusDI: (number | null)[];
}

export function computeADX(highs: number[], lows: number[], closes: number[], period = 14): ADXResult {
  const n = closes.length;
  const adx: (number | null)[] = new Array(n).fill(null);
  const plusDI: (number | null)[] = new Array(n).fill(null);
  const minusDI: (number | null)[] = new Array(n).fill(null);

  if (n < period * 2) return { adx, plusDI, minusDI };

  const tr = trueRange(highs, lows, closes);
  const plusDM: (number | null)[] = new Array(n).fill(0);
  const minusDM: (number | null)[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
  }

  const atr = wilderSmooth(tr as (number | null)[], period);
  const smoothPlus = wilderSmooth(plusDM, period);
  const smoothMinus = wilderSmooth(minusDM, period);

  const dx: (number | null)[] = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    if (atr[i] === null || atr[i] === 0) continue;
    plusDI[i] = (smoothPlus[i]! / atr[i]!) * 100;
    minusDI[i] = (smoothMinus[i]! / atr[i]!) * 100;
    const diSum = plusDI[i]! + minusDI[i]!;
    if (diSum > 0) {
      dx[i] = (Math.abs(plusDI[i]! - minusDI[i]!) / diSum) * 100;
    }
  }

  const adxLine = wilderSmooth(dx, period);
  for (let i = 0; i < n; i++) {
    adx[i] = adxLine[i];
  }

  return { adx, plusDI, minusDI };
}

// ── 6. SuperTrend ──────────────────────────────

export interface SuperTrendResult {
  supertrend: (number | null)[];
  direction: (number | null)[]; // 1=up, -1=down
}

export function computeSuperTrend(
  highs: number[],
  lows: number[],
  closes: number[],
  atrPeriod = 10,
  multiplier = 3.0,
): SuperTrendResult {
  const n = closes.length;
  const supertrend: (number | null)[] = new Array(n).fill(null);
  const direction: (number | null)[] = new Array(n).fill(null);

  if (n < atrPeriod + 1) return { supertrend, direction };

  const tr = trueRange(highs, lows, closes);
  const atr = wilderSmooth(tr as (number | null)[], atrPeriod);
  const hl2 = highs.map((h, i) => (h + lows[i]) / 2);

  const upperBand: number[] = new Array(n).fill(0);
  const lowerBand: number[] = new Array(n).fill(0);
  const dir: number[] = new Array(n).fill(0);

  for (let i = atrPeriod; i < n; i++) {
    if (atr[i] === null) continue;

    const basicUpper = hl2[i] + multiplier * atr[i]!;
    const basicLower = hl2[i] - multiplier * atr[i]!;

    if (i > atrPeriod && upperBand[i - 1] !== 0) {
      upperBand[i] = basicUpper < upperBand[i - 1] || closes[i - 1] > upperBand[i - 1] ? basicUpper : upperBand[i - 1];
    } else {
      upperBand[i] = basicUpper;
    }

    if (i > atrPeriod && lowerBand[i - 1] !== 0) {
      lowerBand[i] = basicLower > lowerBand[i - 1] || closes[i - 1] < lowerBand[i - 1] ? basicLower : lowerBand[i - 1];
    } else {
      lowerBand[i] = basicLower;
    }

    if (i === atrPeriod) {
      dir[i] = closes[i] > upperBand[i] ? 1 : -1;
    } else {
      const prev = dir[i - 1];
      if (prev === -1 && closes[i] > upperBand[i]) dir[i] = 1;
      else if (prev === 1 && closes[i] < lowerBand[i]) dir[i] = -1;
      else dir[i] = prev;
    }

    supertrend[i] = dir[i] === 1 ? lowerBand[i] : upperBand[i];
    direction[i] = dir[i];
  }

  return { supertrend, direction };
}

// ── 7. Ichimoku Cloud ──────────────────────────

export interface IchimokuResult {
  tenkan: (number | null)[];
  kijun: (number | null)[];
  senkouA: (number | null)[];
  senkouB: (number | null)[];
  chikou: (number | null)[];
}

export function computeIchimoku(
  highs: number[],
  lows: number[],
  closes: number[],
  tenkanP = 9,
  kijunP = 26,
  senkouBP = 52,
  displacement = 26,
): IchimokuResult {
  const n = closes.length;

  function midpoint(h: number[], l: number[], period: number): (number | null)[] {
    const out: (number | null)[] = new Array(n).fill(null);
    for (let i = period - 1; i < n; i++) {
      let hi = -Infinity,
        lo = Infinity;
      for (let j = i - period + 1; j <= i; j++) {
        hi = Math.max(hi, h[j]);
        lo = Math.min(lo, l[j]);
      }
      out[i] = (hi + lo) / 2;
    }
    return out;
  }

  const tenkan = midpoint(highs, lows, tenkanP);
  const kijun = midpoint(highs, lows, kijunP);

  // Senkou Span A = (tenkan + kijun) / 2, displaced forward by displacement
  const senkouA: (number | null)[] = new Array(n + displacement).fill(null);
  for (let i = 0; i < n; i++) {
    if (tenkan[i] !== null && kijun[i] !== null) {
      const idx = i + displacement;
      if (idx < senkouA.length) {
        senkouA[idx] = (tenkan[i]! + kijun[i]!) / 2;
      }
    }
  }

  // Senkou Span B = midpoint(senkouBP), displaced forward
  const senkouBRaw = midpoint(highs, lows, senkouBP);
  const senkouB: (number | null)[] = new Array(n + displacement).fill(null);
  for (let i = 0; i < n; i++) {
    if (senkouBRaw[i] !== null) {
      const idx = i + displacement;
      if (idx < senkouB.length) {
        senkouB[idx] = senkouBRaw[i];
      }
    }
  }

  // Chikou Span = close displaced back
  const chikou: (number | null)[] = new Array(n).fill(null);
  for (let i = displacement; i < n; i++) {
    chikou[i - displacement] = closes[i];
  }

  return {
    tenkan,
    kijun,
    senkouA: senkouA.slice(0, n),
    senkouB: senkouB.slice(0, n),
    chikou,
  };
}

// ── 8. OBV ──────────────────────────────────

export interface OBVResult {
  obv: (number | null)[];
  obvEma: (number | null)[];
}

export function computeOBV(closes: number[], volumes: number[], emaPeriod = 20): OBVResult {
  const n = closes.length;
  const obv: (number | null)[] = new Array(n).fill(null);
  obv[0] = 0;

  for (let i = 1; i < n; i++) {
    const prev = obv[i - 1]!;
    if (closes[i] > closes[i - 1]) {
      obv[i] = prev + volumes[i];
    } else if (closes[i] < closes[i - 1]) {
      obv[i] = prev - volumes[i];
    } else {
      obv[i] = prev;
    }
  }

  const obvEma = ema(obv, emaPeriod);

  return { obv, obvEma };
}

// ── 9. ATR ──────────────────────────────────

export interface ATRResult {
  atr: (number | null)[];
  atrPct: (number | null)[]; // ATR as % of close
}

export function computeATR(highs: number[], lows: number[], closes: number[], period = 14): ATRResult {
  const n = closes.length;
  const tr = trueRange(highs, lows, closes);
  const atrVals = wilderSmooth(tr as (number | null)[], period);

  const atrPct: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (atrVals[i] !== null && closes[i] > 0) {
      atrPct[i] = (atrVals[i]! / closes[i]) * 100;
    }
  }

  return { atr: atrVals, atrPct };
}

// ── 10. Williams Paşa ──────────────────────────

export interface WilliamsPasaResult {
  percentR: (number | null)[];
  emaWil: (number | null)[];
}

export function computeWilliamsPasa(
  highs: number[],
  lows: number[],
  closes: number[],
  length = 260,
  emaLen = 260
): WilliamsPasaResult {
  const n = closes.length;
  const percentR: (number | null)[] = new Array(n).fill(null);

  const hh = rollingHighest(highs, length);
  const ll = rollingLowest(lows, length);

  for (let i = length - 1; i < n; i++) {
    const hVal = hh[i];
    const lVal = ll[i];
    if (hVal === null || lVal === null) continue;
    const range = hVal - lVal;
    if (range === 0) {
      percentR[i] = 50.0;
    } else {
      percentR[i] = (100.0 * (closes[i] - lVal)) / range;
    }
  }

  const emaWil = ema(percentR, emaLen);
  return { percentR, emaWil };
}

// ── 11. Nizami Cedid ──────────────────────────

export interface NizamiCedidResult {
  macd: (number | null)[];
  signal: (number | null)[];
  emacd: (number | null)[];
  histogram: (number | null)[];
  delta: (number | null)[];
}

export function computeNizamiCedid(
  closes: number[],
  volumes: number[],
  fast = 120,
  slow = 260,
  signalLen = 50,
  vwmaLen = 185
): NizamiCedidResult {
  const n = closes.length;
  const closesN = closes as (number | null)[];
  const fastMa = ema(closesN, fast);
  const slowMa = ema(closesN, slow);

  const macd: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (fastMa[i] !== null && slowMa[i] !== null) {
      macd[i] = fastMa[i]! - slowMa[i]!;
    }
  }

  const signal = ema(macd, signalLen);

  const macdVol: (number | null)[] = new Array(n).fill(null);
  const volClean: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const mVal = macd[i] ?? 0;
    const vVal = volumes[i] ?? 0;
    volClean[i] = vVal;
    macdVol[i] = mVal * vVal;
  }

  const sumMacdVol = smaCalc(macdVol, vwmaLen);
  const sumVol = smaCalc(volClean, vwmaLen);
  const emacd: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const sv = sumVol[i];
    const smv = sumMacdVol[i];
    if (sv !== null && smv !== null && sv > 0) {
      emacd[i] = smv / sv;
    }
  }

  const histogram: (number | null)[] = new Array(n).fill(null);
  const delta: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (macd[i] !== null && signal[i] !== null) {
      histogram[i] = macd[i]! - signal[i]!;
    }
    if (macd[i] !== null && emacd[i] !== null) {
      delta[i] = macd[i]! - emacd[i]!;
    }
  }

  // Normalize by fastMa
  const normMacd: (number | null)[] = new Array(n).fill(null);
  const normSignal: (number | null)[] = new Array(n).fill(null);
  const normEmacd: (number | null)[] = new Array(n).fill(null);
  const normHistogram: (number | null)[] = new Array(n).fill(null);
  const normDelta: (number | null)[] = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    const f = fastMa[i];
    if (f !== null && f !== 0) {
      if (macd[i] !== null) normMacd[i] = macd[i]! / f;
      if (signal[i] !== null) normSignal[i] = signal[i]! / f;
      if (emacd[i] !== null) normEmacd[i] = emacd[i]! / f;
      if (histogram[i] !== null) normHistogram[i] = histogram[i]! / f;
      if (delta[i] !== null) normDelta[i] = delta[i]! / f;
    }
  }

  return {
    macd: normMacd,
    signal: normSignal,
    emacd: normEmacd,
    histogram: normHistogram,
    delta: normDelta,
  };
}

// ── 12. Chaikin Money Flow (CMF) ──────────────────────────

export interface CMFResult {
  cmf: (number | null)[];
}

export function computeCMF(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
  period = 20
): CMFResult {
  const n = closes.length;
  const cmf: (number | null)[] = new Array(n).fill(null);

  if (n < period) return { cmf };

  // Money Flow Volume (MFV) and Volume arrays
  const mfv: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    const v = volumes[i];

    const range = h - l;
    if (range === 0) {
      mfv[i] = 0;
    } else {
      const multiplier = ((c - l) - (h - c)) / range;
      mfv[i] = multiplier * v;
    }
  }

  // Calculate rolling CMF values
  for (let i = period - 1; i < n; i++) {
    let sumMFV = 0;
    let sumVol = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumMFV += mfv[j];
      sumVol += volumes[j];
    }
    if (sumVol > 0) {
      cmf[i] = sumMFV / sumVol;
    } else {
      cmf[i] = 0;
    }
  }

  return { cmf };
}

