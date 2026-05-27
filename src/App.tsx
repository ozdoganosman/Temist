import { useState, useEffect, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import type { Interval } from './components/Chart/types';

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
import { AppProvider } from './contexts/AppContext';
import { ToastProvider } from './components/Toast/Toast';
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary';
import Toolbar from './components/Toolbar/Toolbar';
import MobileToolbar from './components/Toolbar/MobileToolbar';
import ChartContainer from './components/Chart/ChartContainer';
import Legend from './components/Legend/Legend';
import Financials from './components/Financials/Financials';
import Watchlist from './components/Watchlist/Watchlist';
import AlarmPanel from './components/Alarms/AlarmPanel';
import StockSummary from './components/StockSummary/StockSummary';
import ExportMenu from './components/Chart/ExportMenu';
import Disclaimer from './components/Disclaimer/Disclaimer';
import { useToolbarProps } from './hooks/useToolbarProps';
import './App.css';

const MarketAnalysis = lazy(() => import('./components/Analysis/MarketAnalysis'));
const MultiChartView = lazy(() => import('./components/MultiChart/MultiChartView'));
const BacktestView = lazy(() => import('./components/Backtest/BacktestView'));
const FinancialAnalysisView = lazy(() => import('./components/FinancialAnalysis/FinancialAnalysisView'));

function ViewFallback() {
  const { t } = useTranslation();
  return <div className="loading-overlay">{t('common.loading')}</div>;
}

// --- Inner component that consumes context ---
function AppContent() {
  const { t } = useTranslation();
  const {
    toolbarProps,
    isMobile,
    activeView,
    setActiveView,
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
    showMATLRNS,
    showFinancials,
    logScale,
    finHeight,
    splitterRef,
    watchlist,
    watchlistOpen,
    setWatchlistOpen,
    removeSymbol,
    alarms,
    alarmsOpen,
    setAlarmsOpen,
    addAlarm,
    removeAlarm,
    updateAlarm,
    resetTriggered,
    uniqueActiveSymbols,
  } = useToolbarProps();

  const [mobileTab, setMobileTab] = useState<'chart' | 'watchlist' | 'financials' | 'alarms'>('chart');

  // Sync state between mobileTab and watchlistOpen/alarmsOpen
  useEffect(() => {
    if (isMobile) {
      if (watchlistOpen) {
        setMobileTab('watchlist');
      } else if (alarmsOpen) {
        setMobileTab('alarms');
      }
    }
  }, [watchlistOpen, alarmsOpen, isMobile]);



  // --- Mobile Layout ---
  if (isMobile) {
    const {
      onToggleWilliamsPasa,
      onToggleNizamiCedid,
      onToggleEMAOverlay,
      onTogglePearsonChannels,
      onToggleMATLRNS,
      onToggleBollinger,
      onToggleRSI,
      onToggleMACD,
      onToggleStochRSI,
      onToggleOBV,
      onIntervalChange,
      onToggleLogScale,
    } = toolbarProps;

    return (
      <div className="app mobile-app">
        <MobileToolbar
          {...toolbarProps}
          activeMobileTab={mobileTab}
          onMobileTabChange={(tab) => {
            setMobileTab(tab);
            if (tab === 'watchlist') {
              setWatchlistOpen(true);
              setAlarmsOpen(false);
            } else if (tab === 'alarms') {
              setWatchlistOpen(false);
              setAlarmsOpen(true);
            } else {
              setWatchlistOpen(false);
              setAlarmsOpen(false);
            }
          }}
        />

        <div className="app-body mobile-body">
          <div className="app-main mobile-main">
            {/* Secondary full screen pages */}
            {activeView === 'analysis' && (
              <div className="analysis-wrapper mobile-tab-panel">
                <ErrorBoundary>
                  <Suspense fallback={<ViewFallback />}>
                    <MarketAnalysis onSymbolClick={handleSymbolClick} />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}
            {activeView === 'finansal' && (
              <div className="analysis-wrapper mobile-tab-panel">
                <ErrorBoundary>
                  <Suspense fallback={<ViewFallback />}>
                    <FinancialAnalysisView symbol={symbol} symbols={symbols} data={data} onSymbolChange={setSymbol} />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )}

            {/* Main views (Chart, Watchlist, Financials, Signals, Alarms) */}
            {activeView === 'chart' && (
              <>
                {mobileTab === 'chart' && (
                  <div className="mobile-tab-panel chart-tab-active">
                    <StockSummary
                      symbol={symbol}
                      displayName={symbols.find((s) => s.name === symbol)?.displayName ?? ''}
                      data={data}
                    />

                    {/* Horizontally scrollable Indicator & Interval quick-toggle bar */}
                    <div className="mobile-quick-toggle-bar">
                      <div className="mqt-group">
                        {INTERVALS.map((iv) => (
                          <button
                            key={iv.value}
                            className={`mqt-btn ${interval === iv.value ? 'active' : ''}`}
                            onClick={() => onIntervalChange(iv.value)}
                          >
                            {iv.label}
                          </button>
                        ))}
                        <button className={`mqt-btn ${logScale ? 'active' : ''}`} onClick={onToggleLogScale}>
                          Log
                        </button>
                      </div>
                      <div className="mqt-group indicators-group">
                        <button className={`mqt-btn ${showWilliamsPasa ? 'active' : ''}`} onClick={onToggleWilliamsPasa}>
                          W.Paşa
                        </button>
                        <button className={`mqt-btn ${showNizamiCedid ? 'active' : ''}`} onClick={onToggleNizamiCedid}>
                          N.Cedid
                        </button>
                        <button className={`mqt-btn ${showEMAOverlay ? 'active' : ''}`} onClick={onToggleEMAOverlay}>
                          EMA
                        </button>
                        <button className={`mqt-btn ${showPearsonChannels ? 'active' : ''}`} onClick={onTogglePearsonChannels}>
                          3ChanPers
                        </button>
                        <button className={`mqt-btn ${showMATLRNS ? 'active' : ''}`} onClick={onToggleMATLRNS}>
                          MATLRNS
                        </button>
                        <button className={`mqt-btn ${showBollinger ? 'active' : ''}`} onClick={onToggleBollinger}>
                          BB
                        </button>
                        <button className={`mqt-btn ${showRSI ? 'active' : ''}`} onClick={onToggleRSI}>
                          RSI
                        </button>
                        <button className={`mqt-btn ${showMACD ? 'active' : ''}`} onClick={onToggleMACD}>
                          MACD
                        </button>
                        <button className={`mqt-btn ${showStochRSI ? 'active' : ''}`} onClick={onToggleStochRSI}>
                          StochRSI
                        </button>
                        <button className={`mqt-btn ${showOBV ? 'active' : ''}`} onClick={onToggleOBV}>
                          OBV
                        </button>
                      </div>
                    </div>

                    <div className="chart-wrapper">
                      <Legend
                        data={legendData}
                        symbol={symbol}
                        lastClose={lastBar?.close ?? 0}
                        prevClose={prevBar?.close ?? lastBar?.close ?? 0}
                        lastVolume={lastBar?.volume ?? 0}
                      />
                      {!loading && data.length > 0 && <ExportMenu data={data} symbol={symbol} />}
                      {loading ? (
                        <div className="loading-overlay">{t('common.dataLoading')}</div>
                      ) : (
                        <ErrorBoundary>
                          <ChartContainer
                            data={data}
                            symbol={symbol}
                            interval={interval}
                            onLegendUpdate={handleLegendUpdate}
                            showBollinger={showBollinger}
                            showRSI={showRSI}
                            showMACD={showMACD}
                            showStochRSI={showStochRSI}
                            showSuperTrend={showSuperTrend}
                            showIchimoku={showIchimoku}
                            showOBV={showOBV}
                            showWilliamsPasa={showWilliamsPasa}
                            showNizamiCedid={showNizamiCedid}
                            showEMAOverlay={showEMAOverlay}
                            showPearsonChannels={showPearsonChannels}
                            showMATLRNS={showMATLRNS}
                            logScale={logScale}
                          />
                        </ErrorBoundary>
                      )}
                    </div>
                  </div>
                )}

                {mobileTab === 'watchlist' && (
                  <div className="mobile-tab-panel watchlist-tab-active">
                    <ErrorBoundary>
                      <Watchlist
                        watchlist={watchlist}
                        symbols={symbols}
                        currentSymbol={symbol}
                        onSymbolClick={(sym) => {
                          handleSymbolClick(sym);
                          setMobileTab('chart');
                          setWatchlistOpen(false);
                        }}
                        onRemove={removeSymbol}
                        onClose={() => {
                          setMobileTab('chart');
                          setWatchlistOpen(false);
                        }}
                      />
                    </ErrorBoundary>
                  </div>
                )}

                {mobileTab === 'financials' && (
                  <div className="mobile-tab-panel financials-tab-active">
                    <ErrorBoundary>
                      <Financials symbol={symbol} />
                    </ErrorBoundary>
                  </div>
                )}



                {mobileTab === 'alarms' && (
                  <div className="mobile-tab-panel alarms-tab-active">
                    <ErrorBoundary>
                      <AlarmPanel
                        alarms={alarms}
                        currentSymbol={symbol}
                        uniqueActiveSymbols={uniqueActiveSymbols}
                        onAdd={addAlarm}
                        onRemove={removeAlarm}
                        onUpdate={updateAlarm}
                        onResetTriggered={resetTriggered}
                        onClose={() => {
                          setMobileTab('chart');
                          setAlarmsOpen(false);
                        }}
                      />
                    </ErrorBoundary>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Mobile Sticky Bottom Nav Bar */}
        <div className="mobile-bottom-nav" role="navigation">
          <button
            className={`mb-nav-item ${activeView === 'chart' && mobileTab === 'chart' ? 'active' : ''}`}
            onClick={() => {
              setActiveView('chart');
              setMobileTab('chart');
              setWatchlistOpen(false);
              setAlarmsOpen(false);
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" />
            </svg>
            <span>Grafik</span>
          </button>

          <button
            className={`mb-nav-item ${activeView === 'chart' && mobileTab === 'watchlist' ? 'active' : ''}`}
            onClick={() => {
              setActiveView('chart');
              setMobileTab('watchlist');
              setWatchlistOpen(true);
              setAlarmsOpen(false);
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            <span>İzle</span>
          </button>

          <button
            className={`mb-nav-item ${activeView === 'chart' && mobileTab === 'financials' ? 'active' : ''}`}
            onClick={() => {
              setActiveView('chart');
              setMobileTab('financials');
              setWatchlistOpen(false);
              setAlarmsOpen(false);
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            <span>Finansal</span>
          </button>



          <button
            className={`mb-nav-item ${activeView === 'chart' && mobileTab === 'alarms' ? 'active' : ''}`}
            onClick={() => {
              setActiveView('chart');
              setMobileTab('alarms');
              setWatchlistOpen(false);
              setAlarmsOpen(true);
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span>Alarm</span>
          </button>
        </div>
      </div>
    );
  }

  // --- Desktop Layout ---
  return (
    <div className="app">
      {isMobile ? <MobileToolbar {...toolbarProps} /> : <Toolbar {...toolbarProps} />}

      <div className="app-body">
        {watchlistOpen && (
          <Watchlist
            watchlist={watchlist}
            symbols={symbols}
            currentSymbol={symbol}
            onSymbolClick={handleSymbolClick}
            onRemove={removeSymbol}
            onClose={() => setWatchlistOpen(false)}
          />
        )}

        <div className="app-main">
          {activeView === 'chart' && (
            <>
              <StockSummary
                symbol={symbol}
                displayName={symbols.find((s) => s.name === symbol)?.displayName ?? ''}
                data={data}
              />
              <div className="chart-wrapper" style={showFinancials ? { flex: '1 1 0', minHeight: 200 } : undefined}>
                <Legend
                  data={legendData}
                  symbol={symbol}
                  lastClose={lastBar?.close ?? 0}
                  prevClose={prevBar?.close ?? lastBar?.close ?? 0}
                  lastVolume={lastBar?.volume ?? 0}
                />
                {!loading && data.length > 0 && <ExportMenu data={data} symbol={symbol} />}
                {loading ? (
                  <div className="loading-overlay">{t('common.dataLoading')}</div>
                ) : (
                  <ErrorBoundary>
                    <ChartContainer
                      data={data}
                      symbol={symbol}
                      interval={interval}
                      onLegendUpdate={handleLegendUpdate}
                      showBollinger={showBollinger}
                      showRSI={showRSI}
                      showMACD={showMACD}
                      showStochRSI={showStochRSI}
                      showSuperTrend={showSuperTrend}
                      showIchimoku={showIchimoku}
                      showOBV={showOBV}
                      showWilliamsPasa={showWilliamsPasa}
                      showNizamiCedid={showNizamiCedid}
                      showEMAOverlay={showEMAOverlay}
                      showPearsonChannels={showPearsonChannels}
                      showMATLRNS={showMATLRNS}
                      logScale={logScale}
                    />
                  </ErrorBoundary>
                )}
              </div>
              {showFinancials && (
                <>
                  <div ref={splitterRef} className="splitter" />
                  <div className="financials-panel" style={{ height: finHeight }}>
                    <ErrorBoundary>
                      <Financials symbol={symbol} />
                    </ErrorBoundary>
                  </div>
                </>
              )}

            </>
          )}
          {activeView === 'analysis' && (
            <div className="analysis-wrapper">
              <ErrorBoundary>
                <Suspense fallback={<ViewFallback />}>
                  <MarketAnalysis onSymbolClick={handleSymbolClick} />
                </Suspense>
              </ErrorBoundary>
            </div>
          )}
          {activeView === 'multichart' && (
            <ErrorBoundary>
              <Suspense fallback={<ViewFallback />}>
                <MultiChartView
                  symbols={symbols}
                  interval={interval}
                  showBollinger={showBollinger}
                  showRSI={showRSI}
                  showMACD={showMACD}
                  showStochRSI={showStochRSI}
                  showSuperTrend={showSuperTrend}
                  showIchimoku={showIchimoku}
                  showOBV={showOBV}
                  logScale={logScale}
                />
              </Suspense>
            </ErrorBoundary>
          )}
          {activeView === 'backtest' && (
            <div className="analysis-wrapper">
              <ErrorBoundary>
                <Suspense fallback={<ViewFallback />}>
                  <BacktestView />
                </Suspense>
              </ErrorBoundary>
            </div>
          )}
          {activeView === 'finansal' && (
            <div className="analysis-wrapper">
              <ErrorBoundary>
                <Suspense fallback={<ViewFallback />}>
                  <FinancialAnalysisView symbol={symbol} symbols={symbols} data={data} onSymbolChange={setSymbol} />
                </Suspense>
              </ErrorBoundary>
            </div>
          )}
        </div>

        {alarmsOpen && (
          <AlarmPanel
            alarms={alarms}
            currentSymbol={symbol}
            uniqueActiveSymbols={uniqueActiveSymbols}
            onAdd={addAlarm}
            onRemove={removeAlarm}
            onUpdate={updateAlarm}
            onResetTriggered={resetTriggered}
            onClose={() => setAlarmsOpen(false)}
          />
        )}
      </div>
      <Disclaimer />
    </div>
  );
}

// --- Outer component that provides context ---
export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </AppProvider>
  );
}
