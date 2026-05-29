import { useState, useCallback, useEffect } from 'react';
import ChartContainer from '../Chart/ChartContainer';
import Legend from '../Legend/Legend';
import { SymbolSearch } from '../SymbolSearch/SymbolSearch';
import type { Interval, LegendData } from '../Chart/types';
import type { SymbolInfo } from '../../api/borsaApi';
import { useHistoryData } from '../../hooks/useHistoryData';
import './MultiChartView.css';

type Layout = '1x1' | '1x2' | '2x2';

interface ChartSlot {
  id: number;
  symbol: string;
}

interface MultiChartViewProps {
  symbols: SymbolInfo[];
  interval: Interval;
  showBollinger: boolean;
  showRSI: boolean;
  showMACD: boolean;
  showStochRSI: boolean;
  showSuperTrend: boolean;
  showIchimoku: boolean;
  showOBV: boolean;
  logScale: boolean;
}

function SlotChart({
  slot,
  symbols,
  interval,
  isActive,
  showBollinger,
  showRSI,
  showMACD,
  showStochRSI,
  showSuperTrend,
  showIchimoku,
  showOBV,
  logScale,
  onActivate,
  onSymbolChange,
  onRemove,
  showRemove,
}: {
  slot: ChartSlot;
  symbols: SymbolInfo[];
  interval: Interval;
  isActive: boolean;
  showBollinger: boolean;
  showRSI: boolean;
  showMACD: boolean;
  showStochRSI: boolean;
  showSuperTrend: boolean;
  showIchimoku: boolean;
  showOBV: boolean;
  logScale: boolean;
  onActivate: () => void;
  onSymbolChange: (symbol: string) => void;
  onRemove: () => void;
  showRemove: boolean;
}) {
  const { data, loading } = useHistoryData(slot.symbol, interval);
  const [legendData, setLegendData] = useState<LegendData | null>(null);

  const handleLegendUpdate = useCallback((d: LegendData | null) => {
    setLegendData(d);
  }, []);

  const lastBar = data.length > 0 ? data[data.length - 1] : null;
  const prevBar = data.length > 1 ? data[data.length - 2] : null;
  const displayName = symbols.find((s) => s.name === slot.symbol)?.displayName ?? '';

  return (
    <div className={`chart-slot ${isActive ? 'active' : ''}`} onClick={onActivate}>
      <div className="chart-slot-header">
        <SymbolSearch symbol={slot.symbol} symbols={symbols} onSymbolChange={onSymbolChange} compact />
        <span className="slot-symbol-name">{displayName}</span>
        {showRemove && (
          <button
            className="slot-close-btn"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            title="Kapat"
          >
            ✕
          </button>
        )}
      </div>
      <div className="chart-slot-body">
        <Legend
          data={legendData}
          symbol={slot.symbol}
          lastClose={lastBar?.close ?? 0}
          prevClose={prevBar?.close ?? lastBar?.close ?? 0}
          lastVolume={lastBar?.volume ?? 0}
        />
        {loading ? (
          <div className="loading-overlay">Veri yukleniyor...</div>
        ) : (
          <ChartContainer
            data={data}
            symbol={slot.symbol}
            interval={interval}
            onLegendUpdate={handleLegendUpdate}
            showBollinger={showBollinger}
            showRSI={showRSI}
            showMACD={showMACD}
            showStochRSI={showStochRSI}
            showSuperTrend={showSuperTrend}
            showIchimoku={showIchimoku}
            showOBV={showOBV}
            logScale={logScale}
            showCommentary={false}
          />
        )}
      </div>
    </div>
  );
}

const DEFAULT_SYMBOLS = ['THYAO', 'GARAN', 'AKBNK', 'ASELS'];

export default function MultiChartView({
  symbols,
  interval,
  showBollinger,
  showRSI,
  showMACD,
  showStochRSI,
  showSuperTrend,
  showIchimoku,
  showOBV,
  logScale,
}: MultiChartViewProps) {
  const [layout, setLayout] = useState<Layout>('2x2');
  const [slots, setSlots] = useState<ChartSlot[]>(() => DEFAULT_SYMBOLS.map((sym, i) => ({ id: i, symbol: sym })));
  const [activeSlotId, setActiveSlotId] = useState(0);

  const maxSlots = layout === '1x1' ? 1 : layout === '1x2' ? 2 : 4;
  const visibleSlots = slots.slice(0, maxSlots);

  const handleSymbolChange = useCallback((slotId: number, symbol: string) => {
    setSlots((prev) => prev.map((s) => (s.id === slotId ? { ...s, symbol } : s)));
  }, []);

  const handleRemove = useCallback((slotId: number) => {
    setSlots((prev) => {
      const next = prev.filter((s) => s.id !== slotId);
      if (next.length === 0) return [{ id: 0, symbol: 'THYAO' }];
      return next;
    });
  }, []);

  useEffect(() => {
    if (!visibleSlots.find((s) => s.id === activeSlotId) && visibleSlots.length > 0) {
      setActiveSlotId(visibleSlots[0].id);
    }
  }, [visibleSlots, activeSlotId]);

  return (
    <div className="multichart-container">
      <div className="multichart-layout-bar">
        <span className="layout-label">Duzenleme:</span>
        {(['1x1', '1x2', '2x2'] as Layout[]).map((l) => (
          <button key={l} className={`layout-btn ${layout === l ? 'active' : ''}`} onClick={() => setLayout(l)}>
            {l}
          </button>
        ))}
      </div>

      <div className={`multichart-grid grid-${layout}`}>
        {visibleSlots.map((slot) => (
          <SlotChart
            key={slot.id}
            slot={slot}
            symbols={symbols}
            interval={interval}
            isActive={slot.id === activeSlotId}
            showBollinger={showBollinger}
            showRSI={showRSI}
            showMACD={showMACD}
            showStochRSI={showStochRSI}
            showSuperTrend={showSuperTrend}
            showIchimoku={showIchimoku}
            showOBV={showOBV}
            logScale={logScale}
            onActivate={() => setActiveSlotId(slot.id)}
            onSymbolChange={(sym) => handleSymbolChange(slot.id, sym)}
            onRemove={() => handleRemove(slot.id)}
            showRemove={visibleSlots.length > 1}
          />
        ))}
      </div>
    </div>
  );
}
