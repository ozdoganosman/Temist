import { describe, expect, it } from 'vitest';
import type { OHLCVData } from '../../api/borsaApi';
import {
  buildOption,
  addPadding,
  computeVisiblePriceExtent,
  getPaddingCount,
  readDataZoomWindow,
  shiftDataZoomWindow,
  getPaddedCategoryCount,
  getLeftPanGutterCount,
  getRightPanGutterCount,
  portableZoomFromWindow,
  windowFromPortableZoom,
  legacyAxisOffsetToBarsPast,
  normalizePortableZoomPrefs,
  sanitizePrefsForSymbolSwitch,
  portableZoomPrefsForSymbolSwitch,
} from './chartBuilder';
import type { ThemeColors } from './chartBuilder';

const theme: ThemeColors = {
  bg: '#0a0e17',
  border: '#1a1e2e',
  text: '#8a8e96',
  tooltipBg: '#1e222d',
  tooltipText: '#c8ccd4',
  pointerLine: '#555',
  sliderBg: '#0f1320',
};

function makeBar(index: number, low: number, high: number): OHLCVData {
  return {
    date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
    open: low + (high - low) * 0.25,
    high,
    low,
    close: low + (high - low) * 0.75,
    volume: 1000,
  };
}

describe('chartBuilder price axis scaling', () => {
  it('computes the price extent from visible candles only', () => {
    const data = [
      makeBar(0, 900, 1000),
      makeBar(1, 10, 12),
      makeBar(2, 11, 13),
      makeBar(3, 10.5, 12.5),
    ];
    const pad = getPaddingCount(data.length);
    const extent = computeVisiblePriceExtent(data, pad + 1, pad + 3, pad);

    expect(extent).toBeDefined();
    expect(extent!.min).toBeGreaterThan(9);
    expect(extent!.max).toBeLessThan(14);
  });

  it('sets the initial y-axis range to the default visible window', () => {
    const data = Array.from({ length: 150 }, (_, i) =>
      i === 0 ? makeBar(i, 900, 1000) : makeBar(i, 10, 12),
    );

    const option = buildOption(data, 'TEST', false, undefined, false, false, false, false, theme);
    const yAxis = option.yAxis as Array<{ min?: number; max?: number }>;

    expect(yAxis[0].min).toBeGreaterThan(9);
    expect(yAxis[0].max).toBeLessThan(13);
  });
});

describe('padded category axis length', () => {
  it('includes symmetric left and right pan gutters', () => {
    const count = getPaddedCategoryCount(3650, false);
    expect(count).toBe(getLeftPanGutterCount(false) + 3650 + getRightPanGutterCount(false));
  });

  it('right pan gutter dates stay within a few years of the last candle', () => {
    const lastReal = '2024-06-01';
    const padded = addPadding([lastReal], [['-', '-', '-', '-']], [{ value: 0 }], [], false);
    const gutterCount = getRightPanGutterCount(false);
    const lastPadLabel = padded.dates[padded.dates.length - 1];
    expect(lastPadLabel).not.toBe('');
    const lastYear = parseInt(lastPadLabel.slice(0, 4), 10);
    expect(lastYear).toBeGreaterThanOrEqual(2024);
    expect(lastYear).toBeLessThan(2030);
    expect(padded.dates.filter((d) => d !== '').length).toBe(1 + gutterCount);
  });
});

