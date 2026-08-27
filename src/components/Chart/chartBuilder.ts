import * as echarts from 'echarts';
import type { OHLCVData } from '../../api/borsaApi';
import type { Interval, ChartDrawing } from './types';
import { isIntraday } from './types';
import { formatPrice, formatVolume } from '../../utils/formatters';
import {
  computeWilliamsPasa,
  computeNizamiCedid,
  ema,
  computeCMF,
} from '../../utils/indicators';
import type { SignalConfig, SignalEvent } from '../../utils/signalDetection';
import { computeAllPearsonChannels, DEFAULT_PEARSON_CONFIGS } from '../../utils/pearsonChannels';
import type { CMFResult } from '../../utils/indicators';


export interface ComputedIndicators {
  williamsPasa?: {
    percentR: (number | null)[];
    emaWil: (number | null)[];
  };
  nizamiCedid?: {
    macd: (number | null)[];
    signal: (number | null)[];
    emacd: (number | null)[];
  };
  cmf?: {
    cmf: (number | null)[];
    ema130: (number | null)[];
    ema260: (number | null)[];
  };
}

interface SignalPoint {
  value: [number, number];
}

export const UP_COLOR = '#26a69a';
export const DOWN_COLOR = '#ef5350';

export interface ThemeColors {
  bg: string;
  border: string;
  text: string;
  tooltipBg: string;
  tooltipText: string;
  pointerLine: string;
  sliderBg: string;
}

export function getThemeColors(): ThemeColors {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--chart-bg', '#0a0e17'),
    border: v('--border-primary', '#1a1e2e'),
    text: v('--text-muted', '#8a8e96'),
    tooltipBg: v('--highlight-bg', '#1e222d'),
    tooltipText: v('--text-primary', '#c8ccd4'),
    pointerLine: v('--text-muted', '#555'),
    sliderBg: v('--bg-secondary', '#0f1320'),
  };
}

const EMPTY_OHLC = ['-', '-', '-', '-'];
const EMPTY_VOL = { value: 0, itemStyle: { color: 'transparent' } };
export const RIGHT_PAD_BARS = 10;
/**
 * Blank x-axis slots before the first candle so old data can be panned toward
 * the centre of the viewport. These carry empty labels (no dates), so the size
 * only affects how far left you can scroll — kept generous but well below the
 * old 600 so the bottom range slider isn't dominated by empty track.
 */
export const LEFT_PAN_GUTTER_BARS = 220;
/**
 * Projected slots after the last candle so pan-right can reveal whitespace, the
 * way TradingView shows a short stretch of future dates past the latest bar.
 * Capped tight (~5 months of business days) so the axis never runs years into
 * the future and the slider stays proportionate.
 */
export const RIGHT_PAN_GUTTER_BARS = 110;
export const DEFAULT_VISIBLE_CANDLE_COUNT = 72;
export const MAX_PERSISTED_VISIBLE_CANDLE_COUNT = 96;
// Above this many visible candles, switch ECharts candlestick "large" mode back
// on. Large mode batches rendering (much cheaper) but collapses bodies to ~1px;
// that's acceptable once this many candles are on screen (bodies would be hair-
// thin anyway). Below the threshold we keep large:false so bodies stay readable.
export const LARGE_MODE_VISIBLE_THRESHOLD = 250;

export function getPaddingCount(dataLen: number, intradayMode = false): number {
  if (intradayMode) return 10;
  return 15;
}

export function getLeftPanGutterCount(intradayMode = false): number {
  return intradayMode ? 120 : LEFT_PAN_GUTTER_BARS;
}

export function getRightPanGutterCount(intradayMode = false): number {
  return intradayMode ? 80 : RIGHT_PAN_GUTTER_BARS;
}

/** Category index where real OHLCV data begins (after the left pan gutter). */
export function getAxisLeadingOffset(_dataLen: number, intradayMode = false): number {
  return getLeftPanGutterCount(intradayMode);
}

/** Total x-axis category count (left gutter + data + right gutter). */
export function getPaddedCategoryCount(dataLen: number, intradayMode = false): number {
  return getLeftPanGutterCount(intradayMode) + dataLen + getRightPanGutterCount(intradayMode);
}

export interface ChartDataBounds {
  padBefore: number;
  dataStart: number;
  dataEndExclusive: number;
  lastDataIdx: number;
  maxCategoryIdx: number;
  /** Furthest right index that still shows real candles (not deep empty gutter). */
  maxSensibleEndIdx: number;
}

export function getChartDataBounds(dataLen: number, intradayMode = false): ChartDataBounds {
  const padBefore = getLeftPanGutterCount(intradayMode);
  const dataStart = padBefore;
  const dataEndExclusive = padBefore + dataLen;
  const lastDataIdx = Math.max(dataStart, dataEndExclusive - 1);
  const maxCategoryIdx = Math.max(0, getPaddedCategoryCount(dataLen, intradayMode) - 1);
  const maxSensibleEndIdx = Math.min(dataEndExclusive + RIGHT_PAD_BARS, maxCategoryIdx);
  return { padBefore, dataStart, dataEndExclusive, lastDataIdx, maxCategoryIdx, maxSensibleEndIdx };
}

/** Zoom prefs anchored to the last real candle — portable across symbols. */
export interface PortableZoomPrefs {
  visibleBarCount: number;
  /** Window end minus last data index (0 ≈ last candle visible at right edge). */
  barsPastLastData: number;
  /** Window start minus first data index (negative = panned into left gutter). */
  startOffsetFromDataStart: number;
}

export function portableZoomFromWindow(
  startValue: number,
  endValue: number,
  dataLen: number,
  intradayMode = false,
): PortableZoomPrefs {
  const bounds = getChartDataBounds(dataLen, intradayMode);
  return {
    visibleBarCount: Math.max(1, endValue - startValue),
    barsPastLastData: endValue - bounds.lastDataIdx,
    startOffsetFromDataStart: startValue - bounds.dataStart,
  };
}

export function defaultPortableZoomPrefs(dataLen: number, intradayMode = false): PortableZoomPrefs {
  const visible = DEFAULT_VISIBLE_CANDLE_COUNT + RIGHT_PAD_BARS;
  return {
    visibleBarCount: visible,
    barsPastLastData: RIGHT_PAD_BARS,
    startOffsetFromDataStart: Math.max(0, dataLen - visible),
  };
}

const MIN_VISIBLE_BARS = 20;
const MAX_VISIBLE_BARS = 400;
const MAX_PRESERVED_ZOOM_ON_SYMBOL = 400;

function windowOverlapsData(
  startIdx: number,
  endIdx: number,
  bounds: ChartDataBounds,
): boolean {
  return endIdx >= bounds.dataStart && startIdx <= bounds.lastDataIdx;
}

export function windowFromPortableZoom(
  prefs: PortableZoomPrefs,
  dataLen: number,
  intradayMode = false,
): { startValue: number; endValue: number } {
  const bounds = getChartDataBounds(dataLen, intradayMode);
  if (dataLen === 0) {
    return { startValue: 0, endValue: 0 };
  }

  const maxPast = RIGHT_PAD_BARS + 5;
  const barsPast = Math.min(Math.max(prefs.barsPastLastData, -5), maxPast);
  let visible = Math.max(10, Math.min(prefs.visibleBarCount, MAX_VISIBLE_BARS));

  const hasStartOffset = Number.isFinite(prefs.startOffsetFromDataStart);
  let startIdx: number;
  let endIdx: number;

  if (hasStartOffset) {
    const dataBars = bounds.lastDataIdx - bounds.dataStart + 1;
    const minOffset = -getLeftPanGutterCount(intradayMode) + 5;
    const maxOffset = Math.max(0, dataBars - 10);
    const offset = Math.min(Math.max(prefs.startOffsetFromDataStart, minOffset), maxOffset);
    startIdx = Math.max(0, bounds.dataStart + offset);
    endIdx = startIdx + visible;
    endIdx = Math.min(endIdx, bounds.maxSensibleEndIdx, bounds.maxCategoryIdx);
    if (endIdx <= startIdx) {
      endIdx = Math.min(bounds.maxCategoryIdx, startIdx + visible);
    }
  } else {
    endIdx = bounds.lastDataIdx + barsPast;
    endIdx = Math.min(endIdx, bounds.maxSensibleEndIdx);
    endIdx = Math.min(endIdx, bounds.maxCategoryIdx);
    startIdx = endIdx - visible;
    if (startIdx < 0) {
      startIdx = 0;
      endIdx = Math.min(bounds.maxCategoryIdx, startIdx + visible);
    }
  }

  const result = { startValue: startIdx, endValue: endIdx };
  if (!windowOverlapsData(result.startValue, result.endValue, bounds)) {
    return windowFromPortableZoom(defaultPortableZoomPrefs(dataLen, intradayMode), dataLen, intradayMode);
  }
  return result;
}

/** Build zoom prefs for a new symbol: keep bar span + right anchor, not gutter position. */
export function portableZoomPrefsForSymbolSwitch(
  previous: PortableZoomPrefs | null,
  dataLen: number,
  intradayMode = false,
): PortableZoomPrefs {
  const bounds = getChartDataBounds(dataLen, intradayMode);
  const dataBars = Math.max(1, bounds.lastDataIdx - bounds.dataStart + 1);

  let visible = previous?.visibleBarCount ?? DEFAULT_VISIBLE_CANDLE_COUNT + RIGHT_PAD_BARS;
  if (!Number.isFinite(visible) || visible < MIN_VISIBLE_BARS) {
    visible = DEFAULT_VISIBLE_CANDLE_COUNT + RIGHT_PAD_BARS;
  }
  if (visible > MAX_PRESERVED_ZOOM_ON_SYMBOL || visible >= dataBars * 0.85) {
    visible = Math.min(DEFAULT_VISIBLE_CANDLE_COUNT + RIGHT_PAD_BARS, dataBars);
  }
  visible = Math.min(visible, dataBars);

  let barsPast = previous?.barsPastLastData ?? RIGHT_PAD_BARS;
  barsPast = Math.min(Math.max(barsPast, -5), RIGHT_PAD_BARS + 5);

  return normalizePortableZoomPrefs(
    {
      visibleBarCount: visible,
      barsPastLastData: barsPast,
      startOffsetFromDataStart: Math.max(0, dataBars - visible),
    },
    dataLen,
    intradayMode,
  );
}

