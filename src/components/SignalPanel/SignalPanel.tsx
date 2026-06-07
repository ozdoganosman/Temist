import { useMemo, useState, lazy, Suspense } from 'react';
import type { OHLCVData } from '../../api/borsaApi';
import type {
  SignalConfig,
  PositionMode,
} from '../../utils/signalDetection';
import { computeCombinedSignals, pairTrades } from '../../utils/signalDetection';
import type { EnhancedTradeStats } from '../../utils/optimizerTypes';
import { computeEnhancedStats } from '../../utils/optimizerMetrics';
import Tip from './Tip';
import OptimizerPanel from './OptimizerPanel';
import { SignalCombinator } from './SignalCombinator';
import { useSavedConfigs } from '../../hooks/useSavedConfigs';
import './SignalPanel.css';

const MLDashboard = lazy(() => import('../MLDashboard/MLDashboard'));
const SavedPanel = lazy(() => import('./SavedPanel'));

interface Props {
  data: OHLCVData[];
  symbol: string;
  config: SignalConfig;
  onConfigChange: (config: SignalConfig) => void;
  dateRange: { start?: string; end?: string };
  onDateRangeChange: (range: { start?: string; end?: string }) => void;
}

function pct(v: number): string {
  return (v * 100).toFixed(2) + '%';
}
function pf(v: number): string {
  return isFinite(v) ? v.toFixed(2) : '\u221e';
}


function Num({
  value,
  onChange,
  min,
  max,
  width,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  width?: number;
}) {
  return (
    <input
      type="number"
      className="sp-num"
      value={value}
      min={min}
      max={max}
      style={width ? { width } : undefined}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (!isNaN(v)) onChange(v);
      }}
    />
  );
}

function Tag({ label, children, desc }: { label: string; children: React.ReactNode; desc?: string }) {
  const inner = (
    <span className="sp-tag">
      <span className="sp-tag-label">{label}</span>
      {children}
    </span>
  );
  return desc ? <Tip text={desc}>{inner}</Tip> : inner;
}

