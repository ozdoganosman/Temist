/**
 * Application-level context for indicator visibility and signal config.
 * Reduces prop drilling through Toolbar and other components.
 *
 * Sync logic: when showSignals is ON, signal-panel indicator toggles
 * automatically drive the chart overlay toggles. On close, previous
 * overlay state is restored.
 */
import { createContext, useContext, useReducer, useCallback, type ReactNode } from 'react';
import type { SignalConfig } from '../utils/signalDetection';
import { DEFAULT_SIGNAL_CONFIG } from '../utils/signalDetection';

// ── State ──
interface SavedOverlays {
  showBollinger: boolean;
  showRSI: boolean;
  showMACD: boolean;
  showStochRSI: boolean;
  showSuperTrend: boolean;
  showIchimoku: boolean;
  showOBV: boolean;
  showWilliamsPasa: boolean;
  showNizamiCedid: boolean;
  showEMAOverlay: boolean;
  showPearsonChannels: boolean;
  showMATLRNS: boolean;
}

type ToggleKey = keyof Omit<IndicatorState, 'signalConfig' | 'signalDateRange' | '_savedOverlays'>;

interface IndicatorState {
  showBollinger: boolean;
  showRSI: boolean;
  showMACD: boolean;
  showStochRSI: boolean;
  showSuperTrend: boolean;
  showIchimoku: boolean;
  showOBV: boolean;
  showWilliamsPasa: boolean;
  showNizamiCedid: boolean;
  showEMAOverlay: boolean;
  showPearsonChannels: boolean;
  showMATLRNS: boolean;
  showFinancials: boolean;
  showSignals: boolean;
  logScale: boolean;
  signalConfig: SignalConfig;
  signalDateRange: { start?: string; end?: string };
  /** Saved overlay state before signal panel opened (null = panel not open) */
  _savedOverlays: SavedOverlays | null;
}

// ── Actions ──
type IndicatorAction =
  | { type: 'TOGGLE'; key: ToggleKey }
  | { type: 'SET_SIGNAL_CONFIG'; config: SignalConfig }
  | { type: 'SET_SIGNAL_DATE_RANGE'; range: { start?: string; end?: string } };

const initialState: IndicatorState = {
  showBollinger: false,
  showRSI: false,
  showMACD: false,
  showStochRSI: false,
  showSuperTrend: false,
  showIchimoku: false,
  showOBV: false,
  showWilliamsPasa: false,
  showNizamiCedid: false,
  showEMAOverlay: false,
  showPearsonChannels: false,
  showMATLRNS: false,
  showFinancials: false,
  showSignals: false,
  logScale: false,
  signalConfig: DEFAULT_SIGNAL_CONFIG,
  signalDateRange: {},
  _savedOverlays: null,
};

/** Sync overlay toggles from signal config */
function syncOverlaysFromConfig(_state: IndicatorState, config: SignalConfig): Partial<IndicatorState> {
  return {
    showBollinger: config.bollinger.enabled,
    showRSI: config.rsi.enabled,
    showMACD: config.macd.enabled,
    showStochRSI: config.stochRsi.enabled,
    showSuperTrend: config.supertrend.enabled,
    showIchimoku: config.ichimoku.enabled,
    showOBV: config.obv.enabled,
    showWilliamsPasa: config.williamsPasa?.enabled ?? false,
    showNizamiCedid: config.nizamiCedid?.enabled ?? false,
    showEMAOverlay: false,
    showPearsonChannels: false,
    showMATLRNS: false,
  };
}

function indicatorReducer(state: IndicatorState, action: IndicatorAction): IndicatorState {
  switch (action.type) {
    case 'TOGGLE': {
      const key = action.key;

      // Special handling for showSignals toggle
      if (key === 'showSignals') {
        const opening = !state.showSignals;
        if (opening) {
          // Save current overlay state, then sync from signal config
          return {
            ...state,
            showSignals: true,
            _savedOverlays: {
              showBollinger: state.showBollinger,
              showRSI: state.showRSI,
              showMACD: state.showMACD,
              showStochRSI: state.showStochRSI,
              showSuperTrend: state.showSuperTrend,
              showIchimoku: state.showIchimoku,
              showOBV: state.showOBV,
              showWilliamsPasa: state.showWilliamsPasa,
              showNizamiCedid: state.showNizamiCedid,
              showEMAOverlay: state.showEMAOverlay,
              showPearsonChannels: state.showPearsonChannels,
              showMATLRNS: state.showMATLRNS,
            },
            ...syncOverlaysFromConfig(state, state.signalConfig),
          };
        } else {
          // Restore saved overlay state
          const saved = state._savedOverlays;
          return {
            ...state,
            showSignals: false,
            _savedOverlays: null,
            ...(saved ? saved : {}),
          };
        }
      }

      return { ...state, [key]: !state[key] };
    }

    case 'SET_SIGNAL_CONFIG': {
      const next: IndicatorState = { ...state, signalConfig: action.config };
      // If signal panel is open, sync overlay toggles
      if (state.showSignals) {
        Object.assign(next, syncOverlaysFromConfig(next, action.config));
      }
      return next;
    }

    case 'SET_SIGNAL_DATE_RANGE':
      return { ...state, signalDateRange: action.range };

    default:
      return state;
  }
}

// ── Context ──
interface AppContextValue extends IndicatorState {
  toggle: (key: ToggleKey) => void;
  setSignalConfig: (config: SignalConfig) => void;
  setSignalDateRange: (range: { start?: string; end?: string }) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(indicatorReducer, initialState);

  const toggle = useCallback((key: ToggleKey) => {
    dispatch({ type: 'TOGGLE', key });
  }, []);

  const setSignalConfig = useCallback((config: SignalConfig) => {
    dispatch({ type: 'SET_SIGNAL_CONFIG', config });
  }, []);

  const setSignalDateRange = useCallback((range: { start?: string; end?: string }) => {
    dispatch({ type: 'SET_SIGNAL_DATE_RANGE', range });
  }, []);

  return (
    <AppContext.Provider value={{ ...state, toggle, setSignalConfig, setSignalDateRange }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}
