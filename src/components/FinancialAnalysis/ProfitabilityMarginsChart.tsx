import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { MarginPoint } from '../../utils/computeFinancialMetrics';
import { getChartTheme } from '../../utils/chartTheme';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  data: MarginPoint[];
}

export default function ProfitabilityMarginsChart({ data }: Props) {
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
            const items = params.map(
              (p: any) => `${p.marker} ${p.seriesName}: <b>${p.value != null ? p.value.toFixed(1) + '%' : '-'}</b>`,
            );
            return `<b>${params[0].axisValue}</b><br/>${items.join('<br/>')}`;
          },
        },
        legend: { type: 'scroll', top: 4, right: 12, textStyle: { color: t.titleColor, fontSize: 10 }, itemWidth: 12, itemHeight: 10 },
        grid: { left: 50, right: 15, top: 25, bottom: 24 },
        xAxis: {
          type: 'category',
          data: data.map((d) => d.label),
          axisLabel: { color: t.textColor, fontSize: 9 },
          axisLine: { lineStyle: { color: t.axisLineColor } },
          axisTick: { show: false },
        },
        yAxis: {
          type: 'value',
          axisLabel: { color: t.textColor, fontSize: 9, formatter: '{value}%' },
          splitLine: { lineStyle: { color: t.splitLineColor } },
          axisLine: { lineStyle: { color: t.axisLineColor } },
        },
        series: [
          {
            name: 'Brüt Marj',
            type: 'line',
            data: data.map((d) => d.grossMargin),
            itemStyle: { color: '#2962FF' },
            lineStyle: { width: 2 },
            symbolSize: 4,
            areaStyle: { color: 'rgba(41,98,255,0.05)' },
          },
          {
            name: 'Faaliyet Marjı',
            type: 'line',
            data: data.map((d) => d.operatingMargin),
            itemStyle: { color: '#ff6d00' },
            lineStyle: { width: 2 },
            symbolSize: 4,
          },
          {
            name: 'Net Marj',
            type: 'line',
            data: data.map((d) => d.netMargin),
            itemStyle: { color: '#26a69a' },
            lineStyle: { width: 2 },
            symbolSize: 4,
            areaStyle: { color: 'rgba(38,166,154,0.05)' },
          },
        ],
      },
      true,
    );
  }, [data, theme]);

  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}
