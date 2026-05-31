import { useState, useCallback } from 'react';
import { loadFromStorage, saveToStorage } from '../utils/storage';

export interface WatchlistCategory {
  id: string;
  name: string;
  symbols: string[];
  isCollapsed?: boolean;
}

const STORAGE_KEY = 'temist_watchlists';
const OLD_KEY = 'borsa_watchlist';

export function useWatchlist() {
  const [lists, setLists] = useState<WatchlistCategory[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (e) {
        console.error(e);
      }
    }

    // Migrate old watchlist if exists
    const old = localStorage.getItem(OLD_KEY);
    let initialSymbols: string[] = ['THYAO', 'GARAN', 'AKBNK', 'ASELS'];
    if (old) {
      try {
        const parsedOld = JSON.parse(old);
        if (Array.isArray(parsedOld) && parsedOld.length > 0) {
          initialSymbols = parsedOld;
        }
      } catch (e) {
        console.error(e);
      }
    }

    const defaultLists: WatchlistCategory[] = [
      {
        id: 'default',
        name: 'Takip Listesi 1',
        symbols: initialSymbols,
        isCollapsed: false,
      },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultLists));
    return defaultLists;
  });

  const saveLists = useCallback((nextLists: WatchlistCategory[]) => {
    setLists(nextLists);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextLists));
  }, []);

  const addList = useCallback((name: string, initialSymbols: string[] = []) => {
    const newList: WatchlistCategory = {
      id: 'list_' + Date.now(),
      name: name.trim() || `Takip Listesi ${lists.length + 1}`,
      symbols: initialSymbols,
      isCollapsed: false,
    };
    saveLists([...lists, newList]);
  }, [lists, saveLists]);

  const removeList = useCallback((id: string) => {
    if (lists.length <= 1) return; // Keep at least one list
    saveLists(lists.filter(l => l.id !== id));
  }, [lists, saveLists]);

  const renameList = useCallback((id: string, newName: string) => {
    if (!newName.trim()) return;
    saveLists(lists.map(l => l.id === id ? { ...l, name: newName.trim() } : l));
  }, [lists, saveLists]);

  const toggleCollapseList = useCallback((id: string) => {
    saveLists(lists.map(l => l.id === id ? { ...l, isCollapsed: !l.isCollapsed } : l));
  }, [lists, saveLists]);

  const addSymbolToList = useCallback((listId: string, symbol: string) => {
    saveLists(lists.map(l => {
      if (l.id === listId) {
        if (l.symbols.includes(symbol)) return l;
        return { ...l, symbols: [...l.symbols, symbol] };
      }
      return l;
    }));
  }, [lists, saveLists]);

  const removeSymbolFromList = useCallback((listId: string, symbol: string) => {
    saveLists(lists.map(l => {
      if (l.id === listId) {
        return { ...l, symbols: l.symbols.filter(s => s !== symbol) };
      }
      return l;
    }));
  }, [lists, saveLists]);

  const toggleSymbolInList = useCallback((listId: string, symbol: string) => {
    saveLists(lists.map(l => {
      if (l.id === listId) {
        const symbols = l.symbols.includes(symbol)
          ? l.symbols.filter(s => s !== symbol)
          : [...l.symbols, symbol];
        return { ...l, symbols };
      }
      return l;
    }));
  }, [lists, saveLists]);

  const isWatchedInAnyList = useCallback((symbol: string) => {
    return lists.some(l => l.symbols.includes(symbol));
  }, [lists]);

  // For backward compatibility and single-action triggers (e.g. Star Toggle in Toolbar)
  const toggleSymbol = useCallback((symbol: string) => {
    if (lists.length === 0) return;
    // If watched in any list, remove it from all lists where it exists
    const watched = isWatchedInAnyList(symbol);
    if (watched) {
      saveLists(lists.map(l => ({ ...l, symbols: l.symbols.filter(s => s !== symbol) })));
    } else {
      // Add to the first list
      addSymbolToList(lists[0].id, symbol);
    }
  }, [lists, isWatchedInAnyList, addSymbolToList, saveLists]);

  const removeSymbol = useCallback((symbol: string) => {
    saveLists(lists.map(l => ({ ...l, symbols: l.symbols.filter(s => s !== symbol) })));
  }, [lists, saveLists]);

  const moveSymbol = useCallback((fromListId: string, toListId: string, symbol: string, toIndex: number) => {
    saveLists(lists.map(l => {
      if (l.id === fromListId && l.id === toListId) {
        const nextSymbols = l.symbols.filter(s => s !== symbol);
        nextSymbols.splice(toIndex, 0, symbol);
        return { ...l, symbols: nextSymbols };
      }
      if (l.id === fromListId) {
        return { ...l, symbols: l.symbols.filter(s => s !== symbol) };
      }
      if (l.id === toListId) {
        const nextSymbols = l.symbols.filter(s => s !== symbol);
        nextSymbols.splice(toIndex, 0, symbol);
        return { ...l, symbols: nextSymbols };
      }
      return l;
    }));
  }, [lists, saveLists]);

  return {
    lists,
    addList,
    removeList,
    renameList,
    toggleCollapseList,
    addSymbolToList,
    removeSymbolFromList,
    toggleSymbolInList,
    isWatched: isWatchedInAnyList,
    toggleSymbol,
    removeSymbol,
    moveSymbol,
  };
}
