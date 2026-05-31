import { useState, useEffect, useMemo } from 'react';
import { SymbolSearch } from '../SymbolSearch/SymbolSearch';
import Financials from '../Financials/Financials';
import RevenueNetIncomeChart from './RevenueNetIncomeChart';
import ProfitabilityMarginsChart from './ProfitabilityMarginsChart';
import BalanceSheetChart from './BalanceSheetChart';
import CashFlowChart from './CashFlowChart';
import SectorComparison from './SectorComparison';
import { fetchAllFinancials } from '../../api/borsaApi';
import type { AllFinancialsResponse, SymbolInfo, OHLCVData } from '../../api/borsaApi';
import {
  computeKPIs,
  deriveRevenueProfitTrend,
  deriveProfitabilityTrend,
  deriveBalanceSheetTrend,
  deriveCashFlowTrend,
} from '../../utils/computeFinancialMetrics';
import type { FinancialKPIs } from '../../utils/computeFinancialMetrics';
import './FinancialAnalysisView.css';

interface Props {
  symbol: string;
  symbols: SymbolInfo[];
  data: OHLCVData[];
  onSymbolChange: (s: string) => void;
}

function formatKPI(v: number | null, suffix = '', decimals = 1): string {
  if (v == null) return '-';
  return v.toFixed(decimals) + suffix;
}

function formatMarketCap(v: number | null): string {
  if (v == null) return '-';
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(1) + ' Mlr';
  if (abs >= 1e6) return (v / 1e6).toFixed(1) + ' Mln';
  return v.toLocaleString('tr-TR');
}

function kpiColor(v: number | null, invertPositive = false): string {
  if (v == null) return 'neutral';
  if (invertPositive) return v > 1 ? 'negative' : 'positive';
  return v > 0 ? 'positive' : v < 0 ? 'negative' : 'neutral';
}

