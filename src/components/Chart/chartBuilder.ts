import * as echarts from 'echarts';
import type { OHLCVData } from '../../api/borsaApi';
import type { Interval } from './types';
import { isIntraday } from './types';
import { formatPrice, formatVolume } from '../../utils/formatters';
import { computeAllBollingerOverlays, DEFAULT_BOLLINGER_CONFIGS } from '../../utils/regressionChannels';
import {
  computeRSI,
  computeMACD,
  computeStochRSI,
  computeOBV,
  computeSuperTrend,
  computeIchimoku,
  computeWilliamsPasa,
  computeNizamiCedid,
  ema,
  computeCMF,
} from '../../utils/indicators';
import type { SignalConfig, SignalEvent } from '../../utils/signalDetection';
import { computeAllPearsonChannels, DEFAULT_PEARSON_CONFIGS } from '../../utils/pearsonChannels';
import type { CMFResult } from '../../utils/indicators';


export interface ComputedIndicators {
  rsi?: (number | null)[];
  macd?: {
    macd: (number | null)[];
    signal: (number | null)[];
    histogram: (number | null)[];
  };
  stochRsi?: {
    k: (number | null)[];
    d: (number | null)[];
  };
  obv?: {
    obv: (number | null)[];
    obvEma: (number | null)[];
  };
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
    ema34: (number | null)[];
    ema68: (number | null)[];
    ema130: (number | null)[];
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

export function getPaddingCount(dataLen: number, intradayMode = false): number {
  if (intradayMode) return Math.min(40, Math.max(20, Math.floor(dataLen * 0.1)));
  return Math.min(200, Math.max(50, Math.floor(dataLen * 0.2)));
}

function generateFutureDates(lastDate: string, count: number): string[] {
  const result: string[] = [];
  if (!lastDate) return new Array(count).fill('');
  // Handle intraday dates like "2024-01-15 09:30"
  const hasTime = lastDate.includes(' ');
  const dateForParse = hasTime ? lastDate.replace(' ', 'T') + ':00' : lastDate + 'T00:00:00';
  const d = new Date(dateForParse);
  if (isNaN(d.getTime())) return new Array(count).fill('');
  for (let i = 1; i <= count; i++) {
    const next = new Date(d);
    if (hasTime) {
      next.setMinutes(d.getMinutes() + i * 5);
    } else {
      next.setDate(d.getDate() + i);
      while (next.getDay() === 0 || next.getDay() === 6) {
        next.setDate(next.getDate() + 1);
      }
    }
    d.setTime(next.getTime());
    const yyyy = next.getFullYear();
    const mm = String(next.getMonth() + 1).padStart(2, '0');
    const dd = String(next.getDate()).padStart(2, '0');
    if (hasTime) {
      const hh = String(next.getHours()).padStart(2, '0');
      const min = String(next.getMinutes()).padStart(2, '0');
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

export function addPadding(
  dates: string[],
  ohlcArr: unknown[],
  volumeArr: unknown[],
  closeArr: (number | null)[],
  intradayMode = false,
) {
  const pad = getPaddingCount(dates.length, intradayMode);
  const padBefore = new Array(pad).fill('');
  const lastDate = dates.length > 0 ? dates[dates.length - 1] : '';
  const padAfter = generateFutureDates(lastDate, pad);

  return {
    dates: [...padBefore, ...dates, ...padAfter],
    ohlc: [...new Array(pad).fill(EMPTY_OHLC), ...ohlcArr, ...new Array(pad).fill(EMPTY_OHLC)],
    volumes: [...new Array(pad).fill(EMPTY_VOL), ...volumeArr, ...new Array(pad).fill(EMPTY_VOL)],
    close: [...new Array(pad).fill(null), ...closeArr, ...new Array(pad).fill(null)],
    offset: pad,
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
    } else if (Math.abs(currentScore - score) > 0.03) {
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
  const isMobile =
    typeof window !== 'undefined' &&
    (window.innerWidth < 768 || window.matchMedia('(pointer: coarse)').matches);
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
  const isMobile =
    typeof window !== 'undefined' &&
    (window.innerWidth < 768 || window.matchMedia('(pointer: coarse)').matches);
  return {
    left: isMobile ? 10 : 15,
    right: isMobile ? 32 : 55,
  };
}

export function buildOption(
  filtered: OHLCVData[],
  symbol: string,
  showBollinger = false,
  visibleBollinger?: Set<string>,
  showRSI = false,
  showMACD = false,
  showStochRSI = false,
  logScale = false,
  theme?: ThemeColors,
  signalEvents?: SignalEvent[],
  sigConfig?: SignalConfig,
  showSuperTrend = false,
  showIchimoku = false,
  showOBV = false,
  interval?: Interval,
  showWilliamsPasa = false,
  showNizamiCedid = false,
  showEMAOverlay = false,
  showPearsonChannels = false,
  showCMF = false,
  cmfResult: CMFResult | null = null,
  hoveredIndex: number | null = null,
  computed?: ComputedIndicators,
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
  const rightPadBars = 120;
  const visibleEnd = Math.min(dataEnd + rightPadBars, total);
  const dataStart = Math.max(padded.offset, visibleEnd - 120 - rightPadBars);
  const zoomStart = (dataStart / total) * 100;
  const zoomEnd = (visibleEnd / total) * 100;

  const lastClose = filtered.length > 0 ? filtered[filtered.length - 1].close : null;
  const lastOpen = filtered.length > 0 ? filtered[filtered.length - 1].open : null;
  const lastPriceColor =
    lastClose !== null && lastOpen !== null ? (lastClose >= lastOpen ? UP_COLOR : DOWN_COLOR) : tc.text;

  let regimeAreas: any[] = [];
  if (showEMAOverlay && filtered.length > 21) {
    const closes = filtered.map((d) => d.close);
    regimeAreas = computeEMARegimeAreas(closes, rawDates, padded.offset, total);
  }

  const mainSeries: echarts.SeriesOption = {
    name: symbol,
    type: 'candlestick' as const,
    data: ohlc,
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
    markLine:
      lastClose !== null
        ? {
            silent: true,
            symbol: 'none',
            lineStyle: { color: lastPriceColor, type: 'dashed', width: 1 },
            label: {
              show: true,
              position: 'end',
              formatter: () => formatPrice(lastClose),
              backgroundColor: lastPriceColor,
              color: '#fff',
              fontSize: 10,
              padding: [2, 4],
              borderRadius: 2,
            },
            data: [{ yAxis: lastClose }],
          }
        : undefined,
  };

  const maxVol = filtered.reduce((m, d) => Math.max(m, d.volume), 0);
  const volAxisMax = maxVol * 10;

  // --- Dynamic panel layout ---
  const panelHeight = 120;
  const subPanels: string[] = [];
  if (showRSI) subPanels.push('rsi');
  if (showMACD) subPanels.push('macd');
  if (showStochRSI) subPanels.push('stochRsi');
  if (showOBV) subPanels.push('obv');
  if (showWilliamsPasa) subPanels.push('williams_pasa');
  if (showNizamiCedid) subPanels.push('nizami_cedid');
  if (showCMF) subPanels.push('cmf');
  const hasSubPanels = subPanels.length > 0;

  const panelBottoms: number[] = [];
  for (let i = 0; i < subPanels.length; i++) {
    panelBottoms.push(40 + i * (panelHeight + 10));
  }
  const mainBottom = hasSubPanels ? panelBottoms[panelBottoms.length - 1] + panelHeight + 20 : 50;

  const margins = getGridMargins();
  const grids: echarts.GridComponentOption[] = [{ left: margins.left, right: margins.right, top: 20, bottom: mainBottom, containLabel: false }];
  for (let i = 0; i < subPanels.length; i++) {
    grids.push({ left: margins.left, right: margins.right, bottom: panelBottoms[i], height: panelHeight, containLabel: false });
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

    if (subPanels[i] === 'rsi') {
      yAxes.push({
        id: 'y-axis-rsi',
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
          label: { backgroundColor: tc.tooltipBg, color: tc.tooltipText, formatter: (p: any) => `${Math.round(p.value)}` },
        },
      } as echarts.YAXisComponentOption);
    } else if (subPanels[i] === 'macd') {
      yAxes.push({
        id: 'y-axis-macd',
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
    } else if (subPanels[i] === 'obv') {
      yAxes.push({
        id: 'y-axis-obv',
        gridIndex: gridIdx,
        position: 'right',
        scale: true,
        splitNumber: 3,
        splitLine: { lineStyle: { color: tc.border } },
        axisLine: { lineStyle: { color: tc.border } },
        axisLabel: {
          color: tc.text,
          fontSize: 10,
          formatter: (v: number) => formatVolume(v),
        },
        axisPointer: {
          show: true,
          type: 'line',
          lineStyle: { color: tc.pointerLine, type: 'dashed' },
          label: { backgroundColor: tc.tooltipBg, color: tc.tooltipText, formatter: (p: any) => formatVolume(Number(p.value)) },
        },
      } as echarts.YAXisComponentOption);
    } else if (subPanels[i] === 'stochRsi') {
      yAxes.push({
        id: 'y-axis-stochRsi',
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
    } else if (subPanels[i] === 'williams_pasa') {
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
        min: -1,
        max: 1,
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
  const pad = getPaddingCount(filtered.length, intradayMode);
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
            tooltip: { show: false },
          });
        }
      }
    });
  }




  // RSI sub panel
  if (showRSI && filtered.length > 15) {
    const rsiGridIdx = subPanels.indexOf('rsi') + 1;
    const rsiYIdx = panelYAxisIdx['rsi'];
    const closes = filtered.map((d) => d.close);
    const rsiPeriod = sigConfig?.rsi?.period ?? 14;
    const rsiResult = computed?.rsi ? { rsi: computed.rsi } : computeRSI(closes, rsiPeriod);
    const rsiPadded = [...padNull, ...rsiResult.rsi, ...padNull];

    const oversold = sigConfig?.rsi?.oversold ?? 30;
    const overbought = sigConfig?.rsi?.overbought ?? 70;

    subSeries.push({
      name: 'RSI',
      type: 'line',
      data: rsiPadded,
      xAxisIndex: rsiGridIdx,
      yAxisIndex: rsiYIdx,
      showSymbol: false,
      lineStyle: { color: '#E040FB', width: 2 },
      z: 5,
      tooltip: { show: false },
      markLine: {
        silent: true,
        symbol: 'none',
        data: [
          {
            yAxis: overbought,
            lineStyle: { color: 'rgba(239,83,80,0.6)', type: 'dashed' as const, width: 1 },
            label: {
              show: true,
              position: 'insideEndTop' as const,
              formatter: `${overbought}`,
              fontSize: 9,
              color: '#ef5350',
            },
          },
          {
            yAxis: oversold,
            lineStyle: { color: 'rgba(38,166,154,0.6)', type: 'dashed' as const, width: 1 },
            label: {
              show: true,
              position: 'insideEndBottom' as const,
              formatter: `${oversold}`,
              fontSize: 9,
              color: '#26a69a',
            },
          },
          { yAxis: 50, lineStyle: { color: 'rgba(255,193,7,0.4)', type: 'dotted' as const, width: 1 } },
        ],
      },
      markArea: {
        silent: true,
        data: [
          [{ yAxis: overbought, itemStyle: { color: 'rgba(239,83,80,0.06)' } }, { yAxis: 100 }],
          [{ yAxis: 0, itemStyle: { color: 'rgba(38,166,154,0.06)' } }, { yAxis: oversold }],
        ] as unknown as echarts.MarkAreaComponentOption['data'],
      },
    });
  }

  // MACD sub panel
  if (showMACD && filtered.length > 35) {
    const macdGridIdx = subPanels.indexOf('macd') + 1;
    const macdYIdx = panelYAxisIdx['macd'];
    const closes = filtered.map((d) => d.close);
    const fast = sigConfig?.macd?.fast ?? 12;
    const slow = sigConfig?.macd?.slow ?? 26;
    const sigPeriod = sigConfig?.macd?.signalPeriod ?? 9;
    const macdResult = computed?.macd || computeMACD(closes, fast, slow, sigPeriod);

    const macdPadded = [...padNull, ...macdResult.macd, ...padNull];
    const signalPadded = [...padNull, ...macdResult.signal, ...padNull];
    const histPadded = [...padNull, ...macdResult.histogram, ...padNull];

    // Histogram with color
    const histColored = histPadded.map((val: number | null, idx: number) => {
      if (val === null) return { value: null };
      const prev = idx > 0 ? histPadded[idx - 1] : null;
      let color: string;
      if (val >= 0) {
        color = prev !== null && prev < val ? '#26A69A' : '#B2DFDB';
      } else {
        color = prev !== null && prev < val ? '#FFCDD2' : '#FF5252';
      }
      return { value: val, itemStyle: { color } };
    });

    subSeries.push(
      {
        name: 'MACD Hist',
        type: 'bar',
        data: histColored,
        xAxisIndex: macdGridIdx,
        yAxisIndex: macdYIdx,
        barWidth: '60%',
        z: 1,
        tooltip: { show: false },
      },
      {
        name: 'MACD',
        type: 'line',
        data: macdPadded,
        xAxisIndex: macdGridIdx,
        yAxisIndex: macdYIdx,
        showSymbol: false,
        lineStyle: { color: '#2196F3', width: 2 },
        z: 5,
        tooltip: { show: false },
      },
      {
        name: 'Signal',
        type: 'line',
        data: signalPadded,
        xAxisIndex: macdGridIdx,
        yAxisIndex: macdYIdx,
        showSymbol: false,
        lineStyle: { color: '#FF6D00', width: 2 },
        z: 5,
        tooltip: { show: false },
      },
      {
        name: 'MACD Zero',
        type: 'line',
        data: new Array(total).fill(0),
        xAxisIndex: macdGridIdx,
        yAxisIndex: macdYIdx,
        showSymbol: false,
        lineStyle: { color: '#787B86', width: 1, type: 'dashed' },
        z: 2,
        silent: true,
        tooltip: { show: false },
      },
    );
  }

  // Stochastic RSI sub panel
  if (showStochRSI && filtered.length > 30) {
    const srGridIdx = subPanels.indexOf('stochRsi') + 1;
    const srYIdx = panelYAxisIdx['stochRsi'];
    const closes = filtered.map((d) => d.close);
    const rsiP = sigConfig?.stochRsi?.rsiPeriod ?? 14;
    const stochP = sigConfig?.stochRsi?.stochPeriod ?? 14;
    const kS = sigConfig?.stochRsi?.kSmooth ?? 3;
    const dS = sigConfig?.stochRsi?.dSmooth ?? 3;
    const srResult = computed?.stochRsi || computeStochRSI(closes, rsiP, stochP, kS, dS);

    const kPadded = [...padNull, ...srResult.k, ...padNull];
    const dPadded = [...padNull, ...srResult.d, ...padNull];

    subSeries.push(
      {
        name: '%K',
        type: 'line',
        data: kPadded,
        xAxisIndex: srGridIdx,
        yAxisIndex: srYIdx,
        showSymbol: false,
        lineStyle: { color: '#2196F3', width: 2 },
        z: 5,
        tooltip: { show: false },
        markLine: {
          silent: true,
          symbol: 'none',
          data: [
            { yAxis: 80, lineStyle: { color: 'rgba(239,83,80,0.6)', type: 'dashed' as const, width: 1 } },
            { yAxis: 20, lineStyle: { color: 'rgba(38,166,154,0.6)', type: 'dashed' as const, width: 1 } },
          ],
        },
        markArea: {
          silent: true,
          data: [
            [{ yAxis: 80, itemStyle: { color: 'rgba(239,83,80,0.06)' } }, { yAxis: 100 }],
            [{ yAxis: 0, itemStyle: { color: 'rgba(38,166,154,0.06)' } }, { yAxis: 20 }],
          ] as unknown as echarts.MarkAreaComponentOption['data'],
        },
      },
      {
        name: '%D',
        type: 'line',
        data: dPadded,
        xAxisIndex: srGridIdx,
        yAxisIndex: srYIdx,
        showSymbol: false,
        lineStyle: { color: '#FF6D00', width: 2 },
        z: 5,
        tooltip: { show: false },
      },
    );
  }

  // OBV sub panel
  if (showOBV && filtered.length > 20) {
    const obvGridIdx = subPanels.indexOf('obv') + 1;
    const obvYIdx = panelYAxisIdx['obv'];
    const closes = filtered.map((d) => d.close);
    const vols = filtered.map((d) => d.volume);
    const emaPeriod = sigConfig?.obv?.emaPeriod ?? 20;
    const obvResult = computed?.obv || computeOBV(closes, vols, emaPeriod);

    const obvPadded = [...padNull, ...obvResult.obv, ...padNull];
    const obvEmaPadded = [...padNull, ...obvResult.obvEma, ...padNull];

    subSeries.push(
      {
        name: 'OBV',
        type: 'line',
        data: obvPadded,
        xAxisIndex: obvGridIdx,
        yAxisIndex: obvYIdx,
        showSymbol: false,
        lineStyle: { color: '#26a69a', width: 2 },
        z: 5,
        tooltip: { show: false },
      },
      {
        name: 'OBV EMA',
        type: 'line',
        data: obvEmaPadded,
        xAxisIndex: obvGridIdx,
        yAxisIndex: obvYIdx,
        showSymbol: false,
        lineStyle: { color: '#FF6D00', width: 2 },
        z: 5,
        tooltip: { show: false },
      },
    );
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
    console.log('Nizami Cedid debug:', {
      filteredLength: filtered.length,
      closesLength: closes.length,
      macdLength: ncResult.macd.length,
      lastCloses: closes.slice(-10),
      lastMacd: ncResult.macd.slice(-10),
      lastEmacd: ncResult.emacd.slice(-10),
      lastDelta: ncResult.delta.slice(-10),
    });

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
    ema34: ema(cmfResult.cmf, 34),
    ema68: ema(cmfResult.cmf, 68),
    ema130: ema(cmfResult.cmf, 130)
  } : null);

  if (showCMF && cmfSrc && filtered.length > 20) {
    const cmfGridIdx = subPanels.indexOf('cmf') + 1;
    const cmfYIdx = panelYAxisIdx['cmf'];
    const cmfPadded = [...padNull, ...cmfSrc.cmf, ...padNull];

    const ema34Padded = [...padNull, ...cmfSrc.ema34, ...padNull];
    const ema68Padded = [...padNull, ...cmfSrc.ema68, ...padNull];
    const ema130Padded = [...padNull, ...cmfSrc.ema130, ...padNull];

    subSeries.push(
      {
        name: 'CMF (20)',
        type: 'line',
        data: cmfPadded,
        xAxisIndex: cmfGridIdx,
        yAxisIndex: cmfYIdx,
        showSymbol: false,
        lineStyle: { color: '#9c27b0', width: 2 },
        z: 5,
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
              lineStyle: { color: 'rgba(255,255,255,0.15)', type: 'solid' as const, width: 1 },
            },
          ],
        },
      },
      {
        name: 'CMF EMA 34',
        type: 'line',
        data: ema34Padded,
        xAxisIndex: cmfGridIdx,
        yAxisIndex: cmfYIdx,
        showSymbol: false,
        lineStyle: { color: '#FF9800', width: 1.2 },
        z: 5,
        tooltip: { show: false },
      },
      {
        name: 'CMF EMA 68',
        type: 'line',
        data: ema68Padded,
        xAxisIndex: cmfGridIdx,
        yAxisIndex: cmfYIdx,
        showSymbol: false,
        lineStyle: { color: '#e91e63', width: 1.2 },
        z: 5,
        tooltip: { show: false },
      },
      {
        name: 'CMF EMA 130',
        type: 'line',
        data: ema130Padded,
        xAxisIndex: cmfGridIdx,
        yAxisIndex: cmfYIdx,
        showSymbol: false,
        lineStyle: { color: '#00e5ff', width: 1.2 },
        z: 5,
        tooltip: { show: false },
      }
    );
  }

  const activeIdx = (hoveredIndex !== null && hoveredIndex >= 0 && hoveredIndex < filtered.length)
    ? hoveredIndex
    : filtered.length - 1;

  const titles = buildTitlesOption(
    filtered,
    subPanels,
    panelBottoms,
    activeIdx,
    showRSI,
    showMACD,
    showStochRSI,
    showOBV,
    showWilliamsPasa,
    showNizamiCedid,
    showCMF,
    sigConfig,
    tc,
    computed
  );

  return {
    animation: false,
    backgroundColor: tc.bg,
    grid: grids,
    xAxis: xAxes as echarts.EChartsOption['xAxis'],
    yAxis: yAxes as echarts.EChartsOption['yAxis'],
    title: titles,
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: allXAxisIndices,
        start: zoomStart,
        end: zoomEnd,
        zoomOnMouseWheel: true,
        moveOnMouseMove: false,
        moveOnMouseWheel: false,
        preventDefaultMouseMove: false,
      },
      {
        type: 'slider',
        xAxisIndex: allXAxisIndices,
        start: zoomStart,
        end: zoomEnd,
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
        barWidth: '60%',
        z: 1,
        tooltip: { show: false },
      },
      // ── Bollinger Bands overlay ──
      ...(showBollinger
        ? (() => {
            const closePrices = filtered.map((d) => d.close);
            const overlays = computeAllBollingerOverlays(closePrices);
            const vis = visibleBollinger ?? new Set(overlays.map((o) => o.id));
            const series: echarts.SeriesOption[] = [];
            for (const ov of overlays) {
              if (!vis.has(ov.id)) continue;
              const cfg = DEFAULT_BOLLINGER_CONFIGS.find((c) => c.id === ov.id);
              if (!cfg) continue;
              const upperPadded = [...padNull, ...ov.upper, ...padNull];
              const middlePadded = [...padNull, ...ov.middle, ...padNull];
              const lowerPadded = [...padNull, ...ov.lower, ...padNull];
              series.push(
                {
                  name: `${cfg.label} Ust`,
                  type: 'line',
                  data: upperPadded,
                  xAxisIndex: 0,
                  yAxisIndex: 0,
                  showSymbol: false,
                  lineStyle: { color: cfg.bandColor, width: cfg.width },
                  silent: true,
                  z: 5,
                  connectNulls: false,
                  tooltip: { show: false },
                },
                {
                  name: `${cfg.label} Orta`,
                  type: 'line',
                  data: middlePadded,
                  xAxisIndex: 0,
                  yAxisIndex: 0,
                  showSymbol: false,
                  lineStyle: { color: cfg.color, width: 1, type: 'dashed' },
                  silent: true,
                  z: 5,
                  connectNulls: false,
                  tooltip: { show: false },
                },
                {
                  name: `${cfg.label} Alt`,
                  type: 'line',
                  data: lowerPadded,
                  xAxisIndex: 0,
                  yAxisIndex: 0,
                  showSymbol: false,
                  lineStyle: { color: cfg.bandColor, width: cfg.width },
                  silent: true,
                  z: 5,
                  connectNulls: false,
                  tooltip: { show: false },
                },
              );
            }
            return series;
          })()
        : []),
      // ── SuperTrend overlay ──
      ...(showSuperTrend && filtered.length > 11
        ? (() => {
            const highs = filtered.map((d) => d.high);
            const lows = filtered.map((d) => d.low);
            const closes = filtered.map((d) => d.close);
            const atrP = sigConfig?.supertrend?.atrPeriod ?? 10;
            const mult = sigConfig?.supertrend?.multiplier ?? 3.0;
            const st = computeSuperTrend(highs, lows, closes, atrP, mult);

            const upData: (number | null)[] = new Array(total).fill(null);
            const dnData: (number | null)[] = new Array(total).fill(null);

            for (let i = 0; i < st.supertrend.length; i++) {
              if (st.supertrend[i] === null) continue;
              const idx = pad + i;
              if (idx >= 0 && idx < total) {
                if (st.direction[i] === 1) upData[idx] = st.supertrend[i];
                else dnData[idx] = st.supertrend[i];
                // Bridge for color continuity
                if (i > 0 && st.direction[i] !== st.direction[i - 1] && st.supertrend[i - 1] !== null) {
                  const prevIdx = pad + i - 1;
                  if (st.direction[i] === 1) upData[prevIdx] = st.supertrend[i - 1];
                  else dnData[prevIdx] = st.supertrend[i - 1];
                  if (st.direction[i - 1] === 1) upData[idx] = st.supertrend[i];
                  else dnData[idx] = st.supertrend[i];
                }
              }
            }

            return [
              {
                name: 'ST Up',
                type: 'line' as const,
                data: upData,
                xAxisIndex: 0,
                yAxisIndex: 0,
                showSymbol: false,
                lineStyle: { color: UP_COLOR, width: 2 },
                connectNulls: false,
                z: 4,
                silent: true,
                tooltip: { show: false },
              },
              {
                name: 'ST Down',
                type: 'line' as const,
                data: dnData,
                xAxisIndex: 0,
                yAxisIndex: 0,
                showSymbol: false,
                lineStyle: { color: DOWN_COLOR, width: 2 },
                connectNulls: false,
                z: 4,
                silent: true,
                tooltip: { show: false },
              },
            ] as echarts.SeriesOption[];
          })()
        : []),
      // ── Ichimoku Cloud overlay ──
      ...(showIchimoku && filtered.length > 52
        ? (() => {
            const highs = filtered.map((d) => d.high);
            const lows = filtered.map((d) => d.low);
            const closes = filtered.map((d) => d.close);
            const tP = sigConfig?.ichimoku?.tenkan ?? 9;
            const kP = sigConfig?.ichimoku?.kijun ?? 26;
            const sP = sigConfig?.ichimoku?.senkouB ?? 52;
            const ich = computeIchimoku(highs, lows, closes, tP, kP, sP);

            const tenkanPadded = [...padNull, ...ich.tenkan, ...padNull];
            const kijunPadded = [...padNull, ...ich.kijun, ...padNull];
            const senkouAPadded = [...padNull, ...ich.senkouA, ...padNull];
            const senkouBPadded = [...padNull, ...ich.senkouB, ...padNull];

            // Cloud fill: use stacked area between Span A and Span B
            const cloudLower: (number | null)[] = new Array(total).fill(null);
            const cloudWidth: (number | null)[] = new Array(total).fill(null);

            for (let i = 0; i < total; i++) {
              const sa = senkouAPadded[i];
              const sb = senkouBPadded[i];
              if (sa !== null && sb !== null) {
                cloudLower[i] = Math.min(sa, sb);
                cloudWidth[i] = Math.abs(sa - sb);
              }
            }

            return [
              {
                name: 'Tenkan',
                type: 'line' as const,
                data: tenkanPadded,
                xAxisIndex: 0,
                yAxisIndex: 0,
                showSymbol: false,
                lineStyle: { color: '#2196F3', width: 1.5 },
                z: 5,
                silent: true,
                tooltip: { show: false },
              },
              {
                name: 'Kijun',
                type: 'line' as const,
                data: kijunPadded,
                xAxisIndex: 0,
                yAxisIndex: 0,
                showSymbol: false,
                lineStyle: { color: '#ef5350', width: 1.5 },
                z: 5,
                silent: true,
                tooltip: { show: false },
              },
              {
                name: 'Cloud Base',
                type: 'line' as const,
                data: cloudLower,
                stack: 'ichCloud',
                xAxisIndex: 0,
                yAxisIndex: 0,
                showSymbol: false,
                lineStyle: { width: 0 },
                areaStyle: { color: 'transparent' },
                connectNulls: false,
                z: 2,
                silent: true,
                tooltip: { show: false },
              },
              {
                name: 'Cloud Fill',
                type: 'line' as const,
                data: cloudWidth,
                stack: 'ichCloud',
                xAxisIndex: 0,
                yAxisIndex: 0,
                showSymbol: false,
                lineStyle: { width: 0 },
                areaStyle: { color: 'rgba(76,175,80,0.15)' },
                connectNulls: false,
                z: 2,
                silent: true,
                tooltip: { show: false },
              },
            ] as echarts.SeriesOption[];
          })()
        : []),
      // ── Signal scatter markers (4-directional) ──
      ...(signalEvents && signalEvents.length > 0
        ? (() => {
            const pad = getPaddingCount(filtered.length, intradayMode);
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
    ],
  };
}