/** Prevent symbol switches from restoring a full-history or gutter-swallowing zoom. */
export function sanitizePrefsForSymbolSwitch(
  prefs: PortableZoomPrefs,
  dataLen: number,
  intradayMode = false,
): PortableZoomPrefs {
  const bounds = getChartDataBounds(dataLen, intradayMode);
  const dataBars = Math.max(1, bounds.lastDataIdx - bounds.dataStart + 1);

  if (prefs.visibleBarCount >= dataBars * 0.85 || prefs.visibleBarCount > MAX_PRESERVED_ZOOM_ON_SYMBOL) {
    return portableZoomPrefsForSymbolSwitch(null, dataLen, intradayMode);
  }

  let p = normalizePortableZoomPrefs(prefs, dataLen, intradayMode);

  const leftGutter = getLeftPanGutterCount(intradayMode);
  const minOffset = -leftGutter + 5;
  const maxOffset = Math.max(0, dataBars - 10);
  if (!Number.isFinite(p.startOffsetFromDataStart)) {
    p.startOffsetFromDataStart = Math.max(0, dataBars - p.visibleBarCount);
  }
  p.startOffsetFromDataStart = Math.min(Math.max(p.startOffsetFromDataStart, minOffset), maxOffset);

  return p;
}

/** Convert legacy axis-end offset (pre data-anchor) to barsPastLastData. */
export function legacyAxisOffsetToBarsPast(
  offsetFromAxisEnd: number,
  dataLen: number,
  intradayMode = false,
): number {
  const bounds = getChartDataBounds(dataLen, intradayMode);
  const endIdx = bounds.maxCategoryIdx - offsetFromAxisEnd;
  return endIdx - bounds.lastDataIdx;
}

export function loadPortableZoomPrefs(
  dataLen: number,
  intradayMode = false,
): PortableZoomPrefs | null {
  try {
    const countRaw = localStorage.getItem('temist_chart_visible_bar_count');
    const offsetRaw = localStorage.getItem('temist_chart_zoom_offset_from_end');
    if (countRaw === null || offsetRaw === null) return null;

    const visibleBarCount = parseInt(countRaw, 10);
    const offsetNum = parseInt(offsetRaw, 10);
    if (!Number.isFinite(visibleBarCount) || !Number.isFinite(offsetNum)) return null;

    // Legacy values were "offset from axis end" (thousands when a normal view).
    const barsPastLastData =
      offsetNum > RIGHT_PAD_BARS + 20
        ? legacyAxisOffsetToBarsPast(offsetNum, dataLen, intradayMode)
        : offsetNum;

    const offsetRaw2 = localStorage.getItem('temist_chart_start_offset_from_data');
    const startOffsetFromDataStart =
      offsetRaw2 !== null && offsetRaw2 !== ''
        ? parseInt(offsetRaw2, 10)
        : Math.max(0, dataLen - visibleBarCount);

    const loaded: PortableZoomPrefs = {
      visibleBarCount,
      barsPastLastData,
      startOffsetFromDataStart: Number.isFinite(startOffsetFromDataStart) ? startOffsetFromDataStart : 0,
    };
    // Always anchor to the end of data when loading from storage across sessions;
    // only the zoom level (visibleBarCount) is worth preserving.
    return portableZoomPrefsForSymbolSwitch(loaded, dataLen, intradayMode);
  } catch {
    return null;
  }
}

export function savePortableZoomPrefs(prefs: PortableZoomPrefs): void {
  try {
    localStorage.setItem('temist_chart_visible_bar_count', String(prefs.visibleBarCount));
    localStorage.setItem('temist_chart_zoom_offset_from_end', String(prefs.barsPastLastData));
    localStorage.setItem('temist_chart_start_offset_from_data', String(prefs.startOffsetFromDataStart));
  } catch {
    // ignore quota errors
  }
}

/** Clamp portable prefs so symbol switches never land on gutter-wide spans. */
export function normalizePortableZoomPrefs(
  prefs: PortableZoomPrefs,
  dataLen: number,
  intradayMode = false,
): PortableZoomPrefs {
  const bounds = getChartDataBounds(dataLen, intradayMode);
  const dataBarCount = Math.max(1, bounds.lastDataIdx - bounds.dataStart + 1);
  const maxVisible = Math.min(dataBarCount + RIGHT_PAD_BARS, MAX_VISIBLE_BARS);
  const startOffset = Number.isFinite(prefs.startOffsetFromDataStart)
    ? prefs.startOffsetFromDataStart
    : Math.max(0, dataBarCount - Math.min(Math.max(prefs.visibleBarCount, MIN_VISIBLE_BARS), maxVisible));

  return {
    visibleBarCount: Math.min(Math.max(prefs.visibleBarCount, MIN_VISIBLE_BARS), maxVisible),
    barsPastLastData: Math.min(Math.max(prefs.barsPastLastData, -5), RIGHT_PAD_BARS + 5),
    startOffsetFromDataStart: startOffset,
  };
}

type DataZoomWindowInput = {
  start?: number;
  end?: number;
  startValue?: number;
  endValue?: number;
};

/** Resolve the current dataZoom window as category indices. */
export function readDataZoomWindow(
  dz: DataZoomWindowInput | undefined,
  categoryCount: number,
  dataLen?: number,
  intradayMode = false,
): { startValue: number; endValue: number } {
  const maxIdx = Math.max(0, categoryCount - 1);
  if (categoryCount === 0) {
    return { startValue: 0, endValue: 0 };
  }

  const toIndex = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    return null;
  };

  let startValue = toIndex(dz?.startValue);
  let endValue = toIndex(dz?.endValue);
  if (startValue === null || endValue === null) {
    const startPct = toIndex(dz?.start) ?? 0;
    const endPct = toIndex(dz?.end) ?? 100;
    // Map percent to the data region, not the full axis (avoids 2400-bar gutter skew).
    if (dataLen != null && dataLen > 0) {
      const bounds = getChartDataBounds(dataLen, intradayMode);
      const dataBarCount = bounds.lastDataIdx - bounds.dataStart + 1;
      startValue = bounds.dataStart + Math.floor((startPct / 100) * dataBarCount);
      endValue = bounds.dataStart + Math.ceil((endPct / 100) * dataBarCount);
      endValue = Math.min(endValue, bounds.maxSensibleEndIdx);
    } else {
      startValue = Math.floor((startPct / 100) * maxIdx);
      endValue = Math.ceil((endPct / 100) * maxIdx);
    }
  }

  return {
    startValue: Math.max(0, Math.min(maxIdx, startValue)),
    endValue: Math.max(0, Math.min(maxIdx, endValue)),
  };
}

/** Shift a dataZoom window by bar count, clamped to [0, maxCategoryIdx]. */
export function shiftDataZoomWindow(
  startValue: number,
  endValue: number,
  shiftBars: number,
  maxCategoryIdx: number,
): { startValue: number; endValue: number } {
  if (maxCategoryIdx <= 0) {
    return { startValue: 0, endValue: 0 };
  }

  const span = Math.max(1, endValue - startValue);
  let newStart = startValue + shiftBars;
  let newEnd = endValue + shiftBars;

  if (newStart < 0) {
    newEnd -= newStart;
    newStart = 0;
  }
  if (newEnd > maxCategoryIdx) {
    newStart -= newEnd - maxCategoryIdx;
    newEnd = maxCategoryIdx;
  }
  if (newStart < 0) {
    newStart = 0;
  }
  if (newEnd < newStart) {
    newEnd = Math.min(maxCategoryIdx, newStart + span);
  }

  return { startValue: newStart, endValue: newEnd };
}

export function generateFutureDates(lastDate: string, count: number): string[] {
  const result: string[] = [];
  if (!lastDate) return new Array(count).fill('');
  // Handle intraday dates like "2024-01-15 09:30"
  const hasTime = lastDate.includes(' ');
  const dateForParse = hasTime ? lastDate.replace(' ', 'T') + ':00' : lastDate + 'T00:00:00';
  const d = new Date(dateForParse);
  if (isNaN(d.getTime())) return new Array(count).fill('');
  for (let i = 1; i <= count; i++) {
    // Advance exactly one step per iteration. (A previous version added `i`
    // days each pass on top of an already-advancing date, so the gutter dates
    // grew quadratically — 600 bars landed ~500 years out, year 2500+.)
    if (hasTime) {
      d.setMinutes(d.getMinutes() + 5);
    } else {
      d.setDate(d.getDate() + 1);
      while (d.getDay() === 0 || d.getDay() === 6) {
        d.setDate(d.getDate() + 1);
      }
    }
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    if (hasTime) {
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      result.push(`${yyyy}-${mm}-${dd} ${hh}:${min}`);
    } else {
      result.push(`${yyyy}-${mm}-${dd}`);
    }
  }
  return result;
}

function formatIndicatorVal(v: number): string {
  if (v === null || v === undefined || isNaN(v)) return '';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1000) {
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  if (abs >= 1) {
    return v.toFixed(2);
  }
  if (abs >= 0.0001) {
    return Number(v.toFixed(4)).toString();
  }
  return v.toExponential(2);
}

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  const coarsePointer =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return window.innerWidth < 768 || coarsePointer;
}

export function addPadding(
  dates: string[],
  ohlcArr: unknown[],
  volumeArr: unknown[],
  closeArr: (number | null)[],
  intradayMode = false,
) {
  const padBefore = getLeftPanGutterCount(intradayMode);
  const padAfterCount = getRightPanGutterCount(intradayMode);
  const padBeforeArr = new Array(padBefore).fill('');
  const lastDate = dates.length > 0 ? dates[dates.length - 1] : '';
  const padAfter = generateFutureDates(lastDate, padAfterCount);

  return {
    dates: [...padBeforeArr, ...dates, ...padAfter],
    ohlc: [
      ...new Array(padBefore).fill(EMPTY_OHLC),
      ...ohlcArr,
      ...new Array(padAfterCount).fill(EMPTY_OHLC),
    ],
    volumes: [
      ...new Array(padBefore).fill(EMPTY_VOL),
      ...volumeArr,
      ...new Array(padAfterCount).fill(EMPTY_VOL),
    ],
    close: [...new Array(padBefore).fill(null), ...closeArr, ...new Array(padAfterCount).fill(null)],
    offset: padBefore,
  };
}

