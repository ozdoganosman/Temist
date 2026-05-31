/**
 * useToolbarProps – extracts all toolbar-related state, effects, and prop
 * assembly out of App.tsx so that AppContent becomes a thin rendering shell.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '../contexts/AppContext';
import { useToast } from '../components/Toast/Toast';
import { useWatchlist } from './useWatchlist';

import { useIsMobile } from './useMediaQuery';
import { useHistoryData } from './useHistoryData';
import type { Interval, LegendData, ActiveView } from '../components/Chart/types';
import { fetchSymbols, fetchDataTimestamp } from '../api/borsaApi';
import type { SymbolInfo } from '../api/borsaApi';

// --- Hash routing helpers ---

const VIEW_ROUTES: ActiveView[] = ['analysis', 'multichart', 'backtest', 'finansal'];

function parseHash(): { symbol?: string; view?: ActiveView } {
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (!hash) return {};
  if (VIEW_ROUTES.includes(hash as ActiveView)) return { view: hash as ActiveView };
  if (/^[A-Za-z0-9]+$/.test(hash)) return { symbol: hash.toUpperCase(), view: 'chart' };
  return {};
}

function writeHash(view: ActiveView, symbol: string) {
  const next = view === 'chart' ? `#/${symbol}` : `#/${view}`;
  if (window.location.hash !== next) {
    window.history.replaceState(null, '', next);
  }
}

// --- Hook ---

export function useToolbarProps() {
  const { t } = useTranslation();
  // ── Context ──
  const {
    showBollinger,
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
    showFinancials,
    showCMF,
    logScale,
    toggle,
  } = useAppContext();

  const { toast } = useToast();

  // ── State ──
  const initial = parseHash();
  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [symbol, setSymbol] = useState(initial.symbol ?? 'THYAO');
  const [interval, setInterval_] = useState<Interval>('1d');
  const [legendData, setLegendData] = useState<LegendData | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>(initial.view ?? 'chart');
  const [dataTimestamp, setDataTimestamp] = useState<number | null>(null);
  const [finHeight, setFinHeight] = useState(() => (window.innerWidth < 768 ? 180 : 300));
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const splitterRef = useRef<HTMLDivElement>(null);

  // ── Sub-hooks ──
  const {
    lists,
    addList,
    removeList,
    renameList,
    toggleCollapseList,
    addSymbolToList,
    removeSymbolFromList,
    toggleSymbolInList,
    isWatched,
    toggleSymbol,
    removeSymbol,
    moveSymbol,
  } = useWatchlist();
  const isMobile = useIsMobile();
  const { data, loading } = useHistoryData(symbol, interval);

  // ── Effects ──

  // Reset legend when symbol changes so stale data doesn't linger
  useEffect(() => {
    setLegendData(null);
  }, [symbol]);

  // Fetch symbol list + data timestamp on mount
  useEffect(() => {
    fetchSymbols()
      .then((res) => {
        const all = [...res.stocks, ...res.indices];
        setSymbols(all);
      })
      .catch(() => {
        toast(t('errors.symbolListFailed'), 'warning');
        setSymbols([
          { name: 'THYAO', displayName: 'Türk Hava Yolları' },
          { name: 'GARAN', displayName: 'Garanti Bankası' },
          { name: 'AKBNK', displayName: 'Akbank' },
          { name: 'ASELS', displayName: 'Aselsan' },
          { name: 'EREGL', displayName: 'Ereğli Demir Çelik' },
        ]);
      });
    fetchDataTimestamp().then((ts) => setDataTimestamp(ts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync state -> hash
  useEffect(() => {
    writeHash(activeView, symbol);
  }, [activeView, symbol]);

  // Listen for hash changes (browser back/forward)
  useEffect(() => {
    const onHashChange = () => {
      const parsed = parseHash();
      if (parsed.view) setActiveView(parsed.view);
      if (parsed.symbol) setSymbol(parsed.symbol);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Splitter drag — use refs to avoid re-attaching on every height change
  const finHeightRef = useRef(finHeight);
  finHeightRef.current = finHeight;

  useEffect(() => {
    if (!showFinancials) return;

    const onStart = (startY: number) => {
      const startH = finHeightRef.current;

      const onMove = (currentY: number) => {
        const diff = startY - currentY;
        setFinHeight(Math.max(120, Math.min(window.innerHeight - 200, startH + diff)));
      };

      const onMouseMove = (ev: MouseEvent) => {
        onMove(ev.clientY);
      };

      const onTouchMove = (ev: TouchEvent) => {
        if (ev.touches.length > 0) {
          onMove(ev.touches[0].clientY);
        }
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onTouchMove, { passive: true });
      document.addEventListener('touchend', onUp);
    };

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      onStart(e.clientY);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        onStart(e.touches[0].clientY);
      }
    };

    const splitter = splitterRef.current;
    splitter?.addEventListener('mousedown', onMouseDown);
    splitter?.addEventListener('touchstart', onTouchStart, { passive: true });

    return () => {
      splitter?.removeEventListener('mousedown', onMouseDown);
      splitter?.removeEventListener('touchstart', onTouchStart);
    };
  }, [showFinancials]);



  // ── Computed ──
  const lastBar = data.length > 0 ? data[data.length - 1] : null;
  const prevBar = data.length > 1 ? data[data.length - 2] : null;

  // ── Callbacks ──
  const handleLegendUpdate = useCallback((d: LegendData | null) => {
    setLegendData(d);
  }, []);

  const handleSymbolClick = useCallback((sym: string) => {
    setSymbol(sym);
    setActiveView('chart');
  }, []);

  // ── Toolbar props object ──
  const toolbarProps = {
    symbol,
    symbols,
    interval,
    onSymbolChange: setSymbol,
    onIntervalChange: setInterval_,
    onToggleFinancials: () => toggle('showFinancials'),
    showFinancials,
    onToggleBollinger: () => toggle('showBollinger'),
    showBollinger,
    onToggleRSI: () => toggle('showRSI'),
    showRSI,
    onToggleMACD: () => toggle('showMACD'),
    showMACD,
    onToggleStochRSI: () => toggle('showStochRSI'),
    showStochRSI,
    onToggleSuperTrend: () => toggle('showSuperTrend'),
    showSuperTrend,
    onToggleIchimoku: () => toggle('showIchimoku'),
    showIchimoku,
    onToggleOBV: () => toggle('showOBV'),
    showOBV,
    onToggleWilliamsPasa: () => toggle('showWilliamsPasa'),
    showWilliamsPasa,
    onToggleNizamiCedid: () => toggle('showNizamiCedid'),
    showNizamiCedid,
    onToggleEMAOverlay: () => toggle('showEMAOverlay'),
    showEMAOverlay,
    onTogglePearsonChannels: () => toggle('showPearsonChannels'),
    showPearsonChannels,
    onToggleCMF: () => toggle('showCMF'),
    showCMF,
    logScale,
    onToggleLogScale: () => toggle('logScale'),
    activeView,
    onViewChange: setActiveView,
    watchlistOpen,
    onToggleWatchlist: () => setWatchlistOpen((v: boolean) => !v),
    isCurrentSymbolWatched: isWatched(symbol),
    onToggleCurrentSymbolWatch: () => toggleSymbol(symbol),
    onMoveSymbol: moveSymbol,
    dataTimestamp,
  };

  // ── Return everything AppContent needs ──
  return {
    // toolbar
    toolbarProps,
    isMobile,

    // view
    activeView,
    setActiveView,

    // symbol / data
    symbol,
    setSymbol,
    symbols,
    interval,
    data,
    loading,
    lastBar,
    prevBar,
    legendData,
    handleLegendUpdate,
    handleSymbolClick,

    // indicators from context
    showBollinger,
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
    showFinancials,
    showCMF,
    logScale,

    // panels
    finHeight,
    splitterRef,

    // watchlist
    lists,
    addList,
    removeList,
    renameList,
    toggleCollapseList,
    addSymbolToList,
    removeSymbolFromList,
    toggleSymbolInList,
    isWatched,
    watchlistOpen,
    setWatchlistOpen,
    removeSymbol,
    moveSymbol,
  };
}
