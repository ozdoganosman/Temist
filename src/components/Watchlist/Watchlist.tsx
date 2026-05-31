import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuoteData, SymbolInfo } from '../../api/borsaApi';
import { usePriceService } from '../../hooks/usePriceService';
import type { WatchlistCategory } from '../../hooks/useWatchlist';
import './Watchlist.css';

interface WatchlistProps {
  lists: WatchlistCategory[];
  symbols: SymbolInfo[];
  currentSymbol: string;
  onSymbolClick: (symbol: string) => void;
  onRemoveFromList: (listId: string, symbol: string) => void;
  onAddSymbolToList: (listId: string, symbol: string) => void;
  onToggleCollapse: (listId: string) => void;
  onAddList: (name: string) => void;
  onRemoveList: (listId: string) => void;
  onRenameList: (listId: string, name: string) => void;
  onMoveSymbol?: (fromListId: string, toListId: string, symbol: string, toIndex: number) => void;
  onClose: () => void;
}

function formatPrice(price: number): string {
  if (price >= 10000) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return price.toFixed(2);
}

function PriceCell({ data }: { data: QuoteData | undefined }) {
  if (!data) {
    return (
      <div className="watchlist-item-price">
        <div className="watchlist-item-price-value" style={{ color: 'var(--text-muted)' }}>
          --
        </div>
      </div>
    );
  }

  const positive = data.changePercent >= 0;
  return (
    <div className="watchlist-item-price">
      <div className="watchlist-item-price-value">{formatPrice(data.price)}</div>
      <div className={`watchlist-item-change ${positive ? 'positive' : 'negative'}`}>
        {positive ? '+' : ''}
        {data.changePercent.toFixed(2)}%
      </div>
    </div>
  );
}

