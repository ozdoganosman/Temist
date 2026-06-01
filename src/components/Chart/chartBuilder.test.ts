import { describe, expect, it } from 'vitest';
import type { OHLCVData } from '../../api/borsaApi';
import { buildOption, computeVisiblePriceExtent, getPaddingCount } from './chartBuilder';
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
