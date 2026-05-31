import { useState, useEffect, useRef, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchFinancials } from '../../api/borsaApi';
import type { FinancialsResponse } from '../../api/borsaApi';
import './Financials.css';

type ReportType = 'income_stmt' | 'balance_sheet' | 'cashflow';

const REPORT_LABEL_KEYS: Record<ReportType, string> = {
  income_stmt: 'financials.incomeStatement',
  balance_sheet: 'financials.balanceSheet',
  cashflow: 'financials.cashFlow',
};

function formatCell(val: number | string | null): string {
  if (val === null || val === undefined) return '-';
  if (typeof val === 'string') return val;
  if (val === 0) return '0';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(1) + ' Mlr';
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + ' Mln';
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + ' B';
  return val.toFixed(0);
}

function formatPeriod(dateStr: string): string {
  // Format: "2024/12" → "2024", "2024/3" → "2024/Q1", "2024/6" → "2024/Q2", etc.
  const slashParts = dateStr.split('/');
  if (slashParts.length === 2) {
    const year = slashParts[0];
    const month = parseInt(slashParts[1], 10);
    if (month === 12) return year;
    const qMap: Record<number, string> = { 3: 'Q1', 6: 'Q2', 9: 'Q3' };
    return year + '/' + (qMap[month] || `M${month}`);
  }
  // Format: "2024-01-01" style
  const dashParts = dateStr.split('-');
  if (dashParts.length >= 2) {
    const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
    const month = parseInt(dashParts[1], 10);
    return months[month - 1] + ' ' + dashParts[0];
  }
  return dateStr;
}

interface MiniTrendChartProps {
  periods: string[];
  row: any;
}

function MiniTrendChart({ periods, row }: MiniTrendChartProps) {
  // Extract values corresponding to periods chronologically (reversing if latest is first, to display left-to-right old-to-new)
  const isLatestFirst = periods.length > 1 && new Date(periods[0].replace('/', '-')).getTime() > new Date(periods[periods.length - 1].replace('/', '-')).getTime();
  const chronologicalPeriods = isLatestFirst ? [...periods].reverse() : periods;

  const points = chronologicalPeriods
    .map((p, idx) => {
      const val = row[p];
      return {
        period: p,
        formattedPeriod: formatPeriod(p),
        val: typeof val === 'number' ? val : null,
      };
    })
    .filter((pt) => pt.val !== null) as Array<{ period: string; formattedPeriod: string; val: number }>;

  if (points.length === 0) {
    return <div className="mini-chart-no-data">Grafik için yeterli sayısal veri bulunamadı.</div>;
  }

  const vals = points.map((pt) => pt.val);
  const minVal = Math.min(...vals);
  const maxVal = Math.max(...vals);
  const valRange = maxVal - minVal === 0 ? 1 : maxVal - minVal;

  const padMin = minVal - valRange * 0.15;
  const padMax = maxVal + valRange * 0.15;
  const padRange = padMax - padMin;

  const width = 600;
  const height = 140;
  const paddingLeft = 70;
  const paddingRight = 30;
  const paddingTop = 20;
  const paddingBottom = 30;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const svgPoints = points.map((pt, idx) => {
    const x = paddingLeft + (idx / (points.length - 1 || 1)) * chartWidth;
    const y = paddingTop + chartHeight - ((pt.val - padMin) / padRange) * chartHeight;
    return { ...pt, x, y };
  });

  const linePath = svgPoints.map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
  const fillPath = svgPoints.length > 0
    ? `${linePath} L ${svgPoints[svgPoints.length - 1].x.toFixed(1)} ${(paddingTop + chartHeight).toFixed(1)} L ${svgPoints[0].x.toFixed(1)} ${(paddingTop + chartHeight).toFixed(1)} Z`
    : '';

  const gridLevels = [
    { value: maxVal, label: formatCell(maxVal) },
    { value: minVal + valRange / 2, label: formatCell(minVal + valRange / 2) },
    { value: minVal, label: formatCell(minVal) },
  ];

  return (
    <div className="mini-chart-wrapper">
      <div className="mini-chart-title" style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '8px', paddingLeft: `${paddingLeft}px` }}>
        {row.item} - Dönemsel Değişim Grafiği
      </div>
      <div style={{ position: 'relative', overflowX: 'auto', width: '100%' }}>
        <svg width={width} height={height} style={{ overflow: 'visible', margin: '0 auto', display: 'block' }}>
          {/* Grids */}
          {gridLevels.map((lvl, idx) => {
            const y = paddingTop + chartHeight - ((lvl.value - padMin) / padRange) * chartHeight;
            return (
              <g key={idx}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={width - paddingRight}
                  y2={y}
                  stroke="var(--border-primary)"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
                <text
                  x={paddingLeft - 8}
                  y={y + 4}
                  fill="var(--text-muted)"
                  fontSize="9"
                  fontFamily="monospace"
                  textAnchor="end"
                >
                  {lvl.label}
                </text>
              </g>
            );
          })}

          {/* Area under line */}
          <path d={fillPath} fill="url(#miniChartGradient)" opacity="0.15" />

          {/* Sparkline */}
          <path
            d={linePath}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Markers and text on hover */}
          {svgPoints.map((pt, idx) => (
            <g key={idx} className="chart-dot-group">
              <circle
                cx={pt.x}
                cy={pt.y}
                r="4.5"
                fill="var(--accent)"
                stroke="var(--bg-primary)"
                strokeWidth="1.5"
              />
              <text
                x={pt.x}
                y={pt.y - 8}
                fill="var(--text-primary)"
                fontSize="9"
                fontWeight="bold"
                fontFamily="monospace"
                textAnchor="middle"
                className="chart-dot-label"
                style={{
                  background: 'var(--tooltip-bg)',
                  padding: '2px',
                  borderRadius: '3px'
                }}
              >
                {formatCell(pt.val)}
              </text>
              <text
                x={pt.x}
                y={height - 8}
                fill="var(--text-muted)"
                fontSize="9"
                textAnchor="middle"
              >
                {pt.formattedPeriod}
              </text>
            </g>
          ))}

          {/* Gradient */}
          <defs>
            <linearGradient id="miniChartGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    </div>
  );
}

