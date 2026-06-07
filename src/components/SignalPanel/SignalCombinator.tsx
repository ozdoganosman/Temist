/**
 * SignalCombinator — 5-mode signal combination engine UI.
 *
 * Replaces the simple AND/OR combination with:
 *   1. Agirlikli Oylama  (Weighted Voting)
 *   2. Kosullu Zincirler  (Conditional Chains)
 *   3. Onay Modu          (Confirmation)
 *   4. Rejim Bazli        (Regime-Adaptive)
 *   5. Surekli Skor       (Continuous Scoring)
 *
 * The component manages configuration only — actual signal computation
 * is handled by the parent (SignalPanel) via onApplyConfig.
 */

import { useState, useCallback, useMemo } from 'react';
import type { SignalConfig } from '../../utils/signalDetection';
import { DEFAULT_SIGNAL_CONFIG } from '../../utils/signalDetection';
import type { OHLCVData } from '../../api/borsaApi';

// ── Types ────────────────────────────────────

export interface SignalCombinatorProps {
  featureImportance: Record<string, number> | null;
  onApplyConfig: (config: SignalConfig) => void;
  data: OHLCVData[];
  dateRange: { start?: string; end?: string };
}

type CombinationMode =
  | 'weighted'
  | 'conditional'
  | 'confirmation'
  | 'regime'
  | 'scoring';

type IndicatorKey = 'williamsPasa' | 'nizamiCedid';

const INDICATOR_KEYS: IndicatorKey[] = ['williamsPasa', 'nizamiCedid'];

const INDICATOR_LABELS: Record<IndicatorKey, string> = {
  williamsPasa: 'Williams Paşa',
  nizamiCedid: 'Nizami Cedid',
};

// ── Feature importance to indicator mapping ──

const FEATURE_TO_IND: Record<string, string> = {
  williams_pasa: 'williamsPasa',
  nizami_cedid: 'nizamiCedid',
};

// ── Mode 2 constants ─────────────────────────

interface ChainIndicatorDef {
  key: string;
  label: string;
  conditions: { value: string; label: string }[];
  hasValue: boolean;
  defaultValue: number;
}

const CHAIN_INDICATORS: ChainIndicatorDef[] = [
  {
    key: 'williams_pasa',
    label: 'Williams Paşa %R',
    conditions: [
      { value: 'lt', label: '< deger' },
      { value: 'gt', label: '> deger' },
    ],
    hasValue: true,
    defaultValue: 5,
  },
  {
    key: 'nizami_cedid',
    label: 'Nizami Cedid Delta',
    conditions: [
      { value: 'gt_zero', label: '> 0' },
      { value: 'lt_zero', label: '< 0' },
    ],
    hasValue: false,
    defaultValue: 0,
  },
];

interface ChainRule {
  indicatorKey: string;
  condition: string;
  value: number;
}

// ── Mode labels ──────────────────────────────

const MODE_OPTIONS: { value: CombinationMode; label: string; desc: string }[] = [
  { value: 'weighted', label: 'Agirlikli Oylama', desc: 'Her indikatoru agirliga gore oylar' },
  { value: 'conditional', label: 'Kosullu Zincirler', desc: 'Sirali kural zincirleri' },
  { value: 'confirmation', label: 'Onay Modu', desc: 'Birincil + onay indikatoru' },
  { value: 'regime', label: 'Rejim Bazli', desc: 'Piyasa rejimine gore otomatik' },
  { value: 'scoring', label: 'Surekli Skor', desc: 'Kompozit skor hesaplama' },
];

// ── Helpers ──────────────────────────────────

function deriveWeightsFromImportance(
  featureImportance: Record<string, number>,
): Record<IndicatorKey, number> {
  const sums: Record<string, number> = {};
  for (const k of INDICATOR_KEYS) sums[k] = 0;
  let total = 0;

  for (const [feat, imp] of Object.entries(featureImportance)) {
    const indKey = FEATURE_TO_IND[feat];
    if (indKey && indKey in sums) {
      sums[indKey] += imp;
      total += imp;
    }
  }

  if (total === 0) total = 1;
  const result: Record<string, number> = {};
  for (const k of INDICATOR_KEYS) {
    result[k] = Math.round((sums[k] / total) * 100);
  }
  // Ensure at least some weight if total is non-zero
  const sum = Object.values(result).reduce((a, b) => a + b, 0);
  if (sum === 0) {
    for (const k of INDICATOR_KEYS) result[k] = Math.round(100 / INDICATOR_KEYS.length);
  }
  return result as Record<IndicatorKey, number>;
}

