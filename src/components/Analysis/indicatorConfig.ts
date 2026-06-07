/**
 * Frontend metadata registry for backend indicators.
 * Must match indicator names in backend/indicators.py INDICATOR_REGISTRY.
 *
 * To add a new indicator:
 *   1. Add the class in backend/indicators.py
 *   2. Add a meta entry here
 *   → Table + charts auto-update.
 */

export interface IndicatorMeta {
  name: string; // backend key prefix: "rsi"
  label: string; // display label: "RSI"
  scoreKey: string; // "rsi_score"
  signalKey: string; // "rsi_signal"
  detailKeys: string[]; // extra columns to show
}

const INDICATOR_META: IndicatorMeta[] = [];

export default INDICATOR_META;

/** Map a backend detail key to a human-readable label */
export function detailLabel(key: string): string {
  return key;
}
