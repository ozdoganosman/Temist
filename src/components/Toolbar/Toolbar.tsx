import { useState } from 'react';
import type { Interval, ActiveView } from '../Chart/types';
import type { SymbolInfo } from '../../api/borsaApi';
import { SymbolSearch } from '../SymbolSearch/SymbolSearch';
import { useTheme } from '../../contexts/ThemeContext';
import './Toolbar.css';

interface ToolbarProps {
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
  onToggleCMF: () => void;
  showCMF: boolean;
  logScale: boolean;
  onToggleLogScale: () => void;
  activeView: ActiveView;
  onViewChange: (view: ActiveView) => void;
  // Watchlist
  watchlistOpen: boolean;
  onToggleWatchlist: () => void;
  isCurrentSymbolWatched: boolean;
  onToggleCurrentSymbolWatch: () => void;
  dataTimestamp: number | null;
}

function formatTurkishDate(ts: number): string {
  const MONTHS = ['Oca', 'Sub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Agu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const d = new Date(ts * 1000);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
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

export default function Toolbar({
  symbol,
  symbols,
  interval,
  onSymbolChange,
  onIntervalChange,
  onToggleFinancials,
  showFinancials,
  onToggleBollinger: _onToggleBollinger,
  showBollinger: _showBollinger,
  onToggleRSI: _onToggleRSI,
  showRSI: _showRSI,
  onToggleMACD: _onToggleMACD,
  showMACD: _showMACD,
  onToggleStochRSI: _onToggleStochRSI,
  showStochRSI: _showStochRSI,
  onToggleSuperTrend: _onToggleSuperTrend,
  showSuperTrend: _showSuperTrend,
  onToggleIchimoku: _onToggleIchimoku,
  showIchimoku: _showIchimoku,
  onToggleOBV: _onToggleOBV,
  showOBV: _showOBV,
  onToggleWilliamsPasa,
  showWilliamsPasa,
  onToggleNizamiCedid,
  showNizamiCedid,
  onToggleEMAOverlay,
  showEMAOverlay,
  onTogglePearsonChannels,
  showPearsonChannels,
  onToggleCMF,
  showCMF,
  logScale,
  onToggleLogScale,
  activeView,
  onViewChange,
  watchlistOpen,
  onToggleWatchlist,
  isCurrentSymbolWatched,
  onToggleCurrentSymbolWatch,
  dataTimestamp,
}: ToolbarProps) {
  const isChart = activeView === 'chart' || activeView === 'multichart';
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="toolbar" role="toolbar">
      <div className="toolbar-section">
        {/* Watchlist toggle */}
        <button
          className={`toolbar-btn watchlist-toggle-btn ${watchlistOpen ? 'active' : ''}`}
          onClick={onToggleWatchlist}
          title="Takip Listesi"
          aria-label="Takip Listesi"
        >
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
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        </button>

        <div className="toolbar-divider" />

        {/* View toggle */}
        <div className="toolbar-group view-toggle" role="group">
          <button
            className={`toolbar-btn ${activeView === 'chart' ? 'active' : ''}`}
            onClick={() => onViewChange('chart')}
            aria-label="Grafik gorunumu"
          >
            Grafik
          </button>
          <button
            className={`toolbar-btn finansal-btn ${activeView === 'finansal' ? 'active' : ''}`}
            onClick={() => onViewChange('finansal')}
            aria-label="Finansal veriler"
          >
            Finansal
          </button>
          <button
            className={`toolbar-btn ${activeView === 'analysis' ? 'active' : ''}`}
            onClick={() => onViewChange('analysis')}
            aria-label="Hisse Tarama"
          >
            Tarama
          </button>
        </div>

        <div className="toolbar-divider" />

        {isChart && (
          <>
            <div className="toolbar-group" role="group">
              <SymbolSearch symbol={symbol} symbols={symbols} onSymbolChange={onSymbolChange} />
              {/* Watch star */}
              <button
                className={`toolbar-btn star-btn ${isCurrentSymbolWatched ? 'watched' : ''}`}
                onClick={onToggleCurrentSymbolWatch}
                title={isCurrentSymbolWatched ? 'Takipten cikar' : 'Takip listesine ekle'}
              >
                {isCurrentSymbolWatched ? '\u2605' : '\u2606'}
              </button>
            </div>

            <div className="toolbar-divider" />

            <div className="toolbar-group" role="group">
              {INTERVALS.map((iv) => (
                <button
                  key={iv.value}
                  className={`toolbar-btn ${interval === iv.value ? 'active' : ''}`}
                  onClick={() => onIntervalChange(iv.value)}
                  aria-label={`${iv.label} periyot`}
                >
                  {iv.label}
                </button>
              ))}
            </div>

            <div className="toolbar-divider" />

            <button
              className={`toolbar-btn ${logScale ? 'active' : ''}`}
              onClick={onToggleLogScale}
              aria-label="Logaritmik olcek"
            >
              Log
            </button>
          </>
        )}
      </div>

      {isChart && (
        <div className="toolbar-section">
          <button
            className={`toolbar-btn ${showWilliamsPasa ? 'active' : ''}`}
            onClick={onToggleWilliamsPasa}
            aria-label="Williams Paşa goster"
          >
            Williams Paşa
          </button>
          <button
            className={`toolbar-btn ${showNizamiCedid ? 'active' : ''}`}
            onClick={onToggleNizamiCedid}
            aria-label="Nizami Cedid goster"
          >
            Nizami Cedid
          </button>
          <button
            className={`toolbar-btn ${showEMAOverlay ? 'active' : ''}`}
            onClick={onToggleEMAOverlay}
            aria-label="EMA goster"
          >
            EMA
          </button>
          <button
            className={`toolbar-btn ${showPearsonChannels ? 'active' : ''}`}
            onClick={onTogglePearsonChannels}
            aria-label="Pearson Kanalları goster"
          >
            3ChanPers
          </button>
          <button
            className={`toolbar-btn ${showCMF ? 'active' : ''}`}
            onClick={onToggleCMF}
            aria-label="CMF goster"
          >
            CMF
          </button>

          <button
            className={`toolbar-btn ${showFinancials ? 'active' : ''}`}
            onClick={onToggleFinancials}
            aria-label="Finansal veriler"
          >
            Finansallar
          </button>
          <div className="toolbar-divider" />



          <button
            className="toolbar-btn theme-toggle-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Aydinlik tema' : 'Karanlik tema'}
            aria-label="Tema degistir"
          >
            {theme === 'dark' ? '\u2600' : '\u263D'}
          </button>

          <div className="data-freshness">
            {dataTimestamp ? `Son guncelleme: ${formatTurkishDate(dataTimestamp)}` : 'Statik Veri'}
          </div>
        </div>
      )}
    </div>
  );
}
