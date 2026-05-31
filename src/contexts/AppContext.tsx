import { createContext, useContext, useReducer, useCallback, useState, useEffect, type ReactNode } from 'react';

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
  showCMF: boolean;
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
  showCMF: false,
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
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(indicatorReducer, initialState);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('temist_theme');
    return saved === 'light' || saved === 'dark' ? saved : 'dark';
  });

  const toggle = useCallback((key: ToggleKey) => {
    dispatch({ type: 'TOGGLE', key });
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('temist_theme', next);
      document.documentElement.setAttribute('data-theme', next);
      return next;
    });
  }, []);

  // Update HTML attribute on mount and changes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <AppContext.Provider value={{ ...state, toggle, theme, toggleTheme }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}
