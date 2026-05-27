import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as echarts from 'echarts';
import type { Interval, LegendData } from './types';
import type { OHLCVData } from '../../api/borsaApi';
import { DEFAULT_BOLLINGER_CONFIGS } from '../../utils/regressionChannels';
import type { BollingerOverlayResult } from '../../utils/regressionChannels';
import { computeAllBollingerOverlays } from '../../utils/regressionChannels';
import {
  computeCombinedSignals,
  extractCombinedSignalEvents,
  DEFAULT_SIGNAL_CONFIG,
} from '../../utils/signalDetection';
import type { SignalConfig, SignalEvent } from '../../utils/signalDetection';
import { isIntraday } from './types';
import { buildOption, getThemeColors, getPaddingCount, getGridMargins } from './chartBuilder';
import { buildSignalScatterSeries } from './signalRenderer';
import './ChartContainer.css';

// Keep import reference for future use (signal scatter is already called inside buildOption)
void buildSignalScatterSeries;

interface ChartContainerProps {
  data: OHLCVData[];
  symbol: string;
  interval: Interval;
  onLegendUpdate: (data: LegendData | null) => void;
  showBollinger?: boolean;
  showRSI?: boolean;
  showMACD?: boolean;
  showStochRSI?: boolean;
  showSuperTrend?: boolean;
  showIchimoku?: boolean;
  showOBV?: boolean;
  showWilliamsPasa?: boolean;
  showNizamiCedid?: boolean;
  showEMAOverlay?: boolean;
  showPearsonChannels?: boolean;
  showMATLRNS?: boolean;
  showSignals?: boolean;
  signalConfig?: SignalConfig;
  logScale?: boolean;
}