function Cond({
  checked,
  onChange,
  label,
  desc,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  desc?: string;
}) {
  const inner = (
    <label className={`sp-cond ${checked ? 'on' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
  return desc ? <Tip text={desc}>{inner}</Tip> : inner;
}

const POSITION_MODE_OPTIONS: { value: PositionMode; label: string }[] = [
  { value: 'long-only', label: 'UZUN' },
  { value: 'short-only', label: 'KISA' },
  { value: 'both', label: 'IKI YON' },
];

export default function SignalPanel({ data, symbol, config, onConfigChange, dateRange, onDateRangeChange }: Props) {
  const [activeTab, setActiveTab] = useState<'signals' | 'optimizer' | 'ml' | 'saved'>('signals');
  const { configs: savedConfigs, saveConfig, removeConfig } = useSavedConfigs();

  const stats = useMemo<EnhancedTradeStats>(() => {
    const empty: EnhancedTradeStats = {
      trades: [],
      totalTrades: 0,
      winRate: 0,
      avgReturn: 0,
      profitFactor: 0,
      maxWin: 0,
      maxLoss: 0,
      totalReturn: 0,
      maxDrawdown: 0,
      maxDrawdownDuration: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      calmarRatio: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      avgBarsHeld: 0,
      expectancy: 0,
      kellyFraction: 0,
      recoveryFactor: 0,
      ulcerIndex: 0,
      equityCurve: [1],
    };
    if (data.length < 30) return empty;
    const combined = computeCombinedSignals(data, config);
    const basic = pairTrades(combined, data, dateRange.start, dateRange.end, config.positionMode);
    if (basic.totalTrades === 0) return empty;
    return computeEnhancedStats(basic.trades, 0);
  }, [data, config, dateRange]);


  return (
    <div className="signal-panel">
      {/* Top bar */}
      <div className="sp-top-bar">
        <div className="sp-position-mode">
          {POSITION_MODE_OPTIONS.map((opt) => (
            <Tip
              key={opt.value}
              text={
                opt.value === 'long-only'
                  ? 'Sadece uzun pozisyon (AL-SAT)'
                  : opt.value === 'short-only'
                    ? 'Sadece kisa pozisyon (aciga satis)'
                    : 'Hem uzun hem kisa pozisyon'
              }
            >
              <button
                className={`sp-mode-btn ${config.positionMode === opt.value ? 'active' : ''}`}
                onClick={() => onConfigChange({ ...config, positionMode: opt.value })}
              >
                {opt.label}
              </button>
            </Tip>
          ))}
        </div>
        <Tip text="Tarih araligi filtresi.">
          <div className="sp-date-range">
            <input
              type="date"
              value={dateRange.start ?? ''}
              onChange={(e) => onDateRangeChange({ ...dateRange, start: e.target.value || undefined })}
            />
            <span className="sp-date-sep">-</span>
            <input
              type="date"
              value={dateRange.end ?? ''}
              onChange={(e) => onDateRangeChange({ ...dateRange, end: e.target.value || undefined })}
            />
            {(dateRange.start || dateRange.end) && (
              <button className="sp-clear-dates" onClick={() => onDateRangeChange({})}>
                &#10005;
              </button>
            )}
          </div>
        </Tip>
        <div className="sp-symbol">{symbol}</div>
        <Tip text="Mevcut indikator ayarini kaydet.">
          <button className="sp-save-btn" onClick={() => saveConfig(config, symbol)}>
            Kaydet
          </button>
        </Tip>
      </div>

      {/* Tab bar */}
      <div className="sp-tab-bar">
        <button className={`sp-tab ${activeTab === 'signals' ? 'active' : ''}`} onClick={() => setActiveTab('signals')}>
          Islemler
        </button>
        <button
          className={`sp-tab ${activeTab === 'optimizer' ? 'active' : ''}`}
          onClick={() => setActiveTab('optimizer')}
        >
          Optimizator
        </button>
        <button className={`sp-tab ${activeTab === 'ml' ? 'active' : ''}`} onClick={() => setActiveTab('ml')}>
          ML Tahmin
        </button>
        <button className={`sp-tab ${activeTab === 'saved' ? 'active' : ''}`} onClick={() => setActiveTab('saved')}>
          Kayitli{savedConfigs.length > 0 && <span className="sp-tab-badge">{savedConfigs.length}</span>}
        </button>
      </div>

      <OptimizerPanel
        data={data}
        dateRange={dateRange}
        onApplyConfig={(cfg) => {
          onConfigChange(cfg);
          setActiveTab('signals');
        }}
        hidden={activeTab !== 'optimizer'}
      />

      <Suspense fallback={<div className="sp-no-trades">ML paneli yukleniyor...</div>}>
        <MLDashboard
          data={data}
          dateRange={dateRange}
          hidden={activeTab !== 'ml'}
        />
      </Suspense>

      <Suspense fallback={<div className="sp-no-trades">Kayitli panel yukleniyor...</div>}>
        <SavedPanel
          configs={savedConfigs}
          currentSymbol={symbol}
          onRemoveConfig={removeConfig}
          onApplyConfig={(cfg) => {
            onConfigChange(cfg);
            setActiveTab('signals');
          }}
          hidden={activeTab !== 'saved'}
        />
      </Suspense>

      <div className="sp-body" style={activeTab !== 'signals' ? { display: 'none' } : undefined}>
        <SignalCombinator
          featureImportance={null}
          onApplyConfig={onConfigChange}
          data={data}
          dateRange={dateRange}
        />
        <div className="sp-indicators">
        </div>

        {/* ── KPIs ── */}
        {stats.totalTrades === 0 ? (
          <div className="sp-no-trades">Islem bulunamadi. En az bir indikator ve bir kosul secin.</div>
        ) : (
          <>
            <div className="sp-kpi-strip">
              <Tip text="Toplam AL-SAT islem cifti sayisi.">
                <div className="sp-kpi">
                  <span className="sp-kpi-label">Islem</span>
                  <span className="sp-kpi-value">{stats.totalTrades}</span>
                </div>
              </Tip>
              <Tip text="Karla kapanan islemlerin orani.">
                <div className="sp-kpi">
                  <span className="sp-kpi-label">Kazanma</span>
                  <span className="sp-kpi-value" style={{ color: stats.winRate >= 0.5 ? '#26a69a' : '#ef5350' }}>
                    {pct(stats.winRate)}
                  </span>
                </div>
              </Tip>
              <Tip text="Kumulatif toplam getiri.">
                <div className="sp-kpi">
                  <span className="sp-kpi-label">Toplam</span>
                  <span className="sp-kpi-value" style={{ color: stats.totalReturn >= 0 ? '#26a69a' : '#ef5350' }}>
                    {pct(stats.totalReturn)}
                  </span>
                </div>
              </Tip>
              <Tip text="Toplam kar / Toplam zarar orani. 1'in ustu karli.">
                <div className="sp-kpi">
                  <span className="sp-kpi-label">Kar Fakt.</span>
                  <span className="sp-kpi-value" style={{ color: stats.profitFactor >= 1 ? '#26a69a' : '#ef5350' }}>
                    {pf(stats.profitFactor)}
                  </span>
                </div>
              </Tip>
              <Tip text="Yillik risk-ayarli getiri. 1+ iyi, 2+ cok iyi.">
                <div className="sp-kpi">
                  <span className="sp-kpi-label">Sharpe</span>
                  <span className="sp-kpi-value" style={{ color: stats.sharpeRatio >= 1 ? '#26a69a' : '#ef5350' }}>
                    {pf(stats.sharpeRatio)}
                  </span>
                </div>
              </Tip>
              <Tip text="Sadece negatif volatiliteye gore ayarlanmis getiri. Sharpe'den daha iyi asagi risk olcumu.">
                <div className="sp-kpi">
                  <span className="sp-kpi-label">Sortino</span>
                  <span className="sp-kpi-value" style={{ color: stats.sortinoRatio >= 1 ? '#26a69a' : '#ef5350' }}>
                    {pf(stats.sortinoRatio)}
                  </span>
                </div>
              </Tip>
              <Tip text="Yillik getiri / Maksimum dususu orani.">
                <div className="sp-kpi">
                  <span className="sp-kpi-label">Calmar</span>
                  <span className="sp-kpi-value" style={{ color: stats.calmarRatio >= 1 ? '#26a69a' : '#ef5350' }}>
                    {pf(stats.calmarRatio)}
                  </span>
                </div>
              </Tip>
              <Tip text="En buyuk tepe-dip dususu. Portfoy riski.">
                <div className="sp-kpi">
                  <span className="sp-kpi-label">Maks DD</span>
                  <span className="sp-kpi-value" style={{ color: '#ef5350' }}>
                    {pct(stats.maxDrawdown)}
                  </span>
                </div>
              </Tip>
              <Tip text="Beklenen getiri = ortKar*kazanma - ortZarar*kaybetme.">
                <div className="sp-kpi">
                  <span className="sp-kpi-label">Beklenti</span>
                  <span className="sp-kpi-value" style={{ color: stats.expectancy >= 0 ? '#26a69a' : '#ef5350' }}>
                    {pct(stats.expectancy)}
                  </span>
                </div>
              </Tip>
              <Tip text="Kelly kriteri: optimal pozisyon buyuklugu (0-1).">
                <div className="sp-kpi">
                  <span className="sp-kpi-label">Kelly</span>
                  <span className="sp-kpi-value">{pct(stats.kellyFraction)}</span>
                </div>
              </Tip>
              <Tip text="Toplam getiri / Maks dusus. Toparlanma gucu.">
                <div className="sp-kpi">
                  <span className="sp-kpi-label">Toparl.</span>
                  <span className="sp-kpi-value" style={{ color: stats.recoveryFactor >= 1 ? '#26a69a' : '#ef5350' }}>
                    {pf(stats.recoveryFactor)}
                  </span>
                </div>
              </Tip>
              <Tip text="Ust uste kazanc / kayip serisi.">
                <div className="sp-kpi">
                  <span className="sp-kpi-label">Seri K/Z</span>
                  <span className="sp-kpi-value">
                    <span style={{ color: '#26a69a' }}>{stats.consecutiveWins}</span>/
                    <span style={{ color: '#ef5350' }}>{stats.consecutiveLosses}</span>
                  </span>
                </div>
              </Tip>
              <Tip text="Ortalama islem suresi (bar sayisi).">
                <div className="sp-kpi">
                  <span className="sp-kpi-label">Ort. Sure</span>
                  <span className="sp-kpi-value">{stats.avgBarsHeld.toFixed(0)}</span>
                </div>
              </Tip>
            </div>

            <div className="sp-trade-table-wrap">
              <table className="sp-trade-table">
                <thead>
                  <tr>
                    <th>Yon</th>
                    <th>Giris</th>
                    <th>Fiyat</th>
                    <th>Cikis</th>
                    <th>Fiyat</th>
                    <th>K/Z %</th>
                    <th>Bar</th>
                  </tr>
                </thead>
                <tbody>
                  {[...stats.trades].reverse().map((t, i) => (
                    <tr key={i}>
                      <td>
                        <span className={`sp-pos-badge ${t.positionType}`}>
                          {t.positionType === 'long' ? 'U' : 'K'}
                        </span>
                      </td>
                      <td>{t.entryDate}</td>
                      <td>{t.entryPrice.toFixed(2)}</td>
                      <td>{t.exitDate}</td>
                      <td>{t.exitPrice.toFixed(2)}</td>
                      <td style={{ color: t.returnPct >= 0 ? '#26a69a' : '#ef5350', fontWeight: 600 }}>
                        {pct(t.returnPct)}
                      </td>
                      <td>{t.barsHeld}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
