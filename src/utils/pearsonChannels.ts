/**
 * Pearson Regression Channels utility.
 * Finds the optimal period within min/max that maximizes R^2 correlation.
 */

export interface PearsonConfig {
  id: string;
  label: string;
  min: number;
  max: number;
  mult: number;
  color: string;
  centerColor?: string;
  width: number;
}

export const DEFAULT_PEARSON_CONFIGS: PearsonConfig[] = [
  {
    id: 'extra_short',
    label: 'En Kısa Vadeli',
    min: 21,
    max: 34,
    mult: 2,
    color: '#787B86', // gray
    centerColor: '#FFE9C9', // light peach
    width: 3,
  },
  {
    id: 'short',
    label: 'Kısa Vadeli',
    min: 55,
    max: 89,
    mult: 2,
    color: '#2196F3', // blue
    centerColor: '#EF5350', // red
    width: 2,
  },
  {
    id: 'long',
    label: 'Uzun Vadeli',
    min: 144,
    max: 233,
    mult: 2,
    color: '#4CAF50', // green
    centerColor: undefined, // no center line in Pine Script (deleted)
    width: 3,
  },
  {
    id: 'extra_long',
    label: 'En Uzun Vadeli',
    min: 377,
    max: 610,
    mult: 2,
    color: '#FF9800', // orange
    centerColor: '#4CAF50', // green
    width: 2,
  },
];

export interface PearsonChannelResult {
  id: string;
  label: string;
  p: number; // chosen optimal period
  startIndex: number;
  endIndex: number;
  A: number; // start value (at startIndex)
  B: number; // end value (at endIndex)
  rmse: number; // channel width (residual std dev * mult)
  r: number; // correlation coefficient (signed)
}

/**
 * Compute the optimal Pearson regression channel for a given config.
 */
export function computePearsonChannel(closes: number[], config: PearsonConfig): PearsonChannelResult | null {
  const N = closes.length;
  if (N < config.min) return null;

  let bestP = 0;
  let maxR2 = -1;
  let bestA = 0;
  let bestB = 0;
  let bestRmse = 0;
  let bestR = 0;

  const maxP = Math.min(config.max, N);
  if (maxP < config.min) return null;

  for (let p = config.min; p <= maxP; p++) {
    // Extract last p values
    let sumY = 0;
    let sumYY = 0;
    let sumXY = 0;

    for (let i = 0; i < p; i++) {
      const y = closes[N - p + i];
      const x = i + 1; // 1-based index
      sumY += y;
      sumYY += y * y;
      sumXY += x * y;
    }

    const meanY = sumY / p;
    const vary = sumYY / p - meanY * meanY;
    const varx = (p * p - 1) / 12;
    const covxy = sumXY / p - ((p + 1) / 2) * meanY;

    if (vary <= 0) continue;

    const r2 = (covxy * covxy) / (vary * varx);

    if (r2 > maxR2) {
      maxR2 = r2;
      bestP = p;

      const slope = covxy / varx;
      const intercept = meanY - slope * ((p + 1) / 2);
      bestA = slope * 1 + intercept;
      bestB = slope * p + intercept;
      
      const mse = vary * (1 - r2);
      bestRmse = Math.sqrt(Math.max(0, mse)) * config.mult;
      bestR = Math.sqrt(r2) * (slope < 0 ? -1 : 1);
    }
  }

  if (bestP === 0) return null;

  return {
    id: config.id,
    label: config.label,
    p: bestP,
    startIndex: N - bestP,
    endIndex: N - 1,
    A: bestA,
    B: bestB,
    rmse: bestRmse,
    r: bestR,
  };
}

/**
 * Compute all Pearson channels.
 */
export function computeAllPearsonChannels(
  closes: number[],
  configs: PearsonConfig[] = DEFAULT_PEARSON_CONFIGS,
): PearsonChannelResult[] {
  const results: PearsonChannelResult[] = [];
  for (const cfg of configs) {
    const res = computePearsonChannel(closes, cfg);
    if (res) results.push(res);
  }
  return results;
}
