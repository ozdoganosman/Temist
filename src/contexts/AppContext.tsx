import { createContext, useContext, useReducer, useCallback, useState, useEffect, type ReactNode } from 'react';
import { loadFromStorage, saveToStorage } from '../utils/storage';

// ── State ──
interface IndicatorState {
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
  showWilliamsPasa: false,
  showNizamiCedid: false,
  showEMAOverlay: false,
  showPearsonChannels: false,
  showFinancials: false,
  showCMF: false,
  logScale: false,
};

const LAYOUT_STORAGE_KEY = 'temist_chart_layout';

/** Restore the persisted chart layout, ignoring unknown/invalid entries. */
function loadInitialState(): IndicatorState {
  const saved = loadFromStorage<Partial<IndicatorState> | null>(LAYOUT_STORAGE_KEY, null);
  if (!saved || typeof saved !== 'object') return initialState;
  const merged = { ...initialState };
  for (const key of Object.keys(initialState) as ToggleKey[]) {
    if (typeof saved[key] === 'boolean') merged[key] = saved[key] as boolean;
  }
  return merged;
}

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
  const [state, dispatch] = useReducer(indicatorReducer, undefined, loadInitialState);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('temist_theme');
    return saved === 'light' || saved === 'dark' ? saved : 'dark';
  });

  // Persist the chart layout (active indicators, log scale, financials panel)
  // so it survives reloads and direct #/SYMBOL links — TradingView-style.
  useEffect(() => {
    saveToStorage(LAYOUT_STORAGE_KEY, state);
  }, [state]);

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