function defaultWeights(): Record<IndicatorKey, number> {
  const w: Record<string, number> = {};
  for (const k of INDICATOR_KEYS) w[k] = Math.round(100 / INDICATOR_KEYS.length);
  return w as Record<IndicatorKey, number>;
}

function buildSignalConfigFromWeights(
  weights: Record<IndicatorKey, number>,
  _threshold: number,
): SignalConfig {
  const config: SignalConfig = JSON.parse(JSON.stringify(DEFAULT_SIGNAL_CONFIG));
  for (const k of INDICATOR_KEYS) {
    (config[k] as { enabled: boolean }).enabled = weights[k] > 0;
  }
  config.mode = 'OR';
  return config;
}

function buildSignalConfigFromChains(rules: ChainRule[]): SignalConfig {
  const config: SignalConfig = JSON.parse(JSON.stringify(DEFAULT_SIGNAL_CONFIG));
  for (const k of INDICATOR_KEYS) {
    (config[k] as { enabled: boolean }).enabled = false;
  }
  for (const rule of rules) {
    switch (rule.indicatorKey) {
      case 'williams_pasa':
        config.williamsPasa.enabled = true;
        config.williamsPasa.conditions.threshold = true;
        break;
      case 'nizami_cedid':
        config.nizamiCedid.enabled = true;
        config.nizamiCedid.conditions.deltaCross = true;
        break;
    }
  }
  config.mode = 'AND';
  return config;
}

function buildSignalConfigFromConfirmation(
  primary: IndicatorKey,
  confirmation: IndicatorKey,
): SignalConfig {
  const config: SignalConfig = JSON.parse(JSON.stringify(DEFAULT_SIGNAL_CONFIG));
  for (const k of INDICATOR_KEYS) {
    (config[k] as { enabled: boolean }).enabled = k === primary || k === confirmation;
  }
  config.mode = 'AND';
  return config;
}

function buildSignalConfigFromRegime(
  regimeIndicators: Record<string, Record<IndicatorKey, boolean>>,
): SignalConfig {
  // Enable any indicator active in at least one regime
  const config: SignalConfig = JSON.parse(JSON.stringify(DEFAULT_SIGNAL_CONFIG));
  for (const k of INDICATOR_KEYS) {
    const active = Object.values(regimeIndicators).some((r) => r[k]);
    (config[k] as { enabled: boolean }).enabled = active;
  }
  config.mode = 'OR';
  return config;
}

function buildSignalConfigFromScoring(
  weights: Record<IndicatorKey, number>,
): SignalConfig {
  const config: SignalConfig = JSON.parse(JSON.stringify(DEFAULT_SIGNAL_CONFIG));
  for (const k of INDICATOR_KEYS) {
    (config[k] as { enabled: boolean }).enabled = weights[k] > 0;
  }
  config.mode = 'OR';
  return config;
}

// ── Inline styles ────────────────────────────

