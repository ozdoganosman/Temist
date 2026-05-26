import { useState, useRef, useEffect, useCallback } from 'react';
import type { Interval, ActiveView } from '../Chart/types';
import type { SymbolInfo } from '../../api/borsaApi';
import { useTheme } from '../../contexts/ThemeContext';
import './MobileToolbar.css';

interface MobileToolbarProps {
  symbol: string;
  symbols: SymbolInfo[];
  interval: Interval;
  onSymbolChange: (symbol: string) => void;
  onIntervalChange: (interval: Interval) => void;
  onToggleFinancials: () => void;
  showFinancials: boolean;
  onToggleBollinger: () => void;
  showBollinger: boolean;
  onToggleRSI: () => void;
  showRSI: boolean;
  onToggleMACD: () => void;
  showMACD: boolean;
  onToggleStochRSI: () => void;
  showStochRSI: boolean;
  onToggleSuperTrend: () => void;
  showSuperTrend: boolean;
  onToggleIchimoku: () => void;
  showIchimoku: boolean;
  onToggleOBV: () => void;
  showOBV: boolean;
  onToggleWilliamsPasa: () => void;
  showWilliamsPasa: boolean;
  onToggleNizamiCedid: () => void;
  showNizamiCedid: boolean;
  onToggleEMAOverlay: () => void;
  showEMAOverlay: boolean;
  onTogglePearsonChannels: () => void;
  showPearsonChannels: boolean;
  onToggleMATLRNS: () => void;
  showMATLRNS: boolean;
  logScale: boolean;
  onToggleLogScale: () => void;
  activeView: ActiveView;
  onViewChange: (view: ActiveView) => void;
  watchlistOpen: boolean;
  onToggleWatchlist: () => void;
  isCurrentSymbolWatched: boolean;
  onToggleCurrentSymbolWatch: () => void;
  alarmsOpen: boolean;
  onToggleAlarms: () => void;
  alarmCount: number;
  dataTimestamp: number | null;
  onToggleSignals: () => void;
  showSignals: boolean;
}

const INTERVALS: { value: Interval; label: string }[] = [
  { value: '1m', label: '1dk' },
  { value: '5m', label: '5dk' },
  { value: '15m', label: '15dk' },
  { value: '30m', label: '30dk' },
  { value: '1h', label: '1S' },
  { value: '1d', label: '1G' },
  { value: '1wk', label: '1H' },
  { value: '1mo', label: '1A' },
];

