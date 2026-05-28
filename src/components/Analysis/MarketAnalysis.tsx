import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { runClientScan, clearScanCache, getCachedScanResults, type ScannedStock } from './scanEngine';
import './MarketAnalysis.css';

interface Props {
  onSymbolClick?: (symbol: string) => void;
}

type SortKey = 'symbol' | 'close' | 'changePercent' | 'overallScore' | 'williamsPasa' | 'nizamiCedid' | 'emaRibbon' | 'pearson' | 'matlrns';

interface FinancialMetrics {
  netProfit: number | null;
  revenueGrowth: number | null;
  equity: number | null;
  equityGrowth: number | null;
  latestPeriod: string;
}

export interface RuleConfig {
  id: string;
  leftFieldKey: string;
  operator: string;
  rightType: 'number' | 'field';
  rightValue: string;
}

export interface FieldDef {
  key: string;
  module: string;
  field: string;
  label: string;
  type: 'number' | 'boolean';
}

export const ALL_FIELDS: FieldDef[] = [
  { key: 'wp_value', module: 'wp', field: 'value', label: 'Williams Paşa: %R', type: 'number' },
  { key: 'wp_ema', module: 'wp', field: 'ema', label: 'Williams Paşa: %R EMA', type: 'number' },
  { key: 'nc_macd', module: 'nc', field: 'macd', label: 'Nizami Cedid: MACD', type: 'number' },
  { key: 'nc_macdSignal', module: 'nc', field: 'macdSignal', label: 'Nizami Cedid: Signal', type: 'number' },
  { key: 'nc_emacd', module: 'nc', field: 'emacd', label: 'Nizami Cedid: eMACD', type: 'number' },
  { key: 'nc_value', module: 'nc', field: 'value', label: 'Nizami Cedid: Delta', type: 'number' },
  { key: 'nc_condition', module: 'nc', field: 'condition', label: 'Nizami Cedid: Trend (EMA 377 > 610)', type: 'boolean' },
  { key: 'er_value', module: 'er', field: 'value', label: 'EMA Ribbon: Yayılım', type: 'number' },
  { key: 'pc_value', module: 'pc', field: 'value', label: 'Pearson: Korelasyon R', type: 'number' },
  { key: 'pc_pos', module: 'pc', field: 'pos', label: 'Pearson: Kanal Konumu', type: 'number' },
  { key: 'ml_value', module: 'ml', field: 'value', label: 'MATLRNS: Yön (-2 ile +2)', type: 'number' },
  { key: 'netProfit_netProfit', module: 'netProfit', field: 'netProfit', label: 'Finansal: Net Dönem Karı', type: 'number' },
  { key: 'revGrowth_revenueGrowth', module: 'revGrowth', field: 'revenueGrowth', label: 'Finansal: Satış Gelir Büyümesi (%)', type: 'number' },
  { key: 'equity_equity', module: 'equity', field: 'equity', label: 'Finansal: Özkaynaklar', type: 'number' },
  { key: 'equity_equityGrowth', module: 'equity', field: 'equityGrowth', label: 'Finansal: Özkaynak Büyümesi (%)', type: 'number' },
];

export const getRightFields = (leftFieldKey: string): FieldDef[] => {
  const leftDef = ALL_FIELDS.find(f => f.key === leftFieldKey);
  if (!leftDef) return [];
  return ALL_FIELDS.filter(f => f.module === leftDef.module && f.key !== leftFieldKey);
};

export const evaluateRule = (stock: ScannedStock, rule: RuleConfig, finData?: any): boolean => {
  const leftDef = ALL_FIELDS.find(f => f.key === rule.leftFieldKey);
  if (!leftDef) return true;

  let leftVal: any = null;
  const modId = leftDef.module;
  if (['wp', 'nc', 'er', 'pc', 'ml'].includes(modId)) {
    const indicatorData = stock.indicators[modId === 'wp' ? 'williamsPasa' : modId === 'nc' ? 'nizamiCedid' : modId === 'er' ? 'emaRibbon' : modId === 'pc' ? 'pearson' : 'matlrns'];
    if (!indicatorData) return true;
    leftVal = (indicatorData as any)[leftDef.field];
  } else {
    if (!finData) return true;
    leftVal = finData[leftDef.field];
  }

  if (leftVal === null || leftVal === undefined) return false;

  let rightVal: any = null;
  if (rule.rightType === 'number') {
    if (leftDef.type === 'boolean') {
      rightVal = rule.rightValue.toLowerCase() === 'true' || rule.rightValue === '1';
    } else {
      rightVal = parseFloat(rule.rightValue);
      if (isNaN(rightVal)) return true; // ignore invalid comparison value
    }
  } else {
    const rightDef = ALL_FIELDS.find(f => f.key === rule.rightValue);
    if (!rightDef) return true;
    const rightModId = rightDef.module;
    if (['wp', 'nc', 'er', 'pc', 'ml'].includes(rightModId)) {
      const indicatorData = stock.indicators[rightModId === 'wp' ? 'williamsPasa' : rightModId === 'nc' ? 'nizamiCedid' : rightModId === 'er' ? 'emaRibbon' : rightModId === 'pc' ? 'pearson' : 'matlrns'];
      rightVal = indicatorData ? (indicatorData as any)[rightDef.field] : null;
    } else {
      rightVal = finData ? finData[rightDef.field] : null;
    }
  }

  if (rightVal === null || rightVal === undefined) return false;

  // Scale Nizami Cedid values for display percentage parity (so typing 1 means 1%)
  let scaledLeft = leftVal;
  let scaledRight = rightVal;
  if (rule.rightType === 'number' && modId === 'nc' && ['value', 'macd', 'macdSignal', 'emacd'].includes(leftDef.field)) {
    scaledLeft = leftVal * 100;
  }

  switch (rule.operator) {
    case '>': return scaledLeft > scaledRight;
    case '<': return scaledLeft < scaledRight;
    case '>=': return scaledLeft >= scaledRight;
    case '<=': return scaledLeft <= scaledRight;
    case '==': return scaledLeft === scaledRight;
    case '!=': return scaledLeft !== scaledRight;
    default: return true;
  }
};

// Global module-level memory cache for financials to prevent refetching and temporary blank fields on navigation
let cachedFinancials: Record<string, FinancialMetrics | null> = {};
try {
  const savedFin = localStorage.getItem('temist_scanner_financials');
  if (savedFin) {
    cachedFinancials = JSON.parse(savedFin);
  }
} catch (e) {
  console.error('Failed to parse cached financials:', e);
}

