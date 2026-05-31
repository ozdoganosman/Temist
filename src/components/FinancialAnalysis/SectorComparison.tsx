import { useState, useEffect, useRef, useMemo } from 'react';
import * as echarts from 'echarts';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { getStockSector } from '../../utils/sectorMap';
import { fetchScanResults, fetchAllFinancials } from '../../api/borsaApi';
import type { SymbolInfo, AllFinancialsResponse } from '../../api/borsaApi';
import { computeKPIs } from '../../utils/computeFinancialMetrics';
import type { FinancialKPIs } from '../../utils/computeFinancialMetrics';

interface Props {
  symbol: string;
  symbols: SymbolInfo[];
  kpis: FinancialKPIs;
}

interface PeerData {
  symbol: string;
  displayName: string;
  kpis: FinancialKPIs;
}

export default function SectorComparison({ symbol, symbols, kpis }: Props) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  
  const [activeTab, setActiveTab] = useState<'radar' | 'bar'>('radar');
  const [activeMetric, setActiveMetric] = useState<'fk' | 'pddd' | 'roe' | 'margin' | 'debt'>('fk');
  
  const [peers, setPeers] = useState<PeerData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  // Map symbols array to a dictionary
  const symbolNames = useMemo(() => {
    const map: Record<string, string> = {};
    symbols.forEach((s) => {
      map[s.name] = s.displayName;
    });
    return map;
  }, [symbols]);

  const currentSector = useMemo(() => {
    const name = symbolNames[symbol] || '';
    return getStockSector(symbol, name);
  }, [symbol, symbolNames]);

  // Load sector peer data dynamically
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setPeers([]);

    async function loadPeers() {
      try {
        const scan = await fetchScanResults();
        if (cancelled) return;

        // Find symbols in the same sector
        const matchedPeers = scan.results
          .filter((r) => {
            if (r.symbol === symbol) return false;
            const name = symbolNames[r.symbol] || '';
            return getStockSector(r.symbol, name) === currentSector;
          })
          // Sort by volume or data points to pick major peers
          .sort((a, b) => b.volume - a.volume)
          .slice(0, 4);

        if (matchedPeers.length === 0) {
          setLoading(false);
          return;
        }

        // Fetch financials for each peer concurrently
        const peerResults = await Promise.all(
          matchedPeers.map(async (peer) => {
            const allFin = await fetchAllFinancials(peer.symbol);
            if (!allFin) return null;
            // Mock OHLCV data with peer close price to compute KPIs
            const mockOHLCV = [{ close: peer.close }] as any[];
            const peerKPIs = computeKPIs(allFin, mockOHLCV);
            return {
              symbol: peer.symbol,
              displayName: symbolNames[peer.symbol] || peer.symbol,
              kpis: peerKPIs,
            };
          })
        );

        if (cancelled) return;

        const validPeers = peerResults.filter(Boolean) as PeerData[];
        setPeers(validPeers);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          setError('Sektörel akran verileri yüklenirken bir hata oluştu.');
          setLoading(false);
        }
      }
    }

    loadPeers();

    return () => {
      cancelled = true;
    };
  }, [symbol, currentSector, symbolNames]);

  // Calculate sector average (selected stock + loaded peers)
  const allComparisonData = useMemo(() => {
    const list = [{ symbol, displayName: symbolNames[symbol] || symbol, kpis }, ...peers];
    
    const count = list.length;
    if (count === 0) return null;

    const avg = {
      fk: 0,
      pddd: 0,
      roe: 0,
      margin: 0,
      debt: 0,
      fkCount: 0,
      pdddCount: 0,
      roeCount: 0,
      marginCount: 0,
      debtCount: 0,
    };

    list.forEach((item) => {
      if (item.kpis.fk && item.kpis.fk > 0) {
        avg.fk += item.kpis.fk;
        avg.fkCount++;
      }
      if (item.kpis.pddd && item.kpis.pddd > 0) {
        avg.pddd += item.kpis.pddd;
        avg.pdddCount++;
      }
      if (item.kpis.roe !== null) {
        avg.roe += item.kpis.roe;
        avg.roeCount++;
      }
      if (item.kpis.netKarMarji !== null) {
        avg.margin += item.kpis.netKarMarji;
        avg.marginCount++;
      }
      if (item.kpis.borcOzkaynak !== null) {
        avg.debt += item.kpis.borcOzkaynak;
        avg.debtCount++;
      }
    });

    return {
      list,
      sectorAvg: {
        fk: avg.fkCount > 0 ? avg.fk / avg.fkCount : null,
        pddd: avg.pdddCount > 0 ? avg.pddd / avg.pdddCount : null,
        roe: avg.roeCount > 0 ? avg.roe / avg.roeCount : null,
        netKarMarji: avg.marginCount > 0 ? avg.margin / avg.marginCount : null,
        borcOzkaynak: avg.debtCount > 0 ? avg.debt / avg.debtCount : null,
      },
    };
  }, [symbol, symbolNames, kpis, peers]);

  // Normalize helper for Radar chart (clamps to [0, 1] range where higher is better)
  const radarData = useMemo(() => {
    if (!allComparisonData) return null;
    const { sectorAvg } = allComparisonData;

    const normalize = (val: number | null, type: 'fk' | 'pddd' | 'roe' | 'margin' | 'debt') => {
      if (val === null || isNaN(val)) return 0.1; // fallback baseline
      switch (type) {
        case 'fk': {
          // Inverse F/K: Earnings Yield. Higher yield is better.
          const yieldVal = 1 / val;
          return Math.max(0.1, Math.min(1, yieldVal / 0.2)); // scaled so F/K <= 5 is 1.0
        }
        case 'pddd': {
          // Inverse PD/DD. Higher book yield is better.
          const bookYield = 1 / val;
          return Math.max(0.1, Math.min(1, bookYield)); // scaled so PD/DD <= 1 is 1.0
        }
        case 'roe':
          return Math.max(0.1, Math.min(1, val / 40)); // scaled so ROE >= 40% is 1.0
        case 'margin':
          return Math.max(0.1, Math.min(1, val / 30)); // scaled so margin >= 30% is 1.0
        case 'debt':
          // 1 / (1 + Debt/Equity). Higher score = less debt relative to equity.
          return Math.max(0.1, Math.min(1, 1 / (1 + val))); 
      }
    };

    return {
      myScores: [
        normalize(kpis.fk, 'fk'),
        normalize(kpis.pddd, 'pddd'),
        normalize(kpis.roe, 'roe'),
        normalize(kpis.netKarMarji, 'margin'),
        normalize(kpis.borcOzkaynak, 'debt'),
      ],
      avgScores: [
        normalize(sectorAvg.fk, 'fk'),
        normalize(sectorAvg.pddd, 'pddd'),
        normalize(sectorAvg.roe, 'roe'),
        normalize(sectorAvg.netKarMarji, 'margin'),
        normalize(sectorAvg.borcOzkaynak, 'debt'),
      ],
    };
  }, [allComparisonData, kpis]);

  // Initialize and update ECharts
  useEffect(() => {
    if (!chartRef.current || loading || !allComparisonData) return;

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current);
    }

    const isDark = theme === 'dark';
    const textColor = isDark ? '#8a8e96' : '#555555';
    const gridColor = isDark ? '#1a1e2e' : '#eaeaea';
    const tooltipBg = isDark ? '#1e222d' : '#ffffff';
    const tooltipBorder = isDark ? '#2a2e3e' : '#d0d0d0';
    const tooltipText = isDark ? '#e0e3eb' : '#1a1a2e';

    let option: echarts.EChartsOption = {};

    if (activeTab === 'radar' && radarData) {
      option = {
        tooltip: {
          trigger: 'item',
          backgroundColor: tooltipBg,
          borderColor: tooltipBorder,
          textStyle: { color: tooltipText, fontSize: 11 },
          formatter: (params: any) => {
            // Label custom mapping to actual values
            const actualValues = params.name === symbol 
              ? [
                  kpis.fk ? kpis.fk.toFixed(1) + 'x' : '-',
                  kpis.pddd ? kpis.pddd.toFixed(2) + 'x' : '-',
                  kpis.roe ? kpis.roe.toFixed(1) + '%' : '-',
                  kpis.netKarMarji ? kpis.netKarMarji.toFixed(1) + '%' : '-',
                  kpis.borcOzkaynak ? kpis.borcOzkaynak.toFixed(2) : '-',
                ]
              : [
                  allComparisonData.sectorAvg.fk ? allComparisonData.sectorAvg.fk.toFixed(1) + 'x' : '-',
                  allComparisonData.sectorAvg.pddd ? allComparisonData.sectorAvg.pddd.toFixed(2) + 'x' : '-',
                  allComparisonData.sectorAvg.roe ? allComparisonData.sectorAvg.roe.toFixed(1) + '%' : '-',
                  allComparisonData.sectorAvg.netKarMarji ? allComparisonData.sectorAvg.netKarMarji.toFixed(1) + '%' : '-',
                  allComparisonData.sectorAvg.borcOzkaynak ? allComparisonData.sectorAvg.borcOzkaynak.toFixed(2) : '-',
                ];
            return `<b>${params.name}</b><br/>
                    F/K Oranı: ${actualValues[0]}<br/>
                    PD/DD Oranı: ${actualValues[1]}<br/>
                    ROE (%): ${actualValues[2]}<br/>
                    Net Kâr Marjı: ${actualValues[3]}<br/>
                    Borç/Özkaynak: ${actualValues[4]}`;
          }
        },
        legend: {
          data: [symbol, 'Sektörel Ortalama'],
          textStyle: { color: textColor, fontSize: 10 },
          bottom: 0,
        },
        radar: {
          indicator: [
            { name: 'F/K Oranı (Ters)', max: 1 },
            { name: 'PD/DD Oranı (Ters)', max: 1 },
            { name: 'ROE (%)', max: 1 },
            { name: 'Net Kâr Marjı (%)', max: 1 },
            { name: 'Özkaynak Gücü (Ters Borç)', max: 1 },
          ],
          splitArea: {
            show: true,
            areaStyle: {
              color: isDark
                ? ['rgba(20,24,36,0.3)', 'rgba(15,19,32,0.15)']
                : ['rgba(245,245,245,0.6)', 'rgba(255,255,255,0.9)'],
            },
          },
          axisName: {
            color: textColor,
            fontSize: 9,
          },
          axisLine: {
            lineStyle: { color: gridColor },
          },
          splitLine: {
            lineStyle: { color: gridColor },
          },
        },
        series: [
          {
            name: 'Sektörel Kıyaslama',
            type: 'radar',
            data: [
              {
                value: radarData.myScores,
                name: symbol,
                itemStyle: { color: '#2962ff' },
                areaStyle: { color: 'rgba(41,98,255,0.15)' },
              },
              {
                value: radarData.avgScores,
                name: 'Sektörel Ortalama',
                itemStyle: { color: '#26a69a' },
                areaStyle: { color: 'rgba(38,166,154,0.1)' },
              },
            ],
          },
        ],
      };
    } else if (activeTab === 'bar') {
      // Grouped peer columns comparison
      const dataset = allComparisonData.list.map((item) => {
        let val: number | null = 0;
        if (activeMetric === 'fk') val = item.kpis.fk;
        else if (activeMetric === 'pddd') val = item.kpis.pddd;
        else if (activeMetric === 'roe') val = item.kpis.roe;
        else if (activeMetric === 'margin') val = item.kpis.netKarMarji;
        else if (activeMetric === 'debt') val = item.kpis.borcOzkaynak;

        return {
          name: item.symbol,
          val: val || 0,
          isSelf: item.symbol === symbol,
        };
      });

      const metricLabel = {
        fk: 'F/K Oranı (x)',
        pddd: 'PD/DD Oranı (x)',
        roe: 'ROE (%)',
        margin: 'Net Kâr Marjı (%)',
        debt: 'Borç / Özkaynak (x)',
      }[activeMetric];

      option = {
        tooltip: {
          trigger: 'axis',
          backgroundColor: tooltipBg,
          borderColor: tooltipBorder,
          textStyle: { color: tooltipText, fontSize: 11 },
          formatter: (params: any) => {
            const p = params[0];
            return `<b>${p.name}</b><br/>${metricLabel}: <b>${p.value.toFixed(2)}</b>`;
          }
        },
        grid: { left: 50, right: 15, top: 30, bottom: 30 },
        xAxis: {
          type: 'category',
          data: dataset.map((d) => d.name),
          axisLabel: { color: textColor, fontSize: 9 },
          axisLine: { lineStyle: { color: gridColor } },
        },
        yAxis: {
          type: 'value',
          axisLabel: { color: textColor, fontSize: 9 },
          splitLine: { lineStyle: { color: gridColor } },
        },
        series: [
          {
            name: metricLabel,
            type: 'bar',
            data: dataset.map((d) => ({
              value: d.val,
              itemStyle: {
                color: d.isSelf ? '#2962ff' : '#26a69a',
                borderRadius: [4, 4, 0, 0]
              },
            })),
            barMaxWidth: 30,
            label: {
              show: true,
              position: 'top',
              color: textColor,
              fontSize: 9,
              formatter: (params: any) => params.value.toFixed(1),
            },
          },
        ],
      };
    }

    chartInstance.current.setOption(option, true);

    const handleResize = () => {
      chartInstance.current?.resize();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [activeTab, activeMetric, loading, allComparisonData, radarData, theme, symbol, kpis]);

  // Clean up chart instance on unmount
  useEffect(() => {
    return () => {
      if (chartInstance.current) {
        chartInstance.current.dispose();
        chartInstance.current = null;
      }
    };
  }, []);

  return (
    <div className="fa-chart-card sector-comparison-card" style={{ gridColumn: 'span 2' }}>
      <div className="fa-chart-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px' }}>
        <span>Sektörel Karşılaştırma Matrisi ({currentSector})</span>
        <div className="fa-toggle" style={{ margin: 0 }}>
          <button className={`fa-toggle-btn ${activeTab === 'radar' ? 'active' : ''}`} onClick={() => setActiveTab('radar')}>
            🕸️ Radar Grafik
          </button>
          <button className={`fa-toggle-btn ${activeTab === 'bar' ? 'active' : ''}`} onClick={() => setActiveTab('bar')}>
            📊 Akran Kıyaslama
          </button>
        </div>
      </div>
      
      <div className="fa-chart-body" style={{ display: 'flex', flexDirection: 'column', height: '360px', padding: '12px' }}>
        {loading && (
          <div className="fin-loading" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            Akran verileri yükleniyor...
          </div>
        )}
        {error && <div className="fin-error">{error}</div>}
        
        {!loading && !error && peers.length === 0 && (
          <div className="fin-empty" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            Bu sektör için kıyaslama verisi bulunamadı.
          </div>
        )}

        {!loading && !error && peers.length > 0 && (
          <>
            {activeTab === 'bar' && (
              <div className="bar-metric-selector" style={{ display: 'flex', gap: '4px', marginBottom: '8px', flexWrap: 'wrap' }}>
                {(['fk', 'pddd', 'roe', 'margin', 'debt'] as const).map((m) => (
                  <button
                    key={m}
                    className={`fin-tab ${activeMetric === m ? 'active' : ''}`}
                    onClick={() => setActiveMetric(m)}
                    style={{ fontSize: '10px', padding: '3px 8px' }}
                  >
                    {{
                      fk: 'F/K',
                      pddd: 'PD/DD',
                      roe: 'ROE',
                      margin: 'Net Kâr Marjı',
                      debt: 'Borç/Özkaynak',
                    }[m]}
                  </button>
                ))}
              </div>
            )}
            <div ref={chartRef} style={{ flex: 1, width: '100%' }} />
          </>
        )}
      </div>
    </div>
  );
}