describe('portable zoom (data-anchored)', () => {
  it('maps legacy axis-end offset to bars past last data', () => {
    const dataLen = 3650;
    const bounds = getPaddedCategoryCount(dataLen, false);
    const legacyOffset = bounds - 1 - (getLeftPanGutterCount(false) + dataLen + 10);
    const barsPast = legacyAxisOffsetToBarsPast(legacyOffset, dataLen, false);
    expect(barsPast).toBe(11);
  });

  it('keeps the window on real candles after symbol change', () => {
    const left = getLeftPanGutterCount(false);
    const lastData = left + 3650 - 1;
    const prefs = portableZoomFromWindow(lastData - 75, lastData + 11, 3650, false);
    expect(prefs.barsPastLastData).toBe(11);
    const window = windowFromPortableZoom(prefs, 500, false);
    const shortLastData = getLeftPanGutterCount(false) + 500 - 1;
    expect(window.endValue).toBeGreaterThanOrEqual(shortLastData);
    expect(window.endValue).toBeLessThanOrEqual(shortLastData + 15);
    expect(window.endValue - window.startValue).toBeGreaterThanOrEqual(10);
  });

  it('normalizes absurd visible bar counts from full-axis percent', () => {
    const prefs = normalizePortableZoomPrefs({ visibleBarCount: 5000, barsPastLastData: 11 }, 3650, false);
    expect(prefs.visibleBarCount).toBeLessThanOrEqual(400);
    expect(prefs.visibleBarCount).toBeGreaterThanOrEqual(20);
  });

  it('symbol switch keeps bar span on data, not empty gutter', () => {
    const prev = { visibleBarCount: 120, barsPastLastData: 8, startOffsetFromDataStart: -300 };
    const prefs = portableZoomPrefsForSymbolSwitch(prev, 800, false);
    const window = windowFromPortableZoom(prefs, 800, false);
    const left = getLeftPanGutterCount(false);
    const lastData = left + 800 - 1;
    expect(window.endValue).toBeGreaterThanOrEqual(left);
    expect(window.endValue).toBeLessThanOrEqual(lastData + 15);
    expect(window.endValue - window.startValue).toBeLessThanOrEqual(130);
  });

  it('maps percent zoom to the data region not the gutter', () => {
    const dataLen = 3650;
    const catCount = getPaddedCategoryCount(dataLen, false);
    const fullAxis = readDataZoomWindow({ start: 0, end: 100 }, catCount);
    const dataOnly = readDataZoomWindow({ start: 0, end: 100 }, catCount, dataLen, false);
    expect(dataOnly.endValue - dataOnly.startValue).toBeLessThan(fullAxis.endValue - fullAxis.startValue);
    const narrow = readDataZoomWindow({ start: 90, end: 100 }, catCount, dataLen, false);
    expect(narrow.endValue - narrow.startValue).toBeLessThan(500);
  });

  it('clamps deep gutter views back to sensible end', () => {
    const prefs = { visibleBarCount: 80, barsPastLastData: 2000, startOffsetFromDataStart: 0 };
    const window = windowFromPortableZoom(prefs, 3650, false);
    const lastData = getLeftPanGutterCount(false) + 3650 - 1;
    expect(window.endValue).toBeLessThanOrEqual(lastData + 15);
  });

  it('falls back to data view when prefs target only empty gutter', () => {
    const left = getLeftPanGutterCount(false);
    const gutterOnly = {
      visibleBarCount: 120,
      barsPastLastData: 10,
      startOffsetFromDataStart: -400,
    };
    const window = windowFromPortableZoom(gutterOnly, 3650, false);
    const lastData = left + 3650 - 1;
    expect(window.endValue).toBeGreaterThanOrEqual(lastData - 150);
    expect(window.endValue).toBeLessThanOrEqual(lastData + 15);
  });

  it('rejects full-history zoom on symbol switch', () => {
    const insane = sanitizePrefsForSymbolSwitch(
      { visibleBarCount: 5000, barsPastLastData: 11, startOffsetFromDataStart: 0 },
      3650,
      false,
    );
    expect(insane.visibleBarCount).toBeLessThanOrEqual(82);
  });
});

describe('dataZoom pan window', () => {
  it('reads percent zoom as category indices', () => {
    const window = readDataZoomWindow({ start: 0, end: 100 }, 101);
    expect(window.startValue).toBe(0);
    expect(window.endValue).toBe(100);
  });

  it('shifts the window right until the last category', () => {
    const shifted = shiftDataZoomWindow(40, 80, 30, 100);
    expect(shifted.endValue).toBe(100);
    expect(shifted.startValue).toBe(60);
  });

  it('shifts the window left until the first category', () => {
    const shifted = shiftDataZoomWindow(10, 50, -20, 100);
    expect(shifted.startValue).toBe(0);
    expect(shifted.endValue).toBe(40);
  });
});
