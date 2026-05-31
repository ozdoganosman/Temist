import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { RevenueProfitPoint } from '../../utils/computeFinancialMetrics';
import { getChartTheme } from '../../utils/chartTheme';
import { useTheme } from '../../contexts/ThemeContext';

function fmtVal(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(1) + ' Mlr';
  if (abs >= 1e6) return (v / 1e6).toFixed(1) + ' Mln';
  return v.toLocaleString('tr-TR');
}

interface Props {
  data: RevenueProfitPoint[];
}

export default function RevenueNetIncomeChart({ data }: Props) {
  const { theme } = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    inst.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, []);

  useEffect(() => {
    if (!inst.current || !data.length) return;
    const t = getChartTheme();
    inst.current.setOption(
      {
        title: { show: false },
        tooltip: {
          trigger: 'axis',
          backgroundColor: t.tooltipBg,
          borderColor: t.tooltipBorder,
          textStyle: { color: t.tooltipText, fontSize: 11 },
          formatter: (params: any) => {
            const items = params.map((p: any) => `${p.marker} ${p.seriesName}: <b>${fmtVal(p.value)}</b>`);
            return `<b>${params[0].axisValue}</b><br/>${items.join('<br/>')}`;
          },
        },
        legend: { type: 'scroll', top: 4, right: 12, textStyle: { color: t.titleColor, fontSize: 10 }, itemWidth: 12, itemHeight: 10 },
        grid: { left: 55, right: 55, top: 25, bottom: 24 },
        xAxis: {
          type: 'category',
          data: data.map((d) => d.label),
          axisLabel: { color: t.textColor, fontSize: 9 },
          axisLine: { lineStyle: { color: t.axisLineColor } },
          axisTick: { show: false },
        },
        yAxis: [
          {
            type: 'value',
            axisLabel: {
              color: '#2962FF',
              fontSize: 9,
              formatter: (v: number) => {
                const a = Math.abs(v);
                if (a >= 1e9) return (v / 1e9).toFixed(0) + 'B';
                if (a >= 1e6) return (v / 1e6).toFixed(0) + 'M';
                return String(v);
              },
            },
            splitLine: { lineStyle: { color: t.splitLineColor } },
            axisLine: { lineStyle: { color: t.axisLineColor } },
          },
          {
            type: 'value',
            position: 'right',
            splitLine: { show: false },
            axisLabel: {
              color: '#26a69a',
              fontSize: 9,
              formatter: (v: number) => {
                const a = Math.abs(v);
                if (a >= 1e9) return (v / 1e9).toFixed(0) + 'B';
                if (a >= 1e6) return (v / 1e6).toFixed(0) + 'M';
                return String(v);
              },
            },
            axisLine: { lineStyle: { color: t.axisLineColor } },
          }
        ],
        series: [
          {
            name: 'Hasılat',
            type: 'bar',
            yAxisIndex: 0,
            data: data.map((d) => d.revenue),
            itemStyle: { color: '#2962FF' },
            barMaxWidth: 28,
          },
          {
            name: 'Net Kâr',
            type: 'line',
            yAxisIndex: 1,
            data: data.map((d) => d.netIncome),
            itemStyle: { color: '#26a69a' },
            lineStyle: { width: 2 },
            symbolSize: 4,
          },
        ],
      },
      true,
    );
  }, [data, theme]);

  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}