export interface PriceAxisExtent {
  min: number;
  max: number;
}

export function computeVisiblePriceExtent(
  data: OHLCVData[],
  categoryStart: number,
  categoryEnd: number,
  pad: number,
  logScale = false,
): PriceAxisExtent | undefined {
  if (data.length === 0) return undefined;

  const start = Math.max(0, Math.floor(Math.min(categoryStart, categoryEnd) - pad));
  const end = Math.min(data.length - 1, Math.ceil(Math.max(categoryStart, categoryEnd) - pad));
  if (end < 0 || start > data.length - 1 || start > end) return undefined;

  let min = Infinity;
  let max = -Infinity;
  let minPositive = Infinity;

  for (let i = start; i <= end; i++) {
    const low = data[i]?.low;
    const high = data[i]?.high;
    if (Number.isFinite(low) && (!logScale || low > 0)) {
      min = Math.min(min, low);
      if (low > 0) minPositive = Math.min(minPositive, low);
    }
    if (Number.isFinite(high) && (!logScale || high > 0)) {
      max = Math.max(max, high);
      if (high > 0) minPositive = Math.min(minPositive, high);
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;

  const range = max - min;
  const padding = range > 0 ? range * 0.06 : Math.max(Math.abs(max) * 0.01, 0.01);
  const paddedMin = min - padding;
  const paddedMax = max + padding;

  if (logScale) {
    const safeMin = Number.isFinite(minPositive) ? minPositive * 0.95 : min;
    return {
      min: Math.max(paddedMin, safeMin),
      max: paddedMax,
    };
  }

  return {
    min: paddedMin,
    max: paddedMax,
  };
}

function computeNizamiCedidRegimeAreas(condition: (boolean | null)[], rawDates: string[]): any[] {
  const areas: any[] = [];
  let startIdx: number | null = null;
  for (let i = 0; i < condition.length; i++) {
    const cond = condition[i];
    if (cond === true) {
      if (startIdx === null) {
        startIdx = i;
      }
    } else {
      if (startIdx !== null) {
        areas.push([
          { xAxis: rawDates[startIdx], itemStyle: { color: 'rgba(76, 175, 80, 0.04)' } },
          { xAxis: rawDates[i - 1] }
        ]);
        startIdx = null;
      }
    }
  }
  if (startIdx !== null) {
    areas.push([
          { xAxis: rawDates[startIdx], itemStyle: { color: 'rgba(76, 175, 80, 0.04)' } },
          { xAxis: rawDates[rawDates.length - 1] }
    ]);
  }
  return areas;
}

function computeEMARegimeAreas(
  closes: number[],
  rawDates: string[],
  _pad: number,
  _total: number
): any[] {
  const n = closes.length;
  const allPeriods = [8, 13, 21, 34, 55, 89, 144, 233, 377, 610];
  const periods = allPeriods.filter(p => n >= p);
  if (periods.length < 2) return [];
  
  const emas = periods.map(p => ema(closes, p));
  const maxPeriod = periods[periods.length - 1];
  const totalPairs = periods.length - 1;
  
  const areas: any[] = [];
  let currentStartIdx: number | null = null;
  let currentScore: number | null = null;

  for (let i = maxPeriod; i < n; i++) {
    let sum = 0;
    let valid = true;
    for (let j = 0; j < periods.length; j++) {
      if (emas[j][i] === null) {
        valid = false;
        break;
      }
    }
    if (!valid) {
      if (currentStartIdx !== null && currentScore !== null) {
        const r = Math.round(239 - (239 - 76) * currentScore);
        const g = Math.round(83 + (175 - 83) * currentScore);
        const b = 80;
        const color = `rgba(${r}, ${g}, ${b}, 0.15)`;
        areas.push([
          { xAxis: rawDates[currentStartIdx], itemStyle: { color } },
          { xAxis: rawDates[i] }
        ]);
        currentStartIdx = null;
        currentScore = null;
      }
      continue;
    }

    const spread = 0.003; // Normalization spread
    for (let j = 0; j < totalPairs; j++) {
      const emaCurr = emas[j][i];
      const emaNext = emas[j+1][i];
      if (emaCurr !== null && emaNext !== null) {
        const diffRatio = (emaCurr - emaNext) / emaNext;
        const clamped = Math.max(-1, Math.min(1, diffRatio / spread));
        sum += clamped;
      }
    }
    const score = (sum / totalPairs + 1) / 2; // Map [-1, 1] to [0, 1]

    if (currentScore === null) {
      currentStartIdx = i;
      currentScore = score;
    // Merge threshold: increase from 0.03 to 0.10 to produce far fewer segments
    } else if (Math.abs(currentScore - score) > 0.10) {
      const r = Math.round(239 - (239 - 76) * currentScore);
      const g = Math.round(83 + (175 - 83) * currentScore);
      const b = 80;
      const color = `rgba(${r}, ${g}, ${b}, 0.15)`;
      areas.push([
        { xAxis: rawDates[currentStartIdx!], itemStyle: { color } },
        { xAxis: rawDates[i] }
      ]);
      currentStartIdx = i;
      currentScore = score;
    }
  }

  if (currentStartIdx !== null && currentScore !== null) {
    const r = Math.round(239 - (239 - 76) * currentScore);
    const g = Math.round(83 + (175 - 83) * currentScore);
    const b = 80;
    const color = `rgba(${r}, ${g}, ${b}, 0.15)`;
    areas.push([
      { xAxis: rawDates[currentStartIdx], itemStyle: { color } },
      { xAxis: rawDates[n - 1] }
    ]);
  }
  
  return areas;
}

function buildPearsonTable(results: any[], tc: ThemeColors, bottom: number): any {
  const isMobile = isMobileViewport();
  const rowHeight = isMobile ? 26 : 32;
  const tableWidth = isMobile ? 260 : 340;
  
  const hasAverage = results.length > 0;
  const extraRows = hasAverage ? 1.2 : 0;
  const tableHeight = (isMobile ? 32 : 40) + (results.length + extraRows) * rowHeight;
  const rightOffset = isMobile ? 38 : 65;
  
  const titleFontSize = isMobile ? '12px' : '14px';
  const rowFontSize = isMobile ? '11px' : '13px';
  const leftColX = isMobile ? 10 : 15;
  const midColX = isMobile ? 115 : 145;
  const rightColX = isMobile ? 185 : 235;
  const headerLineY = isMobile ? 28 : 34;
  const firstRowY = isMobile ? 35 : 42;

  const children: any[] = [
    {
      type: 'rect',
      shape: { width: tableWidth, height: tableHeight, r: 8 },
      style: {
        fill: tc.tooltipBg,
        stroke: tc.border,
        lineWidth: 2,
        shadowBlur: 14,
        shadowColor: 'rgba(0,0,0,0.5)',
      },
    },
    // Header Row
    {
      type: 'text',
      left: leftColX,
      top: isMobile ? 8 : 10,
      style: {
        text: 'Kanal (Pearson)',
        fill: tc.text,
        font: `bold ${titleFontSize} sans-serif`,
      },
    },
    {
      type: 'text',
      left: midColX,
      top: isMobile ? 8 : 10,
      style: {
        text: 'Pearson R',
        fill: tc.text,
        font: `bold ${titleFontSize} sans-serif`,
      },
    },
    {
      type: 'text',
      left: rightColX,
      top: isMobile ? 8 : 10,
      style: {
        text: 'Günlük Eğilim',
        fill: tc.text,
        font: `bold ${titleFontSize} sans-serif`,
      },
    },
    {
      type: 'line',
      shape: { x1: 0, y1: headerLineY, x2: tableWidth, y2: headerLineY },
      style: { stroke: tc.border, lineWidth: 2 },
    },
  ];

  results.forEach((res, i) => {
    const y = firstRowY + i * rowHeight;
    const rVal = res.r;
    const rStr = rVal.toFixed(2);
    const rColor = rVal >= 0.5 ? '#26a69a' : rVal <= -0.5 ? '#ef5350' : tc.text;

    const slopePct = (res.B - res.A) / res.p;
    const slopeStr = (slopePct >= 0 ? '+' : '') + slopePct.toFixed(4) + '%';
    const slopeColor = slopePct > 0 ? '#26a69a' : slopePct < 0 ? '#ef5350' : tc.text;

    children.push(
      {
        type: 'text',
        left: leftColX,
        top: y,
        style: {
          text: `${res.label} (${res.p})`,
          fill: tc.text,
          font: `${rowFontSize} sans-serif`,
        },
      },
      {
        type: 'text',
        left: midColX,
        top: y,
        style: {
          text: rStr,
          fill: rColor,
          font: `bold ${rowFontSize} sans-serif`,
        },
      },
      {
        type: 'text',
        left: rightColX,
        top: y,
        style: {
          text: slopeStr,
          fill: slopeColor,
          font: `bold ${rowFontSize} sans-serif`,
        },
      }
    );
  });

  if (hasAverage) {
    const avgLineY = headerLineY + results.length * rowHeight;
    children.push({
      type: 'line',
      shape: { x1: 0, y1: avgLineY, x2: tableWidth, y2: avgLineY },
      style: { stroke: tc.border, lineWidth: 1.5, lineDash: [4, 4] },
    });

    const avgP = results.reduce((sum, r) => sum + r.p, 0) / results.length;
    const avgR = results.reduce((sum, r) => sum + r.r, 0) / results.length;
    const avgSlopePct = results.reduce((sum, r) => sum + (r.B - r.A) / r.p, 0) / results.length;

    const y = firstRowY + results.length * rowHeight + (isMobile ? 5 : 7);
    const rColor = avgR >= 0.5 ? '#26a69a' : avgR <= -0.5 ? '#ef5350' : tc.text;
    const avgSlopeStr = (avgSlopePct >= 0 ? '+' : '') + avgSlopePct.toFixed(4) + '%';
    const avgSlopeColor = avgSlopePct > 0 ? '#26a69a' : avgSlopePct < 0 ? '#ef5350' : tc.text;

    children.push(
      {
        type: 'text',
        left: leftColX,
        top: y,
        style: {
          text: `Ortalama (${avgP.toFixed(0)})`,
          fill: tc.text,
          font: `bold ${rowFontSize} sans-serif`,
        },
      },
      {
        type: 'text',
        left: midColX,
        top: y,
        style: {
          text: avgR.toFixed(2),
          fill: rColor,
          font: `bold ${rowFontSize} sans-serif`,
        },
      },
      {
        type: 'text',
        left: rightColX,
        top: y,
        style: {
          text: avgSlopeStr,
          fill: avgSlopeColor,
          font: `bold ${rowFontSize} sans-serif`,
        },
      }
    );
  }

  return {
    type: 'group',
    right: rightOffset,
    bottom: bottom,
    z: 100,
    children,
  };
}

export function getGridMargins() {
  const isMobile = isMobileViewport();
  return {
    left: isMobile ? 10 : 15,
    right: isMobile ? 32 : 55,
  };
}

/** Stable ECharts series ids so drawing-only changes can be merge-updated. */
export const CANDLE_SERIES_ID = 'temist-candles';
export const DRAWINGS_SERIES_ID = 'temist-drawings';

/**
 * Build the custom overlay series that renders trend lines, fibonacci levels,
 * and selection handles. Extracted so it can be rebuilt in isolation for
 * incremental (merge-mode) drawing updates without rebuilding the whole chart.
 */
export function buildDrawingsSeries(
  drawings: ChartDrawing[] | undefined,
  dates: string[],
  selectedDrawingId: string | null | undefined,
  tc: ThemeColors,
): echarts.SeriesOption[] {
  if (!drawings || drawings.length === 0) {
    // Empty placeholder keeps the series id alive for merge updates.
    return [{ id: DRAWINGS_SERIES_ID, type: 'custom', xAxisIndex: 0, yAxisIndex: 0, data: [], renderItem: () => null, silent: true }];
  }
  const isDark = tc.bg !== '#ffffff';
  // O(1) date→index lookups instead of O(n) indexOf per drawing per render.
  const dateIndex = new Map<string, number>();
  for (let i = 0; i < dates.length; i++) dateIndex.set(dates[i], i);

  return [{
    id: DRAWINGS_SERIES_ID,
    name: 'Çizimler',
    type: 'custom',
    xAxisIndex: 0,
    yAxisIndex: 0,
    z: 30,
    data: drawings,
    silent: true,
    renderItem: (params: any, api: any) => {
      const item = drawings[params.dataIndex];
      if (!item) return null;

      let startIdx = item.startBarIdx;
      if (item.startDate) {
        const idx = dateIndex.get(item.startDate);
        if (idx !== undefined) startIdx = idx;
      }

      const startCoord = api.coord([startIdx, item.startPrice]);
      if (!startCoord) return null;
      const startX = startCoord[0];
      const startY = startCoord[1];

      let endIdx = item.endBarIdx !== undefined ? item.endBarIdx : startIdx;
      if (item.endDate) {
        const idx = dateIndex.get(item.endDate);
        if (idx !== undefined) endIdx = idx;
      }

      const isSelected = item.id === selectedDrawingId;

      if (item.type === 'trend' && item.endPrice !== undefined) {
        const endCoord = api.coord([endIdx, item.endPrice]);
        if (!endCoord) return null;
        const endX = endCoord[0];
        const endY = endCoord[1];

        const lineColor = isSelected ? '#ff9800' : '#2962ff';
        const lineWidth = isSelected ? 3 : 2;

        const lineObj = {
          type: 'line',
          shape: { x1: startX, y1: startY, x2: endX, y2: endY },
          style: { stroke: lineColor, lineWidth: lineWidth }
        };

        if (isSelected) {
          return {
            type: 'group',
            children: [
              lineObj,
              { type: 'circle', shape: { cx: startX, cy: startY, r: 5 }, style: { fill: '#ffffff', stroke: '#ff9800', lineWidth: 2 } },
              { type: 'circle', shape: { cx: endX, cy: endY, r: 5 }, style: { fill: '#ffffff', stroke: '#ff9800', lineWidth: 2 } }
            ]
          };
        }
        return lineObj;
      } else if (item.type === 'horizontal') {
        if (isSelected) {
          return { type: 'circle', shape: { cx: startX, cy: startY, r: 5 }, style: { fill: '#ffffff', stroke: '#ff9800', lineWidth: 2 } };
        }
        return null;
      } else if (item.type === 'fibonacci' && item.endPrice !== undefined) {
        const gridWidth = params.coordSys.width;
        const gridX = params.coordSys.x;

        const priceDiff = item.endPrice - item.startPrice;
        const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

        const children: any[] = [];
        levels.forEach((lvl) => {
          const lvlPrice = item.startPrice + priceDiff * lvl;
          const lvlCoord = api.coord([startIdx, lvlPrice]);
          if (!lvlCoord) return;
          const y = lvlCoord[1];

          children.push({
            type: 'line',
            shape: { x1: gridX, y1: y, x2: gridX + gridWidth, y2: y },
            style: {
              stroke: isSelected ? '#ff9800' : (lvl === 0 || lvl === 1 ? '#ef5350' : '#8a8e96'),
              lineWidth: isSelected ? 2 : (lvl === 0 || lvl === 1 ? 1.5 : 1),
              lineDash: lvl === 0 || lvl === 1 ? undefined : [3, 3]
            }
          });

          children.push({
            type: 'text',
            x: gridX + 5,
            y: y - 10,
            style: {
              text: `Fib ${(lvl * 100).toFixed(1)}% (${lvlPrice.toFixed(2)})`,
              fill: isSelected ? '#ff9800' : (isDark ? '#8a8e96' : '#555555'),
              font: isSelected ? 'bold 10px sans-serif' : '9px sans-serif'
            }
          });
        });

        if (isSelected) {
          const endCoord = api.coord([endIdx, item.endPrice]);
          if (endCoord) {
            const endX = endCoord[0];
            const endY = endCoord[1];
            children.push({ type: 'line', shape: { x1: startX, y1: startY, x2: endX, y2: endY }, style: { stroke: '#ff9800', lineWidth: 1.5, lineDash: [4, 4] } });
            children.push({ type: 'circle', shape: { cx: startX, cy: startY, r: 5 }, style: { fill: '#ffffff', stroke: '#ff9800', lineWidth: 2 } });
            children.push({ type: 'circle', shape: { cx: endX, cy: endY, r: 5 }, style: { fill: '#ffffff', stroke: '#ff9800', lineWidth: 2 } });
          }
        }

        return { type: 'group', children };
      }

      return null;
    }
  }];
}

/** Build markLine entries for the last-price line + horizontal drawing lines. */
export function buildPriceMarkLineData(
  drawings: ChartDrawing[] | undefined,
  selectedDrawingId: string | null | undefined,
  lastClose: number | null,
  lastPriceColor: string,
): any[] {
  const markLineData: any[] = [];
  if (lastClose !== null) {
    markLineData.push({
      yAxis: lastClose,
      lineStyle: { color: lastPriceColor, type: 'dashed', width: 1 },
      label: {
        show: true, position: 'end', formatter: () => formatPrice(lastClose),
        backgroundColor: lastPriceColor, color: '#fff', fontSize: 10, padding: [2, 4], borderRadius: 2,
      },
    });
  }
  if (drawings && drawings.length > 0) {
    drawings.forEach((d) => {
      if (d.type === 'horizontal') {
        if (d.startPrice == null || !isFinite(d.startPrice)) return;
        const isSelected = d.id === selectedDrawingId;
        const color = isSelected ? '#ff9800' : '#26a69a';
        const width = isSelected ? 3 : 2;
        markLineData.push({
          yAxis: d.startPrice,
          lineStyle: { color: color, type: 'solid', width: width },
          label: {
            show: true, position: 'end', formatter: () => formatPrice(d.startPrice),
            backgroundColor: color, color: '#fff', fontSize: 10, padding: [2, 4], borderRadius: 2,
          },
        });
      }
    });
  }
  return markLineData;
}

/**
 * Build a merge-mode setOption patch that updates ONLY the drawing overlay and
 * the candle series markLine. Used for incremental drawing edits so the whole
 * chart (candles, indicators, axes, zoom) is not rebuilt on every mouse move.
 */
export function buildDrawingUpdatePatch(
  drawings: ChartDrawing[] | undefined,
  dates: string[],
  selectedDrawingId: string | null | undefined,
  lastClose: number | null,
  lastOpen: number | null,
  tc: ThemeColors,
): { series: echarts.SeriesOption[] } {
  const lastPriceColor =
    lastClose !== null && lastOpen !== null ? (lastClose >= lastOpen ? UP_COLOR : DOWN_COLOR) : tc.text;
  const markLineData = buildPriceMarkLineData(drawings, selectedDrawingId, lastClose, lastPriceColor);
  return {
    series: [
      {
        id: CANDLE_SERIES_ID,
        type: 'candlestick',
        markLine: { silent: true, symbol: 'none', data: markLineData },
      } as echarts.SeriesOption,
      ...buildDrawingsSeries(drawings, dates, selectedDrawingId, tc),
    ],
  };
}

export function buildOption(
  filtered: OHLCVData[],
  symbol: string,
  logScale = false,
  theme?: ThemeColors,
  signalEvents?: SignalEvent[],
  sigConfig?: SignalConfig,
  interval?: Interval,
  showWilliamsPasa = false,
  showNizamiCedid = false,
  showEMAOverlay = false,
  showPearsonChannels = false,
  showCMF = false,
  cmfResult: CMFResult | null = null,
  hoveredIndex: number | null = null,
  computed?: ComputedIndicators,
  panelHeights?: Record<string, number>,
  drawings?: ChartDrawing[],
  selectedDrawingId?: string | null,
  zoomStartValue?: number | null,
  zoomEndValue?: number | null,
): echarts.EChartsOption {
  const tc = theme ?? getThemeColors();
  const intradayMode = interval ? isIntraday(interval) : false;
  const rawDates = filtered.map((d) => d.date);
  const rawOhlc = filtered.map((d) => [d.open, d.close, d.low, d.high]);
  const rawVolumes = filtered.map((d) => ({
    value: d.volume,
    itemStyle: {
      color: d.close >= d.open ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)',
    },
  }));

  const padded = addPadding(rawDates, rawOhlc, rawVolumes, [], intradayMode);
  const dates = padded.dates;
  const ohlc = padded.ohlc;
  const volumes = padded.volumes;

  const total = dates.length;
  const dataTotal = filtered.length;
  const dataEnd = padded.offset + dataTotal;
  const rightPadBars = RIGHT_PAD_BARS;
  const visibleEnd = Math.min(dataEnd + rightPadBars, total);
  const dataStart = Math.max(padded.offset, visibleEnd - DEFAULT_VISIBLE_CANDLE_COUNT - rightPadBars);
  const zoomStart = (dataStart / total) * 100;
  const zoomEnd = (visibleEnd / total) * 100;
  const visibleStartValue = zoomStartValue ?? dataStart;
  const visibleEndValue = zoomEndValue ?? visibleEnd;
  const priceAxisExtent = computeVisiblePriceExtent(
    filtered,
    visibleStartValue,
    visibleEndValue,
    padded.offset,
    logScale,
  );

  const lastClose = filtered.length > 0 ? filtered[filtered.length - 1].close : null;
  const lastOpen = filtered.length > 0 ? filtered[filtered.length - 1].open : null;
  const lastPriceColor =
    lastClose !== null && lastOpen !== null ? (lastClose >= lastOpen ? UP_COLOR : DOWN_COLOR) : tc.text;

  let regimeAreas: any[] = [];
  if (showEMAOverlay && filtered.length > 21) {
    const closes = filtered.map((d) => d.close);
    regimeAreas = computeEMARegimeAreas(closes, rawDates, padded.offset, total);
  }

  const markLineData = buildPriceMarkLineData(drawings, selectedDrawingId, lastClose, lastPriceColor);


  // ECharts "large" candlestick mode auto-enables when the data length exceeds
  // largeThreshold (600) and collapses candle bodies into ~1px sticks. Daily
  // (~3650 bars) and weekly history crossed that threshold, so their candles
  // rendered as thin lines while monthly looked fine. Keep large mode OFF while
  // a readable number of candles is on screen (so bodies render properly), and
  // only turn it back on when so many candles are visible that bodies would be
  // hair-thin anyway — that restores the batched-render performance for the
  // zoomed-out case. The visible span is recomputed live on zoom in the
  // dataZoom handler.
  const visibleSpan = Math.abs(visibleEndValue - visibleStartValue);
  const useLargeMode = visibleSpan > LARGE_MODE_VISIBLE_THRESHOLD;

  const mainSeries: echarts.SeriesOption = {
    id: CANDLE_SERIES_ID,
    name: symbol,
    type: 'candlestick' as const,
    data: ohlc,
    large: useLargeMode,
    largeThreshold: 600,
    barWidth: '72%',
    barMinWidth: 4,
    barMaxWidth: 20,
    itemStyle: {
      color: UP_COLOR,
      color0: DOWN_COLOR,
      borderColor: UP_COLOR,
      borderColor0: DOWN_COLOR,
    },
    markArea: regimeAreas.length > 0 ? {
      silent: true,
      data: regimeAreas,
    } : undefined,
    markLine: markLineData.length > 0 ? {
      silent: true,
      symbol: 'none',
      data: markLineData,
    } : undefined,
  };

  const maxVol = filtered.reduce((m, d) => Math.max(m, d.volume), 0);
  const volAxisMax = maxVol * 10;

  // --- Dynamic panel layout ---
  const panelHeightsMap = panelHeights || {};
  const subPanels: string[] = [];
  if (showWilliamsPasa) subPanels.push('williams_pasa');
  if (showNizamiCedid) subPanels.push('nizami_cedid');
  if (showCMF) subPanels.push('cmf');
  const hasSubPanels = subPanels.length > 0;

  const panelBottoms: number[] = [];
  let currentBottom = 40;
  for (let i = 0; i < subPanels.length; i++) {
    panelBottoms.push(currentBottom);
    const h = panelHeightsMap[subPanels[i]] ?? 120;
    currentBottom += h + 10;
  }
  const mainBottom = hasSubPanels ? currentBottom + 10 : 50;

  const margins = getGridMargins();
  const grids: echarts.GridComponentOption[] = [{ left: margins.left, right: margins.right, top: 20, bottom: mainBottom, containLabel: false }];
  for (let i = 0; i < subPanels.length; i++) {
    const h = panelHeightsMap[subPanels[i]] ?? 120;
    grids.push({ left: margins.left, right: margins.right, bottom: panelBottoms[i], height: h, containLabel: false });
  }

  const allXAxisIndices = Array.from({ length: 1 + subPanels.length }, (_, i) => i);
  // Intraday xAxis label formatter
  const intradayLabelFormatter = intradayMode
    ? (value: string) => {
        if (!value || !value.includes(' ')) return value;
        const timePart = value.split(' ')[1]; // "HH:mm"
        if (interval === '1h') {
          // Show DD/MM HH:mm
          const datePart = value.split(' ')[0]; // "YYYY-MM-DD"
          const parts = datePart.split('-');
          return `${parts[2]}/${parts[1]} ${timePart}`;
        }
        return timePart; // 1m/5m/15m/30m → just "HH:mm"
      }
    : undefined;

  const xAxes: echarts.XAXisComponentOption[] = [
    {
      type: 'category',
      data: dates,
      boundaryGap: true,
      axisLine: { lineStyle: { color: tc.border } },
      axisLabel: {
        show: !hasSubPanels,
        color: tc.text,
        fontSize: 11,
        ...(intradayLabelFormatter ? { formatter: intradayLabelFormatter } : {}),
      },
      splitLine: { show: false },
      axisTick: { show: false },
      gridIndex: 0,
      axisPointer: {
        show: true,
        type: 'line',
        lineStyle: { color: tc.pointerLine, type: 'dashed' },
        label: { show: !hasSubPanels, backgroundColor: tc.tooltipBg, color: tc.tooltipText },
      },
    },
  ];
  for (let i = 0; i < subPanels.length; i++) {
    const isBottom = i === 0;
    xAxes.push({
      type: 'category',
      data: dates,
      boundaryGap: true,
      axisLine: { lineStyle: { color: tc.border } },
      axisLabel: isBottom
        ? { color: tc.text, fontSize: 10, ...(intradayLabelFormatter ? { formatter: intradayLabelFormatter } : {}) }
        : { show: false },
      splitLine: { show: false },
      axisTick: { show: false },
      gridIndex: i + 1,
      axisPointer: {
        show: true,
        type: 'line',
        lineStyle: { color: tc.pointerLine, type: 'dashed' },
        label: isBottom ? { backgroundColor: tc.tooltipBg, color: tc.tooltipText } : { show: false },
      },
    });
  }

  const yAxes: echarts.YAXisComponentOption[] = [
    {
      id: 'y-axis-price',
      type: logScale ? 'log' : 'value',
      scale: true,
      min: priceAxisExtent?.min,
      max: priceAxisExtent?.max,
      gridIndex: 0,
      position: 'right',
      splitLine: { lineStyle: { color: tc.border } },
      axisLine: { lineStyle: { color: tc.border } },
      axisLabel: { color: tc.text, fontSize: 11, formatter: (v: number) => formatPrice(v) },
      axisPointer: {
        show: true,
        type: 'line',
        lineStyle: { color: tc.pointerLine, type: 'dashed' },
        label: { backgroundColor: tc.tooltipBg, color: tc.tooltipText },
      },
    },
    {
      id: 'y-axis-volume',
      gridIndex: 0,
      position: 'right',
      min: 0,
      max: volAxisMax,
      splitNumber: 3,
      interval: maxVol > 0 ? maxVol / 2 : undefined,
      splitLine: { show: false },
      axisLine: { show: false },
      axisLabel: {
        show: true,
        inside: true,
        color: tc.text,
        fontSize: 10,
        formatter: (v: number) => {
          if (v === 0 || v > maxVol) return '';
          return formatVolume(v);
        },
      },
      axisTick: { show: false },
      axisPointer: { show: false },
    },
  ];

  const panelYAxisIdx: Record<string, number> = {};

  for (let i = 0; i < subPanels.length; i++) {
    const yIdx = 2 + i;
    panelYAxisIdx[subPanels[i]] = yIdx;
    const gridIdx = i + 1;

    if (subPanels[i] === 'williams_pasa') {
      yAxes.push({
        id: 'y-axis-williams_pasa',
        gridIndex: gridIdx,
        position: 'right',
        min: 0,
        max: 100,
        splitNumber: 2,
        splitLine: { lineStyle: { color: tc.border } },
        axisLine: { lineStyle: { color: tc.border } },
        axisLabel: { color: tc.text, fontSize: 10, formatter: (v: number) => `${Math.round(v)}` },
        axisPointer: {
          show: true,
          type: 'line',
          lineStyle: { color: tc.pointerLine, type: 'dashed' },
          label: { backgroundColor: tc.tooltipBg, color: tc.tooltipText, formatter: (p: any) => `${Math.round(Number(p.value))}` },
        },
      } as echarts.YAXisComponentOption);
    } else if (subPanels[i] === 'nizami_cedid') {
      yAxes.push({
        id: 'y-axis-nizami_cedid',
        gridIndex: gridIdx,
        position: 'right',
        scale: true,
        splitNumber: 3,
        splitLine: { lineStyle: { color: tc.border } },
        axisLine: { lineStyle: { color: tc.border } },
        axisLabel: {
          color: tc.text,
          fontSize: 10,
          formatter: (v: number) => formatIndicatorVal(v),
        },
        axisPointer: {
          show: true,
          type: 'line',
          lineStyle: { color: tc.pointerLine, type: 'dashed' },
          label: { backgroundColor: tc.tooltipBg, color: tc.tooltipText, formatter: (p: any) => formatIndicatorVal(Number(p.value)) },
        },
      } as echarts.YAXisComponentOption);
    } else if (subPanels[i] === 'cmf') {
      yAxes.push({
        id: 'y-axis-cmf',
        gridIndex: gridIdx,
        position: 'right',
        min: -0.5,
        max: 0.5,
        splitNumber: 2,
        splitLine: { lineStyle: { color: tc.border } },
        axisLine: { lineStyle: { color: tc.border } },
        axisLabel: { color: tc.text, fontSize: 10, formatter: (v: number) => v.toFixed(2) },
        axisPointer: {
          show: true,
          type: 'line',
          lineStyle: { color: tc.pointerLine, type: 'dashed' },
          label: { backgroundColor: tc.tooltipBg, color: tc.tooltipText, formatter: (p: any) => Number(p.value).toFixed(2) },
        },
      } as echarts.YAXisComponentOption);
    }
  }

  // --- Sub panel series ---
  const subSeries: echarts.SeriesOption[] = [];
  const pad = getLeftPanGutterCount(intradayMode);
  const padNull = new Array(pad).fill(null);

  // ── New Indicators Calculations ──
  const emaSeries: echarts.SeriesOption[] = [];
  if (showEMAOverlay && filtered.length > 5) {
    const closes = filtered.map((d) => d.close);
    const periods = [8, 13, 21, 34, 55, 89, 144, 233, 377, 610];
    const colors = [
      '#8A8E96', // EMA 8 (gray)
      '#af35a3', // EMA 13 (purple)
      '#FF9800', // EMA 21 (orange)
      '#00BCD4', // EMA 34 (cyan)
      '#2196F3', // EMA 55 (blue)
      '#E91E63', // EMA 89 (pink)
      '#00E676', // EMA 144 (lime)
      '#4CAF50', // EMA 233 (green)
      '#00C853', // EMA 377 (darker green)
      '#1B5E20', // EMA 610 (forest green)
    ];
    const widths = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5];

    periods.forEach((period, idx) => {
      if (closes.length >= period) {
        const emaVals = ema(closes, period);
        const emaPadded = [...padNull, ...emaVals, ...padNull];
        emaSeries.push({
          name: `EMA ${period}`,
          type: 'line',
          data: emaPadded,
          xAxisIndex: 0,
          yAxisIndex: 0,
          showSymbol: false,
          lineStyle: { color: colors[idx], width: widths[idx] },
          silent: true,
          z: 4,
          connectNulls: false,
          clip: true,
          sampling: 'average',
          tooltip: { show: false },
        });
      }
    });
  }

  const pearsonSeries: echarts.SeriesOption[] = [];
  const pearsonResults: any[] = [];
  if (showPearsonChannels && filtered.length > 21) {
    const closes = filtered.map((d) => d.close);
    const results = computeAllPearsonChannels(closes, DEFAULT_PEARSON_CONFIGS);
    results.forEach((res) => {
      pearsonResults.push(res);
      const cfg = DEFAULT_PEARSON_CONFIGS.find((c) => c.id === res.id);
      if (!cfg) return;

      const upData = new Array(total).fill(null);
      const dnData = new Array(total).fill(null);

      const startIdx = pad + res.startIndex;
      const endIdx = pad + res.endIndex;

      if (startIdx >= 0 && endIdx < total) {
        upData[startIdx] = res.A + res.rmse;
        upData[endIdx] = res.B + res.rmse;

        dnData[startIdx] = res.A - res.rmse;
        dnData[endIdx] = res.B - res.rmse;

        pearsonSeries.push({
          name: `${res.label} Üst`,
          type: 'line',
          data: upData,
          xAxisIndex: 0,
          yAxisIndex: 0,
          showSymbol: false,
          lineStyle: { color: cfg.color, width: cfg.width },
          connectNulls: true,
          silent: true,
          z: 5,
          clip: true,
          label: {
            show: true,
            formatter: `${res.p}`,
            fontSize: 9,
            color: cfg.color,
            position: 'left',
          },
          tooltip: { show: false },
        });

        pearsonSeries.push({
          name: `${res.label} Alt`,
          type: 'line',
          data: dnData,
          xAxisIndex: 0,
          yAxisIndex: 0,
          showSymbol: false,
          lineStyle: { color: cfg.color, width: cfg.width },
          connectNulls: true,
          silent: true,
          z: 5,
          clip: true,
          tooltip: { show: false },
        });

        if (cfg.centerColor) {
          const midData = new Array(total).fill(null);
          midData[startIdx] = res.A;
          midData[endIdx] = res.B;
          pearsonSeries.push({
            name: `${res.label} Orta`,
            type: 'line',
            data: midData,
            xAxisIndex: 0,
            yAxisIndex: 0,
            showSymbol: false,
            lineStyle: { color: cfg.centerColor, width: 1, type: 'dashed' },
            connectNulls: true,
            silent: true,
            z: 5,
            clip: true,
            tooltip: { show: false },
          });
        }
      }
    });
  }




  // Williams Paşa sub panel
  if (showWilliamsPasa && filtered.length > 260) {
    const wpGridIdx = subPanels.indexOf('williams_pasa') + 1;
    const wpYIdx = panelYAxisIdx['williams_pasa'];
    const highs = filtered.map((d) => d.high);
    const lows = filtered.map((d) => d.low);
    const closes = filtered.map((d) => d.close);
    const length = sigConfig?.williamsPasa?.length ?? 260;
    const emaLen = sigConfig?.williamsPasa?.emaLen ?? 260;
    const wpResult = computed?.williamsPasa || computeWilliamsPasa(highs, lows, closes, length, emaLen);

    const rPadded = [...padNull, ...wpResult.percentR, ...padNull];
    const emaPadded = [...padNull, ...wpResult.emaWil, ...padNull];

    subSeries.push(
      {
        name: 'Williams Paşa %R',
        type: 'line',
        data: rPadded,
        xAxisIndex: wpGridIdx,
        yAxisIndex: wpYIdx,
        showSymbol: false,
        lineStyle: { color: '#7E57C2', width: 2 },
        z: 5,
        clip: true,
        sampling: 'average',
        tooltip: { show: false },
        markLine: {
          silent: true,
          symbol: 'none',
          data: [
            {
              yAxis: 98,
              lineStyle: { color: 'rgba(239,83,80,0.6)', type: 'dashed' as const, width: 1 },
              label: { show: true, position: 'insideEndTop' as const, formatter: '98', fontSize: 9, color: '#ef5350' },
            },
            {
              yAxis: 5,
              lineStyle: { color: 'rgba(38,166,154,0.6)', type: 'dashed' as const, width: 1 },
              label: { show: true, position: 'insideEndBottom' as const, formatter: '5', fontSize: 9, color: '#26a69a' },
            },
            { yAxis: 50, lineStyle: { color: 'rgba(255,193,7,0.4)', type: 'dotted' as const, width: 1 } },
          ],
        },
        markArea: {
          silent: true,
          data: [
            [{ yAxis: 5, itemStyle: { color: 'rgba(126, 87, 194, 0.08)' } }, { yAxis: 98 }],
          ] as unknown as echarts.MarkAreaComponentOption['data'],
        },
      },
      {
        name: 'EMA %R',
        type: 'line',
        data: emaPadded,
        xAxisIndex: wpGridIdx,
        yAxisIndex: wpYIdx,
        showSymbol: false,
        lineStyle: { color: '#FF9800', width: 1.5, type: 'dashed' },
        z: 5,
        clip: true,
        sampling: 'average',
        tooltip: { show: false },
      }
    );
  }

  // Nizami Cedid sub panel
  if (showNizamiCedid && filtered.length > 260) {
    const ncGridIdx = subPanels.indexOf('nizami_cedid') + 1;
    const ncYIdx = panelYAxisIdx['nizami_cedid'];
    const closes = filtered.map((d) => d.close);
    const vols = filtered.map((d) => d.volume);
    const fast = sigConfig?.nizamiCedid?.fast ?? 120;
    const slow = sigConfig?.nizamiCedid?.slow ?? 260;
    const signalLen = sigConfig?.nizamiCedid?.signalLen ?? 50;
    const vwmaLen = sigConfig?.nizamiCedid?.vwmaLen ?? 185;
    const ncResult = computed?.nizamiCedid || computeNizamiCedid(closes, vols, fast, slow, signalLen, vwmaLen);

    const macdPadded = [...padNull, ...ncResult.macd, ...padNull];
    const signalPadded = [...padNull, ...ncResult.signal, ...padNull];
    const emacdPadded = [...padNull, ...ncResult.emacd, ...padNull];

    subSeries.push(
      {
        name: 'NC MACD',
        type: 'line',
        data: macdPadded,
        xAxisIndex: ncGridIdx,
        yAxisIndex: ncYIdx,
        showSymbol: false,
        lineStyle: { color: '#2196F3', width: 2 },
        z: 5,
        clip: true,
        sampling: 'average',
        tooltip: { show: false },
      },
      {
        name: 'NC Sinyal',
        type: 'line',
        data: signalPadded,
        xAxisIndex: ncGridIdx,
        yAxisIndex: ncYIdx,
        showSymbol: false,
        lineStyle: { color: '#FF6D00', width: 2 },
        z: 5,
        clip: true,
        sampling: 'average',
        tooltip: { show: false },
      },
      {
        name: 'NC eMACD',
        type: 'line',
        data: emacdPadded,
        xAxisIndex: ncGridIdx,
        yAxisIndex: ncYIdx,
        showSymbol: false,
        lineStyle: { color: '#4CAF50', width: 4.5 },
        z: 5,
        clip: true,
        sampling: 'average',
        tooltip: { show: false },
      },
      {
        name: 'NC Zero',
        type: 'line',
        data: new Array(total).fill(0),
        xAxisIndex: ncGridIdx,
        yAxisIndex: ncYIdx,
        showSymbol: false,
        lineStyle: { color: '#787B86', width: 1, type: 'dashed' },
        z: 2,
        silent: true,
        tooltip: { show: false },
      }
    );
  }

  // Chaikin Money Flow (CMF) sub panel
  const cmfSrc = computed?.cmf || (cmfResult ? {
    cmf: cmfResult.cmf,
    ema130: ema(cmfResult.cmf, 130),
    ema260: ema(cmfResult.cmf, 260)
  } : null);

  if (showCMF && cmfSrc && filtered.length > 20) {
    const cmfGridIdx = subPanels.indexOf('cmf') + 1;
    const cmfYIdx = panelYAxisIdx['cmf'];
    const cmfPadded = [...padNull, ...cmfSrc.cmf, ...padNull];

    const ema130Padded = [...padNull, ...cmfSrc.ema130, ...padNull];
    const ema260Padded = [...padNull, ...cmfSrc.ema260, ...padNull];

    // Split CMF into positive and negative sets for transparent area gradients
    const cmfPos = cmfPadded.map((v) => (v !== null && v > 0 ? v : 0));
    const cmfNeg = cmfPadded.map((v) => (v !== null && v < 0 ? v : 0));

    subSeries.push(
      {
        name: 'CMF Pos Area',
        type: 'line',
        data: cmfPos,
        xAxisIndex: cmfGridIdx,
        yAxisIndex: cmfYIdx,
        showSymbol: false,
        lineStyle: { width: 0 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(38, 166, 154, 0.25)' },
            { offset: 1, color: 'rgba(38, 166, 154, 0.01)' }
          ])
        },
        z: 2,
        clip: true,
        sampling: 'average',
        tooltip: { show: false },
      },
      {
        name: 'CMF Neg Area',
        type: 'line',
        data: cmfNeg,
        xAxisIndex: cmfGridIdx,
        yAxisIndex: cmfYIdx,
        showSymbol: false,
        lineStyle: { width: 0 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(239, 83, 80, 0.01)' },
            { offset: 1, color: 'rgba(239, 83, 80, 0.25)' }
          ])
        },
        z: 2,
        clip: true,
        sampling: 'average',
        tooltip: { show: false },
      },
      {
        name: 'CMF (20)',
        type: 'line',
        data: cmfPadded,
        xAxisIndex: cmfGridIdx,
        yAxisIndex: cmfYIdx,
        showSymbol: false,
        lineStyle: { color: '#9c27b0', width: 2 },
        z: 3,
        clip: true,
        sampling: 'average',
        tooltip: { show: false },
        markLine: {
          silent: true,
          symbol: 'none',
          data: [
            {
              yAxis: 0.20,
              lineStyle: { color: 'rgba(38,166,154,0.6)', type: 'dashed' as const, width: 1 },
              label: { show: true, position: 'insideEndTop' as const, formatter: '0.20', fontSize: 9, color: '#26a69a' },
            },
            {
              yAxis: -0.20,
              lineStyle: { color: 'rgba(239,83,80,0.6)', type: 'dashed' as const, width: 1 },
              label: { show: true, position: 'insideEndBottom' as const, formatter: '-0.20', fontSize: 9, color: '#ef5350' },
            },
            {
              yAxis: 0,
              lineStyle: { color: tc.border, type: 'solid' as const, width: 1.2 },
            },
          ],
        },
      },
      {
        name: 'CMF EMA 130',
        type: 'line',
        data: ema130Padded,
        xAxisIndex: cmfGridIdx,
        yAxisIndex: cmfYIdx,
        showSymbol: false,
        lineStyle: { color: '#FF9800', width: 1.2 },
        z: 4,
        clip: true,
        sampling: 'average',
        tooltip: { show: false },
      },
      {
        name: 'CMF EMA 260',
        type: 'line',
        data: ema260Padded,
        xAxisIndex: cmfGridIdx,
        yAxisIndex: cmfYIdx,
        showSymbol: false,
        lineStyle: { color: '#00e5ff', width: 1.2 },
        z: 4,
        clip: true,
        sampling: 'average',
        tooltip: { show: false },
      }
    );
  }

  const drawingsSeries = buildDrawingsSeries(drawings, dates, selectedDrawingId, tc);

  return {
    animation: false,
    backgroundColor: tc.bg,
    grid: grids,
    xAxis: xAxes as echarts.EChartsOption['xAxis'],
    yAxis: yAxes as echarts.EChartsOption['yAxis'],
    dataZoom: [
      {
        type: 'inside',
        filterMode: 'none',
        xAxisIndex: allXAxisIndices,
        start: (zoomStartValue !== undefined && zoomStartValue !== null) ? undefined : zoomStart,
        end: (zoomEndValue !== undefined && zoomEndValue !== null) ? undefined : zoomEnd,
        startValue: (zoomStartValue !== undefined && zoomStartValue !== null) ? zoomStartValue : undefined,
        endValue: (zoomEndValue !== undefined && zoomEndValue !== null) ? zoomEndValue : undefined,
        zoomOnMouseWheel: true,
        moveOnMouseMove: false,
        moveOnMouseWheel: false,
        preventDefaultMouseMove: false,
      },
      {
        type: 'slider',
        filterMode: 'none',
        xAxisIndex: allXAxisIndices,
        start: (zoomStartValue !== undefined && zoomStartValue !== null) ? undefined : zoomStart,
        end: (zoomEndValue !== undefined && zoomEndValue !== null) ? undefined : zoomEnd,
        startValue: (zoomStartValue !== undefined && zoomStartValue !== null) ? zoomStartValue : undefined,
        endValue: (zoomEndValue !== undefined && zoomEndValue !== null) ? zoomEndValue : undefined,
        bottom: 8,
        height: 20,
        borderColor: tc.border,
        backgroundColor: tc.sliderBg,
        dataBackground: { lineStyle: { color: 'transparent' }, areaStyle: { color: 'transparent' } },
        selectedDataBackground: { lineStyle: { color: 'transparent' }, areaStyle: { color: 'rgba(41,98,255,0.08)' } },
        fillerColor: 'rgba(41,98,255,0.15)',
        handleStyle: { color: '#404555', borderColor: '#606580' },
        textStyle: { color: tc.text, fontSize: 10 },
      },
    ],
    tooltip: { show: false },
    axisPointer: {
      show: true,
      link: [{ xAxisIndex: allXAxisIndices }],
      label: { backgroundColor: tc.tooltipBg, color: tc.tooltipText },
    },
    graphic:
      showPearsonChannels && pearsonResults.length > 0
        ? [buildPearsonTable(pearsonResults, tc, mainBottom + 10)]
        : undefined,
    series: [
      { ...mainSeries, xAxisIndex: 0, yAxisIndex: 0 },
      {
        name: 'Volume',
        type: 'bar',
        data: volumes,
        xAxisIndex: 0,
        yAxisIndex: 1,
        barWidth: '72%',
        barMinWidth: 3,
        z: 1,
        tooltip: { show: false },
      },
      // ── Signal scatter markers (4-directional) ──
      ...(signalEvents && signalEvents.length > 0
        ? (() => {
            const pad = getLeftPanGutterCount(intradayMode);
            const longEntryPts: SignalPoint[] = [];
            const longExitPts: SignalPoint[] = [];
            const shortEntryPts: SignalPoint[] = [];
            const shortExitPts: SignalPoint[] = [];
            // Fallback: events without positionAction use old bullish/bearish logic
            const buyPoints: SignalPoint[] = [];
            const sellPoints: SignalPoint[] = [];
            for (const ev of signalEvents) {
              const catIdx = pad + ev.barIndex;
              if (catIdx >= 0 && catIdx < total) {
                const pt: SignalPoint = { value: [catIdx, ev.entryPrice] };
                if (ev.positionAction === 'long-entry') longEntryPts.push(pt);
                else if (ev.positionAction === 'long-exit') longExitPts.push(pt);
                else if (ev.positionAction === 'short-entry') shortEntryPts.push(pt);
                else if (ev.positionAction === 'short-exit') shortExitPts.push(pt);
                else if (ev.signalType === 'bullish') buyPoints.push(pt);
                else sellPoints.push(pt);
              }
            }
            const ORANGE = '#ff9800';
            const BLUE = '#2196F3';
            const series: echarts.SeriesOption[] = [];
            // Long Entry: green triangle up
            if (longEntryPts.length > 0 || buyPoints.length > 0)
              series.push({
                name: 'Uzun Giris',
                type: 'scatter' as const,
                data: [...longEntryPts, ...buyPoints],
                xAxisIndex: 0,
                yAxisIndex: 0,
                symbol: 'triangle',
                symbolSize: 14,
                symbolOffset: [0, 10],
                itemStyle: { color: UP_COLOR, borderColor: '#fff', borderWidth: 1 },
                z: 20,
                silent: true,
                tooltip: { show: false },
              });
            // Long Exit: red triangle down
            if (longExitPts.length > 0 || sellPoints.length > 0)
              series.push({
                name: 'Uzun Cikis',
                type: 'scatter' as const,
                data: [...longExitPts, ...sellPoints],
                xAxisIndex: 0,
                yAxisIndex: 0,
                symbol: 'path://M0,0 L10,0 L5,10 Z',
                symbolSize: 14,
                symbolOffset: [0, -10],
                itemStyle: { color: DOWN_COLOR, borderColor: '#fff', borderWidth: 1 },
                z: 20,
                silent: true,
                tooltip: { show: false },
              });
            // Short Entry: orange diamond
            if (shortEntryPts.length > 0)
              series.push({
                name: 'Kisa Giris',
                type: 'scatter' as const,
                data: shortEntryPts,
                xAxisIndex: 0,
                yAxisIndex: 0,
                symbol: 'diamond',
                symbolSize: 14,
                symbolOffset: [0, -10],
                itemStyle: { color: ORANGE, borderColor: '#fff', borderWidth: 1 },
                z: 20,
                silent: true,
                tooltip: { show: false },
              });
            // Short Exit: blue diamond
            if (shortExitPts.length > 0)
              series.push({
                name: 'Kisa Cikis',
                type: 'scatter' as const,
                data: shortExitPts,
                xAxisIndex: 0,
                yAxisIndex: 0,
                symbol: 'diamond',
                symbolSize: 14,
                symbolOffset: [0, 10],
                itemStyle: { color: BLUE, borderColor: '#fff', borderWidth: 1 },
                z: 20,
                silent: true,
                tooltip: { show: false },
              });
            return series;
          })()
        : []),
      ...emaSeries,
      ...pearsonSeries,
      ...subSeries,
      ...drawingsSeries,
    ],
  };
}