export default function ChartContainer({
  data,
  symbol,
  interval,
  onLegendUpdate,
  showBollinger = false,
  showRSI = false,
  showMACD = false,
  showStochRSI = false,
  showSuperTrend = false,
  showIchimoku = false,
  showOBV = false,
  showWilliamsPasa = false,
  showNizamiCedid = false,
  showEMAOverlay = false,
  showPearsonChannels = false,
  showMATLRNS = false,
  showSignals = false,
  signalConfig,
  logScale = false,
}: ChartContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const lastBarRef = useRef<OHLCVData | null>(null);
  const currentDataRef = useRef<OHLCVData[]>([]);
  const symbolRef = useRef(symbol);
  useEffect(() => {
    symbolRef.current = symbol;
  }, [symbol]);
  const intervalRef = useRef(interval);
  useEffect(() => {
    intervalRef.current = interval;
  }, [interval]);
  const onLegendUpdateRef = useRef(onLegendUpdate);
  useEffect(() => {
    onLegendUpdateRef.current = onLegendUpdate;
  }, [onLegendUpdate]);

  // Toggle visibility of individual Bollinger bands
  const [visibleBollinger, setVisibleBollinger] = useState<Set<string>>(
    () => new Set(DEFAULT_BOLLINGER_CONFIGS.map((c) => c.id)),
  );

  const toggleBollinger = useCallback((id: string) => {
    setVisibleBollinger((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  void toggleBollinger; // reserved for future UI

  const filtered = data;

  // Compute combined signal events for scatter markers
  const signalEvents = useMemo<SignalEvent[]>(() => {
    if (!showSignals || filtered.length < 60) return [];
    const cfg = signalConfig ?? DEFAULT_SIGNAL_CONFIG;
    const combined = computeCombinedSignals(filtered, cfg);
    return extractCombinedSignalEvents(combined, filtered);
  }, [filtered, showSignals, signalConfig]);

  // Compute Bollinger overlay values for display table
  const bollingerResults = useMemo<BollingerOverlayResult[]>(() => {
    if (!showBollinger || filtered.length < 20) return [];
    const closePrices = filtered.map((d) => d.close);
    return computeAllBollingerOverlays(closePrices);
  }, [filtered, showBollinger]);

  void bollingerResults; // used internally by buildOption

  // Initialize chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = echarts.init(containerRef.current, undefined, { renderer: 'canvas' });
    chartInstanceRef.current = chart;

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    const ro = new ResizeObserver(handleResize);
    ro.observe(containerRef.current);

    // Drag-to-pan: left-click drag pans both X and Y axes simultaneously
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let startZoomStart = 0;
    let startZoomEnd = 100;
    let startYMin = 0;
    let startYMax = 0;
    let dragOnPriceAxis = false;
    let priceAxisDragStartY = 0;
    let priceAxisStartYMin = 0;
    let priceAxisStartYMax = 0;
    let activeYAxisIdx = 0;
    let activeYAxisId = 'y-axis-price';

    // Cursor change on hover over axis areas
    const setCursorOnAll = (cursor: string) => {
      if (!containerRef.current) return;
      containerRef.current.style.cursor = cursor;
      const canvases = containerRef.current.querySelectorAll('canvas');
      canvases.forEach((c) => {
        c.style.cursor = cursor;
      });
    };
    const SLIDER_ZONE_HEIGHT = 34;
    const onHoverMove = (e: MouseEvent) => {
      if (!containerRef.current || dragging || dragOnPriceAxis) return;
      const rect = containerRef.current.getBoundingClientRect();
      const margins = getGridMargins();
      const gridRight = rect.right - margins.right;
      const gridLeft = rect.left + margins.left;
      const distFromBottom = rect.bottom - e.clientY;
      const clickY = e.clientY - rect.top;

      if (distFromBottom > SLIDER_ZONE_HEIGHT && (e.clientX > gridRight || e.clientX < gridLeft)) {
        const opt = chart.getOption() as any;
        const grids = opt.grid || [];
        const testX = rect.width / 2;
        let overGrid = false;
        for (let i = 0; i < grids.length; i++) {
          if (chart.containPixel({ gridIndex: i }, [testX, clickY])) {
            overGrid = true;
            break;
          }
        }
        if (overGrid) {
          setCursorOnAll('ns-resize');
        } else {
          setCursorOnAll('');
        }
      } else {
        setCursorOnAll('');
      }
    };

    const handleDragStart = (clientX: number, clientY: number, preventDefault: () => void) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const margins = getGridMargins();
      const gridLeft = rect.left + margins.left;
      const gridRight = rect.right - margins.right;
      const distFromBottom = rect.bottom - clientY;
      const clickY = clientY - rect.top;

      // Let ECharts handle slider zone natively
      if (distFromBottom <= SLIDER_ZONE_HEIGHT) {
        return;
      }

      if (clientX < gridLeft || clientX > gridRight) {
        dragOnPriceAxis = true;
        priceAxisDragStartY = clientY;

        const opt = chart.getOption() as any;
        const grids = opt.grid || [];
        const yAxes = opt.yAxis || [];
        const testX = rect.width / 2;

        let gIdx = 0;
        for (let i = 0; i < grids.length; i++) {
          if (chart.containPixel({ gridIndex: i }, [testX, clickY])) {
            gIdx = i;
            break;
          }
        }

        activeYAxisIdx = 0;
        activeYAxisId = 'y-axis-price';
        if (clientX < gridLeft) {
          const foundIdx = yAxes.findIndex((y: any) => y.id === 'y-axis-volume');
          if (foundIdx !== -1) {
            activeYAxisIdx = foundIdx;
            activeYAxisId = 'y-axis-volume';
          }
        } else {
          const foundIdx = yAxes.findIndex((y: any) => y.gridIndex === gIdx && y.position !== 'left');
          if (foundIdx !== -1) {
            activeYAxisIdx = foundIdx;
            activeYAxisId = yAxes[foundIdx].id || 'y-axis-price';
          }
        }

        const yAxisModel = (chart as any).getModel()?.getComponent('yAxis', activeYAxisIdx) as any;
        const extent = yAxisModel?.axis?.scale?.getExtent?.();
        if (extent) {
          priceAxisDragStartY = clientY;
          priceAxisStartYMin = extent[0];
          priceAxisStartYMax = extent[1];
        }
        preventDefault();
        return;
      }

      dragging = true;
      dragStartX = clientX;
      dragStartY = clientY;
      const opt = chart.getOption() as any;
      const grids = opt.grid || [];
      const yAxes = opt.yAxis || [];
      const testX = rect.width / 2;

      let gIdx = 0;
      for (let i = 0; i < grids.length; i++) {
        if (chart.containPixel({ gridIndex: i }, [testX, clickY])) {
          gIdx = i;
          break;
        }
      }

      startZoomStart = opt.dataZoom?.[0]?.start ?? 0;
      startZoomEnd = opt.dataZoom?.[0]?.end ?? 100;

      activeYAxisIdx = 0;
      activeYAxisId = 'y-axis-price';
      const foundIdx = yAxes.findIndex((y: any) => y.gridIndex === gIdx && y.position !== 'left');
      if (foundIdx !== -1) {
        activeYAxisIdx = foundIdx;
        activeYAxisId = yAxes[foundIdx].id || 'y-axis-price';
      }
      const yAxisModel2 = (chart as any).getModel()?.getComponent('yAxis', activeYAxisIdx) as any;
      const extent2 = yAxisModel2?.axis?.scale?.getExtent?.();
      if (extent2) {
        startYMin = extent2[0];
        startYMax = extent2[1];
      }
      preventDefault();
    };

    const handleDragMove = (clientX: number, clientY: number, preventDefault?: () => void) => {
      if (!containerRef.current) return;

      if (dragOnPriceAxis) {
        if (preventDefault) preventDefault();
        const dy = clientY - priceAxisDragStartY;
        const rect = containerRef.current.getBoundingClientRect();
        
        const opt = chart.getOption() as any;
        const yAxes = opt.yAxis || [];
        const gIdx = yAxes[activeYAxisIdx]?.gridIndex ?? 0;
        const gridHeight = gIdx === 0 ? (rect.height - 70) : 120;

        const yRange = priceAxisStartYMax - priceAxisStartYMin;
        const mid = (priceAxisStartYMin + priceAxisStartYMax) / 2;
        const scaleFactor = 1 + (dy / gridHeight) * 2;
        const newHalf = (yRange / 2) * Math.max(0.1, scaleFactor);
        
        chart.setOption({
          yAxis: [
            {
              id: activeYAxisId,
              min: mid - newHalf,
              max: mid + newHalf,
            },
          ],
        });
        return;
      }

      if (!dragging) return;
      if (preventDefault) preventDefault();
      const rect = containerRef.current.getBoundingClientRect();

      const dx = clientX - dragStartX;
      const pxRange = rect.width;
      const zoomRange = startZoomEnd - startZoomStart;
      const shift = -(dx / pxRange) * zoomRange;
      const newStart = startZoomStart + shift;
      const newEnd = startZoomEnd + shift;

      chart.dispatchAction({
        type: 'dataZoom',
        dataZoomIndex: 0,
        start: newStart,
        end: newEnd,
      });

      if (activeYAxisId && activeYAxisId !== '') {
        const dy = clientY - dragStartY;
        const opt = chart.getOption() as any;
        const yAxes = opt.yAxis || [];
        const gIdx = yAxes[activeYAxisIdx]?.gridIndex ?? 0;
        const gridHeight = gIdx === 0 ? (rect.height - 70) : 120;

        const yRange = startYMax - startYMin;
        const yShift = (dy / gridHeight) * yRange;

        chart.setOption({
          yAxis: [
            {
              id: activeYAxisId,
              min: startYMin + yShift,
              max: startYMax + yShift,
            },
          ],
        });
      }
    };

    const handleDragEnd = () => {
      dragging = false;
      dragOnPriceAxis = false;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      handleDragStart(e.clientX, e.clientY, () => e.preventDefault());
    };

    const onMouseMove = (e: MouseEvent) => {
      handleDragMove(e.clientX, e.clientY);
    };

    const onMouseUp = () => {
      handleDragEnd();
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        handleDragStart(touch.clientX, touch.clientY, () => {
          if (e.cancelable) e.preventDefault();
        });
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        handleDragMove(touch.clientX, touch.clientY, () => {
          if (e.cancelable) e.preventDefault();
        });
      }
    };

    const onTouchEnd = () => {
      handleDragEnd();
    };

    const el = containerRef.current;
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('mousemove', onHoverMove);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchend', onTouchEnd);

    const onDblClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const margins = getGridMargins();
      const gridLeft = rect.left + margins.left;
      const gridRight = rect.right - margins.right;
      const distFromBottom = rect.bottom - e.clientY;
      const clickY = e.clientY - rect.top;

      // Let ECharts handle slider zone natively
      if (distFromBottom <= SLIDER_ZONE_HEIGHT) {
        return;
      }

      const opt = chart.getOption() as any;
      const yAxes = opt.yAxis || [];

      // Calculate default volume max limit to prevent volume bars from overlapping the price chart
      const maxVol = filtered.reduce((m, d) => Math.max(m, d.volume), 0);
      const volAxisMax = maxVol > 0 ? maxVol * 10 : 100;

      if (e.clientX < gridLeft || e.clientX > gridRight) {
        const grids = opt.grid || [];
        const testX = rect.width / 2;

        let gIdx = 0;
        for (let i = 0; i < grids.length; i++) {
          if (chart.containPixel({ gridIndex: i }, [testX, clickY])) {
            gIdx = i;
            break;
          }
        }

        let targetYAxisId = 'y-axis-price';
        if (e.clientX < gridLeft) {
          const foundIdx = yAxes.findIndex((y: any) => y.id === 'y-axis-volume');
          if (foundIdx !== -1) {
            targetYAxisId = 'y-axis-volume';
          }
        } else {
          const foundIdx = yAxes.findIndex((y: any) => y.gridIndex === gIdx && y.position !== 'left');
          if (foundIdx !== -1) {
            targetYAxisId = yAxes[foundIdx].id || 'y-axis-price';
          }
        }

        if (targetYAxisId === 'y-axis-volume') {
          chart.setOption({
            yAxis: [
              {
                id: 'y-axis-volume',
                min: 0,
                max: volAxisMax,
              },
            ],
          });
        } else {
          chart.setOption({
            yAxis: [
              {
                id: targetYAxisId,
                min: undefined,
                max: undefined,
              },
            ],
          });
        }
      } else {
        const newYAxisOpt = yAxes.map((y: any) => {
          if (y.id === 'y-axis-volume') {
            return {
              id: y.id,
              min: 0,
              max: volAxisMax,
            };
          }
          return {
            id: y.id,
            min: undefined,
            max: undefined,
          };
        });
        chart.setOption({
          yAxis: newYAxisOpt,
        });
      }
    };
    el.addEventListener('dblclick', onDblClick);

    // Crosshair tracking for legend
    chart.on('updateAxisPointer', (params: unknown) => {
      const p = params as { axesInfo?: Array<{ axisDim?: string; value?: number }> };
      const xInfo = p.axesInfo?.find((a) => a.axisDim === 'x');
      if (xInfo?.value != null && currentDataRef.current.length > 0) {
        const dataIndex = Math.round(xInfo.value);
        const realIdx = dataIndex - getPaddingCount(currentDataRef.current.length, isIntraday(intervalRef.current));
        const bar = currentDataRef.current[realIdx];
        if (bar) {
          const prevClose = realIdx > 0 ? currentDataRef.current[realIdx - 1].close : bar.open;
          onLegendUpdateRef.current({
            symbol: symbolRef.current,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
            time: bar.date,
            prevClose,
          });
        } else {
          onLegendUpdateRef.current(null);
        }
      }
    });

    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('mousemove', onHoverMove);
      el.removeEventListener('dblclick', onDblClick);
      ro.disconnect();
      chart.dispose();
      chartInstanceRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track previous data identity to decide whether to preserve zoom
  const prevDataLenRef = useRef<number>(0);
  const prevSymbolRef = useRef<string>(symbol);

  // Update chart when data/type/timeframe changes
  const updateChart = useCallback(() => {
    const chart = chartInstanceRef.current;
    if (!chart) return;

    const dataChanged = filtered.length !== prevDataLenRef.current || symbol !== prevSymbolRef.current;
    let savedZoom: { start: number; end: number } | null = null;
    if (!dataChanged) {
      const opt = chart.getOption() as { dataZoom?: Array<{ start?: number; end?: number }> } | undefined;
      if (opt?.dataZoom && opt.dataZoom.length > 0) {
        savedZoom = {
          start: opt.dataZoom[0].start ?? 0,
          end: opt.dataZoom[0].end ?? 100,
        };
      }
    }
    prevDataLenRef.current = filtered.length;
    prevSymbolRef.current = symbol;

    currentDataRef.current = [...filtered];
    const themeColors = getThemeColors();
    const newOption = buildOption(
      filtered,
      symbol,
      showBollinger,
      visibleBollinger,
      showRSI,
      showMACD,
      showStochRSI,
      logScale,
      themeColors,
      signalEvents,
      signalConfig,
      showSuperTrend,
      showIchimoku,
      showOBV,
      interval,
      showWilliamsPasa,
      showNizamiCedid,
      showEMAOverlay,
      showPearsonChannels,
      showMATLRNS,
    );

    if (savedZoom && Array.isArray(newOption.dataZoom)) {
      for (const dz of newOption.dataZoom as Array<{ start?: number; end?: number }>) {
        dz.start = savedZoom.start;
        dz.end = savedZoom.end;
      }
    }

    chart.setOption(newOption, true);
    if (filtered.length > 0) {
      lastBarRef.current = { ...filtered[filtered.length - 1] };
    }
  }, [
    filtered,
    symbol,
    interval,
    showBollinger,
    visibleBollinger,
    showRSI,
    showMACD,
    showStochRSI,
    showSuperTrend,
    showIchimoku,
    showOBV,
    showWilliamsPasa,
    showNizamiCedid,
    showEMAOverlay,
    showPearsonChannels,
    showMATLRNS,
    logScale,
    signalEvents,
    signalConfig,
  ]);

  useEffect(() => {
    updateChart();
  }, [updateChart]);

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      <div ref={containerRef} className="chart-container" />
    </div>
  );
}
