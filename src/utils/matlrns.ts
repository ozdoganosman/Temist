import { ema, smaCalc } from './indicators';

export interface MATLRNSResult {
  fastMA: (number | null)[];
  slowMA: (number | null)[];
  direction: number[]; // > 0: bullish, < 0: bearish, 0: warning/neutral
}

// Implement WMA
export function wmaCalc(src: (number | null)[], period: number): (number | null)[] {
  const n = src.length;
  const out: (number | null)[] = new Array(n).fill(null);
  const den = (period * (period + 1)) / 2;
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    let valid = true;
    for (let j = 0; j < period; j++) {
      const v = src[i - j];
      if (v === null) {
        valid = false;
        break;
      }
      sum += v * (period - j);
    }
    if (valid) out[i] = sum / den;
  }
  return period > 0 ? out : new Array(n).fill(null);
}

// Implement VWMA
export function vwmaCalc(closes: number[], volumes: number[], period: number): (number | null)[] {
  const n = closes.length;
  const out: (number | null)[] = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let sumPV = 0;
    let sumV = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumPV += closes[j] * volumes[j];
      sumV += volumes[j];
    }
    if (sumV > 0) {
      out[i] = sumPV / sumV;
    }
  }
  return period > 0 ? out : new Array(n).fill(null);
}

export function getMA(
  type: 'SMA' | 'EMA' | 'WMA' | 'VWMA',
  src: (number | null)[],
  period: number,
  closes: number[],
  volumes: number[]
): (number | null)[] {
  switch (type) {
    case 'SMA':
      return smaCalc(src, period);
    case 'EMA':
      return ema(src, period);
    case 'WMA':
      return wmaCalc(src, period);
    case 'VWMA':
      return vwmaCalc(closes, volumes, period);
    default:
      return ema(src, period);
  }
}

function intervalToSeconds(interval: string): number {
  switch (interval) {
    case '1m': return 60;
    case '5m': return 300;
    case '15m': return 900;
    case '30m': return 1800;
    case '1h': return 3600;
    case '1d': return 86400;
    case '1wk': return 604800;
    case '1mo': return 2592000;
    default: return 86400;
  }
}

export function spanToIntLen(span: number, unit: string, interval: string): number {
  const tfSec = intervalToSeconds(interval);
  if (unit === 'Days') {
    return Math.max(1, Math.round((span * 1440 * 60) / tfSec));
  }
  if (unit === 'Minutes') {
    return Math.max(1, Math.round((span * 60) / tfSec));
  }
  return Math.max(1, Math.round(span));
}

export function computeMATLRNS(
  closes: number[],
  highs: number[],
  lows: number[],
  volumes: number[],
  interval = '1d',
  fastType: 'SMA' | 'EMA' | 'WMA' | 'VWMA' = 'EMA',
  fastSpan = 8,
  fastUnit = 'Days',
  slowType: 'SMA' | 'EMA' | 'WMA' | 'VWMA' = 'EMA',
  slowSpan = 21,
  slowUnit = 'Days',
  tolerance = 9,
  includePriceWarning = true
): MATLRNSResult {
  const n = closes.length;
  const source: (number | null)[] = new Array(n);
  for (let i = 0; i < n; i++) {
    source[i] = (highs[i] + lows[i] + closes[i] + closes[i]) / 4;
  }

  const fastLen = spanToIntLen(fastSpan, fastUnit, interval);
  const slowLen = spanToIntLen(slowSpan, slowUnit, interval);

  const fastMA = getMA(fastType, source, fastLen, closes, volumes);
  const slowMA = getMA(slowType, source, slowLen, closes, volumes);

  const direction: number[] = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    const fVal = fastMA[i];
    const sVal = slowMA[i];
    if (fVal === null || sVal === null || i < tolerance) {
      continue;
    }

    const prevFVal = fastMA[i - tolerance];
    const prevSVal = slowMA[i - tolerance];
    if (prevFVal === null || prevSVal === null) {
      continue;
    }

    const fastChange = fVal - prevFVal;
    let fastD = fastChange > 0 ? 1 : fastChange < 0 ? -1 : 0;

    const slowChange = sVal - prevSVal;
    const slowD = slowChange > 0 ? 1 : slowChange < 0 ? -1 : 0;

    if (includePriceWarning) {
      const closeP = closes[i] - fVal;
      if (closeP < 0) {
        fastD = Math.min(fastD, -1);
      } else if (closeP > 0) {
        fastD = Math.max(fastD, 1);
      }
    }

    direction[i] = fastD + slowD;
  }

  return { fastMA, slowMA, direction };
}