const S = {
  wrapper: {
    border: '1px solid var(--border-secondary, #333)',
    borderRadius: 6,
    marginBottom: 12,
    background: 'var(--bg-secondary, #1a1a2e)',
    fontSize: 13,
  } as React.CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    cursor: 'pointer',
    userSelect: 'none' as const,
    borderBottom: '1px solid var(--border-secondary, #333)',
  } as React.CSSProperties,
  headerTitle: {
    fontWeight: 600,
    fontSize: 14,
    color: 'var(--text-primary, #e0e0e0)',
  } as React.CSSProperties,
  chevron: {
    fontSize: 11,
    color: 'var(--text-secondary, #888)',
    transition: 'transform 0.15s',
  } as React.CSSProperties,
  body: {
    padding: '10px 12px',
  } as React.CSSProperties,
  modeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  } as React.CSSProperties,
  modeLabel: {
    fontWeight: 500,
    color: 'var(--text-secondary, #aaa)',
    marginRight: 4,
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  select: {
    flex: 1,
    padding: '4px 8px',
    borderRadius: 4,
    border: '1px solid var(--border-secondary, #444)',
    background: 'var(--bg-primary, #12121f)',
    color: 'var(--text-primary, #e0e0e0)',
    fontSize: 13,
    outline: 'none',
  } as React.CSSProperties,
  modeDesc: {
    fontSize: 11,
    color: 'var(--text-secondary, #888)',
    fontStyle: 'italic' as const,
    marginBottom: 10,
  } as React.CSSProperties,
  section: {
    marginBottom: 10,
  } as React.CSSProperties,
  sectionTitle: {
    fontWeight: 600,
    fontSize: 12,
    color: 'var(--text-secondary, #aaa)',
    marginBottom: 6,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  } as React.CSSProperties,
  sliderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  } as React.CSSProperties,
  sliderLabel: {
    width: 72,
    fontSize: 12,
    color: 'var(--text-primary, #ccc)',
    flexShrink: 0,
  } as React.CSSProperties,
  slider: {
    flex: 1,
    accentColor: '#26a69a',
    height: 4,
  } as React.CSSProperties,
  sliderVal: {
    width: 32,
    textAlign: 'right' as const,
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-primary, #e0e0e0)',
    flexShrink: 0,
  } as React.CSSProperties,
  btn: {
    padding: '5px 12px',
    borderRadius: 4,
    border: 'none',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  } as React.CSSProperties,
  btnPrimary: {
    background: '#26a69a',
    color: '#fff',
  } as React.CSSProperties,
  btnSecondary: {
    background: 'var(--bg-primary, #12121f)',
    color: 'var(--text-primary, #ccc)',
    border: '1px solid var(--border-secondary, #444)',
  } as React.CSSProperties,
  btnDanger: {
    background: 'transparent',
    color: '#ef5350',
    border: 'none',
    padding: '2px 6px',
    fontSize: 14,
    cursor: 'pointer',
    lineHeight: 1,
  } as React.CSSProperties,
  ruleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
    padding: '4px 6px',
    borderRadius: 4,
    background: 'var(--bg-primary, #12121f)',
  } as React.CSSProperties,
  ruleSelect: {
    padding: '3px 6px',
    borderRadius: 3,
    border: '1px solid var(--border-secondary, #444)',
    background: 'var(--bg-secondary, #1a1a2e)',
    color: 'var(--text-primary, #e0e0e0)',
    fontSize: 12,
  } as React.CSSProperties,
  numInput: {
    width: 56,
    padding: '3px 6px',
    borderRadius: 3,
    border: '1px solid var(--border-secondary, #444)',
    background: 'var(--bg-secondary, #1a1a2e)',
    color: 'var(--text-primary, #e0e0e0)',
    fontSize: 12,
    textAlign: 'center' as const,
  } as React.CSSProperties,
  thresholdRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    marginBottom: 8,
  } as React.CSSProperties,
  applyRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTop: '1px solid var(--border-secondary, #333)',
  } as React.CSSProperties,
  regimeSection: {
    marginBottom: 8,
    padding: '6px 8px',
    borderRadius: 4,
    border: '1px solid var(--border-secondary, #333)',
    background: 'var(--bg-primary, #12121f)',
  } as React.CSSProperties,
  regimeTitle: {
    fontWeight: 600,
    fontSize: 12,
    marginBottom: 4,
    color: 'var(--text-primary, #ccc)',
  } as React.CSSProperties,
  checkboxGrid: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 4,
  } as React.CSSProperties,
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    fontSize: 11,
    color: 'var(--text-primary, #ccc)',
    cursor: 'pointer',
    padding: '2px 4px',
    borderRadius: 3,
    transition: 'background 0.1s',
  } as React.CSSProperties,
  scoreLevel: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '2px 0',
    fontSize: 12,
  } as React.CSSProperties,
  scoreBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 3,
    fontSize: 11,
    fontWeight: 600,
  } as React.CSSProperties,
  compositeScore: {
    textAlign: 'center' as const,
    padding: '10px 0',
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--text-primary, #e0e0e0)',
  } as React.CSSProperties,
  historyTable: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 11,
    marginTop: 8,
  } as React.CSSProperties,
  historyTh: {
    padding: '4px 6px',
    textAlign: 'left' as const,
    fontWeight: 600,
    color: 'var(--text-secondary, #888)',
    borderBottom: '1px solid var(--border-secondary, #333)',
    fontSize: 11,
  } as React.CSSProperties,
  historyTd: {
    padding: '3px 6px',
    borderBottom: '1px solid var(--border-secondary, #222)',
    color: 'var(--text-primary, #ccc)',
  } as React.CSSProperties,
  emptyMsg: {
    padding: '12px 0',
    textAlign: 'center' as const,
    color: 'var(--text-secondary, #666)',
    fontSize: 12,
    fontStyle: 'italic' as const,
  } as React.CSSProperties,
  regimeNote: {
    fontSize: 11,
    color: 'var(--text-secondary, #777)',
    marginTop: 6,
    lineHeight: 1.4,
  } as React.CSSProperties,
  confirmRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  } as React.CSSProperties,
  confirmLabel: {
    fontSize: 12,
    color: 'var(--text-secondary, #aaa)',
    minWidth: 60,
  } as React.CSSProperties,
} as const;

