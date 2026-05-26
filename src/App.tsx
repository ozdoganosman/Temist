import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
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
import SignalPanel from './components/SignalPanel/SignalPanel';
import StockSummary from './components/StockSummary/StockSummary';
import ExportMenu from './components/Chart/ExportMenu';
import Disclaimer from './components/Disclaimer/Disclaimer';
import { useToolbarProps } from './hooks/useToolbarProps';
import './App.css';

const MarketAnalysis = lazy(() => import('./components/Analysis/MarketAnalysis'));
const MultiChartView = lazy(() => import('./components/MultiChart/MultiChartView'));
const BacktestView = lazy(() => import('./components/Backtest/BacktestView'));
const FinancialAnalysisView = lazy(() => import('./components/FinancialAnalysis/FinancialAnalysisView'));
const CryptoPage = lazy(() => import('./components/Crypto/CryptoPage'));

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
    showSignals,
    logScale,
    signalConfig,
    setSignalConfig,
    signalDateRange,
    setSignalDateRange,
    finHeight,
    sigHeight,
    splitterRef,
    sigSplitterRef,
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

  // Kripto mode renders its own full-page layout
  if (activeView === 'kripto') {
    return (
      <div className="app">
        <ErrorBoundary>
          <Suspense fallback={<ViewFallback />}>
            <CryptoPage onViewChange={setActiveView} />
          </Suspense>
        </ErrorBoundary>
        <Disclaimer />
      </div>
    );
  }

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
                      showSignals={showSignals}
                      signalConfig={signalConfig}
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
              {showSignals && (
                <>
                  <div ref={sigSplitterRef} className="splitter" />
                  <div className="signal-panel-wrapper" style={{ height: sigHeight }}>
                    <ErrorBoundary>
                      <SignalPanel
                        data={data}
                        symbol={symbol}
                        config={signalConfig}
                        onConfigChange={setSignalConfig}
                        dateRange={signalDateRange}
                        onDateRangeChange={setSignalDateRange}
                      />
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
