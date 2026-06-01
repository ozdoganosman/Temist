import { describe, expect, it } from 'vitest';
import type { OHLCVData } from '../../api/borsaApi';
import {
  buildOption,
  computeVisiblePriceExtent,
  getPaddingCount,
  readDataZoomWindow,
  shiftDataZoomWindow,
  getPaddedCategoryCount,
  getRightPanGutterCount,
  portableZoomFromWindow,
  windowFromPortableZoom,
  legacyAxisOffsetToBarsPast,
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
  it('includes asymmetric right gutter', () => {
    const count = getPaddedCategoryCount(3650, false);
    expect(count).toBe(15 + 3650 + getRightPanGutterCount(false));
  });
});

describe('portable zoom (data-anchored)', () => {
  it('maps legacy axis-end offset to bars past last data', () => {
    const dataLen = 3650;
    const bounds = getPaddedCategoryCount(dataLen, false);
    const legacyOffset = bounds - 1 - (15 + dataLen + 10);
    const barsPast = legacyAxisOffsetToBarsPast(legacyOffset, dataLen, false);
    expect(barsPast).toBe(11);
  });

  it('keeps the window on real candles after symbol change', () => {
    const prefs = portableZoomFromWindow(3600, 3675, 3650, false);
    expect(prefs.barsPastLastData).toBe(11);
    const window = windowFromPortableZoom(prefs, 500, false);
    const lastData = 15 + 500 - 1;
    expect(window.endValue).toBeGreaterThanOrEqual(lastData);
    expect(window.endValue).toBeLessThanOrEqual(lastData + 15);
    expect(window.endValue - window.startValue).toBeGreaterThanOrEqual(10);
  });

  it('clamps deep gutter views back to sensible end', () => {
    const prefs = { visibleBarCount: 80, barsPastLastData: 2000 };
    const window = windowFromPortableZoom(prefs, 3650, false);
    const lastData = 15 + 3650 - 1;
    expect(window.endValue).toBeLessThanOrEqual(lastData + 15);
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
