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

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '-';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
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
            const idx = params[0]?.dataIndex ?? 0;
            const row = data[idx];
            const lines = params.map((p: any) => {
              if (p.seriesName === 'Net Marj') {
                return `${p.marker} ${p.seriesName}: <b>${fmtPct(p.value)}</b>`;
              }
              return `${p.marker} ${p.seriesName}: <b>${fmtVal(p.value)}</b>`;
            });
            const extra: string[] = [];
            if (row?.revenueYoYPct != null) {
              extra.push(`Hasılat YoY: <b>${fmtPct(row.revenueYoYPct)}</b>`);
            }
            if (row?.netIncomeYoYPct != null) {
              extra.push(`Net Kâr YoY: <b>${fmtPct(row.netIncomeYoYPct)}</b>`);
            }
            return `<b>${params[0].axisValue}</b><br/>${lines.join('<br/>')}${
              extra.length ? `<br/><span style="opacity:0.85">${extra.join('<br/>')}</span>` : ''
            }`;
          },
        },
        legend: {
          type: 'scroll',
          top: 4,
          right: 12,
          textStyle: { color: t.titleColor, fontSize: 10 },
          itemWidth: 12,
          itemHeight: 10,
        },
        grid: { left: 55, right: 62, top: 28, bottom: 24 },
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
            name: 'TL',
            nameTextStyle: { color: '#2962FF', fontSize: 9 },
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
            name: 'TL',
            nameTextStyle: { color: '#26a69a', fontSize: 9 },
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
          },
          {
            type: 'value',
            position: 'right',
            offset: 48,
            name: '%',
            nameTextStyle: { color: '#ff9800', fontSize: 9 },
            splitLine: { show: false },
            axisLabel: {
              color: '#ff9800',
              fontSize: 9,
              formatter: (v: number) => `${v}%`,
            },
            axisLine: { show: false },
          },
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
          {
            name: 'Net Marj',
            type: 'line',
            yAxisIndex: 2,
            data: data.map((d) => d.netMarginPct),
            itemStyle: { color: '#ff9800' },
            lineStyle: { width: 2, type: 'dashed' },
            symbolSize: 5,
            connectNulls: false,
            label: {
              show: true,
              position: 'top',
              distance: 4,
              color: '#ff9800',
              fontSize: 9,
              formatter: (p: { value: number | null }) =>
                p.value != null && Number.isFinite(p.value) ? `${p.value.toFixed(1)}%` : '',
            },
          },
        ],
      },
      true,
    );
  }, [data, theme]);

  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}
