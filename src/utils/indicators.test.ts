import { describe, it, expect } from 'vitest';
import {
  ema,
  computeRSI,
  computeMACD,
  computeBollingerBands,
  computeStochRSI,
  computeADX,
  computeSuperTrend,
  computeIchimoku,
  computeOBV,
  computeCMF,
} from './indicators';

describe('ema', () => {
  it('returns first non-null value as initial EMA', () => {
    const result = ema([10, 20, 30], 3);
    expect(result[0]).toBe(10);
  });

  it('handles null values gracefully', () => {
    const result = ema([null, null, 10, 20], 2);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBe(10);
    expect(result[3]).not.toBeNull();
  });

  it('produces correct length output', () => {
    const src = [1, 2, 3, 4, 5];
    const result = ema(
      src.map((v) => v as number | null),
      3,
    );
    expect(result).toHaveLength(5);
  });
});

describe('computeRSI', () => {
  it('returns null only for bar 0 (no prior delta)', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const { rsi } = computeRSI(closes, 14);
    expect(rsi[0]).toBeNull();
    // wilderSmooth starts producing values from first available delta,
    // so bar 1 onward should have RSI values
    for (let i = 1; i < 30; i++) {
      expect(rsi[i]).not.toBeNull();
    }
  });

  it('RSI values are between 0 and 100', () => {
    const n = 100;
    const closes = Array.from({ length: n }, () => 100 + Math.random() * 20);
    const { rsi } = computeRSI(closes, 14);
    for (const v of rsi) {
      if (v !== null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('computeMACD', () => {
  it('returns correct structure', () => {
    const n = 50;
    const closes = Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 10) * 10);
    const result = computeMACD(closes);
    expect(result.macd).toHaveLength(n);
    expect(result.signal).toHaveLength(n);
    expect(result.histogram).toHaveLength(n);
  });
});

describe('computeBollingerBands', () => {
  it('returns upper >= middle >= lower', () => {
    const n = 50;
    const closes = Array.from({ length: n }, (_, i) => 100 + i * 0.5);
    const result = computeBollingerBands(closes);
    for (let i = 19; i < n; i++) {
      if (result.upper[i] !== null && result.middle[i] !== null && result.lower[i] !== null) {
        expect(result.upper[i]!).toBeGreaterThanOrEqual(result.middle[i]!);
        expect(result.middle[i]!).toBeGreaterThanOrEqual(result.lower[i]!);
      }
    }
  });
});

describe('computeStochRSI', () => {
  it('returns K and D values', () => {
    const n = 50;
    const closes = Array.from({ length: n }, () => 100 + Math.random() * 20);
    const result = computeStochRSI(closes);
    expect(result.k).toHaveLength(n);
    expect(result.d).toHaveLength(n);
  });
});

describe('computeADX', () => {
  it('returns ADX, plusDI, minusDI', () => {
    const n = 50;
    const highs = Array.from({ length: n }, (_, i) => 110 + i * 0.5);
    const lows = Array.from({ length: n }, (_, i) => 90 + i * 0.5);
    const closes = Array.from({ length: n }, (_, i) => 100 + i * 0.5);
    const result = computeADX(highs, lows, closes);
    expect(result.adx).toHaveLength(n);
    expect(result.plusDI).toHaveLength(n);
    expect(result.minusDI).toHaveLength(n);
  });
});

describe('computeSuperTrend', () => {
  it('detects uptrend in rising market', () => {
    const n = 100;
    const highs = Array.from({ length: n }, (_, i) => 110 + i * 2);
    const lows = Array.from({ length: n }, (_, i) => 90 + i * 2);
    const closes = Array.from({ length: n }, (_, i) => 100 + i * 2);
    const { direction } = computeSuperTrend(highs, lows, closes);
    // After enough bars, should show uptrend
    const lastDir = direction[n - 1];
    expect(lastDir).toBe(1);
  });
});

describe('computeIchimoku', () => {
  it('returns tenkan, kijun, senkouA, senkouB', () => {
    const n = 100;
    const highs = Array.from({ length: n }, (_, i) => 110 + i);
    const lows = Array.from({ length: n }, (_, i) => 90 + i);
    const closes = Array.from({ length: n }, (_, i) => 100 + i);
    const result = computeIchimoku(highs, lows, closes);
    expect(result.tenkan).toHaveLength(n);
    expect(result.kijun).toHaveLength(n);
    expect(result.senkouA).toHaveLength(n);
    expect(result.senkouB).toHaveLength(n);
  });
});

describe('computeOBV', () => {
  it('returns obv and obvEma', () => {
    const n = 50;
    const closes = Array.from({ length: n }, (_, i) => 100 + i);
    const volumes = Array.from({ length: n }, () => 1000000);
    const result = computeOBV(closes, volumes);
    expect(result.obv).toHaveLength(n);
    expect(result.obvEma).toHaveLength(n);
  });
});

describe('computeCMF', () => {
  it('returns CMF values within bounds [-1, 1]', () => {
    const n = 50;
    const highs = Array.from({ length: n }, () => 105);
    const lows = Array.from({ length: n }, () => 95);
    const closes = Array.from({ length: n }, () => 100);
    const volumes = Array.from({ length: n }, () => 1000);
    
    const result = computeCMF(highs, lows, closes, volumes, 20);
    expect(result.cmf).toHaveLength(n);
    // Before period, should be null
    for (let i = 0; i < 19; i++) {
      expect(result.cmf[i]).toBeNull();
    }
    // After period, should be a number (specifically 0 since close 100 is exactly in middle of 95-105 range)
    for (let i = 19; i < n; i++) {
      expect(result.cmf[i]).toBe(0);
    }
  });
});
