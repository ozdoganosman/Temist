/**
 * Static-data API layer.
 *
 * All data is pre-fetched by scripts/build_data.py and served as
 * static JSON from /data/.  No backend server needed at runtime.
 */

const DATA_BASE = import.meta.env.BASE_URL + 'data';

export interface OHLCVData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SymbolInfo {
  name: string;
  displayName: string;
}

export interface QuoteData {
  price: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePercent: number;
  volume: number;
  time: string;
}

// ── Data Timestamp ────────────────────────────

export async function fetchDataTimestamp(): Promise<number | null> {
  try {
    const res = await fetch(`${DATA_BASE}/scan.json`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.timestamp ?? null;
  } catch {
    return null;
  }
}

// ── Symbols ───────────────────────────────────

export async function fetchSymbols(): Promise<{ stocks: SymbolInfo[]; indices: SymbolInfo[] }> {
  const res = await fetch(`${DATA_BASE}/symbols.json`);
  return res.json();
}

// ── History ───────────────────────────────────

export async function fetchHistory(
  symbol: string,
  _period: string = '1y',
  _interval: string = '1d',
): Promise<OHLCVData[]> {
  const res = await fetch(`${DATA_BASE}/history/${symbol}.json`);
  if (!res.ok) return [];
  const json = await res.json();
  return json.data ?? [];
}

// ── Live History (backend) ────────────────────

const BACKEND_URL = 'http://localhost:8001';

/** Check if backend is reachable (cached result) */
let _backendAvailable: boolean | null = null;
async function isBackendAvailable(): Promise<boolean> {
  if (_backendAvailable !== null) return _backendAvailable;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    await fetch(`${BACKEND_URL}/api/health`, { signal: controller.signal });
    clearTimeout(timeout);
    _backendAvailable = true;
  } catch {
    _backendAvailable = false;
  }
  // Re-check every 60s
  setTimeout(() => { _backendAvailable = null; }, 60_000);
  return _backendAvailable;
}

const INTERVAL_PERIOD_MAP: Record<string, string> = {
  '1m': '1d',
  '5m': '5d',
  '15m': '1mo',
  '30m': '1mo',
  '1h': '3mo',
};