export default function Watchlist({
  lists,
  symbols,
  currentSymbol,
  onSymbolClick,
  onRemoveFromList,
  onAddSymbolToList,
  onToggleCollapse,
  onAddList,
  onRemoveList,
  onRenameList,
  onMoveSymbol,
  onClose,
}: WatchlistProps) {
  const { t } = useTranslation();

  // Search states for adding stocks to list
  const [activeSearchListId, setActiveSearchListId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');

  // Drag and drop states for reordering
  const [draggedItem, setDraggedItem] = useState<{ listId: string; symbol: string; index: number } | null>(null);
  const [dragOverItem, setDragOverItem] = useState<{ listId: string; symbol: string; index: number; position: 'top' | 'bottom' } | null>(null);

  const handleDragStart = (e: React.DragEvent, listId: string, symbol: string, index: number) => {
    setDraggedItem({ listId, symbol, index });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify([symbol]));
    e.dataTransfer.setData('application/temist-watchlist-drag', JSON.stringify({ sourceListId: listId, symbol, index }));
  };

  const handleDragOver = (e: React.DragEvent, listId: string, symbol: string, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedItem) return;

    if (draggedItem.listId === listId && draggedItem.symbol === symbol) {
      setDragOverItem(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    const position = relativeY < rect.height / 2 ? 'top' : 'bottom';

    setDragOverItem({ listId, symbol, index, position });
  };

  const handleDragLeave = () => {
    setDragOverItem(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverItem(null);
  };

  const handleDrop = (e: React.DragEvent, listId: string, symbol: string, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverItem(null);
    if (!draggedItem) return;

    if (onMoveSymbol) {
      let targetIdx = index;
      if (dragOverItem?.position === 'bottom') {
        targetIdx = index + 1;
      }
      onMoveSymbol(draggedItem.listId, listId, draggedItem.symbol, targetIdx);
    }

    setDraggedItem(null);
  };

  // Editing list name states
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editNameText, setEditNameText] = useState('');

  const searchInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Auto focus search input when opened
  useEffect(() => {
    if (activeSearchListId && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [activeSearchListId]);

  // Auto focus edit input when opened
  useEffect(() => {
    if (editingListId && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editingListId]);

  // Aggregate all unique symbols across all watchlists to query their prices
  const allSymbols = useMemo(() => {
    const set = new Set<string>();
    lists.forEach((l) => l.symbols.forEach((s) => set.add(s)));
    return Array.from(set);
  }, [lists]);

  const prices = usePriceService(allSymbols);

  const [scores, setScores] = useState<Map<string, { combined: number; fundamental: number; technical: number }>>(new Map());

  useEffect(() => {
    const loadScores = () => {
      const cached = localStorage.getItem('temist_scanner_scan_results_cache_v4');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            const map = new Map<string, { combined: number; fundamental: number; technical: number }>();
            parsed.forEach((item: any) => {
              if (item.symbol) {
                map.set(item.symbol, {
                  combined: item.combinedScore,
                  fundamental: item.fundamentalScore,
                  technical: item.overallScore,
                });
              }
            });
            setScores(map);
          }
        } catch (e) {
          console.error('Failed to parse scan results cache in Watchlist:', e);
        }
      }
    };

    loadScores();

    const handleUpdate = () => {
      loadScores();
    };

    window.addEventListener('temist_scanner_updated', handleUpdate);
    return () => {
      window.removeEventListener('temist_scanner_updated', handleUpdate);
    };
  }, [allSymbols]);

  const getDisplayName = (sym: string) => {
    const info = symbols.find((s) => s.name === sym);
    return info?.displayName ?? sym;
  };

  // Filtered symbols for autocomplete suggestions
  const suggestions = useMemo(() => {
    if (!searchText.trim()) return [];
    const query = searchText.toUpperCase().trim();
    return symbols
      .filter((s) => s.name.toUpperCase().includes(query) || s.displayName.toUpperCase().includes(query))
      .slice(0, 5);
  }, [searchText, symbols]);

  const handleAddListClick = () => {
    const listName = prompt('Yeni takip listesi adı:');
    if (listName && listName.trim()) {
      onAddList(listName.trim());
    }
  };

  const handleRenameClick = (list: WatchlistCategory) => {
    setEditingListId(list.id);
    setEditNameText(list.name);
  };

  const handleSaveRename = (listId: string) => {
    if (editNameText.trim()) {
      onRenameList(listId, editNameText.trim());
    }
    setEditingListId(null);
  };

  const handleAddSymbol = (listId: string, sym: string) => {
    onAddSymbolToList(listId, sym);
    setSearchText('');
    setActiveSearchListId(null);
  };

  return (
    <div className="watchlist-panel">
      <div className="watchlist-header">
        <span className="watchlist-title">Takip Listelerim</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button className="add-list-btn" onClick={handleAddListClick} title="Yeni Liste Oluştur">
            + Yeni
          </button>
          <button className="watchlist-close-btn" onClick={onClose} title="Kapat">
            ✕
          </button>
        </div>
      </div>

      <div className="watchlist-list">
        {lists.map((list) => {
          const isCollapsed = list.isCollapsed ?? false;
          const isEditing = editingListId === list.id;
          const isSearching = activeSearchListId === list.id;

          return (
            <div
              key={list.id}
              className="watchlist-category"
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }}
              onDragEnter={(e) => {
                e.currentTarget.classList.add('drag-over');
              }}
              onDragLeave={(e) => {
                e.currentTarget.classList.remove('drag-over');
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('drag-over');
                
                const wlDragData = e.dataTransfer.getData('application/temist-watchlist-drag');
                if (wlDragData) {
                  try {
                    const parsed = JSON.parse(wlDragData);
                    if (parsed && parsed.sourceListId && parsed.symbol) {
                      if (onMoveSymbol) {
                        const targetList = lists.find(l => l.id === list.id);
                        const targetIdx = targetList ? targetList.symbols.length : 0;
                        onMoveSymbol(parsed.sourceListId, list.id, parsed.symbol, targetIdx);
                      }
                      return;
                    }
                  } catch (err) {
                    console.error('Failed to parse watchlist drag data:', err);
                  }
                }

                try {
                  const dataStr = e.dataTransfer.getData('text/plain');
                  const symbols = JSON.parse(dataStr);
                  if (Array.isArray(symbols)) {
                    symbols.forEach((sym) => onAddSymbolToList(list.id, sym));
                  }
                } catch (err) {
                  console.error('Failed to parse dropped symbols:', err);
                }
              }}
            >
              {/* Category Header */}
              <div className="watchlist-category-header">
                <div
                  className="watchlist-category-header-click"
                  onClick={() => onToggleCollapse(list.id)}
                >
                  <span className="watchlist-category-collapse-icon">
                    {isCollapsed ? '▶' : '▼'}
                  </span>
                  {isEditing ? (
                    <input
                      ref={editInputRef}
                      className="watchlist-category-rename-input"
                      value={editNameText}
                      onChange={(e) => setEditNameText(e.target.value)}
                      onBlur={() => handleSaveRename(list.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveRename(list.id);
                        if (e.key === 'Escape') setEditingListId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="watchlist-category-name" title="Çift tıklayarak düzenleyin" onDoubleClick={() => handleRenameClick(list)}>
                      {list.name}
                    </span>
                  )}
                  <span className="watchlist-category-count">
                    ({list.symbols.length})
                  </span>
                </div>

                <div className="watchlist-category-controls">
                  <button
                    className="category-control-btn rename-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRenameClick(list);
                    }}
                    title="Yeniden Adlandır"
                  >
                    ✎
                  </button>
                  <button
                    className="category-control-btn add-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isSearching) {
                        setActiveSearchListId(null);
                      } else {
                        setActiveSearchListId(list.id);
                        setSearchText('');
                      }
                    }}
                    title="Hisse Ekle"
                  >
                    +
                  </button>
                  {lists.length > 1 && (
                    <button
                      className="category-control-btn delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`"${list.name}" listesini silmek istediğinize emin misiniz?`)) {
                          onRemoveList(list.id);
                        }
                      }}
                      title="Listeyi Sil"
                    >
                      🗑
                    </button>
                  )}
                </div>
              </div>

              {/* Inline Symbol Adding Search Row */}
              {isSearching && (
                <div className="category-search-row">
                  <div style={{ position: 'relative', display: 'flex', width: '100%', gap: '4px' }}>
                    <input
                      ref={searchInputRef}
                      type="text"
                      className="category-search-input"
                      placeholder="Hisse kodu/adı yazın..."
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setActiveSearchListId(null);
                        if (e.key === 'Enter' && suggestions.length > 0) {
                          handleAddSymbol(list.id, suggestions[0].name);
                        }
                      }}
                    />
                    <button
                      className="category-search-cancel"
                      onClick={() => setActiveSearchListId(null)}
                      title="Kapat"
                    >
                      ✕
                    </button>
                    
                    {/* Autocomplete Suggestions Dropdown */}
                    {suggestions.length > 0 && (
                      <div className="category-search-suggestions">
                        {suggestions.map((s) => (
                          <div
                            key={s.name}
                            className="category-search-suggestion"
                            onClick={() => handleAddSymbol(list.id, s.name)}
                          >
                            <span className="suggestion-code">{s.name}</span>
                            <span className="suggestion-desc">{s.displayName}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Category Items List */}
              {!isCollapsed && (
                <div className="watchlist-category-items">
                  {list.symbols.length === 0 ? (
                    <div className="category-empty-placeholder">
                      Bu liste boş. + tuşuyla hisse ekleyin.
                    </div>
                  ) : (
                    list.symbols.map((sym, idx) => {
                      const isDragOver = dragOverItem?.listId === list.id && dragOverItem?.symbol === sym;
                      const dragOverClass = isDragOver ? `drag-over-${dragOverItem.position}` : '';
                      const isDragging = draggedItem?.listId === list.id && draggedItem?.symbol === sym;

                      return (
                        <div
                          key={sym}
                          className={`watchlist-item ${sym === currentSymbol ? 'active' : ''} ${dragOverClass} ${isDragging ? 'dragging' : ''}`}
                          onClick={() => onSymbolClick(sym)}
                          draggable={true}
                          onDragStart={(e) => handleDragStart(e, list.id, sym, idx)}
                          onDragOver={(e) => handleDragOver(e, list.id, sym, idx)}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => handleDrop(e, list.id, sym, idx)}
                          onDragEnd={handleDragEnd}
                        >
                          <div className="watchlist-item-info">
                            <div className="watchlist-item-symbol">{sym}</div>
                            <div className="watchlist-item-name">{getDisplayName(sym)}</div>
                            <div className="watchlist-item-scores">
                              <span className="score-pill technical" title="Teknik Puan">
                                Teknik: {scores.get(sym) ? scores.get(sym)!.technical.toFixed(0) : '--'}
                              </span>
                            </div>
                          </div>
                          <PriceCell data={prices.get(sym)} />
                          <button
                            className="watchlist-remove-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveFromList(list.id, sym);
                            }}
                            title="Listeden Kaldır"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