interface FinancialsProps {
  symbol: string;
}

export default function Financials({ symbol }: FinancialsProps) {
  const { t } = useTranslation();
  const [report, setReport] = useState<ReportType>('income_stmt');
  const [quarterly, setQuarterly] = useState(false);
  const [data, setData] = useState<FinancialsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});
  const tableWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setExpandedRows({});

    fetchFinancials(symbol, report, quarterly)
      .then((res) => {
        if (!cancelled) {
          if (res.error) setError(res.error);
          setData(res);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [symbol, report, quarterly]);

  // Scroll table to the right (newest data) when data loads
  useEffect(() => {
    if (data && data.data.length > 0 && tableWrapRef.current) {
      tableWrapRef.current.scrollLeft = tableWrapRef.current.scrollWidth;
    }
  }, [data]);

  const toggleRow = (index: number) => {
    setExpandedRows((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  return (
    <div className="financials">
      <div className="financials-header">
        <div className="financials-tabs">
          {(Object.keys(REPORT_LABEL_KEYS) as ReportType[]).map((key) => (
            <button key={key} className={`fin-tab ${report === key ? 'active' : ''}`} onClick={() => setReport(key)}>
              {t(REPORT_LABEL_KEYS[key])}
            </button>
          ))}
        </div>
        <div className="financials-toggle">
          <button className={`fin-tab ${!quarterly ? 'active' : ''}`} onClick={() => setQuarterly(false)}>
            Yıllık
          </button>
          <button className={`fin-tab ${quarterly ? 'active' : ''}`} onClick={() => setQuarterly(true)}>
            Çeyreklik
          </button>
        </div>
      </div>

      {loading && <div className="fin-loading">Yükleniyor...</div>}
      {error && <div className="fin-error">{error}</div>}

      {!loading && data && data.data.length > 0 && (
        <>
          <div className="fin-table-wrap" ref={tableWrapRef}>
            <table className="fin-table">
              <thead>
                <tr>
                  <th className="fin-item-col">Kalem</th>
                  {data.periods.map((p) => (
                    <th key={p}>{formatPeriod(p)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.data.map((row, i) => {
                  const isExpanded = !!expandedRows[i];
                  return (
                    <Fragment key={i}>
                      <tr onClick={() => toggleRow(i)} className="clickable-row">
                        <td className="fin-item-col" title={row.item}>
                          <span className="row-expander" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                            ▶
                          </span>
                          {row.item}
                        </td>
                        {data.periods.map((p) => {
                          const val = row[p];
                          const isNeg = typeof val === 'number' && val < 0;
                          return (
                            <td key={p} className={isNeg ? 'negative' : ''}>
                              {formatCell(val as number | null)}
                            </td>
                          );
                        })}
                      </tr>
                      {isExpanded && (
                        <tr className="expanded-row-chart">
                          <td colSpan={data.periods.length + 1}>
                            <div className="mini-chart-container">
                              <MiniTrendChart periods={data.periods} row={row} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && data && data.data.length === 0 && !error && (
        <div className="fin-empty">Finansal veri bulunamadı.</div>
      )}
    </div>
  );
}