export default function MarketAnalysis({ onSymbolClick }: Props) {
  // Tabs
  const [activeTab, setActiveTab] = useState<'smart' | 'indicator'>(() => {
    const saved = localStorage.getItem('temist_scanner_active_tab');
    return (saved === 'smart' || saved === 'indicator') ? saved : 'indicator';
  });

  // Visible Columns for Indicator Scanner Table
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('temist_scanner_visible_columns');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // fallback
      }
    }
    return {
      wp: true,
      nc: true,
      er: false,
      pc: false,
      ml: false,
      netProfit: false,
      revGrowth: false,
      equity: false,
    };
  });

  // Manual Filter Rules List
  const [rules, setRules] = useState<RuleConfig[]>(() => {
    const saved = localStorage.getItem('temist_scanner_rules');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // fallback
      }
    }
    return [
      { id: 'default_rule', leftFieldKey: 'wp_value', operator: '>', rightType: 'field', rightValue: 'wp_ema' }
    ];
  });

  useEffect(() => {
    localStorage.setItem('temist_scanner_active_tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('temist_scanner_visible_columns', JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  useEffect(() => {
    localStorage.setItem('temist_scanner_rules', JSON.stringify(rules));
  }, [rules]);

  const updateRule = (id: string, updates: Partial<RuleConfig>) => {
    setRules(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  const addRule = () => {
    const newRule: RuleConfig = {
      id: Math.random().toString(36).substr(2, 9),
      leftFieldKey: 'wp_value',
      operator: '>',
      rightType: 'field',
      rightValue: 'wp_ema'
    };
    setRules(prev => [...prev, newRule]);
    
    // Automatically turn on the column display for this rule's module
    const fieldDef = ALL_FIELDS.find(f => f.key === newRule.leftFieldKey);
    if (fieldDef) {
      setVisibleColumns(prev => ({ ...prev, [fieldDef.module]: true }));
    }
  };

  const removeRule = (id: string) => {
    setRules(prev => prev.filter(r => r.id !== id));
  };

  const handleLeftFieldChange = (id: string, newLeftKey: string) => {
    const rightOptions = getRightFields(newLeftKey);
    const hasRightFields = rightOptions.length > 0;
    const defaultRightType = hasRightFields ? 'field' : 'number';
    const defaultRightValue = hasRightFields ? rightOptions[0].key : '0';

    updateRule(id, {
      leftFieldKey: newLeftKey,
      rightType: defaultRightType,
      rightValue: defaultRightValue
    });

    // Automatically make the corresponding module column visible
    const fieldDef = ALL_FIELDS.find(f => f.key === newLeftKey);
    if (fieldDef) {
      setVisibleColumns(prev => ({ ...prev, [fieldDef.module]: true }));
    }
  };

  // Akıllı Tarama States
  const [results, setResults] = useState<ScannedStock[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number; currentSymbol: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Akıllı Tarama Filters & Search
  const [filterBullishWP, setFilterBullishWP] = useState(() => localStorage.getItem('temist_scanner_f_wp') === 'true');
  const [filterBullishNC, setFilterBullishNC] = useState(() => localStorage.getItem('temist_scanner_f_nc') === 'true');
  const [filterBullishER, setFilterBullishER] = useState(() => localStorage.getItem('temist_scanner_f_er') === 'true');
  const [filterBullishPC, setFilterBullishPC] = useState(() => localStorage.getItem('temist_scanner_f_pc') === 'true');
  const [filterBullishML, setFilterBullishML] = useState(() => localStorage.getItem('temist_scanner_f_ml') === 'true');
  const [filterHighScore, setFilterHighScore] = useState(() => localStorage.getItem('temist_scanner_f_high') === 'true');

  useEffect(() => { localStorage.setItem('temist_scanner_f_wp', String(filterBullishWP)); }, [filterBullishWP]);
  useEffect(() => { localStorage.setItem('temist_scanner_f_nc', String(filterBullishNC)); }, [filterBullishNC]);
  useEffect(() => { localStorage.setItem('temist_scanner_f_er', String(filterBullishER)); }, [filterBullishER]);
  useEffect(() => { localStorage.setItem('temist_scanner_f_pc', String(filterBullishPC)); }, [filterBullishPC]);
  useEffect(() => { localStorage.setItem('temist_scanner_f_ml', String(filterBullishML)); }, [filterBullishML]);
  useEffect(() => { localStorage.setItem('temist_scanner_f_high', String(filterHighScore)); }, [filterHighScore]);

  // Financial data loading state
  const [financialsData, setFinancialsData] = useState<Record<string, FinancialMetrics | null>>(() => cachedFinancials);
  const [loadingFinancials, setLoadingFinancials] = useState(false);

  // Drawer & Selection
  const [selectedStock, setSelectedStock] = useState<ScannedStock | null>(() => {
    const saved = localStorage.getItem('temist_scanner_selected_stock');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // fallback
      }
    }
    return null;
  });
  const [drawerOpen, setDrawerOpen] = useState(() => {
    return localStorage.getItem('temist_scanner_drawer_open') === 'true';
  });

  useEffect(() => {
    if (selectedStock) {
      localStorage.setItem('temist_scanner_selected_stock', JSON.stringify(selectedStock));
    } else {
      localStorage.removeItem('temist_scanner_selected_stock');
    }
  }, [selectedStock]);

  useEffect(() => {
    localStorage.setItem('temist_scanner_drawer_open', String(drawerOpen));
  }, [drawerOpen]);

  // Sorting for Smart Scanner
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const saved = localStorage.getItem('temist_scanner_sort_key');
    return saved ? (saved as SortKey) : 'overallScore';
  });
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(() => {
    const saved = localStorage.getItem('temist_scanner_sort_dir');
    return (saved === 'asc' || saved === 'desc') ? saved : 'desc';
  });

  // Sorting for Indicator Scanner
  const [indSortKey, setIndSortKey] = useState<string>(() => {
    return localStorage.getItem('temist_scanner_ind_sort_key') ?? 'symbol';
  });
  const [indSortDirection, setIndSortDirection] = useState<'asc' | 'desc'>(() => {
    const saved = localStorage.getItem('temist_scanner_ind_sort_dir');
    return (saved === 'asc' || saved === 'desc') ? saved : 'asc';
  });

  useEffect(() => { localStorage.setItem('temist_scanner_sort_key', sortKey); }, [sortKey]);
  useEffect(() => { localStorage.setItem('temist_scanner_sort_dir', sortDirection); }, [sortDirection]);
  useEffect(() => { localStorage.setItem('temist_scanner_ind_sort_key', indSortKey); }, [indSortKey]);
  useEffect(() => { localStorage.setItem('temist_scanner_ind_sort_dir', indSortDirection); }, [indSortDirection]);



  // Load scanner results (uses memory cache inside scanEngine if available)
  const doScan = useCallback(async (force = false) => {
    setScanning(true);
    setError(null);
    setProgress(null);
    setSelectedStock(null);
    setDrawerOpen(false);

    try {
      const scanResults = await runClientScan((completed, total, currentSymbol) => {
        setProgress({ completed, total, currentSymbol });
      }, force);
      setResults(scanResults);
    } catch (err) {
      setError('Tarama sırasında bir hata oluştu: ' + String(err));
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    const cached = getCachedScanResults();
    if (cached && cached.length > 0) {
      setResults(cached);
    } else {
      doScan(false);
    }
  }, [doScan]);

  const handleRescan = useCallback(() => {
    clearScanCache();
    doScan(true);
  }, [doScan]);

  // Toggle visible columns
  const handleToggleColumn = (mod: string) => {
    setVisibleColumns(prev => ({
      ...prev,
      [mod]: !prev[mod]
    }));
  };

  // Handle row sorting for Smart Scanner
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
  };

  // Helper to resolve sort values
  const getSortValue = (stock: ScannedStock, key: SortKey): any => {
    switch (key) {
      case 'williamsPasa':
        return stock.indicators.williamsPasa.score;
      case 'nizamiCedid':
        return stock.indicators.nizamiCedid.score;
      case 'emaRibbon':
        return stock.indicators.emaRibbon.score;
      case 'pearson':
        return stock.indicators.pearson.score;
      case 'matlrns':
        return stock.indicators.matlrns.score;
      default:
        return stock[key];
    }
  };

  // Apply filters and sorting to Smart Scanner
  const filteredAndSorted = useMemo(() => {
    let list = [...results];

    // Indicator switches
    if (filterBullishWP) {
      list = list.filter(item => item.indicators.williamsPasa.signal === 'bullish');
    }
    if (filterBullishNC) {
      list = list.filter(item => item.indicators.nizamiCedid.signal === 'bullish');
    }
    if (filterBullishER) {
      list = list.filter(item => item.indicators.emaRibbon.signal === 'bullish');
    }
    if (filterBullishPC) {
      list = list.filter(item => item.indicators.pearson.signal === 'bullish');
    }
    if (filterBullishML) {
      list = list.filter(item => item.indicators.matlrns.signal === 'bullish');
    }
    if (filterHighScore) {
      list = list.filter(item => item.overallScore >= 70);
    }

    // Sort list
    list.sort((a, b) => {
      const valA = getSortValue(a, sortKey);
      const valB = getSortValue(b, sortKey);

      if (valA === valB) return 0;
      if (valA == null) return 1;
      if (valB == null) return -1;

      const isNumeric = typeof valA === 'number' && typeof valB === 'number';
      const order = isNumeric ? (valA as number) - (valB as number) : String(valA).localeCompare(String(valB));
      return sortDirection === 'asc' ? order : -order;
    });

    return list;
  }, [results, filterBullishWP, filterBullishNC, filterBullishER, filterBullishPC, filterBullishML, filterHighScore, sortKey, sortDirection]);

  // Market sentiment calculations
  const sentimentStats = useMemo(() => {
    if (results.length === 0) return { avgScore: 50, bullCount: 0, bearCount: 0, neutralCount: 0 };
    
    let sumScore = 0;
    let bullCount = 0;
    let bearCount = 0;
    let neutralCount = 0;

    for (const item of results) {
      sumScore += item.overallScore;
      if (item.overallScore >= 70) bullCount++;
      else if (item.overallScore <= 30) bearCount++;
      else neutralCount++;
    }

    return {
      avgScore: Math.round(sumScore / results.length),
      bullCount,
      bearCount,
      neutralCount,
    };
  }, [results]);

  const handleRowClick = (stock: ScannedStock) => {
    setSelectedStock(stock);
    setDrawerOpen(true);
  };

  const getSentimentLabel = (score: number) => {
    if (score >= 70) return 'AŞIRI ALICI (BOĞA)';
    if (score >= 55) return 'ALICI (BOĞA)';
    if (score <= 30) return 'AŞIRI SATICI (AYI)';
    if (score <= 45) return 'SATICI (AYI)';
    return 'DENGELİ (NÖTR)';
  };

  const getScoreColor = (score: number) => {
    const hue = Math.max(0, Math.min(120, (score / 100) * 120));
    return `hsl(${hue}, 85%, 45%)`;
  };

  const getSignalBadgeClass = (signal: 'bullish' | 'bearish' | 'neutral') => {
    if (signal === 'bullish') return 'badge-bullish';
    if (signal === 'bearish') return 'badge-bearish';
    return 'badge-neutral';
  };

  const getSignalLabelTr = (signal: 'bullish' | 'bearish' | 'neutral') => {
    if (signal === 'bullish') return 'Yükseliş';
    if (signal === 'bearish') return 'Düşüş';
    return 'Nötr';
  };

  // ── Financial Data Batch Loader ─────────────────

  const fetchFinancialMetrics = async (symbol: string): Promise<FinancialMetrics | null> => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/financials/${symbol}.json`);
      if (!res.ok) return null;
      const json = await res.json();

      const incomeStmt = json.income_stmt;
      const balanceSheet = json.balance_sheet;
      if (!incomeStmt || !balanceSheet) return null;

      const periods = incomeStmt.periods ?? [];
      if (periods.length === 0) return null;

      const lastPeriod = periods[periods.length - 1];

      // Find net profit
      const profitRow = incomeStmt.data.find(
        (r: any) => r.item === 'DÖNEM KARI (ZARARI)' || r.item === 'Ana Ortaklık Payları'
      );
      const netProfit = profitRow ? profitRow[lastPeriod] ?? null : null;

      // Find revenue
      const revenueRow = incomeStmt.data.find((r: any) => r.item === 'Satış Gelirleri');
      const lastRevenue = revenueRow ? revenueRow[lastPeriod] ?? null : null;

      // Find revenue growth YoY
      let revenueGrowth = null;
      if (periods.length > 4 && revenueRow) {
        const lastParts = lastPeriod.split('/');
        const lastYear = parseInt(lastParts[0]);
        const lastMonth = lastParts[1];
        const prevPeriod = `${lastYear - 1}/${lastMonth}`;

        const prevRevenue = revenueRow[prevPeriod] ?? null;
        if (lastRevenue !== null && prevRevenue !== null && prevRevenue !== 0) {
          revenueGrowth = ((lastRevenue - prevRevenue) / prevRevenue) * 100;
        }
      }

      // Find last equity
      const bsPeriods = balanceSheet.periods ?? [];
      const lastBsPeriod = bsPeriods[bsPeriods.length - 1];
      const equityRow = balanceSheet.data.find((r: any) => r.item === 'Özkaynaklar');
      const lastEquity = equityRow ? equityRow[lastBsPeriod] ?? null : null;

      // Find equity growth YoY
      let equityGrowth = null;
      if (bsPeriods.length > 4 && equityRow) {
        const lastParts = lastBsPeriod.split('/');
        const lastYear = parseInt(lastParts[0]);
        const lastMonth = lastParts[1];
        const prevBsPeriod = `${lastYear - 1}/${lastMonth}`;

        const prevEquity = equityRow[prevBsPeriod] ?? null;
        if (lastEquity !== null && prevEquity !== null && prevEquity !== 0) {
          equityGrowth = ((lastEquity - prevEquity) / prevEquity) * 100;
        }
      }

      return {
        netProfit,
        revenueGrowth,
        equity: lastEquity,
        equityGrowth,
        latestPeriod: lastPeriod,
      };
    } catch (e) {
      console.error(`Error loading financials for ${symbol}:`, e);
      return null;
    }
  };

  // Filter computed results technically based on OUR active indicator rules
  const technicallyFiltered = useMemo(() => {
    let list = [...results];

    // Evaluate active technical rules
    const techRules = rules.filter(r => {
      const fieldDef = ALL_FIELDS.find(f => f.key === r.leftFieldKey);
      return fieldDef && ['wp', 'nc', 'er', 'pc', 'ml'].includes(fieldDef.module);
    });

    for (const rule of techRules) {
      list = list.filter(item => evaluateRule(item, rule));
    }

    return list;
  }, [results, rules]);

  // Background financials loader triggered by technical filters
  useEffect(() => {
    if (activeTab !== 'indicator') return;

    // Check if at least one active rule references financial modules, OR if financial columns are manually enabled
    const hasFinActive = rules.some(r => {
      const fieldDef = ALL_FIELDS.find(f => f.key === r.leftFieldKey);
      return fieldDef && ['netProfit', 'revGrowth', 'equity'].includes(fieldDef.module);
    }) || visibleColumns.netProfit || visibleColumns.revGrowth || visibleColumns.equity;

    if (!hasFinActive) return;

    const needed = technicallyFiltered
      .map(item => item.symbol)
      .filter(sym => financialsData[sym] === undefined);

    if (needed.length === 0) return;

    let active = true;
    setLoadingFinancials(true);

    const loadBatch = async () => {
      const BATCH = 8;
      for (let i = 0; i < needed.length; i += BATCH) {
        if (!active) break;
        const batch = needed.slice(i, i + BATCH);
        const promises = batch.map(async sym => {
          const metrics = await fetchFinancialMetrics(sym);
          return { sym, metrics };
        });
        const batchRes = await Promise.all(promises);

        if (!active) break;

        setFinancialsData(prev => {
          const next = { ...prev };
          for (const item of batchRes) {
            next[item.sym] = item.metrics;
          }
          cachedFinancials = next;
          try {
            localStorage.setItem('temist_scanner_financials', JSON.stringify(next));
          } catch (e) {
            console.error('Failed to save financials to localStorage:', e);
          }
          return next;
        });
      }
      if (active) {
        setLoadingFinancials(false);
      }
    };

    loadBatch();

    return () => {
      active = false;
    };
  }, [technicallyFiltered, activeTab, financialsData, rules, visibleColumns]);

  const getIndSortValue = (stock: ScannedStock, key: string): any => {
    if (key === 'symbol') return stock.symbol;
    if (key === 'close') return stock.close;
    if (key === 'changePercent') return stock.changePercent;

    const fieldDef = ALL_FIELDS.find(f => f.key === key);
    if (!fieldDef) return 0;

    const modId = fieldDef.module;
    if (['wp', 'nc', 'er', 'pc', 'ml'].includes(modId)) {
      const indicatorData = stock.indicators[modId === 'wp' ? 'williamsPasa' : modId === 'nc' ? 'nizamiCedid' : modId === 'er' ? 'emaRibbon' : modId === 'pc' ? 'pearson' : 'matlrns'];
      if (!indicatorData) return 0;
      return (indicatorData as any)[fieldDef.field];
    } else {
      const fin = financialsData[stock.symbol];
      if (!fin) return null;
      return fin[fieldDef.field];
    }
  };

  const handleIndSort = (key: string) => {
    if (indSortKey === key) {
      setIndSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setIndSortKey(key);
      setIndSortDirection(key === 'symbol' ? 'asc' : 'desc');
    }
  };

  // Apply financials filters and sort for indicator tab
  const indicatorFilteredAndSorted = useMemo(() => {
    let list = [...technicallyFiltered];

    // Evaluate active financial rules
    const finRules = rules.filter(r => {
      const fieldDef = ALL_FIELDS.find(f => f.key === r.leftFieldKey);
      return fieldDef && ['netProfit', 'revGrowth', 'equity'].includes(fieldDef.module);
    });

    for (const rule of finRules) {
      list = list.filter(item => {
        const fin = financialsData[item.symbol];
        return evaluateRule(item, rule, fin);
      });
    }

    // Sort list
    list.sort((a, b) => {
      const valA = getIndSortValue(a, indSortKey);
      const valB = getIndSortValue(b, indSortKey);

      if (valA === valB) return 0;
      if (valA == null) return 1;
      if (valB == null) return -1;

      const isNumeric = typeof valA === 'number' && typeof valB === 'number';
      const order = isNumeric ? (valA as number) - (valB as number) : String(valA).localeCompare(String(valB));
      return indSortDirection === 'asc' ? order : -order;
    });

    return list;
  }, [technicallyFiltered, financialsData, rules, indSortKey, indSortDirection]);

  // Scroll position persistence
  const tableWrapRef = useRef<HTMLDivElement>(null);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    localStorage.setItem(`temist_scanner_scroll_${activeTab}`, String(e.currentTarget.scrollTop));
  };

  useEffect(() => {
    if (tableWrapRef.current) {
      const savedScroll = localStorage.getItem(`temist_scanner_scroll_${activeTab}`);
      if (savedScroll) {
        tableWrapRef.current.scrollTop = parseInt(savedScroll, 10);
      } else {
        tableWrapRef.current.scrollTop = 0;
      }
    }
  }, [activeTab, results, filteredAndSorted.length, indicatorFilteredAndSorted.length]);

  // Explanations for detail drawer
  const getWilliamsPasaExplanation = (stock: ScannedStock) => {
    const wp = stock.indicators.williamsPasa;
    if (wp.signal === 'bullish') {
      return `Williams Paşa %R değeri (${wp.value.toFixed(1)}) kendi EMA çizgisinin (${wp.ema.toFixed(1)}) üzerindedir. Bu durum kısa vadeli alım iştahının ve yükseliş ivmesinin arttığını gösterir.`;
    }
    if (wp.signal === 'bearish') {
      return `Williams Paşa %R değeri (${wp.value.toFixed(1)}) kendi EMA çizgisinin (${wp.ema.toFixed(1)}) altındadır. Bu durum satış baskısının veya zayıflayan momentumun işaretidir.`;
    }
    return `Williams Paşa %R değeri (${wp.value.toFixed(1)}) kendi EMA seviyesine (${wp.ema.toFixed(1)}) yakındır, belirgin bir kısa vadeli yön kararsızlığı göstermektedir.`;
  };

  const getNizamiCedidExplanation = (stock: ScannedStock) => {
    const nc = stock.indicators.nizamiCedid;
    if (nc.signal === 'bullish') {
      return `Nizami Cedid delta değeri pozitif (${nc.value.toFixed(4)}) ve uzun vadeli trend (EMA 377 > EMA 610) koşulu sağlanmış durumda. Bu, sağlıklı bir orta-uzun vadeli yükseliş yapısını destekler.`;
    }
    if (nc.signal === 'bearish') {
      if (!nc.condition) {
        return `Uzun vadeli trend düşüş yönünde (EMA 377 < EMA 610) seyrediyor. Delta değeri negatif veya zayıf seyrederek genel negatif trend eğilimini teyit etmektedir.`;
      }
      return `Nizami Cedid delta değeri negatif (${nc.value.toFixed(4)}), bu durum orta vadeli bir geri çekilmeye veya satıcıların hakimiyeti ele geçirdiğine işaret eder.`;
    }
    return `Nizami Cedid delta değeri sıfıra yakın seyrediyor. Hacim ağırlıklı hareketli ortalamalarda konsolidasyon ve kararsızlık mevcuttur.`;
  };

  const getEmaRibbonExplanation = (stock: ScannedStock) => {
    const er = stock.indicators.emaRibbon;
    if (er.signal === 'bullish') {
      return `EMA Ribbon hareketli ortalamalar şeridi ideal yükseliş sıralamasındadır (EMA 8 > 13 > 21 > ... > 610). Ortalama yayılım oranı (${er.value.toFixed(3)}) güçlü bir trend ivmesini göstermektedir.`;
    }
    if (er.signal === 'bearish') {
      return `EMA şeridi ters sıralanmıştır veya düşüş yönlü genişlemektedir. Ortalama yayılım oranı (${er.value.toFixed(3)}) düşüş yönlü satış baskısını yansıtır.`;
    }
    return `EMA şeridi sıkışmış (karışmış) durumdadır. Bu, piyasada bir yatay bant (konsolidasyon) sürecinin veya trend dönüşüm aşamasının yaşandığını gösterir.`;
  };

  const getPearsonExplanation = (stock: ScannedStock) => {
    const pc = stock.indicators.pearson;
    if (pc.signal === 'bullish') {
      return `Kısa, uzun ve en uzun vadeli Pearson regresyon kanalları genel olarak yukarı eğilimlidir (R = ${pc.value.toFixed(2)}) ve fiyat kanal ortalamalarına (Pozisyon = ${pc.pos.toFixed(2)}) yakın destekleyici bölgelerdedir.`;
    }
    if (pc.signal === 'bearish') {
      return `Pearson kanalları aşağı eğilimlidir (R = ${pc.value.toFixed(2)}) ve fiyat direnç bölgelerine yakın seyretmektedir. Düşüş eğilimi kanal boyunca devam edebilir.`;
    }
    return `Pearson regresyon kanalları yatay veya karışık yönlerde. Trend gücü (Korelasyon R = ${pc.value.toFixed(2)}) belirgin bir yöne işaret etmemektedir.`;
  };

  const getMatlrnsExplanation = (stock: ScannedStock) => {
    const ml = stock.indicators.matlrns;
    if (ml.value === 2) {
      return 'MATLRNS trend takip sistemi +2 seviyesinde tam boğa durumunda. Hem hızlı hem yavaş hareketli ortalamalar güçlü bir yükseliş teyidi vermektedir.';
    }
    if (ml.value === 1) {
      return 'MATLRNS trend takip sistemi +1 seviyesinde. Yükseliş eğilimi başlamış veya zayıf da olsa devam etmektedir.';
    }
    if (ml.value === -1) {
      return 'MATLRNS trend takip sistemi -1 seviyesinde. Düşüş yönlü baskılar artmakta ve temkinli olunması gerekmektedir.';
    }
    if (ml.value === -2) {
      return 'MATLRNS trend takip sistemi -2 seviyesinde tam ayı durumunda. Satış baskısı en üst seviyededir.';
    }
    return 'MATLRNS trend takip sistemi 0 (nötr) seviyesinde. Kararsızlık veya trend dönüşüm uyarısı mevcuttur.';
  };

  const formatLargeMoney = (value: number | null): string => {
    if (value === null) return '-';
    const absVal = Math.abs(value);
    if (absVal >= 1_000_000_000) {
      return (value / 1_000_000_000).toFixed(2) + ' Milyar ₺';
    }
    if (absVal >= 1_000_000) {
      return (value / 1_000_000).toFixed(2) + ' Milyon ₺';
    }
    return value.toLocaleString('tr-TR') + ' ₺';
  };

  return (
    <div className={`market-analysis-wrapper ${drawerOpen ? 'drawer-active' : ''}`}>
      <div className="market-analysis">
        
        {/* Header */}
        <div className="analysis-header">
          <div className="analysis-header-left">
            <h2 className="analysis-title">BIST Tarama Modülleri</h2>
            <span className="analysis-subtitle">
              Teknik ve temel verileri entegre eden akıllı filtreler
            </span>
          </div>
          <div className="analysis-header-right">
            <button className="rescan-btn" onClick={handleRescan} disabled={scanning}>
              {scanning ? 'Hesaplanıyor...' : 'Yeniden Hesapla / Tara'}
            </button>
          </div>
        </div>

        {/* Tab Selection Row */}
        <div className="scanner-tabs">
          <button
            className={`scanner-tab-btn ${activeTab === 'smart' ? 'active' : ''}`}
            onClick={() => setActiveTab('smart')}
          >
            🧠 Akıllı Tarama (Puan Bazlı)
          </button>
          <button
            className={`scanner-tab-btn ${activeTab === 'indicator' ? 'active' : ''}`}
            onClick={() => setActiveTab('indicator')}
          >
            📊 İndikatör & Finansal Bazlı Tarama
          </button>
        </div>

        {/* Progress bar */}
        {scanning && (
          <div className="scan-progress">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: progress ? `${(progress.completed / progress.total) * 100}%` : '2%',
                }}
              />
            </div>
            <div className="progress-text">
              {progress
                ? `${progress.completed} / ${progress.total} hissenin verisi işlendi (${progress.currentSymbol})`
                : 'Tarama başlatılıyor...'}
            </div>
          </div>
        )}

        {/* Error */}
        {error && <div className="scan-error">{error}</div>}

        {/* ── TAB 1: SMART SCANNER ────────────────── */}
        {activeTab === 'smart' && results.length > 0 && (
          <>
            {/* Sentiment Dashboard */}
            <div className="sentiment-dashboard">
              <div className="sentiment-card avg-score-card">
                <div className="sentiment-card-label">Piyasa Ortalama Skoru</div>
                <div className="avg-score-value" style={{ color: getScoreColor(sentimentStats.avgScore) }}>
                  {sentimentStats.avgScore} <span className="score-out-of">/ 100</span>
                </div>
                <div className="sentiment-verdict">
                  Durum: <strong>{getSentimentLabel(sentimentStats.avgScore)}</strong>
                </div>
              </div>
              <div className="sentiment-card distribution-card">
                <div className="sentiment-card-label">Hisse Dağılımları</div>
                <div className="distribution-row">
                  <div className="dist-item bull-dist">
                    <span className="dist-dot bg-bullish"></span>
                    <span className="dist-label">Yükseliş (Boğa):</span>
                    <span className="dist-count">{sentimentStats.bullCount} Hisse</span>
                  </div>
                  <div className="dist-item neutral-dist">
                    <span className="dist-dot bg-neutral"></span>
                    <span className="dist-label">Nötr (Kararsız):</span>
                    <span className="dist-count">{sentimentStats.neutralCount} Hisse</span>
                  </div>
                  <div className="dist-item bear-dist">
                    <span className="dist-dot bg-bearish"></span>
                    <span className="dist-label">Düşüş (Ayı):</span>
                    <span className="dist-count">{sentimentStats.bearCount} Hisse</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Filters */}
            <div className="scanner-filters">
              <div className="filter-checkboxes-row">
                <span className="filter-row-label">Yükseliş Koşul Filtreleri:</span>
                <label className="filter-pill">
                  <input
                    type="checkbox"
                    checked={filterBullishWP}
                    onChange={e => setFilterBullishWP(e.target.checked)}
                  />
                  <span>Williams Paşa %R</span>
                </label>
                <label className="filter-pill">
                  <input
                    type="checkbox"
                    checked={filterBullishNC}
                    onChange={e => setFilterBullishNC(e.target.checked)}
                  />
                  <span>Nizami Cedid</span>
                </label>
                <label className="filter-pill">
                  <input
                    type="checkbox"
                    checked={filterBullishER}
                    onChange={e => setFilterBullishER(e.target.checked)}
                  />
                  <span>EMA Ribbon</span>
                </label>
                <label className="filter-pill">
                  <input
                    type="checkbox"
                    checked={filterBullishPC}
                    onChange={e => setFilterBullishPC(e.target.checked)}
                  />
                  <span>Pearson Kanal</span>
                </label>
                <label className="filter-pill">
                  <input
                    type="checkbox"
                    checked={filterBullishML}
                    onChange={e => setFilterBullishML(e.target.checked)}
                  />
                  <span>MATLRNS</span>
                </label>
                <label className="filter-pill score-pill">
                  <input
                    type="checkbox"
                    checked={filterHighScore}
                    onChange={e => setFilterHighScore(e.target.checked)}
                  />
                  <span>Puan ≥ 70</span>
                </label>
              </div>
            </div>

            {/* Smart Table */}
            <div className="scanner-table-section">
              <div className="scanner-table-info">
                Gösterilen: <strong>{filteredAndSorted.length}</strong> / {results.length} hisse
              </div>
              <div ref={tableWrapRef} className="scanner-table-wrap" onScroll={handleScroll}>
                <table className="scanner-table">
                  <thead>
                    <tr>
                      <th onClick={() => handleSort('symbol')} className="sortable">
                        Hisse {sortKey === 'symbol' && (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th onClick={() => handleSort('close')} className="sortable text-right">
                        Kapanış {sortKey === 'close' && (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th onClick={() => handleSort('changePercent')} className="sortable text-right">
                        Günlük Değ. {sortKey === 'changePercent' && (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th onClick={() => handleSort('overallScore')} className="sortable score-th">
                        Genel Puan {sortKey === 'overallScore' && (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th onClick={() => handleSort('williamsPasa')} className="sortable text-center">
                        WP {sortKey === 'williamsPasa' && (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th onClick={() => handleSort('nizamiCedid')} className="sortable text-center">
                        NC {sortKey === 'nizamiCedid' && (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th onClick={() => handleSort('emaRibbon')} className="sortable text-center">
                        ER {sortKey === 'emaRibbon' && (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th onClick={() => handleSort('pearson')} className="sortable text-center">
                        PC {sortKey === 'pearson' && (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th onClick={() => handleSort('matlrns')} className="sortable text-center">
                        ML {sortKey === 'matlrns' && (sortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSorted.map(stock => (
                      <tr
                        key={stock.symbol}
                        onClick={() => handleRowClick(stock)}
                        className={`stock-row ${selectedStock?.symbol === stock.symbol ? 'selected' : ''}`}
                      >
                        <td className="stock-sym">
                          <button
                            className="chart-link-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSymbolClick?.(stock.symbol);
                            }}
                            title="Grafiğini Aç"
                          >
                            📈
                          </button>
                          <span>{stock.symbol}</span>
                        </td>
                        <td className="text-right font-mono">{stock.close.toFixed(2)}</td>
                        <td className={`text-right font-mono font-semibold ${stock.changePercent > 0 ? 'text-bullish' : stock.changePercent < 0 ? 'text-bearish' : 'text-neutral'}`}>
                          {stock.changePercent > 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                        </td>
                        <td className="score-td">
                          <div className="overall-score-bar-wrap">
                            <span className="score-number-label">{stock.overallScore}</span>
                            <div className="score-bar-bg">
                              <div
                                className="score-bar-fill"
                                style={{
                                  width: `${stock.overallScore}%`,
                                  backgroundColor: getScoreColor(stock.overallScore),
                                }}
                              />
                            </div>
                          </div>
                        </td>
                        {/* 5 Indicator status columns */}
                        <td className="text-center">
                          <span
                            className={`indicator-status-dot ${stock.indicators.williamsPasa.signal}`}
                            title={`WP Puanı: ${stock.indicators.williamsPasa.score}/20 (%R: ${stock.indicators.williamsPasa.value.toFixed(1)})`}
                          />
                        </td>
                        <td className="text-center">
                          <span
                            className={`indicator-status-dot ${stock.indicators.nizamiCedid.signal}`}
                            title={`NC Puanı: ${stock.indicators.nizamiCedid.score}/20 (Delta: ${stock.indicators.nizamiCedid.value.toFixed(4)})`}
                          />
                        </td>
                        <td className="text-center">
                          <span
                            className={`indicator-status-dot ${stock.indicators.emaRibbon.signal}`}
                            title={`ER Puanı: ${stock.indicators.emaRibbon.score}/20 (Yayılım: ${stock.indicators.emaRibbon.value.toFixed(3)})`}
                          />
                        </td>
                        <td className="text-center">
                          <span
                            className={`indicator-status-dot ${stock.indicators.pearson.signal}`}
                            title={`PC Puanı: ${stock.indicators.pearson.score}/20 (Eğilim R: ${stock.indicators.pearson.value.toFixed(2)})`}
                          />
                        </td>
                        <td className="text-center">
                          <span
                            className={`indicator-status-dot ${stock.indicators.matlrns.signal}`}
                            title={`ML Puanı: ${stock.indicators.matlrns.score}/20 (Sinyal: ${stock.indicators.matlrns.value})`}
                          />
                        </td>
                      </tr>
                    ))}
                    {filteredAndSorted.length === 0 && (
                      <tr>
                        <td colSpan={9} className="no-results-cell">
                          Arama kriterlerine uygun hisse bulunamadı.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── TAB 2: INDICATOR & FINANCIAL SCANNER ── */}
        {activeTab === 'indicator' && results.length > 0 && (
          <>
            {/* Column Selector Checklist Row */}
            <div className="column-selector-panel">
              <span className="filter-row-label">Gösterilecek Sütunlar:</span>
              <div className="filter-checkboxes-row">
                <label className="filter-pill">
                  <input
                    type="checkbox"
                    checked={visibleColumns.wp}
                    onChange={() => handleToggleColumn('wp')}
                  />
                  <span>Williams Paşa</span>
                </label>
                <label className="filter-pill">
                  <input
                    type="checkbox"
                    checked={visibleColumns.nc}
                    onChange={() => handleToggleColumn('nc')}
                  />
                  <span>Nizami Cedid</span>
                </label>
                <label className="filter-pill">
                  <input
                    type="checkbox"
                    checked={visibleColumns.er}
                    onChange={() => handleToggleColumn('er')}
                  />
                  <span>EMA Ribbon</span>
                </label>
                <label className="filter-pill">
                  <input
                    type="checkbox"
                    checked={visibleColumns.pc}
                    onChange={() => handleToggleColumn('pc')}
                  />
                  <span>Pearson Kanal</span>
                </label>
                <label className="filter-pill">
                  <input
                    type="checkbox"
                    checked={visibleColumns.ml}
                    onChange={() => handleToggleColumn('ml')}
                  />
                  <span>MATLRNS</span>
                </label>
                <label className="filter-pill">
                  <input
                    type="checkbox"
                    checked={visibleColumns.netProfit}
                    onChange={() => handleToggleColumn('netProfit')}
                  />
                  <span>Net Kar</span>
                </label>
                <label className="filter-pill">
                  <input
                    type="checkbox"
                    checked={visibleColumns.revGrowth}
                    onChange={() => handleToggleColumn('revGrowth')}
                  />
                  <span>Satış Büyümesi</span>
                </label>
                <label className="filter-pill">
                  <input
                    type="checkbox"
                    checked={visibleColumns.equity}
                    onChange={() => handleToggleColumn('equity')}
                  />
                  <span>Özkaynaklar</span>
                </label>
              </div>
            </div>

            {/* Manual Rules Builder Panel */}
            <div className="scanner-filters manual-rules-panel">
              <div className="filter-top-bar">
                <span className="section-title-sm">Tarama Filtre Kuralları (Tümüyle Manuel)</span>
                <button className="add-rule-btn" onClick={addRule}>
                  + Filtre Kuralı Ekle
                </button>
              </div>

              {rules.length === 0 ? (
                <div className="no-rules-notice">
                  Henüz bir filtre kuralı eklenmedi. Tüm hisseler listeleniyor. Filtre uygulamak için yukarıdan kural ekleyin.
                </div>
              ) : (
                <div className="rules-list-container">
                  {rules.map((rule, idx) => {
                    const rightOptions = getRightFields(rule.leftFieldKey);
                    return (
                      <div key={rule.id} className="manual-rule-row">
                        <span className="rule-number">Kural #{idx + 1}</span>
                        
                        {/* Left Field Selector */}
                        <select
                          className="left-field-select"
                          value={rule.leftFieldKey}
                          onChange={e => handleLeftFieldChange(rule.id, e.target.value)}
                        >
                          {ALL_FIELDS.map(f => (
                            <option key={f.key} value={f.key}>{f.label}</option>
                          ))}
                        </select>

                        {/* Comparison Operator */}
                        <select
                          className="operator-select"
                          value={rule.operator}
                          onChange={e => updateRule(rule.id, { operator: e.target.value })}
                        >
                          <option value=">">&gt;</option>
                          <option value="&lt;">&lt;</option>
                          <option value=">=">&gt;=</option>
                          <option value="&lt;=">&lt;=</option>
                          <option value="==">==</option>
                          <option value="!=">!=</option>
                        </select>

                        {/* Right Operand Type Selector */}
                        <select
                          className="right-type-select"
                          value={rule.rightType}
                          onChange={e => {
                            const type = e.target.value as 'number' | 'field';
                            const val = type === 'field' ? (rightOptions[0]?.key ?? '') : '0';
                            updateRule(rule.id, { rightType: type, rightValue: val });
                          }}
                        >
                          <option value="number">Sayı</option>
                          {rightOptions.length > 0 && <option value="field">Veri</option>}
                        </select>

                        {/* Right Operand Value (text or dropdown) */}
                        {rule.rightType === 'number' ? (
                          <input
                            type="text"
                            className="rule-val-input"
                            value={rule.rightValue}
                            onChange={e => updateRule(rule.id, { rightValue: e.target.value })}
                            placeholder="Değer"
                          />
                        ) : (
                          <select
                            className="rule-val-select"
                            value={rule.rightValue}
                            onChange={e => updateRule(rule.id, { rightValue: e.target.value })}
                          >
                            {rightOptions.map(f => (
                              <option key={f.key} value={f.key}>{f.label}</option>
                            ))}
                          </select>
                        )}

                        {/* Delete Rule Button */}
                        <button
                          className="rule-delete-btn"
                          onClick={() => removeRule(rule.id)}
                          title="Kuralı Sil"
                        >
                          &times; Sil
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {loadingFinancials && (
                <div className="financials-loading-notice">
                  <span className="mini-spinner"></span>
                  Finansal tablolar arka planda yükleniyor...
                </div>
              )}
            </div>

            {/* Custom dynamic table layout */}
            <div className="scanner-table-section">
              <div className="scanner-table-info">
                Gösterilen: <strong>{indicatorFilteredAndSorted.length}</strong> / {results.length} hisse
              </div>
              <div ref={tableWrapRef} className="scanner-table-wrap" onScroll={handleScroll}>
                <table className="scanner-table indicator-table">
                  <thead>
                    <tr>
                      <th onClick={() => handleIndSort('symbol')} className="sortable">
                        Hisse {indSortKey === 'symbol' && (indSortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th onClick={() => handleIndSort('close')} className="sortable text-right">
                        Kapanış {indSortKey === 'close' && (indSortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      <th onClick={() => handleIndSort('changePercent')} className="sortable text-right">
                        Günlük Değ. {indSortKey === 'changePercent' && (indSortDirection === 'asc' ? '▲' : '▼')}
                      </th>
                      
                      {/* Dynamic Technical Headers */}
                      {visibleColumns.wp && (
                        <>
                          <th onClick={() => handleIndSort('wp_value')} className="sortable text-center">
                            %R {indSortKey === 'wp_value' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('wp_ema')} className="sortable text-center">
                            %R EMA {indSortKey === 'wp_ema' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                        </>
                      )}
                      {visibleColumns.nc && (
                        <>
                          <th onClick={() => handleIndSort('nc_value')} className="sortable text-center">
                            NC Delta {indSortKey === 'nc_value' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('nc_macd')} className="sortable text-center">
                            NC MACD {indSortKey === 'nc_macd' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('nc_macdSignal')} className="sortable text-center">
                            NC Signal {indSortKey === 'nc_macdSignal' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('nc_emacd')} className="sortable text-center">
                            NC eMACD {indSortKey === 'nc_emacd' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('nc_condition')} className="sortable text-center">
                            NC Trend {indSortKey === 'nc_condition' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                        </>
                      )}
                      {visibleColumns.er && (
                        <th onClick={() => handleIndSort('er_value')} className="sortable text-center">
                          ER Spread {indSortKey === 'er_value' && (indSortDirection === 'asc' ? '▲' : '▼')}
                        </th>
                      )}
                      {visibleColumns.pc && (
                        <>
                          <th onClick={() => handleIndSort('pc_value')} className="sortable text-center">
                            Pearson R {indSortKey === 'pc_value' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('pc_pos')} className="sortable text-center">
                            Kanal Konum {indSortKey === 'pc_pos' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                        </>
                      )}
                      {visibleColumns.ml && (
                        <th onClick={() => handleIndSort('ml_value')} className="sortable text-center">
                          MATLRNS Yön {indSortKey === 'ml_value' && (indSortDirection === 'asc' ? '▲' : '▼')}
                        </th>
                      )}
                      
                      {/* Dynamic Financial Headers */}
                      {visibleColumns.netProfit && (
                        <th onClick={() => handleIndSort('netProfit_netProfit')} className="sortable text-right">
                          Net Kar {indSortKey === 'netProfit_netProfit' && (indSortDirection === 'asc' ? '▲' : '▼')}
                        </th>
                      )}
                      {visibleColumns.revGrowth && (
                        <th onClick={() => handleIndSort('revGrowth_revenueGrowth')} className="sortable text-right">
                          Satış Gelir Büyümesi {indSortKey === 'revGrowth_revenueGrowth' && (indSortDirection === 'asc' ? '▲' : '▼')}
                        </th>
                      )}
                      {visibleColumns.equity && (
                        <th onClick={() => handleIndSort('equity_equity')} className="sortable text-right">
                          Özkaynaklar {indSortKey === 'equity_equity' && (indSortDirection === 'asc' ? '▲' : '▼')}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {indicatorFilteredAndSorted.map(stock => {
                      const wp = stock.indicators.williamsPasa;
                      const nc = stock.indicators.nizamiCedid;
                      const er = stock.indicators.emaRibbon;
                      const pc = stock.indicators.pearson;
                      const ml = stock.indicators.matlrns;

                      const fin = financialsData[stock.symbol];

                      return (
                        <tr
                          key={stock.symbol}
                          onClick={() => handleRowClick(stock)}
                          className="stock-row-indicator"
                        >
                          <td className="stock-sym">
                            <button
                              className="chart-link-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSymbolClick?.(stock.symbol);
                              }}
                              title="Grafiğini Aç"
                            >
                              📈
                            </button>
                            <span>{stock.symbol}</span>
                          </td>
                          <td className="text-right font-mono">{stock.close.toFixed(2)}</td>
                          <td className={`text-right font-mono font-semibold ${stock.changePercent > 0 ? 'text-bullish' : stock.changePercent < 0 ? 'text-bearish' : 'text-neutral'}`}>
                            {stock.changePercent > 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                          </td>

                          {/* Dynamic Technical Cells */}
                          {visibleColumns.wp && (
                            <>
                              <td className={`text-center font-mono font-semibold ${wp.value > wp.ema ? 'text-bullish' : wp.value < wp.ema ? 'text-bearish' : 'text-neutral'}`}>
                                {wp.value.toFixed(1)}%
                              </td>
                              <td className="text-center font-mono">
                                {wp.ema.toFixed(1)}%
                              </td>
                            </>
                          )}
                          {visibleColumns.nc && (
                            <>
                              <td className={`text-center font-mono font-semibold ${nc.value > 0 ? 'text-bullish' : nc.value < 0 ? 'text-bearish' : 'text-neutral'}`}>
                                {(nc.value * 100).toFixed(2)}%
                              </td>
                              <td className="text-center font-mono">
                                {(nc.macd * 100).toFixed(2)}%
                              </td>
                              <td className="text-center font-mono">
                                {(nc.macdSignal * 100).toFixed(2)}%
                              </td>
                              <td className="text-center font-mono">
                                {(nc.emacd * 100).toFixed(2)}%
                              </td>
                              <td className="text-center">
                                <span className={`badge ${nc.condition ? 'badge-bullish' : 'badge-bearish'}`}>
                                  {nc.condition ? 'EMA 377 > 610' : 'EMA 377 < 610'}
                                </span>
                              </td>
                            </>
                          )}
                          {visibleColumns.er && (
                            <td className={`text-center font-mono font-semibold ${er.value > 0.2 ? 'text-bullish' : er.value < -0.2 ? 'text-bearish' : 'text-neutral'}`}>
                              {er.value.toFixed(3)}
                            </td>
                          )}
                          {visibleColumns.pc && (
                            <>
                              <td className={`text-center font-mono ${pc.value > 0.2 ? 'text-bullish' : pc.value < -0.2 ? 'text-bearish' : 'text-neutral'}`}>
                                {pc.value.toFixed(2)}
                              </td>
                              <td className={`text-center font-mono font-semibold ${pc.pos > 1.2 ? 'text-bullish' : pc.pos < -1.2 ? 'text-bearish' : ''}`}>
                                {pc.pos.toFixed(2)}
                              </td>
                            </>
                          )}
                          {visibleColumns.ml && (
                            <td className={`text-center font-mono font-semibold ${ml.value > 0 ? 'text-bullish' : ml.value < 0 ? 'text-bearish' : 'text-neutral'}`}>
                              {ml.value > 0 ? `+${ml.value}` : ml.value}
                            </td>
                          )}

                          {/* Dynamic Financial Cells */}
                          {visibleColumns.netProfit && (
                            <td className={`text-right font-mono ${fin && fin.netProfit && fin.netProfit > 0 ? 'text-bullish' : fin && fin.netProfit && fin.netProfit < 0 ? 'text-bearish' : ''}`}>
                              {fin ? formatLargeMoney(fin.netProfit) : <span className="cell-loading">-</span>}
                            </td>
                          )}
                          {visibleColumns.revGrowth && (
                            <td className={`text-right font-mono ${fin && fin.revenueGrowth && fin.revenueGrowth > 0 ? 'text-bullish' : fin && fin.revenueGrowth && fin.revenueGrowth < 0 ? 'text-bearish' : ''}`}>
                              {fin && fin.revenueGrowth !== null ? `${fin.revenueGrowth > 0 ? '+' : ''}${fin.revenueGrowth.toFixed(1)}%` : <span className="cell-loading">-</span>}
                            </td>
                          )}
                          {visibleColumns.equity && (
                            <td className="text-right font-mono">
                              {fin ? formatLargeMoney(fin.equity) : <span className="cell-loading">-</span>}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {indicatorFilteredAndSorted.length === 0 && (
                      <tr>
                        <td colSpan={3 + (visibleColumns.wp ? 2 : 0) + (visibleColumns.nc ? 5 : 0) + (visibleColumns.er ? 1 : 0) + (visibleColumns.pc ? 2 : 0) + (visibleColumns.ml ? 1 : 0) + (visibleColumns.netProfit ? 1 : 0) + (visibleColumns.revGrowth ? 1 : 0) + (visibleColumns.equity ? 1 : 0)} className="no-results-cell">
                          Filtrelere uygun hisse senedi bulunamadı.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}


        {/* Loading spinner */}
        {scanning && results.length === 0 && (
          <div className="scan-loading">
            <div className="scan-loading-spinner" />
            <div className="scan-loading-text">
              Piyasa verileri işleniyor ve indikatör puanları derleniyor. Lütfen bekleyin...
            </div>
          </div>
        )}
      </div>

      {/* Slide-in Details Drawer */}
      <div className={`detail-drawer ${drawerOpen ? 'open' : ''}`}>
        {selectedStock && (
          <div className="drawer-inner">
            <div className="drawer-header">
              <div className="drawer-header-left">
                <h3 className="drawer-title">{selectedStock.symbol}</h3>
                <span className="drawer-price font-mono">
                  {selectedStock.close.toFixed(2)}{' '}
                  <span className={`drawer-change ${selectedStock.changePercent > 0 ? 'text-bullish' : selectedStock.changePercent < 0 ? 'text-bearish' : 'text-neutral'}`}>
                    ({selectedStock.changePercent > 0 ? '+' : ''}{selectedStock.changePercent.toFixed(2)}%)
                  </span>
                </span>
              </div>
              <button className="drawer-close-btn" onClick={() => setDrawerOpen(false)} aria-label="Kapat">
                &times;
              </button>
            </div>

            <div className="drawer-body">
              {/* Overall score gauge card */}
              <div className="drawer-score-card">
                <div className="drawer-score-label">Genel Tarama Skoru</div>
                <div className="drawer-score-value-wrap">
                  <span className="drawer-score-num" style={{ color: getScoreColor(selectedStock.overallScore) }}>
                    {selectedStock.overallScore}
                  </span>
                  <span className="drawer-score-max">/100</span>
                </div>
                <div className="drawer-score-meter-wrap">
                  <div className="drawer-score-meter-bg">
                    <div
                      className="drawer-score-meter-fill"
                      style={{
                        width: `${selectedStock.overallScore}%`,
                        backgroundColor: getScoreColor(selectedStock.overallScore),
                      }}
                    />
                  </div>
                </div>
                <div className="drawer-score-verdict">
                  Piyasa İndikatör Eğilimi: <strong>{getSentimentLabel(selectedStock.overallScore)}</strong>
                </div>
              </div>

              {/* 5 Indicators detailed sections */}
              <div className="drawer-section-title">İndikatör Detay Analizleri</div>
              
              <div className="indicator-details-list">
                {/* 1. Williams Pasa */}
                <div className="indicator-detail-item">
                  <div className="indicator-detail-header">
                    <h4 className="ind-name">Williams Paşa (%R)</h4>
                    <span className={`badge ${getSignalBadgeClass(selectedStock.indicators.williamsPasa.signal)}`}>
                      {getSignalLabelTr(selectedStock.indicators.williamsPasa.signal)} ({selectedStock.indicators.williamsPasa.score}/20)
                    </span>
                  </div>
                  <div className="ind-metrics">
                    <span>%R Değeri: <strong className="font-mono">{selectedStock.indicators.williamsPasa.value.toFixed(1)}</strong></span>
                    <span>%R EMA: <strong className="font-mono">{selectedStock.indicators.williamsPasa.ema.toFixed(1)}</strong></span>
                  </div>
                  <p className="ind-desc">{getWilliamsPasaExplanation(selectedStock)}</p>
                </div>

                {/* 2. Nizami Cedid */}
                <div className="indicator-detail-item">
                  <div className="indicator-detail-header">
                    <h4 className="ind-name">Nizami Cedid (MACD eMACD)</h4>
                    <span className={`badge ${getSignalBadgeClass(selectedStock.indicators.nizamiCedid.signal)}`}>
                      {getSignalLabelTr(selectedStock.indicators.nizamiCedid.signal)} ({selectedStock.indicators.nizamiCedid.score}/20)
                    </span>
                  </div>
                  <div className="ind-metrics">
                    <span>Delta Değeri: <strong className="font-mono">{selectedStock.indicators.nizamiCedid.value.toFixed(4)}</strong></span>
                    <span>Uzun Vade Boğa Koşulu: <strong>{selectedStock.indicators.nizamiCedid.condition ? 'Evet (Pozitif)' : 'Hayır (Negatif)'}</strong></span>
                  </div>
                  <p className="ind-desc">{getNizamiCedidExplanation(selectedStock)}</p>
                </div>

                {/* 3. EMA Ribbon */}
                <div className="indicator-detail-item">
                  <div className="indicator-detail-header">
                    <h4 className="ind-name">EMA Ribbon (Şerit Sıralaması)</h4>
                    <span className={`badge ${getSignalBadgeClass(selectedStock.indicators.emaRibbon.signal)}`}>
                      {getSignalLabelTr(selectedStock.indicators.emaRibbon.signal)} ({selectedStock.indicators.emaRibbon.score}/20)
                    </span>
                  </div>
                  <div className="ind-metrics">
                    <span>Ortalama Şerit Yayılımı: <strong className="font-mono">{selectedStock.indicators.emaRibbon.value.toFixed(3)}</strong></span>
                  </div>
                  <p className="ind-desc">{getEmaRibbonExplanation(selectedStock)}</p>
                </div>

                {/* 4. Pearson Regression Channels */}
                <div className="indicator-detail-item">
                  <div className="indicator-detail-header">
                    <h4 className="ind-name">Pearson Regresyon Kanalları (3ChanPers)</h4>
                    <span className={`badge ${getSignalBadgeClass(selectedStock.indicators.pearson.signal)}`}>
                      {getSignalLabelTr(selectedStock.indicators.pearson.signal)} ({selectedStock.indicators.pearson.score}/20)
                    </span>
                  </div>
                  <div className="ind-metrics">
                    <span>Ortalama Korelasyon R: <strong className="font-mono">{selectedStock.indicators.pearson.value.toFixed(2)}</strong></span>
                    <span>Ortalama Fiyat Pozisyonu: <strong className="font-mono">{selectedStock.indicators.pearson.pos.toFixed(2)}</strong></span>
                  </div>
                  <p className="ind-desc">{getPearsonExplanation(selectedStock)}</p>
                </div>

                {/* 5. MATLRNS */}
                <div className="indicator-detail-item">
                  <div className="indicator-detail-header">
                    <h4 className="ind-name">MATLRNS (Trend Takip Sistemi)</h4>
                    <span className={`badge ${getSignalBadgeClass(selectedStock.indicators.matlrns.signal)}`}>
                      {getSignalLabelTr(selectedStock.indicators.matlrns.signal)} ({selectedStock.indicators.matlrns.score}/20)
                    </span>
                  </div>
                  <div className="ind-metrics">
                    <span>Hızlı-Yavaş Yön Sinyali: <strong className="font-mono">{selectedStock.indicators.matlrns.value > 0 ? `+${selectedStock.indicators.matlrns.value}` : selectedStock.indicators.matlrns.value}</strong></span>
                  </div>
                  <p className="ind-desc">{getMatlrnsExplanation(selectedStock)}</p>
                </div>
              </div>

              {/* Direct chart action button */}
              <button
                className="drawer-chart-btn"
                onClick={() => {
                  onSymbolClick?.(selectedStock.symbol);
                  setDrawerOpen(false);
                }}
              >
                Grafiğini Detaylı İncele 📈
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
