import { describe, it, expect } from 'vitest';
import type { OHLCVData, AllFinancialsResponse } from '../api/borsaApi';
import { getLatestActivePeriod, computePEBands } from './computeFinancialMetrics';

describe('getLatestActivePeriod', () => {
  const periods = ['2023/3', '2023/6', '2023/9', '2023/12', '2024/3'];

  it('maps dates accurately using announcement delays', () => {
    // Q4 2023 (2023/12) is active from March 15, 2024
    expect(getLatestActivePeriod('2024-03-14', periods)).toBe('2023/9');
    expect(getLatestActivePeriod('2024-03-15', periods)).toBe('2023/12');

    // Q1 2024 (2024/3) is active from June 1, 2024
    expect(getLatestActivePeriod('2024-05-31', periods)).toBe('2023/12');
    expect(getLatestActivePeriod('2024-06-01', periods)).toBe('2024/3');

    // Q2 2023 (2023/6) is active from Sept 1, 2023
    expect(getLatestActivePeriod('2023-08-31', periods)).toBe('2023/3');
    expect(getLatestActivePeriod('2023-09-01', periods)).toBe('2023/6');
  });

  it('falls back to oldest period if date is before any active date', () => {
    expect(getLatestActivePeriod('2022-01-01', periods)).toBe('2023/3');
  });
});

describe('computePEBands', () => {
  const mockOhlcv: OHLCVData[] = [
    { date: '2024-01-01', open: 100, high: 105, low: 98, close: 100, volume: 1000 },
    { date: '2024-04-01', open: 110, high: 115, low: 108, close: 110, volume: 1100 },
    { date: '2024-07-01', open: 120, high: 125, low: 118, close: 120, volume: 1200 },
  ];

  const mockAllFin: AllFinancialsResponse = {
    income_stmt: {
      periods: ['2023/9', '2023/12', '2024/3'],
      data: [
        {
          item: 'Dönem Net Karı',
          '2023/9': 100000,
          '2023/12': 120000,
          '2024/3': 150000,
        },
      ],
    },
    balance_sheet: {
      periods: ['2023/9', '2023/12', '2024/3'],
      data: [
        {
          item: 'Ödenmiş Sermaye',
          '2023/9': 10000,
          '2023/12': 10000,
          '2024/3': 10000,
        },
      ],
    },
    cashflow: { periods: [], data: [] },
  };

  it('calculates P/E bands correctly with mock data', () => {
    const result = computePEBands(mockOhlcv, mockAllFin);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.dates).toEqual(['2024-01-01', '2024-04-01', '2024-07-01']);
      expect(result.peMin).toBeGreaterThan(0);
      expect(result.peAvg).toBeGreaterThanOrEqual(result.peMin);
      expect(result.peMax).toBeGreaterThanOrEqual(result.peAvg);
      expect(result.minBand).toHaveLength(3);
      expect(result.avgBand).toHaveLength(3);
      expect(result.maxBand).toHaveLength(3);
    }
  });

  it('returns null if income statement data is missing', () => {
    const emptyFin: AllFinancialsResponse = {
      income_stmt: { periods: [], data: [] },
      balance_sheet: { periods: [], data: [] },
      cashflow: { periods: [], data: [] },
    };
    expect(computePEBands(mockOhlcv, emptyFin)).toBeNull();
  });
});
