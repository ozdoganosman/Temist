export type ChartType = 'Candlestick' | 'Line' | 'Area' | 'Bar' | 'Baseline';

export type Interval = '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1wk' | '1mo' | '3mo';

const INTRADAY_INTERVALS: ReadonlySet<string> = new Set(['1m', '5m', '15m', '30m', '1h']);

export function isIntraday(interval: Interval): boolean {
  return INTRADAY_INTERVALS.has(interval);
}

export type ActiveView = 'chart' | 'analysis' | 'multichart' | 'backtest' | 'finansal' | 'kripto';

export interface LegendData {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  time: string;
  prevClose: number;
}

export type ActiveDrawingTool = 'pointer' | 'trend' | 'horizontal' | 'fibonacci';

export interface ChartDrawing {
  id: string;
  type: 'trend' | 'horizontal' | 'fibonacci';
  startBarIdx: number;
  startPrice: number;
  endBarIdx?: number;
  endPrice?: number;
  startDate?: string;
  endDate?: string;
}

