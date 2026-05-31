import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { CashFlowPoint } from '../../utils/computeFinancialMetrics';
import { getChartTheme } from '../../utils/chartTheme';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  data: CashFlowPoint[];
}

export default function CashFlowChart({ data }: Props) {
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

    const fmtAxis = (v: number) => {
      const a = Math.abs(v);
      if (a >= 1e9) return (v / 1e9).toFixed(0) + 'B';
      if (a >= 1e6) return (v / 1e6).toFixed(0) + 'M';
      return String(v);
    };

    inst.current.setOption(
      {
        title: { show: false },
        tooltip: {
          trigger: 'axis',
          backgroundColor: t.tooltipBg,
          borderColor: t.tooltipBorder,
          textStyle: { color: t.tooltipText, fontSize: 11 },
          formatter: (params: any) => {
            const fmtVal = (v: number) => {
              const a = Math.abs(v);
              if (a >= 1e9) return (v / 1e9).toFixed(1) + ' Mlr';
              if (a >= 1e6) return (v / 1e6).toFixed(1) + ' Mln';
              return v.toLocaleString('tr-TR');
            };
            const items = params.map((p: any) => `${p.marker} ${p.seriesName}: <b>${fmtVal(p.value ?? 0)}</b>`);
            return `<b>${params[0].axisValue}</b><br/>${items.join('<br/>')}`;
          },
        },
        legend: { type: 'scroll', top: 4, right: 12, textStyle: { color: t.titleColor, fontSize: 9 }, itemWidth: 10, itemHeight: 10 },
        grid: { left: 60, right: 15, top: 25, bottom: 24 },
        xAxis: {
          type: 'category',
          data: data.map((d) => d.label),
          axisLabel: { color: t.textColor, fontSize: 9 },
          axisLine: { lineStyle: { color: t.axisLineColor } },
          axisTick: { show: false },
        },
        yAxis: {
          type: 'value',
          axisLabel: { color: t.textColor, fontSize: 9, formatter: fmtAxis },
          splitLine: { lineStyle: { color: t.splitLineColor } },
          axisLine: { lineStyle: { color: t.axisLineColor } },
        },
        series: [
          {
            name: 'İşletme',
            type: 'bar',
            data: data.map((d) => d.operating),
            itemStyle: { color: '#26a69a' },
            barMaxWidth: 20,
          },
          {
            name: 'Yatırım',
            type: 'bar',
            data: data.map((d) => d.investing),
            itemStyle: { color: '#ef5350' },
            barMaxWidth: 20,
          },
          {
            name: 'Finansman',
            type: 'bar',
            data: data.map((d) => d.financing),
            itemStyle: { color: '#2962FF' },
            barMaxWidth: 20,
          },
          {
            name: 'Serbest Nakit',
            type: 'line',
            data: data.map((d) => d.freeCashFlow),
            itemStyle: { color: '#fdd835' },
            lineStyle: { width: 2 },
            symbolSize: 5,
          },
        ],
      },
      true,
    );
  }, [data, theme]);

  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}