export default function FinancialAnalysisView({ symbol, symbols, data, onSymbolChange }: Props) {
  const [allFin, setAllFin] = useState<AllFinancialsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [quarterly, setQuarterly] = useState(false);

  // Fetch all financials when symbol changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setAllFin(null);

    fetchAllFinancials(symbol)
      .then((res) => {
        if (!cancelled) {
          setAllFin(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAllFin(null);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // KPIs
  const kpis: FinancialKPIs = useMemo(() => {
    if (!allFin)
      return {
        fk: null,
        pddd: null,
        netKarMarji: null,
        brutKarMarji: null,
        roe: null,
        borcOzkaynak: null,
        piyasaDegeri: null,
        lastPrice: null,
        latestPeriod: null,
      };
    return computeKPIs(allFin, data);
  }, [allFin, data]);

  // Chart data
  const revenueProfitData = useMemo(
    () => (allFin ? deriveRevenueProfitTrend(allFin, quarterly) : []),
    [allFin, quarterly],
  );
  const marginsData = useMemo(() => (allFin ? deriveProfitabilityTrend(allFin, quarterly) : []), [allFin, quarterly]);
  const balanceSheetData = useMemo(
    () => (allFin ? deriveBalanceSheetTrend(allFin, quarterly) : []),
    [allFin, quarterly],
  );
  const cashFlowData = useMemo(() => (allFin ? deriveCashFlowTrend(allFin, quarterly) : []), [allFin, quarterly]);

  const displayName = symbols.find((s) => s.name === symbol)?.displayName ?? '';

  return (
    <div className="financial-analysis">
      {/* Header */}
      <div className="fa-header">
        <div className="fa-header-left">
          <span className="fa-title">{symbol}</span>
          {displayName && <span className="fa-subtitle">{displayName}</span>}
          <SymbolSearch symbol={symbol} symbols={symbols} onSymbolChange={onSymbolChange} compact />
        </div>
        <div className="fa-header-right">
          {kpis.latestPeriod && <span className="fa-subtitle">Son: {kpis.latestPeriod}</span>}
          <div className="fa-toggle">
            <button className={`fa-toggle-btn ${!quarterly ? 'active' : ''}`} onClick={() => setQuarterly(false)}>
              Yillik
            </button>
            <button className={`fa-toggle-btn ${quarterly ? 'active' : ''}`} onClick={() => setQuarterly(true)}>
              Ceyreklik
            </button>
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="fa-loading">
          <div className="fa-loading-spinner" />
          <div className="fa-loading-text">Finansal veriler yukleniyor...</div>
        </div>
      )}

      {/* No data */}
      {!loading && !allFin && <div className="fa-empty">Bu hisse icin finansal veri bulunamadi.</div>}

      {/* Main content */}
      {!loading && allFin && (
        <>
          {/* Metric Cards */}
          <div className="fa-metrics-row">
            <div className="fa-metric-card">
              <span className="fa-metric-label">F/K</span>
              <span className={`fa-metric-value ${kpiColor(kpis.fk)}`}>{formatKPI(kpis.fk, 'x', 1)}</span>
              {kpis.lastPrice != null && (
                <span className="fa-metric-detail">Fiyat: {kpis.lastPrice.toFixed(2)} TL</span>
              )}
            </div>

            <div className="fa-metric-card">
              <span className="fa-metric-label">PD/DD</span>
              <span className={`fa-metric-value ${kpiColor(kpis.pddd)}`}>{formatKPI(kpis.pddd, 'x', 2)}</span>
              {kpis.piyasaDegeri != null && (
                <span className="fa-metric-detail">PD: {formatMarketCap(kpis.piyasaDegeri)} TL</span>
              )}
            </div>

            <div className="fa-metric-card">
              <span className="fa-metric-label">Net Kar Marji</span>
              <span className={`fa-metric-value ${kpiColor(kpis.netKarMarji)}`}>
                {formatKPI(kpis.netKarMarji, '%')}
              </span>
            </div>

            <div className="fa-metric-card">
              <span className="fa-metric-label">Brut Kar Marji</span>
              <span className={`fa-metric-value ${kpiColor(kpis.brutKarMarji)}`}>
                {formatKPI(kpis.brutKarMarji, '%')}
              </span>
            </div>

            <div className="fa-metric-card">
              <span className="fa-metric-label">ROE</span>
              <span className={`fa-metric-value ${kpiColor(kpis.roe)}`}>{formatKPI(kpis.roe, '%')}</span>
            </div>

            <div className="fa-metric-card">
              <span className="fa-metric-label">Borc / Ozkaynak</span>
              <span className={`fa-metric-value ${kpiColor(kpis.borcOzkaynak, true)}`}>
                {formatKPI(kpis.borcOzkaynak, 'x', 2)}
              </span>
            </div>
          </div>

          {/* Chart Grid */}
          <div className="fa-chart-grid">
            <div className="fa-chart-card">
              <div className="fa-chart-header">Hasılat & Net Kâr</div>
              <div className="fa-chart-body">
                <RevenueNetIncomeChart data={revenueProfitData} />
              </div>
            </div>
            <div className="fa-chart-card">
              <div className="fa-chart-header">Karlılık Marjları</div>
              <div className="fa-chart-body">
                <ProfitabilityMarginsChart data={marginsData} />
              </div>
            </div>
            <div className="fa-chart-card">
              <div className="fa-chart-header">Bilanço Yapısı</div>
              <div className="fa-chart-body">
                <BalanceSheetChart data={balanceSheetData} />
              </div>
            </div>
            <div className="fa-chart-card">
              <div className="fa-chart-header">Nakit Akışları</div>
              <div className="fa-chart-body">
                <CashFlowChart data={cashFlowData} />
              </div>
            </div>
            <SectorComparison symbol={symbol} symbols={symbols} kpis={kpis} />
          </div>

          {/* Financial Tables */}
          <div className="fa-table-section">
            <Financials symbol={symbol} />
          </div>
        </>
      )}
    </div>
  );
}