// ── Component ────────────────────────────────

export function SignalCombinator({
  featureImportance,
  onApplyConfig,
  data,
  dateRange: _dateRange,
}: SignalCombinatorProps) {
  // _dateRange reserved for future signal history filtering
  void _dateRange;
  const [collapsed, setCollapsed] = useState(false);
  const [mode, setMode] = useState<CombinationMode>('weighted');

  // Mode 1 & 5: weights
  const [weights, setWeights] = useState<Record<IndicatorKey, number>>(defaultWeights);
  const [threshold, setThreshold] = useState(50);

  // Mode 2: chain rules
  const [chainRules, setChainRules] = useState<ChainRule[]>([]);
  const [newRuleInd, setNewRuleInd] = useState(CHAIN_INDICATORS[0].key);
  const [newRuleCond, setNewRuleCond] = useState(CHAIN_INDICATORS[0].conditions[0].value);
  const [newRuleVal, setNewRuleVal] = useState(CHAIN_INDICATORS[0].defaultValue);

  // Mode 3: confirmation
  const [primaryInd, setPrimaryInd] = useState<IndicatorKey>('williamsPasa');
  const [confirmInd, setConfirmInd] = useState<IndicatorKey>('nizamiCedid');
  const [confirmBars, setConfirmBars] = useState(3);

  // Mode 4: regime
  const [regimeIndicators, setRegimeIndicators] = useState<
    Record<string, Record<IndicatorKey, boolean>>
  >(() => {
    const makeAll = (keys: IndicatorKey[]): Record<IndicatorKey, boolean> => {
      const r: Record<string, boolean> = {};
      for (const k of INDICATOR_KEYS) r[k] = keys.includes(k);
      return r as Record<IndicatorKey, boolean>;
    };
    return {
      low_vol: makeAll(['williamsPasa']),
      high_vol: makeAll(['nizamiCedid']),
      sideways: makeAll(['williamsPasa', 'nizamiCedid']),
    };
  });

  // Mode 5: scoring weights (reuses `weights` state)
  // Score levels are static display

  // ── Derived ────────────────────────────────

  const currentModeDef = MODE_OPTIONS.find((m) => m.value === mode)!;

  const selectedChainInd = useMemo(
    () => CHAIN_INDICATORS.find((d) => d.key === newRuleInd) ?? CHAIN_INDICATORS[0],
    [newRuleInd],
  );

  // ── Handlers ───────────────────────────────

  const handleLoadFromML = useCallback(() => {
    if (!featureImportance) return;
    const derived = deriveWeightsFromImportance(featureImportance);
    setWeights(derived);
  }, [featureImportance]);

  const handleSetWeight = useCallback((key: IndicatorKey, val: number) => {
    setWeights((prev) => ({ ...prev, [key]: val }));
  }, []);

  const handleAddRule = useCallback(() => {
    if (chainRules.length >= 5) return;
    setChainRules((prev) => [
      ...prev,
      { indicatorKey: newRuleInd, condition: newRuleCond, value: newRuleVal },
    ]);
  }, [chainRules.length, newRuleInd, newRuleCond, newRuleVal]);

  const handleRemoveRule = useCallback((idx: number) => {
    setChainRules((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleToggleRegime = useCallback(
    (regime: string, key: IndicatorKey) => {
      setRegimeIndicators((prev) => ({
        ...prev,
        [regime]: {
          ...prev[regime],
          [key]: !prev[regime][key],
        },
      }));
    },
    [],
  );

  const handleApply = useCallback(() => {
    let config: SignalConfig;
    switch (mode) {
      case 'weighted':
        config = buildSignalConfigFromWeights(weights, threshold);
        break;
      case 'conditional':
        config = buildSignalConfigFromChains(chainRules);
        break;
      case 'confirmation':
        config = buildSignalConfigFromConfirmation(primaryInd, confirmInd);
        break;
      case 'regime':
        config = buildSignalConfigFromRegime(regimeIndicators);
        break;
      case 'scoring':
        config = buildSignalConfigFromScoring(weights);
        break;
      default:
        config = JSON.parse(JSON.stringify(DEFAULT_SIGNAL_CONFIG));
    }
    onApplyConfig(config);
  }, [mode, weights, threshold, chainRules, primaryInd, confirmInd, regimeIndicators, onApplyConfig]);

  // When chain indicator changes, reset condition
  const handleNewRuleIndChange = useCallback((key: string) => {
    setNewRuleInd(key);
    const def = CHAIN_INDICATORS.find((d) => d.key === key);
    if (def) {
      setNewRuleCond(def.conditions[0].value);
      setNewRuleVal(def.defaultValue);
    }
  }, []);

  // ── Render ─────────────────────────────────

  return (
    <div className="mld-signal-combinator" style={S.wrapper}>
      {/* Header */}
      <div
        style={S.header}
        onClick={() => setCollapsed((p) => !p)}
      >
        <span style={S.headerTitle}>Sinyal Kombinasyonu</span>
        <span style={{ ...S.chevron, transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
          {collapsed ? '\u25B8' : '\u25BE'}
        </span>
      </div>

      {!collapsed && (
        <div style={S.body}>
          {/* Mode selector */}
          <div style={S.modeRow}>
            <span style={S.modeLabel}>Mod:</span>
            <select
              style={S.select}
              value={mode}
              onChange={(e) => setMode(e.target.value as CombinationMode)}
            >
              {MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div style={S.modeDesc}>{currentModeDef.desc}</div>

          {/* ── Mode 1: Weighted Voting ── */}
          {mode === 'weighted' && (
            <div style={S.section}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={S.sectionTitle}>Indikator Agirliklari</span>
                {featureImportance && (
                  <button
                    style={{ ...S.btn, ...S.btnSecondary, fontSize: 11, padding: '3px 8px' }}
                    onClick={handleLoadFromML}
                  >
                    ML'den Yukle
                  </button>
                )}
              </div>
              {INDICATOR_KEYS.map((key) => (
                <div key={key} style={S.sliderRow}>
                  <span style={S.sliderLabel}>{INDICATOR_LABELS[key]}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={weights[key]}
                    onChange={(e) => handleSetWeight(key, Number(e.target.value))}
                    style={S.slider}
                  />
                  <span style={S.sliderVal}>{weights[key]}</span>
                </div>
              ))}
              <div style={S.thresholdRow}>
                <span style={{ ...S.sliderLabel, fontWeight: 600 }}>Esik</span>
                <input
                  type="range"
                  min={30}
                  max={70}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  style={{ ...S.slider, accentColor: '#ffa726' }}
                />
                <span style={{ ...S.sliderVal, color: '#ffa726' }}>{threshold}</span>
              </div>
            </div>
          )}

          {/* ── Mode 2: Conditional Chains ── */}
          {mode === 'conditional' && (
            <div style={S.section}>
              <span style={S.sectionTitle}>Kurallar ({chainRules.length}/5)</span>
              {chainRules.map((rule, idx) => {
                const def = CHAIN_INDICATORS.find((d) => d.key === rule.indicatorKey);
                const condLabel = def?.conditions.find((c) => c.value === rule.condition)?.label ?? rule.condition;
                return (
                  <div key={idx} style={S.ruleRow}>
                    <span style={{ fontSize: 11, color: '#26a69a', fontWeight: 600, minWidth: 16 }}>
                      {idx + 1}.
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-primary, #ccc)' }}>
                      {def?.label ?? rule.indicatorKey}
                    </span>
                    <span style={{ fontSize: 12, color: '#ffa726' }}>{condLabel}</span>
                    {def?.hasValue && (
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary, #e0e0e0)' }}>
                        {rule.value}
                      </span>
                    )}
                    <button
                      style={S.btnDanger}
                      onClick={() => handleRemoveRule(idx)}
                      title="Kurali sil"
                    >
                      x
                    </button>
                  </div>
                );
              })}

              {chainRules.length < 5 && (
                <div style={{ ...S.ruleRow, border: '1px dashed var(--border-secondary, #444)' }}>
                  <select
                    style={S.ruleSelect}
                    value={newRuleInd}
                    onChange={(e) => handleNewRuleIndChange(e.target.value)}
                  >
                    {CHAIN_INDICATORS.map((d) => (
                      <option key={d.key} value={d.key}>{d.label}</option>
                    ))}
                  </select>
                  <select
                    style={S.ruleSelect}
                    value={newRuleCond}
                    onChange={(e) => setNewRuleCond(e.target.value)}
                  >
                    {selectedChainInd.conditions.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                  {selectedChainInd.hasValue && (
                    <input
                      type="number"
                      style={S.numInput}
                      value={newRuleVal}
                      onChange={(e) => setNewRuleVal(Number(e.target.value))}
                    />
                  )}
                  <button
                    style={{ ...S.btn, ...S.btnSecondary, fontSize: 11, padding: '3px 8px' }}
                    onClick={handleAddRule}
                  >
                    Kural Ekle
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Mode 3: Confirmation ── */}
          {mode === 'confirmation' && (
            <div style={S.section}>
              <div style={S.confirmRow}>
                <span style={S.confirmLabel}>Birincil:</span>
                <select
                  style={S.select}
                  value={primaryInd}
                  onChange={(e) => setPrimaryInd(e.target.value as IndicatorKey)}
                >
                  {INDICATOR_KEYS.map((k) => (
                    <option key={k} value={k}>{INDICATOR_LABELS[k]}</option>
                  ))}
                </select>
              </div>
              <div style={S.confirmRow}>
                <span style={S.confirmLabel}>Onay:</span>
                <select
                  style={S.select}
                  value={confirmInd}
                  onChange={(e) => setConfirmInd(e.target.value as IndicatorKey)}
                >
                  {INDICATOR_KEYS.filter((k) => k !== primaryInd).map((k) => (
                    <option key={k} value={k}>{INDICATOR_LABELS[k]}</option>
                  ))}
                </select>
              </div>
              <div style={S.confirmRow}>
                <span style={S.confirmLabel}>N bar:</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={confirmBars}
                  onChange={(e) => setConfirmBars(Math.min(10, Math.max(1, Number(e.target.value))))}
                  style={{ ...S.numInput, width: 48 }}
                />
                <span style={{ fontSize: 11, color: 'var(--text-secondary, #888)' }}>
                  bar icinde onay gerekli
                </span>
              </div>
            </div>
          )}

          {/* ── Mode 4: Regime-Adaptive ── */}
          {mode === 'regime' && (
            <div style={S.section}>
              {([
                { key: 'low_vol', label: 'Dusuk Volatilite' },
                { key: 'high_vol', label: 'Yuksek Volatilite' },
                { key: 'sideways', label: 'Yatay Piyasa' },
              ] as const).map((regime) => (
                <div key={regime.key} style={S.regimeSection}>
                  <div style={S.regimeTitle}>{regime.label}</div>
                  <div style={S.checkboxGrid}>
                    {INDICATOR_KEYS.map((k) => (
                      <label key={k} style={{
                        ...S.checkboxLabel,
                        background: regimeIndicators[regime.key][k]
                          ? 'rgba(38, 166, 154, 0.15)'
                          : 'transparent',
                      }}>
                        <input
                          type="checkbox"
                          checked={regimeIndicators[regime.key][k]}
                          onChange={() => handleToggleRegime(regime.key, k)}
                          style={{ accentColor: '#26a69a' }}
                        />
                        {INDICATOR_LABELS[k]}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <div style={S.regimeNote}>
                Rejim tespiti otomatiktir: ATR yuzdelik dilimi ile volatilite (dusuk &lt; 30.
                persentil, yuksek &gt; 70. persentil), ADX &lt; 20 ise yatay piyasa olarak
                belirlenir. Her rejimde yalnizca secili indikatorler aktif olur.
              </div>
            </div>
          )}

          {/* ── Mode 5: Continuous Scoring ── */}
          {mode === 'scoring' && (
            <div style={S.section}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={S.sectionTitle}>Skor Agirliklari</span>
                {featureImportance && (
                  <button
                    style={{ ...S.btn, ...S.btnSecondary, fontSize: 11, padding: '3px 8px' }}
                    onClick={handleLoadFromML}
                  >
                    ML'den Yukle
                  </button>
                )}
              </div>
              {INDICATOR_KEYS.map((key) => (
                <div key={key} style={S.sliderRow}>
                  <span style={S.sliderLabel}>{INDICATOR_LABELS[key]}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={weights[key]}
                    onChange={(e) => handleSetWeight(key, Number(e.target.value))}
                    style={S.slider}
                  />
                  <span style={S.sliderVal}>{weights[key]}</span>
                </div>
              ))}

              {/* Threshold levels */}
              <div style={{ marginTop: 10, marginBottom: 6 }}>
                <span style={S.sectionTitle}>Esik Seviyeleri</span>
              </div>
              <div style={S.scoreLevel}>
                <span style={{ ...S.scoreBadge, background: 'rgba(38,166,154,0.3)', color: '#26a69a' }}>
                  Guclu AL
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary, #aaa)' }}>&gt; 70</span>
              </div>
              <div style={S.scoreLevel}>
                <span style={{ ...S.scoreBadge, background: 'rgba(38,166,154,0.15)', color: '#4db6ac' }}>
                  AL
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary, #aaa)' }}>&gt; 30</span>
              </div>
              <div style={S.scoreLevel}>
                <span style={{ ...S.scoreBadge, background: 'rgba(255,255,255,0.05)', color: '#888' }}>
                  NOTR
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary, #aaa)' }}>-30 ~ +30</span>
              </div>
              <div style={S.scoreLevel}>
                <span style={{ ...S.scoreBadge, background: 'rgba(239,83,80,0.15)', color: '#ef9a9a' }}>
                  SAT
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary, #aaa)' }}>&lt; -30</span>
              </div>
              <div style={S.scoreLevel}>
                <span style={{ ...S.scoreBadge, background: 'rgba(239,83,80,0.3)', color: '#ef5350' }}>
                  Guclu SAT
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary, #aaa)' }}>&lt; -70</span>
              </div>

              {/* Current composite score placeholder */}
              <div style={S.compositeScore}>
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-secondary, #888)', display: 'block', marginBottom: 2 }}>
                  Kompozit Skor
                </span>
                <span style={{ color: '#888' }}>--</span>
              </div>
            </div>
          )}

          {/* ── Apply button ── */}
          <div style={S.applyRow}>
            <button
              style={{ ...S.btn, ...S.btnPrimary }}
              onClick={handleApply}
            >
              Uygula
            </button>
          </div>

          {/* ── Signal History Table ── */}
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={S.sectionTitle}>Sinyal Gecmisi</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary, #666)' }}>
                {data.length} bar
              </span>
            </div>
            <div style={S.emptyMsg}>
              Sinyal gecmisi egitim sonrasi gorunur
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