export function buildTitlesOption(
  filtered: OHLCVData[],
  subPanels: string[],
  panelBottoms: number[],
  activeIdx: number,
  showRSI: boolean,
  showMACD: boolean,
  showStochRSI: boolean,
  showOBV: boolean,
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

    if (panel === 'rsi' && showRSI && filtered.length > 15) {
      const period = sigConfig?.rsi?.period ?? 14;
      const rsiResult = computeRSI(closes, period);
      const val = rsiResult.rsi[activeIdx];
      const valStr = val !== null && val !== undefined ? val.toFixed(2) : '--';
      text = `{name|RSI(${period})}  {val|RSI: ${valStr}}`;
      rich = {
        name: { color: '#E040FB', fontWeight: 'bold', fontSize: 11 },
        val: { color: tc.tooltipText, fontSize: 11 },
      };
    }
    else if (panel === 'macd' && showMACD && filtered.length > 35) {
      const fast = sigConfig?.macd?.fast ?? 12;
      const slow = sigConfig?.macd?.slow ?? 26;
      const sigPeriod = sigConfig?.macd?.signalPeriod ?? 9;
      const macdResult = computeMACD(closes, fast, slow, sigPeriod);
      const macdVal = macdResult.macd[activeIdx];
      const sigVal = macdResult.signal[activeIdx];
      const histVal = macdResult.histogram[activeIdx];
      
      const mStr = macdVal !== null && macdVal !== undefined ? macdVal.toFixed(2) : '--';
      const sStr = sigVal !== null && sigVal !== undefined ? sigVal.toFixed(2) : '--';
      const hStr = histVal !== null && histVal !== undefined ? histVal.toFixed(2) : '--';

      let histColor = tc.tooltipText;
      if (histVal !== null && histVal !== undefined) {
        histColor = histVal >= 0 ? '#26A69A' : '#FF5252';
      }
      
      text = `{name|MACD(${fast}, ${slow}, ${sigPeriod})}  {macd|MACD: ${mStr}}  {sig|Sinyal: ${sStr}}  {hist|Hist: ${hStr}}`;
      rich = {
        name: { color: '#2196F3', fontWeight: 'bold', fontSize: 11 },
        macd: { color: '#2196F3', fontSize: 11 },
        sig: { color: '#FF6D00', fontSize: 11 },
        hist: { color: histColor, fontSize: 11 },
      };
    }
    else if (panel === 'stochRsi' && showStochRSI && filtered.length > 30) {
      const rsiP = sigConfig?.stochRsi?.rsiPeriod ?? 14;
      const stochP = sigConfig?.stochRsi?.stochPeriod ?? 14;
      const kS = sigConfig?.stochRsi?.kSmooth ?? 3;
      const dS = sigConfig?.stochRsi?.dSmooth ?? 3;
      const srResult = computeStochRSI(closes, rsiP, stochP, kS, dS);
      const kVal = srResult.k[activeIdx];
      const dVal = srResult.d[activeIdx];
      
      const kStr = kVal !== null && kVal !== undefined ? kVal.toFixed(2) : '--';
      const dStr = dVal !== null && dVal !== undefined ? dVal.toFixed(2) : '--';
      
      text = `{name|Stoch RSI(${rsiP}, ${stochP}, ${kS}, ${dS})}  {k|%K: ${kStr}}  {d|%D: ${dStr}}`;
      rich = {
        name: { color: '#2196F3', fontWeight: 'bold', fontSize: 11 },
        k: { color: '#2196F3', fontSize: 11 },
        d: { color: '#FF6D00', fontSize: 11 },
      };
    }
    else if (panel === 'obv' && showOBV && filtered.length > 20) {
      const emaPeriod = sigConfig?.obv?.emaPeriod ?? 20;
      const obvResult = computeOBV(closes, vols, emaPeriod);
      const obvVal = obvResult.obv[activeIdx];
      const obvEmaVal = obvResult.obvEma[activeIdx];
      
      const oStr = obvVal !== null && obvVal !== undefined ? formatVolume(obvVal) : '--';
      const oeStr = obvEmaVal !== null && obvEmaVal !== undefined ? formatVolume(obvEmaVal) : '--';
      
      text = `{name|OBV}  {obv|OBV: ${oStr}}  {ema|EMA(${emaPeriod}): ${oeStr}}`;
      rich = {
        name: { color: '#26a69a', fontWeight: 'bold', fontSize: 11 },
        obv: { color: '#26a69a', fontSize: 11 },
        ema: { color: '#FF6D00', fontSize: 11 },
      };
    }
    else if (panel === 'williams_pasa' && showWilliamsPasa && filtered.length > 260) {
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
      
      let e34Val = null;
      let e68Val = null;
      let e130Val = null;
      
      if (computed?.cmf) {
        e34Val = computed.cmf.ema34[activeIdx];
        e68Val = computed.cmf.ema68[activeIdx];
        e130Val = computed.cmf.ema130[activeIdx];
      } else {
        const fullCmf = computeCMF(highs, lows, closes, vols, 20).cmf;
        e34Val = ema(fullCmf, 34)[activeIdx];
        e68Val = ema(fullCmf, 68)[activeIdx];
        e130Val = ema(fullCmf, 130)[activeIdx];
      }
      
      const e34Str = e34Val !== null && e34Val !== undefined ? e34Val.toFixed(4) : '--';
      const e68Str = e68Val !== null && e68Val !== undefined ? e68Val.toFixed(4) : '--';
      const e130Str = e130Val !== null && e130Val !== undefined ? e130Val.toFixed(4) : '--';
      
      text = `{name|CMF(20)}  {cmf|CMF: ${cVal}}  {ema34|EMA(34): ${e34Str}}  {ema68|EMA(68): ${e68Str}}  {ema130|EMA(130): ${e130Str}}`;
      rich = {
        name: { color: '#9c27b0', fontWeight: 'bold', fontSize: 11 },
        cmf: { color: '#9c27b0', fontSize: 11 },
        ema34: { color: '#FF9800', fontSize: 11 },
        ema68: { color: '#e91e63', fontSize: 11 },
        ema130: { color: '#00e5ff', fontSize: 11 },
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
