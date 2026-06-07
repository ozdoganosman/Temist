// Custom Turkish Technical Indicators

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

/** SMA (Simple Moving Average) — sliding window O(n) */
export function smaCalc(src: (number | null)[], period: number): (number | null)[] {
  const n = src.length;
  const out: (number | null)[] = new Array(n).fill(null);
  let windowSum = 0;
  let nullCount = 0;

  for (let i = 0; i < n; i++) {
    const v = src[i];
    if (v === null) nullCount++;
    else windowSum += v;

    if (i >= period) {
      const old = src[i - period];
      if (old === null) nullCount--;
      else windowSum -= old;
    }

    if (i >= period - 1 && nullCount === 0) {
      out[i] = windowSum / period;
    }
  }
  return out;
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

// ── Williams Paşa ──────────────────────────

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

  // Calculate rolling CMF values — sliding window O(n)
  let sumMFV = 0;
  let sumVol = 0;
  for (let i = 0; i < n; i++) {
    sumMFV += mfv[i];
    sumVol += volumes[i];

    if (i >= period) {
      sumMFV -= mfv[i - period];
      sumVol -= volumes[i - period];
    }

    if (i >= period - 1) {
      cmf[i] = sumVol > 0 ? sumMFV / sumVol : 0;
    }
  }

  return { cmf };
}

