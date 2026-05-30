/**
 * Application-level context for indicator visibility.
 * Reduces prop drilling through Toolbar and other components.
 */
import { createContext, useContext, useReducer, useCallback, type ReactNode } from 'react';

// ── State ──
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
  showFinancials: boolean;
  showPEBands: boolean;
  logScale: boolean;
}

type ToggleKey = keyof IndicatorState;

type IndicatorAction = { type: 'TOGGLE'; key: ToggleKey };

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
  showFinancials: false,
  showPEBands: false,
  logScale: false,
};

function indicatorReducer(state: IndicatorState, action: IndicatorAction): IndicatorState {
  switch (action.type) {
    case 'TOGGLE': {
      const key = action.key;
      return { ...state, [key]: !state[key] };
    }
    default:
      return state;
  }
}

// ── Context ──
interface AppContextValue extends IndicatorState {
  toggle: (key: ToggleKey) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(indicatorReducer, initialState);

  const toggle = useCallback((key: ToggleKey) => {
    dispatch({ type: 'TOGGLE', key });
  }, []);

  return (
    <AppContext.Provider value={{ ...state, toggle }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}
