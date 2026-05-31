import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { getChartTheme } from '../../utils/chartTheme';

export interface HeatmapItem {
  symbol: string;
  close: number;
  changePercent: number;
  overallScore: number;
  marketCap: number;
}

interface Props {
  data: HeatmapItem[];
  onSelectStock: (symbol: string) => void;
  colorBy: 'change' | 'score';
}

export default function ScanHeatmap({ data, onSelectStock, colorBy }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    inst.current = chart;

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);

    chart.on('click', (params: any) => {
      // Retrieve symbol from clicked node
      if (params.data && params.data.symbol) {
        onSelectStock(params.data.symbol);
      }
    });

    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [onSelectStock]);

  useEffect(() => {
    if (!inst.current) return;
    const t = getChartTheme();

    // Map raw data points to ECharts treemap data nodes
    const treemapNodes = data.map((item) => {
      // Default to 100M if no market cap is loaded
      const sizeValue = item.marketCap && item.marketCap > 0 ? item.marketCap : 200_000_000;
      
      // Determine what value we are coloring by (visualMap targets the first value in value array)
      const colorValue = colorBy === 'change' ? item.changePercent : item.overallScore;

      return {
        name: item.symbol,
        // ECharts treemap uses the first element in value array for size, second for visual coloring
        value: [sizeValue, colorValue],
        symbol: item.symbol,
        close: item.close,
        changePercent: item.changePercent,
        overallScore: item.overallScore,
        marketCap: item.marketCap,
        label: {
          show: true,
          formatter: () => {
            const pct = item.changePercent >= 0 ? `+${item.changePercent.toFixed(1)}%` : `${item.changePercent.toFixed(1)}%`;
            return `${item.symbol}\n${pct}\nTeknik: ${item.overallScore}`;
          },
          fontSize: 11,
          fontWeight: 'bold',
          lineHeight: 14,
        }
      };
    });

    // Define visualMap range and colors based on coloring mode
    const visualMapConfig = colorBy === 'change'
      ? {
          min: -5,
          max: 5,
          calculable: true,
          dimension: 1, // Target index 1 of value array (colorValue)
          inRange: {
            color: ['#ef4444', '#2a2c35', '#10b981'], // Red to Grey to Green
          },
          textStyle: {
            color: t.titleColor,
            fontSize: 10,
          },
          orient: 'horizontal',
          left: 'center',
          bottom: 0,
          formatter: (v: number) => (v >= 0 ? `+${v.toFixed(1)}%` : `${v.toFixed(1)}%`),
        }
      : {
          min: 20,
          max: 85,
          calculable: true,
          dimension: 1, // Target index 1 of value array (colorValue)
          inRange: {
            color: ['#1e293b', '#2563eb', '#60a5fa'], // Slate to Blue to Neon Blue
          },
          textStyle: {
            color: t.titleColor,
            fontSize: 10,
          },
          orient: 'horizontal',
          left: 'center',
          bottom: 0,
        };

    const option: echarts.EChartsOption = {
      tooltip: {
        backgroundColor: t.tooltipBg,
        borderColor: t.tooltipBorder,
        textStyle: { color: t.tooltipText, fontSize: 12 },
        formatter: (info: any) => {
          const item = info.data;
          if (!item) return '';
          const mcapText = item.marketCap
            ? (item.marketCap >= 1_000_000_000
                ? `${(item.marketCap / 1_000_000_000).toFixed(2)} Milyar ₺`
                : `${(item.marketCap / 1_000_000).toFixed(2)} Milyon ₺`)
            : 'Hesaplanıyor...';

          return [
            `<div style="font-weight: bold; margin-bottom: 5px; font-size: 14px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 3px;">${item.symbol}</div>`,
            `Fiyat: <span style="font-family: monospace; font-weight: bold; color: #fff;">${item.close.toFixed(2)} ₺</span><br/>`,
            `Günlük Değişim: <span style="font-family: monospace; font-weight: bold; color: ${item.changePercent >= 0 ? '#10b981' : '#ef4444'}">${item.changePercent >= 0 ? '+' : ''}${item.changePercent.toFixed(2)}%</span><br/>`,
            `Teknik Skor: <span style="font-family: monospace; font-weight: bold; color: #60a5fa">${item.overallScore} / 100</span><br/>`,
            `Piyasa Değeri: <span style="font-family: monospace; color: #9aa0b0;">${mcapText}</span>`,
            `<div style="font-size: 10px; color: #888; margin-top: 8px; font-style: italic;">Detaylar için tıklayın</div>`
          ].join('');
        },
      },
      series: [
        {
          type: 'treemap',
          visibleMin: 250,
          data: treemapNodes,
          leafDepth: 1,
          width: '100%',
          height: '85%',
          top: '5%',
          bottom: '12%',
          roam: false, // Disable drag zoom for a solid clean dashboard feel
          nodeClick: false, // Disable ECharts auto drill-down (handled by our click listener)
          breadcrumb: {
            show: false, // Hide ECharts path bar
          },
          itemStyle: {
            borderColor: '#0c0d10',
            borderWidth: 2,
            gapWidth: 2,
          },
          levels: [
            {
              itemStyle: {
                borderWidth: 2,
                borderColor: '#0c0d10',
                gapWidth: 2,
              },
            },
          ],
        },
      ],
      // Add the responsive color bar visualMap
      visualMap: visualMapConfig as any,
    };

    inst.current.setOption(option, true);
  }, [data, colorBy]);

  return (
    <div
      ref={ref}
      style={{
        width: '100%',
        height: '100%',
        background: 'var(--bg-secondary, #14161d)',
        borderRadius: '12px',
        border: '1px solid var(--border-primary, #1f2229)',
        padding: '12px',
      }}
    />
  );
}