export function buildTitlesOption(
  filtered: OHLCVData[],
  subPanels: string[],
  panelBottoms: number[],
  activeIdx: number,
  showWilliamsPasa: boolean,
  showNizamiCedid: boolean,
  showCMF: boolean,
  sigConfig?: SignalConfig,
  themeColors?: ThemeColors,
  computed?: ComputedIndicators,
): echarts.TitleComponentOption[] {
  if (!filtered || filtered.length === 0 || activeIdx < 0 || activeIdx >= filtered.length) {
    return [];
  }

  const tc = themeColors ?? getThemeColors();
  const titles: echarts.TitleComponentOption[] = [];
  const margins = getGridMargins();
  const titleLeft = margins.left + 5;

  const closes = filtered.map((d) => d.close);
  const highs = filtered.map((d) => d.high);
  const lows = filtered.map((d) => d.low);
  const vols = filtered.map((d) => d.volume);

  subPanels.forEach((panel, i) => {
    const bottom = panelBottoms[i] + 98; // grid height is 120, grid top is bottom+120. Positioning text at bottom+98 leaves 22px height from the top.
    let text = '';
    let rich: Record<string, any> = {};

    if (panel === 'williams_pasa' && showWilliamsPasa && filtered.length > 260) {
      const length = sigConfig?.williamsPasa?.length ?? 260;
      const emaLen = sigConfig?.williamsPasa?.emaLen ?? 260;
      const wpResult = computeWilliamsPasa(highs, lows, closes, length, emaLen);
      const rVal = wpResult.percentR[activeIdx];
      const emaVal = wpResult.emaWil[activeIdx];
      
      const rStr = rVal !== null && rVal !== undefined ? rVal.toFixed(2) : '--';
      const eStr = emaVal !== null && emaVal !== undefined ? emaVal.toFixed(2) : '--';
      
      text = `{name|Williams Paşa %R(${length})}  {val|%R: ${rStr}}  {ema|EMA(${emaLen}): ${eStr}}`;
      rich = {
        name: { color: '#7E57C2', fontWeight: 'bold', fontSize: 11 },
        val: { color: '#7E57C2', fontSize: 11 },
        ema: { color: '#FF9800', fontSize: 11 },
      };
    }
    else if (panel === 'nizami_cedid' && showNizamiCedid && filtered.length > 260) {
      const fast = sigConfig?.nizamiCedid?.fast ?? 120;
      const slow = sigConfig?.nizamiCedid?.slow ?? 260;
      const signalLen = sigConfig?.nizamiCedid?.signalLen ?? 50;
      const vwmaLen = sigConfig?.nizamiCedid?.vwmaLen ?? 185;
      const ncResult = computeNizamiCedid(closes, vols, fast, slow, signalLen, vwmaLen);
      const macdVal = ncResult.macd[activeIdx];
      const sigVal = ncResult.signal[activeIdx];
      const emacdVal = ncResult.emacd[activeIdx];
      
      const mStr = macdVal !== null && macdVal !== undefined ? macdVal.toFixed(2) : '--';
      const sStr = sigVal !== null && sigVal !== undefined ? sigVal.toFixed(2) : '--';
      const eStr = emacdVal !== null && emacdVal !== undefined ? emacdVal.toFixed(2) : '--';
      
      text = `{name|Nizami Cedid}  {macd|MACD: ${mStr}}  {sig|Sinyal: ${sStr}}  {emacd|eMACD: ${eStr}}`;
      rich = {
        name: { color: '#2196F3', fontWeight: 'bold', fontSize: 11 },
        macd: { color: '#2196F3', fontSize: 11 },
        sig: { color: '#FF6D00', fontSize: 11 },
        emacd: { color: '#4CAF50', fontSize: 11 },
      };
    }
    else if (panel === 'cmf' && showCMF && filtered.length > 20) {
      const cmfVal = computed?.cmf?.cmf[activeIdx] ?? (computeCMF(highs, lows, closes, vols, 20).cmf[activeIdx]);
      const cVal = cmfVal !== null && cmfVal !== undefined ? cmfVal.toFixed(4) : '--';

      let e130Val = null;
      let e260Val = null;

      if (computed?.cmf) {
        e130Val = computed.cmf.ema130[activeIdx];
        e260Val = computed.cmf.ema260[activeIdx];
      } else {
        const fullCmf = computeCMF(highs, lows, closes, vols, 20).cmf;
        e130Val = ema(fullCmf, 130)[activeIdx];
        e260Val = ema(fullCmf, 260)[activeIdx];
      }

      const e130Str = e130Val !== null && e130Val !== undefined ? e130Val.toFixed(4) : '--';
      const e260Str = e260Val !== null && e260Val !== undefined ? e260Val.toFixed(4) : '--';

      text = `{name|CMF(20)}  {cmf|CMF: ${cVal}}  {ema130|EMA(130): ${e130Str}}  {ema260|EMA(260): ${e260Str}}`;
      rich = {
        name: { color: '#9c27b0', fontWeight: 'bold', fontSize: 11 },
        cmf: { color: '#9c27b0', fontSize: 11 },
        ema130: { color: '#FF9800', fontSize: 11 },
        ema260: { color: '#00e5ff', fontSize: 11 },
      };
    }

    if (text) {
      titles.push({
        text,
        bottom,
        left: titleLeft,
        textStyle: {
          color: tc.tooltipText,
          fontSize: 11,
          fontFamily: 'sans-serif',
          fontWeight: 'normal',
          rich,
        },
      });
    }
  });

  return titles;
}

