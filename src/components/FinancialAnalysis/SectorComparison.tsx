import { useState, useEffect, useRef, useMemo } from 'react';
import * as echarts from 'echarts';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { getStockSector } from '../../utils/sectorMap';
import { fetchScanResults, fetchAllFinancials } from '../../api/borsaApi';
import type { SymbolInfo } from '../../api/borsaApi';
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
  
  const [activeTab, setActiveTab] = useState<'radar' | 'peers' | 'bar'>('radar');
  const [activeMetric, setActiveMetric] = useState<'fk' | 'pddd' | 'roe' | 'margin' | 'debt'>('fk');
  
  const [peers, setPeers] = useState<PeerData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [sortField, setSortField] = useState<string>('symbol');
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  const radarRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const radarInstance = useRef<echarts.ECharts | null>(null);
  const barInstance = useRef<echarts.ECharts | null>(null);

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

  // Calculate ranks
  const rankings = useMemo(() => {
    if (!allComparisonData) return null;
    const { list } = allComparisonData;

    const calculateMetricRank = (
      metricKey: 'fk' | 'pddd' | 'roe' | 'netKarMarji' | 'borcOzkaynak',
      ascending: boolean,
      isValid: (val: any) => boolean
    ) => {
      const validList = list
        .map(item => ({
          symbol: item.symbol,
          val: item.kpis[metricKey]
        }))
        .filter(item => isValid(item.val));

      validList.sort((a, b) => {
        if (a.val === b.val) return 0;
        if (ascending) {
          return (a.val as number) - (b.val as number);
        } else {
          return (b.val as number) - (a.val as number);
        }
      });

      const rankMap: Record<string, { rank: number; total: number }> = {};
      validList.forEach((item, index) => {
        rankMap[item.symbol] = {
          rank: index + 1,
          total: validList.length
        };
      });

      return rankMap;
    };

    const fkRanks = calculateMetricRank('fk', true, val => val !== null && val > 0);
    const pdddRanks = calculateMetricRank('pddd', true, val => val !== null && val > 0);
    const roeRanks = calculateMetricRank('roe', false, val => val !== null);
    const marginRanks = calculateMetricRank('netKarMarji', false, val => val !== null);
    const debtRanks = calculateMetricRank('borcOzkaynak', true, val => val !== null);

    return {
      fk: fkRanks,
      pddd: pdddRanks,
      roe: roeRanks,
      margin: marginRanks,
      debt: debtRanks
    };
  }, [allComparisonData]);

  // Scorecard data
  const scorecard = useMemo(() => {
    if (!allComparisonData || !rankings) return null;
    const { sectorAvg } = allComparisonData;

    const getVerdict = (
      key: 'fk' | 'pddd' | 'roe' | 'margin' | 'debt',
      val: number | null,
      avg: number | null
    ) => {
      if (val === null || avg === null) return { text: '-', type: 'neutral' };
      switch (key) {
        case 'fk':
          return val < avg 
            ? { text: 'Sektörden Ucuz', type: 'positive' }
            : { text: 'Sektörden Pahalı', type: 'negative' };
        case 'pddd':
          return val < avg 
            ? { text: 'Sektörden Ucuz', type: 'positive' }
            : { text: 'Sektörden Pahalı', type: 'negative' };
        case 'roe':
          return val > avg 
            ? { text: 'Sektör Üstü Kâr', type: 'positive' }
            : { text: 'Sektör Altı Kâr', type: 'negative' };
        case 'margin':
          return val > avg 
            ? { text: 'Sektör Üstü Marj', type: 'positive' }
            : { text: 'Sektör Altı Marj', type: 'negative' };
        case 'debt':
          return val < avg 
            ? { text: 'Daha Düşük Borç', type: 'positive' }
            : { text: 'Daha Yüksek Borç', type: 'negative' };
        default:
          return { text: '-', type: 'neutral' };
      }
    };

    const getRankStr = (rankObj: Record<string, { rank: number; total: number }> | undefined) => {
      if (!rankObj || !rankObj[symbol]) return '-';
      return `${rankObj[symbol].rank} / ${rankObj[symbol].total}`;
    };

    const checkBetter = (type: string) => {
      return type === 'positive';
    };

    const items = [
      {
        key: 'fk' as const,
        label: 'F/K Oranı',
        val: kpis.fk,
        avg: sectorAvg.fk,
        valStr: kpis.fk ? kpis.fk.toFixed(1) + 'x' : '-',
        avgStr: sectorAvg.fk ? sectorAvg.fk.toFixed(1) + 'x' : '-',
        rankStr: getRankStr(rankings.fk),
        verdict: getVerdict('fk', kpis.fk, sectorAvg.fk)
      },
      {
        key: 'pddd' as const,
        label: 'PD/DD Oranı',
        val: kpis.pddd,
        avg: sectorAvg.pddd,
        valStr: kpis.pddd ? kpis.pddd.toFixed(2) + 'x' : '-',
        avgStr: sectorAvg.pddd ? sectorAvg.pddd.toFixed(2) + 'x' : '-',
        rankStr: getRankStr(rankings.pddd),
        verdict: getVerdict('pddd', kpis.pddd, sectorAvg.pddd)
      },
      {
        key: 'roe' as const,
        label: 'Özsermaye Kârlılığı (ROE)',
        val: kpis.roe,
        avg: sectorAvg.roe,
        valStr: kpis.roe ? kpis.roe.toFixed(1) + '%' : '-',
        avgStr: sectorAvg.roe ? sectorAvg.roe.toFixed(1) + '%' : '-',
        rankStr: getRankStr(rankings.roe),
        verdict: getVerdict('roe', kpis.roe, sectorAvg.roe)
      },
      {
        key: 'margin' as const,
        label: 'Net Kâr Marjı',
        val: kpis.netKarMarji,
        avg: sectorAvg.netKarMarji,
        valStr: kpis.netKarMarji ? kpis.netKarMarji.toFixed(1) + '%' : '-',
        avgStr: sectorAvg.netKarMarji ? sectorAvg.netKarMarji.toFixed(1) + '%' : '-',
        rankStr: getRankStr(rankings.margin),
        verdict: getVerdict('margin', kpis.netKarMarji, sectorAvg.netKarMarji)
      },
      {
        key: 'debt' as const,
        label: 'Borç / Özkaynak',
        val: kpis.borcOzkaynak,
        avg: sectorAvg.borcOzkaynak,
        valStr: kpis.borcOzkaynak ? kpis.borcOzkaynak.toFixed(2) + 'x' : '-',
        avgStr: sectorAvg.borcOzkaynak ? sectorAvg.borcOzkaynak.toFixed(2) + 'x' : '-',
        rankStr: getRankStr(rankings.debt),
        verdict: getVerdict('debt', kpis.borcOzkaynak, sectorAvg.borcOzkaynak)
      }
    ];

    const positiveCount = items.filter(item => checkBetter(item.verdict.type)).length;
    const totalCount = items.filter(item => item.val !== null).length;

    return {
      items,
      score: `${positiveCount} / ${totalCount}`,
      positiveCount,
      totalCount
    };
  }, [allComparisonData, rankings, symbol, kpis]);

  // Normalized helper for Radar chart (clamps to [0, 1] range where higher is better)
  const radarData = useMemo(() => {
    if (!allComparisonData) return null;
    const { sectorAvg } = allComparisonData;

    const normalize = (val: number | null, type: 'fk' | 'pddd' | 'roe' | 'margin' | 'debt') => {
      if (val === null || isNaN(val)) return 0.1; // fallback baseline
      switch (type) {
        case 'fk': {
          const yieldVal = 1 / val;
          return Math.max(0.1, Math.min(1, yieldVal / 0.2)); // scaled so F/K <= 5 is 1.0
        }
        case 'pddd': {
          const bookYield = 1 / val;
          return Math.max(0.1, Math.min(1, bookYield)); // scaled so PD/DD <= 1 is 1.0
        }
        case 'roe':
          return Math.max(0.1, Math.min(1, val / 40)); // scaled so ROE >= 40% is 1.0
        case 'margin':
          return Math.max(0.1, Math.min(1, val / 30)); // scaled so margin >= 30% is 1.0
        case 'debt':
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

  // --- Radar Chart Effect ---
  useEffect(() => {
    if (!radarRef.current || loading || !allComparisonData || !radarData) return;

    if (!radarInstance.current) {
      radarInstance.current = echarts.init(radarRef.current);
    }

    const isDark = theme === 'dark';
    const textColor = isDark ? '#8a8e96' : '#555555';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';
    const axisLabelColor = isDark ? '#a0a5b0' : '#444444';
    const tooltipBg = isDark ? '#141824' : '#ffffff';
    const tooltipBorder = isDark ? '#2e3546' : '#d0d0d0';
    const tooltipText = isDark ? '#e0e3eb' : '#1a1a2e';

    const radarOption: echarts.EChartsOption = {
        tooltip: {
          trigger: 'item',
          backgroundColor: tooltipBg,
          borderColor: tooltipBorder,
          textStyle: { color: tooltipText, fontSize: 11 },
          formatter: (params: any) => {
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
                    Özsermaye Kârlılığı: ${actualValues[2]}<br/>
                    Net Kâr Marjı: ${actualValues[3]}<br/>
                    Borç / Özkaynak: ${actualValues[4]}`;
          }
        },
        legend: {
          data: [symbol, 'Sektörel Ortalama'],
          textStyle: { color: textColor, fontSize: 10 },
          bottom: 0,
        },
        radar: {
          center: ['50%', '48%'],
          radius: '72%',
          indicator: [
            { name: 'F/K Oranı', max: 1 },
            { name: 'PD/DD Oranı', max: 1 },
            { name: 'Özsermaye Kârlılığı', max: 1 },
            { name: 'Net Kâr Marjı', max: 1 },
            { name: 'Borçsuzluk Seviyesi', max: 1 },
          ],
          splitArea: {
            show: true,
            areaStyle: {
              color: isDark
                ? ['rgba(255,255,255,0.015)', 'rgba(255,255,255,0.005)']
                : ['rgba(0,0,0,0.01)', 'rgba(0,0,0,0.02)'],
            },
          },
          axisName: {
            color: axisLabelColor,
            fontSize: 10,
            fontWeight: 600,
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
                lineStyle: { width: 2.5 },
                areaStyle: {
                  color: new echarts.graphic.RadialGradient(0.5, 0.5, 0.5, [
                    { offset: 0, color: 'rgba(41, 98, 255, 0.05)' },
                    { offset: 1, color: 'rgba(41, 98, 255, 0.22)' }
                  ])
                },
              },
              {
                value: radarData.avgScores,
                name: 'Sektörel Ortalama',
                itemStyle: { color: '#26a69a' },
                lineStyle: { width: 1.5, type: 'dashed' },
                areaStyle: {
                  color: new echarts.graphic.RadialGradient(0.5, 0.5, 0.5, [
                    { offset: 0, color: 'rgba(38, 166, 154, 0.02)' },
                    { offset: 1, color: 'rgba(38, 166, 154, 0.12)' }
                  ])
                },
              },
            ],
          },
        ],
    };

    radarInstance.current.setOption(radarOption, true);
    radarInstance.current.resize();
  }, [loading, allComparisonData, radarData, theme, symbol, kpis]);

  // --- Bar Chart Effect ---
  useEffect(() => {
    if (!barRef.current || loading || !allComparisonData) return;

    if (!barInstance.current) {
      barInstance.current = echarts.init(barRef.current);
    }

    const isDark = theme === 'dark';
    const textColor = isDark ? '#8a8e96' : '#555555';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';
    const tooltipBg = isDark ? '#141824' : '#ffffff';
    const tooltipBorder = isDark ? '#2e3546' : '#d0d0d0';
    const tooltipText = isDark ? '#e0e3eb' : '#1a1a2e';

    const dataset = allComparisonData.list.map((item) => {
      let val: number | null = 0;
      if (activeMetric === 'fk') val = item.kpis.fk;
      else if (activeMetric === 'pddd') val = item.kpis.pddd;
      else if (activeMetric === 'roe') val = item.kpis.roe;
      else if (activeMetric === 'margin') val = item.kpis.netKarMarji;
      else if (activeMetric === 'debt') val = item.kpis.borcOzkaynak;
      return { name: item.symbol, val: val || 0, isSelf: item.symbol === symbol };
    });

    const metricLabel = {
      fk: 'F/K Oranı (x)',
      pddd: 'PD/DD Oranı (x)',
      roe: 'ROE (%)',
      margin: 'Net Kâr Marjı (%)',
      debt: 'Borç / Özkaynak (x)',
    }[activeMetric];

    const barOption: echarts.EChartsOption = {
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
      grid: { left: 45, right: 15, top: 30, bottom: 35 },
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
            itemStyle: { color: d.isSelf ? '#2962ff' : '#26a69a', borderRadius: [4, 4, 0, 0] },
          })),
          barMaxWidth: 26,
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

    barInstance.current.setOption(barOption, true);
    barInstance.current.resize();
  }, [activeMetric, loading, allComparisonData, theme, symbol]);

  // Resize chart when tab becomes visible
  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeTab === 'radar') radarInstance.current?.resize();
      else if (activeTab === 'bar') barInstance.current?.resize();
    }, 50);
    return () => clearTimeout(timer);
  }, [activeTab]);

  // Clean up and resize observation on mount/unmount
  useEffect(() => {
    let radarRo: ResizeObserver | null = null;
    let barRo: ResizeObserver | null = null;

    if (radarRef.current) {
      radarRo = new ResizeObserver(() => {
        radarInstance.current?.resize();
      });
      radarRo.observe(radarRef.current);
    }

    if (barRef.current) {
      barRo = new ResizeObserver(() => {
        barInstance.current?.resize();
      });
      barRo.observe(barRef.current);
    }

    return () => {
      radarRo?.disconnect();
      barRo?.disconnect();
      radarInstance.current?.dispose();
      barInstance.current?.dispose();
    };
  }, []);

  // Sorted list for Peers Table
  const sortedPeersList = useMemo(() => {
    if (!allComparisonData) return [];
    const { list } = allComparisonData;
    const result = [...list];

    result.sort((a, b) => {
      let valA: any;
      let valB: any;

      if (sortField === 'symbol') {
        valA = a.symbol;
        valB = b.symbol;
      } else {
        const kpiKey = {
          fk: 'fk',
          pddd: 'pddd',
          roe: 'roe',
          margin: 'netKarMarji',
          debt: 'borcOzkaynak'
        }[sortField] as keyof FinancialKPIs;

        valA = a.kpis[kpiKey];
        valB = b.kpis[kpiKey];
      }

      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });

    return result;
  }, [allComparisonData, sortField, sortAsc]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const getSortIcon = (field: string) => {
    if (sortField !== field) return '↕️';
    return sortAsc ? '🔼' : '🔽';
  };

  return (
    <div className="fa-chart-card sector-comparison-card" style={{ gridColumn: 'span 2' }}>
      <div className="fa-chart-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px' }}>
        <span style={{ fontSize: '13px', fontWeight: 700 }}>
          Sektörel Karşılaştırma Matrisi <span className="sector-tag">{currentSector}</span>
        </span>
        <div className="fa-toggle" style={{ margin: 0 }}>
          <button className={`fa-toggle-btn ${activeTab === 'radar' ? 'active' : ''}`} onClick={() => setActiveTab('radar')}>
            🕸️ Radar Analizi
          </button>
          <button className={`fa-toggle-btn ${activeTab === 'peers' ? 'active' : ''}`} onClick={() => setActiveTab('peers')}>
            📋 Akran Listesi
          </button>
          <button className={`fa-toggle-btn ${activeTab === 'bar' ? 'active' : ''}`} onClick={() => setActiveTab('bar')}>
            📊 Akran Kıyaslama
          </button>
        </div>
      </div>
      
      <div className="fa-chart-body sector-comparison-body" style={{ minHeight: '390px', padding: '14px' }}>
        {loading && (
          <div className="fin-loading" style={{ height: '320px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="fa-loading-spinner" style={{ marginRight: '10px', width: '20px', height: '20px' }} />
            Akran verileri yükleniyor...
          </div>
        )}
        {error && <div className="fin-error">{error}</div>}
        
        {!loading && !error && peers.length === 0 && (
          <div className="fin-empty" style={{ height: '320px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            Bu sektör için kıyaslama verisi bulunamadı.
          </div>
        )}

        {!loading && !error && peers.length > 0 && (
          <>
            {/* Radar + Scorecard — always in DOM, hidden when not active */}
            <div style={{ display: activeTab === 'radar' ? 'block' : 'none' }}>
              {scorecard && (
                <div className="sector-comparison-layout">
                  {/* Left Side: Radar Chart */}
                  <div className="sector-chart-pane">
                    <div ref={radarRef} style={{ width: '100%', height: '320px' }} />
                    <div className="radar-legend-info">
                      💡 Grafikte dış çembere yakınlık olumlu performansı (düşük çarpanlar, yüksek kârlılık) temsil eder.
                    </div>
                  </div>

                  {/* Right Side: Scorecard Dashboard */}
                  <div className="sector-scorecard-pane">
                    <div className="scorecard-header">
                      <span className="scorecard-title">Sektörel Karne</span>
                      <div className="scorecard-summary-score">
                        Skor: <span className="score-val">{scorecard.score}</span>
                        <div className="score-bar-bg">
                          <div 
                            className="score-bar-fill" 
                            style={{ 
                              width: `${(scorecard.positiveCount / scorecard.totalCount) * 100}%`,
                              backgroundColor: scorecard.positiveCount >= 3 ? '#26a69a' : '#ff9800'
                            }} 
                          />
                        </div>
                      </div>
                    </div>
                    
                    <div className="scorecard-list">
                      {scorecard.items.map((item) => (
                        <div key={item.key} className="scorecard-item">
                          <div className="scorecard-item-left">
                            <span className="metric-name">{item.label}</span>
                            <div className="metric-compare-values">
                              <span>Hisse: <b>{item.valStr}</b></span>
                              <span className="val-divider">|</span>
                              <span>Ort: <b>{item.avgStr}</b></span>
                            </div>
                          </div>
                          <div className="scorecard-item-right">
                            <span className={`status-badge badge-${item.verdict.type}`}>
                              {item.verdict.text}
                            </span>
                            <span className="rank-badge" title="Sektör Sıralaması">
                              🥇 {item.rankStr}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {activeTab === 'peers' && (
              <div className="sector-peers-table-container">
                <table className="sector-peers-table">
                  <thead>
                    <tr>
                      <th onClick={() => handleSort('symbol')} style={{ cursor: 'pointer' }}>
                        Hisse {getSortIcon('symbol')}
                      </th>
                      <th onClick={() => handleSort('fk')} style={{ cursor: 'pointer', textAlign: 'right' }}>
                        F/K Oranı {getSortIcon('fk')}
                      </th>
                      <th onClick={() => handleSort('pddd')} style={{ cursor: 'pointer', textAlign: 'right' }}>
                        PD/DD Oranı {getSortIcon('pddd')}
                      </th>
                      <th onClick={() => handleSort('roe')} style={{ cursor: 'pointer', textAlign: 'right' }}>
                        Özsermaye Kâr. (ROE) {getSortIcon('roe')}
                      </th>
                      <th onClick={() => handleSort('margin')} style={{ cursor: 'pointer', textAlign: 'right' }}>
                        Net Kâr Marjı {getSortIcon('margin')}
                      </th>
                      <th onClick={() => handleSort('debt')} style={{ cursor: 'pointer', textAlign: 'right' }}>
                        Borç / Özkaynak {getSortIcon('debt')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPeersList.map((item) => {
                      const isSelf = item.symbol === symbol;
                      return (
                        <tr key={item.symbol} className={isSelf ? 'self-row' : ''}>
                          <td style={{ fontWeight: 600 }}>
                            {item.symbol} 
                            {isSelf && <span className="self-tag">Seçili</span>}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {item.kpis.fk ? item.kpis.fk.toFixed(1) + 'x' : '-'}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {item.kpis.pddd ? item.kpis.pddd.toFixed(2) + 'x' : '-'}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {item.kpis.roe !== null ? item.kpis.roe.toFixed(1) + '%' : '-'}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {item.kpis.netKarMarji !== null ? item.kpis.netKarMarji.toFixed(1) + '%' : '-'}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {item.kpis.borcOzkaynak !== null ? item.kpis.borcOzkaynak.toFixed(2) + 'x' : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Bar Chart — always in DOM, hidden when not active */}
            <div style={{ display: activeTab === 'bar' ? 'flex' : 'none', flexDirection: 'column', height: '330px' }}>
              <div className="bar-metric-selector" style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
                {(['fk', 'pddd', 'roe', 'margin', 'debt'] as const).map((m) => (
                  <button
                    key={m}
                    className={`fin-tab ${activeMetric === m ? 'active' : ''}`}
                    onClick={() => setActiveMetric(m)}
                    style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '4px' }}
                  >
                    {{
                      fk: 'F/K Oranı',
                      pddd: 'PD/DD Oranı',
                      roe: 'Özsermaye Kârlılığı',
                      margin: 'Net Kâr Marjı',
                      debt: 'Borç / Özkaynak',
                    }[m]}
                  </button>
                ))}
              </div>
              <div ref={barRef} style={{ flex: 1, width: '100%', minHeight: '260px' }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
