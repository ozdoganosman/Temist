import { useState, useRef, useEffect, useCallback } from 'react';
import type { SymbolInfo } from '../../api/borsaApi';
import './SymbolSearch.css';

interface SymbolSearchProps {
  symbol: string;
  symbols: SymbolInfo[];
  onSymbolChange: (s: string) => void;
  compact?: boolean;
}

const RECENT_KEY = 'temist_recent_symbols';
const MAX_RECENT = 8;

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveRecent(symbol: string): void {
  try {
    const prev = loadRecent().filter((s) => s !== symbol);
    const next = [symbol, ...prev].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}

export function SymbolSearch({ symbol, symbols, onSymbolChange, compact = false }: SymbolSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [recentSymbols, setRecentSymbols] = useState<string[]>(loadRecent);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentSymbol = symbols.find((s) => s.name === symbol);

  const symbolMap = useRef<Map<string, SymbolInfo>>(new Map());
  useEffect(() => {
    const m = new Map<string, SymbolInfo>();
    symbols.forEach((s) => m.set(s.name, s));
    symbolMap.current = m;
  }, [symbols]);

  const MAX_RESULTS = 50;
  const filtered = query.trim()
    ? symbols
        .filter((s) => {
          const q = query.toUpperCase();
          return s.name.toUpperCase().includes(q) || s.displayName.toUpperCase().includes(q);
        })
        .slice(0, MAX_RESULTS)
    : [];

  // Recent symbols resolved to SymbolInfo (skip unknowns)
  const recentItems = recentSymbols
    .map((name) => symbolMap.current.get(name))
    .filter(Boolean) as SymbolInfo[];

  // What to show in the dropdown
  const showRecents = !query.trim() && recentItems.length > 0;
  const displayItems = query.trim() ? filtered : recentItems;

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Reset highlight when filter changes
  useEffect(() => {
    setHighlightIdx(0);
  }, [query]);

  const selectSymbol = useCallback(
    (name: string) => {
      onSymbolChange(name);
      saveRecent(name);
      setRecentSymbols(loadRecent());
      setQuery('');
      setOpen(false);
      inputRef.current?.blur();
    },
    [onSymbolChange],
  );

  const clearRecent = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    localStorage.removeItem(RECENT_KEY);
    setRecentSymbols([]);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, displayItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (displayItems[highlightIdx]) {
        selectSymbol(displayItems[highlightIdx].name);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !dropdownRef.current) return;
    const items = dropdownRef.current.querySelectorAll('.symbol-dropdown-item');
    const el = items[highlightIdx] as HTMLElement;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx, open]);

  return (
    <div className={`symbol-search ${compact ? 'symbol-search-compact' : ''}`}>
      <input
        ref={inputRef}
        className={`symbol-input ${compact ? 'symbol-input-compact' : ''}`}
        type="text"
        value={open ? query : symbol}
        placeholder="Hisse ara..."
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {!open && !compact && currentSymbol && <span className="symbol-name">{currentSymbol.displayName}</span>}
      {open && (
        <div className={`symbol-dropdown ${compact ? 'symbol-dropdown-compact' : ''}`} ref={dropdownRef}>
          {/* Recent searches header */}
          {showRecents && (
            <div className="symbol-dropdown-section-header">
              <span>🕐 Son Görüntülenenler</span>
              <button className="symbol-clear-recent" onClick={clearRecent} title="Geçmişi temizle">✕</button>
            </div>
          )}

          {/* Empty states */}
          {!query.trim() && recentItems.length === 0 && (
            <div className="symbol-dropdown-empty">Hisse kodu veya isim yazin...</div>
          )}
          {query.trim() && filtered.length === 0 && (
            <div className="symbol-dropdown-empty">Sonuc bulunamadi</div>
          )}

          {/* Result list */}
          {displayItems.map((s, i) => (
            <div
              key={s.name}
              className={`symbol-dropdown-item ${i === highlightIdx ? 'highlighted' : ''} ${s.name === symbol ? 'selected' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                selectSymbol(s.name);
              }}
              onMouseEnter={() => setHighlightIdx(i)}
            >
              {showRecents && <span className="sdi-recent-icon">🕐</span>}
              <span className="sdi-name">{s.name}</span>
              <span className="sdi-display">{s.displayName}</span>
            </div>
          ))}

          {/* Search results count when typing */}
          {query.trim() && filtered.length > 0 && (
            <div className="symbol-dropdown-count">{filtered.length} sonuç</div>
          )}
        </div>
      )}
    </div>
  );
}
