import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { getChartTheme } from '../../utils/chartTheme';

interface Props {
  scores: {
    williamsPasa: number;
    nizamiCedid: number;
    emaRibbon: number;
    pearson: number;
  };
}

export default function IndicatorRadarChart({ scores }: Props) {
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
    if (!inst.current) return;
    const t = getChartTheme();
    
    inst.current.setOption({
      tooltip: {
        trigger: 'item',
        backgroundColor: t.tooltipBg,
        borderColor: t.tooltipBorder,
        textStyle: { color: t.tooltipText, fontSize: 12 },
      },
      radar: {
        indicator: [
          { name: 'Williams Paşa', max: 20 },
          { name: 'Nizami Cedid', max: 20 },
          { name: 'EMA Ribbon', max: 20 },
          { name: 'Pearson', max: 20 },
        ],
        shape: 'circle',
        radius: '62%',
        center: ['50%', '50%'],
        axisNameGap: 14,
        splitNumber: 4,
        axisLabel: {
          show: false,
        },
        axisName: {
          color: t.titleColor,
          fontSize: 10,
          fontFamily: 'Outfit, Inter, sans-serif',
          fontWeight: 'bold',
        },
        splitLine: {
          lineStyle: {
            color: t.axisLineColor,
          },
        },
        splitArea: {
          show: true,
          areaStyle: {
            color: ['rgba(26, 30, 46, 0.3)', 'rgba(42, 46, 62, 0.3)'],
          },
        },
        axisLine: {
          lineStyle: {
            color: t.axisLineColor,
          },
        },
      },
      series: [
        {
          name: 'İndikatör Skorları',
          type: 'radar',
          data: [
            {
              value: [
                scores.williamsPasa,
                scores.nizamiCedid,
                scores.emaRibbon,
                scores.pearson,
              ],
              name: 'Skor (Maks 20)',
              symbol: 'circle',
              symbolSize: 6,
              label: {
                show: false,
              },
              lineStyle: {
                width: 2,
                color: '#3b82f6', // Neon blue color
              },
              itemStyle: {
                color: '#60a5fa',
              },
              areaStyle: {
                color: new echarts.graphic.RadialGradient(0.5, 0.5, 0.9, [
                  { offset: 0, color: 'rgba(59, 130, 246, 0.1)' },
                  { offset: 1, color: 'rgba(59, 130, 246, 0.5)' },
                ]),
              },
            },
          ],
        },
      ],
    }, true);

    // Call resize on delayed ticks to handle React render cycle and slide-in drawer CSS transitions
    const timer1 = setTimeout(() => inst.current?.resize(), 50);
    const timer2 = setTimeout(() => inst.current?.resize(), 200);
    const timer3 = setTimeout(() => inst.current?.resize(), 500);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [scores]);

  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}
