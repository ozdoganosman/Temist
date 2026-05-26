/**
 * Custom hook for chart drag interactions:
 * - Drag-to-pan (X+Y axes)
 * - Price axis drag (Y zoom)
 * - Slider zone drag (X zoom)
 * - Double-click to reset Y axis
 */
import { useEffect, useRef } from 'react';
import type * as echarts from 'echarts';

export function useDragPan(
  containerRef: React.RefObject<HTMLDivElement | null>,
  chartInstanceRef: React.RefObject<echarts.ECharts | null>,
) {
  const stateRef = useRef({
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    startZoomStart: 0,
    startZoomEnd: 100,
    startYMin: 0,
    startYMax: 0,
    dragOnPriceAxis: false,
    priceAxisDragStartY: 0,
    priceAxisStartYMin: 0,
    priceAxisStartYMax: 0,
    sliderDragging: false,
    sliderDragStartX: 0,
    sliderStartZoomStart: 0,
    sliderStartZoomEnd: 100,
  });

  useEffect(() => {
    const el = containerRef.current;
    const chart = chartInstanceRef.current;
    if (!el || !chart) return;

    const s = stateRef.current;
    const SLIDER_ZONE_HEIGHT = 34;

    const setCursorOnAll = (cursor: string) => {
      if (!containerRef.current) return;
      containerRef.current.style.cursor = cursor;
      const canvases = containerRef.current.querySelectorAll('canvas');
      canvases.forEach((c) => {
        c.style.cursor = cursor;
      });
    };

    const onHoverMove = (e: MouseEvent) => {
      if (!containerRef.current || s.dragging || s.dragOnPriceAxis || s.sliderDragging) return;
      const rect = containerRef.current.getBoundingClientRect();
      const gridRight = rect.right - 80;
      const gridLeft = rect.left + 80;
      const distFromBottom = rect.bottom - e.clientY;
      if (distFromBottom <= SLIDER_ZONE_HEIGHT && e.clientX > gridLeft && e.clientX < gridRight) {
        setCursorOnAll('ew-resize');
      } else if (e.clientX > gridRight || e.clientX < gridLeft) {
        setCursorOnAll('ns-resize');
      } else {
        setCursorOnAll('');
      }
    };

    const getYExtent = (): [number, number] | null => {
      const yAxisModel = (chart as any).getModel()?.getComponent('yAxis', 0) as unknown as
        | { axis?: { scale?: { getExtent?: () => [number, number] } } }
        | undefined;
      return yAxisModel?.axis?.scale?.getExtent?.() ?? null;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current || e.button !== 0) return;
      const rect = containerRef.current.getBoundingClientRect();
      const gridLeft = rect.left + 80;
      const gridRight = rect.right - 80;
      const distFromBottom = rect.bottom - e.clientY;

      // Slider zone
      if (distFromBottom <= SLIDER_ZONE_HEIGHT && e.clientX > gridLeft && e.clientX < gridRight) {
        s.sliderDragging = true;
        s.sliderDragStartX = e.clientX;
        const opt = chart.getOption() as { dataZoom?: Array<{ start?: number; end?: number }> };
        s.sliderStartZoomStart = opt.dataZoom?.[0]?.start ?? 0;
        s.sliderStartZoomEnd = opt.dataZoom?.[0]?.end ?? 100;
        setCursorOnAll('ew-resize');
        e.preventDefault();
        return;
      }

      // Price axis (left or right)
      if (e.clientX < gridLeft || e.clientX > gridRight) {
        s.dragOnPriceAxis = true;
        s.priceAxisDragStartY = e.clientY;
        const extent = getYExtent();
        if (extent) {
          s.priceAxisStartYMin = extent[0];
          s.priceAxisStartYMax = extent[1];
        }
        e.preventDefault();
        return;
      }

      // Chart area drag
      s.dragging = true;
      s.dragStartX = e.clientX;
      s.dragStartY = e.clientY;
      const opt = chart.getOption() as { dataZoom?: Array<{ start?: number; end?: number }> };
      s.startZoomStart = opt.dataZoom?.[0]?.start ?? 0;
      s.startZoomEnd = opt.dataZoom?.[0]?.end ?? 100;
      const extent = getYExtent();
      if (extent) {
        s.startYMin = extent[0];
        s.startYMax = extent[1];
      }
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

      if (s.sliderDragging) {
        const dx = e.clientX - s.sliderDragStartX;
        const pxWidth = rect.width - 160;
        const range = s.sliderStartZoomEnd - s.sliderStartZoomStart;
        const mid = (s.sliderStartZoomStart + s.sliderStartZoomEnd) / 2;
        const scaleFactor = 1 + (dx / pxWidth) * 2;
        const newHalf = (range / 2) * Math.max(0.02, scaleFactor);
        const newStart = Math.max(0, mid - newHalf);
        const newEnd = Math.min(100, mid + newHalf);
        chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start: newStart, end: newEnd });
        chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 1, start: newStart, end: newEnd });
        return;
      }

      if (s.dragOnPriceAxis) {
        const dy = e.clientY - s.priceAxisDragStartY;
        const pxHeight = rect.height - 70;
        const yRange = s.priceAxisStartYMax - s.priceAxisStartYMin;
        const mid = (s.priceAxisStartYMin + s.priceAxisStartYMax) / 2;
        const scaleFactor = 1 + (dy / pxHeight) * 2;
        const newHalf = (yRange / 2) * Math.max(0.1, scaleFactor);
        chart.setOption({ yAxis: [{ min: mid - newHalf, max: mid + newHalf }] });
        return;
      }

      if (!s.dragging) return;

      // Horizontal pan
      const dx = e.clientX - s.dragStartX;
      const pxRange = rect.width;
      const zoomRange = s.startZoomEnd - s.startZoomStart;
      const shift = -(dx / pxRange) * zoomRange;
      chart.dispatchAction({
        type: 'dataZoom',
        dataZoomIndex: 0,
        start: s.startZoomStart + shift,
        end: s.startZoomEnd + shift,
      });

      // Vertical pan
      const dy = e.clientY - s.dragStartY;
      const pxHeight = rect.height - 70;
      const yRange = s.startYMax - s.startYMin;
      const yShift = (dy / pxHeight) * yRange;
      chart.setOption({ yAxis: [{ min: s.startYMin + yShift, max: s.startYMax + yShift }] });
    };

    const onMouseUp = () => {
      s.dragging = false;
      s.dragOnPriceAxis = false;
      s.sliderDragging = false;
    };

    const onDblClick = () => {
      chart.setOption({ yAxis: [{ min: undefined, max: undefined }] });
    };

    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('mousemove', onHoverMove);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    el.addEventListener('dblclick', onDblClick);

    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('mousemove', onHoverMove);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('dblclick', onDblClick);
    };
  }, [containerRef, chartInstanceRef]);
}