export async function fetchHistoryLive(symbol: string, period?: string, interval: string = '1d'): Promise<OHLCVData[]> {
  if (!(await isBackendAvailable())) return [];
  const effectivePeriod = period ?? INTERVAL_PERIOD_MAP[interval] ?? '1y';
  const url = `${BACKEND_URL}/api/history/${encodeURIComponent(symbol)}?period=${effectivePeriod}&interval=${interval}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return json.data ?? [];
  } catch {
    return [];
  }
}

// ── Financials ────────────────────────────────

export interface FinancialRow {
  item: string;
  [period: string]: string | number | null;
}

export interface FinancialsResponse {
  symbol: string;
  report: string;
  quarterly: boolean;
  periods: string[];
  data: FinancialRow[];
  error?: string;
}

export async function fetchFinancials(
  symbol: string,
  report: 'income_stmt' | 'balance_sheet' | 'cashflow' = 'income_stmt',
  quarterly = false,
): Promise<FinancialsResponse> {
  try {
    const res = await fetch(`${DATA_BASE}/financials/${symbol}.json`);
    if (!res.ok) {
      return { symbol, report, quarterly, periods: [], data: [] };
    }
    const json = await res.json();
    const section = json[report] ?? { periods: [], data: [] };
    const allPeriods: string[] = section.periods ?? [];

    // Filter periods: yearly = only /12, quarterly = all periods
    const filteredPeriods = quarterly ? allPeriods : allPeriods.filter((p: string) => p.endsWith('/12'));

    // Filter data columns to match filtered periods
    const filteredData = (section.data ?? []).map((row: FinancialRow) => {
      const newRow: FinancialRow = { item: row.item };
      for (const p of filteredPeriods) {
        newRow[p] = row[p] ?? null;
      }
      return newRow;
    });

    return {
      symbol,
      report,
      quarterly,
      periods: filteredPeriods,
      data: filteredData,
    };
  } catch {
    return { symbol, report, quarterly, periods: [], data: [] };
  }
}

// ── All Financials (single fetch) ─────────────

export interface FinancialSection {
  periods: string[];
  data: FinancialRow[];
}

export interface AllFinancialsResponse {
  income_stmt: FinancialSection;
  balance_sheet: FinancialSection;
  cashflow: FinancialSection;
}

export async function fetchAllFinancials(symbol: string): Promise<AllFinancialsResponse | null> {
  try {
    const res = await fetch(`${DATA_BASE}/financials/${symbol}.json`);
    if (!res.ok) return null;
    const json = await res.json();
    return {
      income_stmt: json.income_stmt ?? { periods: [], data: [] },
      balance_sheet: json.balance_sheet ?? { periods: [], data: [] },
      cashflow: json.cashflow ?? { periods: [], data: [] },
    };
  } catch {
    return null;
  }
}

// ── WebSocket (no-op in static mode) ──────────

export function createWebSocket(
  _symbol: string,
  _onQuote: (data: QuoteData) => void,
  _onSnapshot?: (data: QuoteData) => void,
): WebSocket {
  // Return a dummy object that never connects.
  // Hooks that call ws.close() still work.
  const dummy = {
    readyState: WebSocket.CLOSED,
    close: () => {},
    send: () => {},
    onmessage: null,
    onopen: null,
    onclose: null,
    onerror: null,
  } as unknown as WebSocket;
  return dummy;
}

// ── Market Scan ───────────────────────────────

export interface ScanRow {
  symbol: string;
  close: number;
  volume: number;
  data_points: number;
  [key: string]: string | number | boolean | undefined | null;
}

export interface ScanProgress {
  type: 'progress';
  completed: number;
  total: number;
  found: number;
}

export interface ScanComplete {
  type: 'complete';
  results: ScanRow[];
  total_symbols: number;
  analyzed: number;
  timestamp: number;
}

/**
 * Load pre-computed scan results from static JSON.
 * Calls onComplete immediately (no SSE streaming needed).
 */
export function startScan(
  _onProgress: (p: ScanProgress) => void,
  onComplete: (c: ScanComplete) => void,
  onError: (err: string) => void,
): AbortController {
  const controller = new AbortController();

  fetch(`${DATA_BASE}/scan.json`, { signal: controller.signal })
    .then(async (res) => {
      if (!res.ok) {
        onError(`HTTP ${res.status}`);
        return;
      }
      const json = await res.json();
      onComplete({
        type: 'complete',
        results: json.results ?? [],
        total_symbols: json.total_symbols ?? 0,
        analyzed: json.analyzed ?? 0,
        timestamp: json.timestamp ?? Date.now() / 1000,
      });
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onError(String(err));
      }
    });

  return controller;
}

/**
 * Fetch cached scan results (same as startScan in static mode).
 */
export async function fetchScanResults(): Promise<ScanComplete & { cache_age_seconds?: number; cached?: boolean }> {
  const res = await fetch(`${DATA_BASE}/scan.json`);
  if (!res.ok) {
    return { type: 'complete', results: [], total_symbols: 0, analyzed: 0, timestamp: 0 };
  }
  const json = await res.json();
  return {
    ...json,
    cached: true,
    cache_age_seconds: json.timestamp ? Date.now() / 1000 - json.timestamp : 0,
  };
}

/**
 * No-op in static mode (no cache to clear).
 */
export async function clearScanCache(): Promise<void> {
  // Nothing to do — data is pre-built
}

// ── Backtest ──────────────────────────────────

/** Row format consumed by BacktestView + deriveBacktestData */
export interface BacktestStatRow {
  indicator: string;
  label: string;
  signal_type: string;
  holding_period: number;
  total_signals: number;
  win_rate: number;
  avg_return: number;
  avg_win: number;
  avg_loss: number;
  profit_factor: number;
  max_win: number;
  max_loss: number;
}

export interface BacktestProgress {
  type: 'progress';
  completed: number;
  total: number;
  analyzed: number;
}

export interface BacktestResult {
  stats: BacktestStatRow[];
  cache_age_seconds?: number;
  timestamp?: number;
}

/** Convert aggregated backtest JSON to flat stat rows. */
function flattenBacktestAggregated(json: any): BacktestStatRow[] {
  const rows: BacktestStatRow[] = [];
  const agg = json?.aggregated;
  if (!agg) return rows;

  for (const [indicatorName, ind] of Object.entries<any>(agg)) {
    if (!ind?.stats) continue;
    for (const s of ind.stats) {
      rows.push({
        indicator: indicatorName,
        label: ind.label ?? indicatorName,
        signal_type: s.signal_type,
        holding_period: s.holding_period,
        total_signals: s.total_signals ?? 0,
        win_rate: s.avg_win_rate ?? s.win_rate ?? 0,
        avg_return: s.avg_return ?? 0,
        avg_win: s.avg_win ?? 0,
        avg_loss: s.avg_loss ?? 0,
        profit_factor: s.avg_profit_factor ?? s.profit_factor ?? 0,
        max_win: s.max_win ?? 0,
        max_loss: s.max_loss ?? 0,
      });
    }
  }
  return rows;
}

export async function fetchBacktestResults(): Promise<BacktestResult> {
  try {
    const res = await fetch(`${DATA_BASE}/backtest.json`);
    if (!res.ok) return { stats: [] };
    const json = await res.json();
    return {
      stats: flattenBacktestAggregated(json),
      timestamp: json.timestamp,
      cache_age_seconds: json.timestamp ? Date.now() / 1000 - json.timestamp : 0,
    };
  } catch {
    return { stats: [] };
  }
}

export function startBacktest(
  _onProgress: (p: BacktestProgress) => void,
  onComplete: (data: BacktestResult) => void,
  onError: (err: string) => void,
): AbortController {
  const controller = new AbortController();

  fetchBacktestResults()
    .then((data) => {
      if (controller.signal.aborted) return;
      if (data.stats.length > 0) onComplete(data);
      else onError('No backtest data available');
    })
    .catch((err) => {
      if (controller.signal.aborted) return;
      onError(String(err));
    });

  return controller;
}

export async function clearBacktestCache(): Promise<void> {
  // No-op in static mode
}

// ── ML Training API (v2 — 3-Layer Ensemble) ─────────

export interface MLSignal {
  barIndex: number;
  signal: number;      // -1, 0, 1
  confidence: number;
  layer?: string;      // 'short_term'
}

export interface MLTrade {
  entryDate: string;
  entryPrice: number;
  entryBarIndex: number;
  exitDate: string;
  exitPrice: number;
  exitBarIndex: number;
  returnPct: number;
  barsHeld: number;
  positionType: 'long' | 'short';
}

export interface MLClassMetrics {
  precision: Record<string, number>;
  recall: Record<string, number>;
  f1: Record<string, number>;
  confusion_matrix: number[][];
  class_labels: string[];
  class_distribution: {
    train: Record<string, number>;
    test: Record<string, number>;
  };
}

export interface MLLayerResult {
  signal?: number;             // Layer 1: -1/0/1
  confidence: number;
  trend?: string;              // Layer 2: 'uptrend'/'sideways'/'downtrend'
  model_type: string;
  oos_accuracy: number;
  class_metrics: MLClassMetrics;
  confusion_matrix: number[][];
  feature_importance: Record<string, number>;
  selected_features: string[];
  equity_curve: number[];
}

export interface MLRiskResult {
  score: number;               // 0-100
  components: {
    volatility: number;
    momentum: number;
    volume: number;
    technical: number;
  };
}

export interface MLWalkForwardResult {
  window: number;
  is_accuracy: number;
  oos_accuracy: number;
  oos_sharpe: number;
}

export interface MLTrainRequest {
  ohlcv: OHLCVData[];
  layers?: {
    short_term?: { forward_period?: number; threshold?: number; threshold_short?: number };
    medium_term?: { forward_period?: number; threshold?: number };
    risk?: { enabled?: boolean };
  };
  models?: {
    short_term_model?: string;
    medium_term_model?: string;
    ensemble?: boolean;
    mlp_weight?: number;
  };
  training?: {
    preset?: string;
    train_ratio?: number;
    n_walks?: number;
    optuna_trials?: number;
    feature_select_k?: number;
    drop_corr_threshold?: number;
    use_boruta?: boolean;
  };
  position_mode?: string;
  confidence_threshold?: number;
}

export type MetaDecision =
  | 'strong_buy' | 'buy' | 'cautious_buy'
  | 'neutral' | 'wait'
  | 'cautious_sell' | 'sell' | 'strong_sell';

export interface MLTrainResponse {
  layers: {
    short_term: MLLayerResult;
    medium_term: MLLayerResult;
    risk_score: MLRiskResult;
  };
  meta_decision: MetaDecision;
  signals: MLSignal[];
  trades: MLTrade[];
  stats: {
    totalTrades: number;
    winRate: number;
    avgReturn: number;
    profitFactor: number;
    maxWin: number;
    maxLoss: number;
    totalReturn: number;
    sharpe: number;
    sortino: number;
    maxDrawdown: number;
    calmar: number;
  };
  walk_forward_results: MLWalkForwardResult[];
  warnings: string[];
  training_meta: {
    total_features: number;
    selected_features: number;
    total_bars: number;
    training_bars: number;
    optuna_trials: number;
    best_trial_score: number;
  };
}

export async function trainMLModel(req: MLTrainRequest): Promise<MLTrainResponse> {
  if (!(await isBackendAvailable())) {
    throw new Error('ML backend sunucusu çalışmıyor. Lütfen backend\'i başlatın: cd backend && python main.py');
  }
  const res = await fetch(`${BACKEND_URL}/api/ml/train`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail ?? `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return res.json();
}

export async function clearMLCache(): Promise<void> {
  if (!(await isBackendAvailable())) return;
  try {
    await fetch(`${BACKEND_URL}/api/ml/cache`, { method: 'DELETE' });
  } catch {
    /* backend offline — ignore */
  }
}