export function getPanelTitleHTML(
  panel: string,
  activeIdx: number,
  filtered: OHLCVData[],
  computed: ComputedIndicators,
  sigConfig: SignalConfig | undefined,
  tc: ThemeColors
): string {
  if (!filtered || filtered.length === 0 || activeIdx < 0 || activeIdx >= filtered.length) {
    return '';
  }

  const closes = filtered.map((d) => d.close);
  const highs = filtered.map((d) => d.high);
  const lows = filtered.map((d) => d.low);
  const vols = filtered.map((d) => d.volume);

  if (panel === 'williams_pasa' && filtered.length > 260) {
    const length = sigConfig?.williamsPasa?.length ?? 260;
    const emaLen = sigConfig?.williamsPasa?.emaLen ?? 260;
    
    let rVal: number | null = null;
    let emaVal: number | null = null;
    
    if (computed.williamsPasa) {
      rVal = computed.williamsPasa.percentR[activeIdx];
      emaVal = computed.williamsPasa.emaWil[activeIdx];
    } else {
      const res = computeWilliamsPasa(highs, lows, closes, length, emaLen);
      rVal = res.percentR[activeIdx];
      emaVal = res.emaWil[activeIdx];
    }
    
    const rStr = rVal !== null && rVal !== undefined ? rVal.toFixed(2) : '--';
    const eStr = emaVal !== null && emaVal !== undefined ? emaVal.toFixed(2) : '--';
    
    return `<span style="color: #7E57C2; font-weight: bold; margin-right: 8px;">Williams Paşa %R(${length})</span>` +
           `<span style="color: #7E57C2; margin-right: 8px;">%R: ${rStr}</span>` +
           `<span style="color: #FF9800;">EMA(${emaLen}): ${eStr}</span>`;
  }
  
  if (panel === 'nizami_cedid' && filtered.length > 260) {
    const fast = sigConfig?.nizamiCedid?.fast ?? 120;
    const slow = sigConfig?.nizamiCedid?.slow ?? 260;
    const signalLen = sigConfig?.nizamiCedid?.signalLen ?? 50;
    const vwmaLen = sigConfig?.nizamiCedid?.vwmaLen ?? 185;
    
    let macdVal: number | null = null;
    let sigVal: number | null = null;
    let emacdVal: number | null = null;
    
    if (computed.nizamiCedid) {
      macdVal = computed.nizamiCedid.macd[activeIdx];
      sigVal = computed.nizamiCedid.signal[activeIdx];
      emacdVal = computed.nizamiCedid.emacd[activeIdx];
    } else {
      const res = computeNizamiCedid(closes, vols, fast, slow, signalLen, vwmaLen);
      macdVal = res.macd[activeIdx];
      sigVal = res.signal[activeIdx];
      emacdVal = res.emacd[activeIdx];
    }
    
    const mStr = macdVal !== null && macdVal !== undefined ? macdVal.toFixed(2) : '--';
    const sStr = sigVal !== null && sigVal !== undefined ? sigVal.toFixed(2) : '--';
    const eStr = emacdVal !== null && emacdVal !== undefined ? emacdVal.toFixed(2) : '--';
    
    return `<span style="color: #2196F3; font-weight: bold; margin-right: 8px;">Nizami Cedid</span>` +
           `<span style="color: #2196F3; margin-right: 8px;">MACD: ${mStr}</span>` +
           `<span style="color: #FF6D00; margin-right: 8px;">Sinyal: ${sStr}</span>` +
           `<span style="color: #4CAF50;">eMACD: ${eStr}</span>`;
  }
  
  if (panel === 'cmf' && filtered.length > 20) {
    let cmfVal: number | null = null;
    let e130Val: number | null = null;
    let e260Val: number | null = null;
    
    if (computed.cmf) {
      cmfVal = computed.cmf.cmf[activeIdx];
      e130Val = computed.cmf.ema130[activeIdx];
      e260Val = computed.cmf.ema260[activeIdx];
    } else {
      const cmfResult = computeCMF(highs, lows, closes, vols, 20);
      cmfVal = cmfResult.cmf[activeIdx];
      e130Val = ema(cmfResult.cmf, 130)[activeIdx];
      e260Val = ema(cmfResult.cmf, 260)[activeIdx];
    }
    
    const cVal = cmfVal !== null && cmfVal !== undefined ? cmfVal.toFixed(4) : '--';
    const e130Str = e130Val !== null && e130Val !== undefined ? e130Val.toFixed(4) : '--';
    const e260Str = e260Val !== null && e260Val !== undefined ? e260Val.toFixed(4) : '--';
    
    return `<span style="color: #9c27b0; font-weight: bold; margin-right: 8px;">CMF(20)</span>` +
           `<span style="color: #9c27b0; margin-right: 8px;">CMF: ${cVal}</span>` +
           `<span style="color: #FF9800; margin-right: 8px;">EMA(130): ${e130Str}</span>` +
           `<span style="color: #00e5ff;">EMA(260): ${e260Str}</span>`;
  }

  return '';
}