function MobileSymbolSearch({
  symbol,
  symbols,
  onSymbolChange,
  onClose,
}: {
  symbol: string;
  symbols: SymbolInfo[];
  onSymbolChange: (s: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const MAX_RESULTS = 50;
  const filtered = query.trim()
    ? symbols
        .filter((s) => {
          const q = query.toUpperCase();
          return s.name.toUpperCase().includes(q) || s.displayName.toUpperCase().includes(q);
        })
        .slice(0, MAX_RESULTS)
    : [];

  useEffect(() => {
    setHighlightIdx(0);
  }, [query]);

  const selectSymbol = useCallback(
    (name: string) => {
      onSymbolChange(name);
      onClose();
    },
    [onSymbolChange, onClose],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlightIdx]) selectSymbol(filtered[highlightIdx].name);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="mobile-search-overlay" role="search" aria-label="Hisse arama" onClick={onClose}>
      <div className="mobile-search-panel" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="mobile-search-input"
          type="text"
          value={query}
          placeholder="Hisse ara..."
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="mobile-search-results">
          {!query.trim() && <div className="mobile-search-empty">Hisse kodu veya isim yazin...</div>}
          {query.trim() && filtered.length === 0 && <div className="mobile-search-empty">Sonuc bulunamadi</div>}
          {filtered.map((s, i) => (
            <div
              key={s.name}
              className={`mobile-search-item ${i === highlightIdx ? 'highlighted' : ''} ${s.name === symbol ? 'selected' : ''}`}
              onClick={() => selectSymbol(s.name)}
            >
              <span className="msi-name">{s.name}</span>
              <span className="msi-display">{s.displayName}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function MobileToolbar({
  symbol,
  symbols,
  interval,
  onSymbolChange,
  onIntervalChange,
  onToggleFinancials,
  showFinancials,
  onToggleBollinger,
  showBollinger,
  onToggleRSI,
  showRSI,
  onToggleMACD,
  showMACD,
  onToggleStochRSI,
  showStochRSI,
  onToggleSuperTrend,
  showSuperTrend,
  onToggleIchimoku,
  showIchimoku,
  onToggleOBV,
  showOBV,
  onToggleWilliamsPasa,
  showWilliamsPasa,
  onToggleNizamiCedid,
  showNizamiCedid,
  onToggleEMAOverlay,
  showEMAOverlay,
  onTogglePearsonChannels,
  showPearsonChannels,
  onToggleMATLRNS,
  showMATLRNS,
  logScale,
  onToggleLogScale,
  activeView,
  onViewChange,
  watchlistOpen,
  onToggleWatchlist,
  isCurrentSymbolWatched,
  onToggleCurrentSymbolWatch,
  alarmsOpen,
  onToggleAlarms,
  alarmCount,
  dataTimestamp,
  onToggleSignals,
  showSignals,
}: MobileToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const isChart = activeView === 'chart' || activeView === 'multichart';

  const currentSymbol = symbols.find((s) => s.name === symbol);

  return (
    <>
      <div className="mobile-toolbar" role="navigation">
        {/* Left: hamburger + symbol */}
        <div className="mt-left">
          <button className="mt-btn mt-hamburger" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">
            {menuOpen ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>

          <button className="mt-symbol-btn" onClick={() => setSearchOpen(true)} aria-label="Hisse ara">
            <span className="mt-symbol-name">{symbol}</span>
            {currentSymbol && <span className="mt-symbol-display">{currentSymbol.displayName}</span>}
          </button>

          <button
            className={`mt-btn mt-star ${isCurrentSymbolWatched ? 'watched' : ''}`}
            onClick={onToggleCurrentSymbolWatch}
            aria-label="Takip listesine ekle/cikar"
          >
            {isCurrentSymbolWatched ? '\u2605' : '\u2606'}
          </button>
        </div>

        {/* Right: quick actions */}
        <div className="mt-right">
          <button className={`mt-btn ${alarmsOpen ? 'active' : ''}`} onClick={onToggleAlarms} aria-label="Alarmlar">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {alarmCount > 0 && <span className="mt-badge">{alarmCount}</span>}
          </button>

          <button className="mt-btn" onClick={toggleTheme} aria-label="Tema degistir">
            {theme === 'dark' ? '\u2600' : '\u263D'}
          </button>

          {dataTimestamp && (
            <span className="mt-data-ts">
              {new Date(dataTimestamp * 1000).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
            </span>
          )}
        </div>
      </div>

      {/* Second bar: view tabs + intervals (when in chart view) */}
      <div className="mobile-interval-bar">
        <div className="mib-views">
          <button className={`mib-btn ${activeView === 'chart' ? 'active' : ''}`} onClick={() => onViewChange('chart')}>
            Grafik
          </button>
          <button
            className={`mib-btn mib-finansal ${activeView === 'finansal' ? 'active' : ''}`}
            onClick={() => onViewChange('finansal')}
          >
            Finansal
          </button>
        </div>

        {isChart && (
          <div className="mib-intervals">
            {INTERVALS.map((iv) => (
              <button
                key={iv.value}
                className={`mib-btn ${interval === iv.value ? 'active' : ''}`}
                onClick={() => onIntervalChange(iv.value)}
              >
                {iv.label}
              </button>
            ))}
            <button className={`mib-btn ${logScale ? 'active' : ''}`} onClick={onToggleLogScale}>
              Log
            </button>
          </div>
        )}
      </div>

      {/* Hamburger menu */}
      {menuOpen && (
        <div className="mobile-menu-overlay" role="dialog" onClick={() => setMenuOpen(false)}>
          <div className="mobile-menu" onClick={(e) => e.stopPropagation()}>
            <div className="mm-section">
              <div className="mm-section-title">Gorunum</div>
              <button
                className={`mm-item ${watchlistOpen ? 'active' : ''}`}
                onClick={() => {
                  onToggleWatchlist();
                  setMenuOpen(false);
                }}
                aria-label="Takip Listesi"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
                Takip Listesi
              </button>
              <button
                className={`mm-item ${alarmsOpen ? 'active' : ''}`}
                onClick={() => {
                  onToggleAlarms();
                  setMenuOpen(false);
                }}
                aria-label="Alarmlar"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                Alarmlar
                {alarmCount > 0 && <span className="mt-badge">{alarmCount}</span>}
              </button>
            </div>

            {isChart && (
              <div className="mm-section">
                <div className="mm-section-title">Indikatorler</div>
                <button className={`mm-item ${showWilliamsPasa ? 'active' : ''}`} onClick={() => onToggleWilliamsPasa()}>
                  Williams Paşa
                </button>
                <button className={`mm-item ${showNizamiCedid ? 'active' : ''}`} onClick={() => onToggleNizamiCedid()}>
                  Nizami Cedid
                </button>
                <button className={`mm-item ${showEMAOverlay ? 'active' : ''}`} onClick={() => onToggleEMAOverlay()}>
                  EMA
                </button>
                <button className={`mm-item ${showPearsonChannels ? 'active' : ''}`} onClick={() => onTogglePearsonChannels()}>
                  3ChanPers
                </button>
                <button className={`mm-item ${showMATLRNS ? 'active' : ''}`} onClick={() => onToggleMATLRNS()}>
                  MATLRNS
                </button>

                <button
                  className={`mm-item ${showFinancials ? 'active' : ''}`}
                  onClick={() => onToggleFinancials()}
                  aria-label="Finansal veriler"
                >
                  Finansallar
                </button>
              </div>
            )}

            <div className="mm-section">
              <div className="mm-section-title">Sayfa</div>
              <button
                className={`mm-item ${activeView === 'chart' ? 'active' : ''}`}
                onClick={() => {
                  onViewChange('chart');
                  setMenuOpen(false);
                }}
                aria-label="Grafik gorunumu"
              >
                Grafik
              </button>
              <button
                className={`mm-item ${activeView === 'finansal' ? 'active' : ''}`}
                onClick={() => {
                  onViewChange('finansal');
                  setMenuOpen(false);
                }}
                aria-label="Finansal Analiz"
              >
                Finansal Analiz
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search overlay */}
      {searchOpen && (
        <MobileSymbolSearch
          symbol={symbol}
          symbols={symbols}
          onSymbolChange={onSymbolChange}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </>
  );
}
