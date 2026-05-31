import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { runClientScan, clearScanCache, getCachedScanResults, type ScannedStock } from './scanEngine';
import { computeKPIs } from '../../utils/computeFinancialMetrics';
import { fetchHistory, fetchSymbols, type OHLCVData } from '../../api/borsaApi';
import { getCacheItem } from '../../utils/indexedDbCache';
import IndicatorRadarChart from './IndicatorRadarChart';
import MiniSparklineChart from './MiniSparklineChart';
import ScanHeatmap, { type HeatmapItem } from './ScanHeatmap';
import { getStockSector, SECTORS } from '../../utils/sectorMap';
import { useToast } from '../../components/Toast/Toast';
import './MarketAnalysis.css';

interface Props {
  onSymbolClick?: (symbol: string) => void;
  watchlists?: Array<{ id: string; name: string; symbols: string[] }>;
  onAddSymbolToList?: (listId: string, symbol: string) => void;
  onAddList?: (name: string, initialSymbols?: string[]) => void;
}

type SortKey = 'symbol' | 'close' | 'changePercent' | 'overallScore' | 'williamsPasa' | 'nizamiCedid' | 'emaRibbon' | 'pearson';

export interface StockFinancialData {
  netProfit: number | null;
  revenueGrowth: number | null;
  equity: number | null;
  equityGrowth: number | null;
  latestPeriod: string;
  fk: number | null;
  pddd: number | null;
  netKarMarji: number | null;
  brutKarMarji: number | null;
  roe: number | null;
  borcOzkaynak: number | null;
  piyasaDegeri: number | null;
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
  { key: 'er_value', module: 'er', field: 'value', label: 'EMA Ribbon: Yayılım', type: 'number' },
  { key: 'pc_value', module: 'pc', field: 'value', label: 'Pearson: Ortalama Korelasyon R', type: 'number' },
  { key: 'pc_pos', module: 'pc', field: 'pos', label: 'Pearson: Ortalama Kanal Konumu', type: 'number' },
  { key: 'pc_extra_short_r', module: 'pc', field: 'extra_short_r', label: 'Pearson: En Kısa Vade Korelasyon R', type: 'number' },
  { key: 'pc_extra_short_pos', module: 'pc', field: 'extra_short_pos', label: 'Pearson: En Kısa Vade Kanal Konumu', type: 'number' },
  { key: 'pc_short_r', module: 'pc', field: 'short_r', label: 'Pearson: Kısa Vade Korelasyon R', type: 'number' },
  { key: 'pc_short_pos', module: 'pc', field: 'short_pos', label: 'Pearson: Kısa Vade Kanal Konumu', type: 'number' },
  { key: 'pc_long_r', module: 'pc', field: 'long_r', label: 'Pearson: Uzun Vade Korelasyon R', type: 'number' },
  { key: 'pc_long_pos', module: 'pc', field: 'long_pos', label: 'Pearson: Uzun Vade Kanal Konumu', type: 'number' },
  { key: 'pc_extra_long_r', module: 'pc', field: 'extra_long_r', label: 'Pearson: En Uzun Vade Korelasyon R', type: 'number' },
  { key: 'pc_extra_long_pos', module: 'pc', field: 'extra_long_pos', label: 'Pearson: En Uzun Vade Kanal Konumu', type: 'number' },
  { key: 'pc_extra_short_slope_pct', module: 'pc', field: 'extra_short_slope_pct', label: 'Pearson: En Kısa Vade Günlük Eğilim', type: 'number' },
  { key: 'pc_short_slope_pct', module: 'pc', field: 'short_slope_pct', label: 'Pearson: Kısa Vade Günlük Eğilim', type: 'number' },
  { key: 'pc_long_slope_pct', module: 'pc', field: 'long_slope_pct', label: 'Pearson: Uzun Vade Günlük Eğilim', type: 'number' },
  { key: 'pc_extra_long_slope_pct', module: 'pc', field: 'extra_long_slope_pct', label: 'Pearson: En Uzun Vade Günlük Eğilim', type: 'number' },
  // Extra technical metrics
  { key: 'extra_changePercent', module: 'extra', field: 'changePercent', label: 'Teknik: Günlük Değişim (%)', type: 'number' },
  { key: 'extra_sma50', module: 'extra', field: 'sma50', label: 'Teknik: SMA 50', type: 'number' },
  { key: 'extra_sma200', module: 'extra', field: 'sma200', label: 'Teknik: SMA 200', type: 'number' },
  { key: 'extra_ema21', module: 'extra', field: 'ema21', label: 'Teknik: EMA 21', type: 'number' },
  { key: 'extra_ema100', module: 'extra', field: 'ema100', label: 'Teknik: EMA 100', type: 'number' },
  { key: 'extra_volumeRatio', module: 'extra', field: 'volumeRatio', label: 'Teknik: Hacim Oranı', type: 'number' },
  // Financial Metrics
  { key: 'netProfit_netProfit', module: 'netProfit', field: 'netProfit', label: 'Finansal: Net Dönem Karı', type: 'number' },
  { key: 'revGrowth_revenueGrowth', module: 'revGrowth', field: 'revenueGrowth', label: 'Finansal: Satış Gelir Büyümesi (%)', type: 'number' },
  { key: 'equity_equity', module: 'equity', field: 'equity', label: 'Finansal: Özkaynaklar', type: 'number' },
  { key: 'equity_equityGrowth', module: 'equity', field: 'equityGrowth', label: 'Finansal: Özkaynak Büyümesi (%)', type: 'number' },
  // Financial KPIs
  { key: 'kpis_fk', module: 'kpis', field: 'fk', label: 'Rasyolar: F/K (Fiyat/Kazanç)', type: 'number' },
  { key: 'kpis_pddd', module: 'kpis', field: 'pddd', label: 'Rasyolar: PD/DD', type: 'number' },
  { key: 'kpis_roe', module: 'kpis', field: 'roe', label: 'Rasyolar: Özkaynak Karlılığı (ROE %)', type: 'number' },
  { key: 'kpis_netKarMarji', module: 'kpis', field: 'netKarMarji', label: 'Rasyolar: Net Kar Marjı (%)', type: 'number' },
  { key: 'kpis_brutKarMarji', module: 'kpis', field: 'brutKarMarji', label: 'Rasyolar: Brüt Kar Marjı (%)', type: 'number' },
  { key: 'kpis_borcOzkaynak', module: 'kpis', field: 'borcOzkaynak', label: 'Rasyolar: Borç / Özkaynak Oranı', type: 'number' },
  { key: 'kpis_piyasaDegeri', module: 'kpis', field: 'piyasaDegeri', label: 'Rasyolar: Piyasa Değeri', type: 'number' },
  { key: 'kpis_fundamentalScore', module: 'kpis', field: 'fundamentalScore', label: 'Rasyolar: Temel Analiz Puanı (0-10)', type: 'number' },
  { key: 'kpis_piotroskiScore', module: 'kpis', field: 'piotroskiScore', label: 'Rasyolar: Piotroski F-Skor (0-9)', type: 'number' },
  { key: 'kpis_combinedScore', module: 'kpis', field: 'combinedScore', label: 'Rasyolar: Birleşik Puan (0-100)', type: 'number' },
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
  if (['wp', 'nc', 'er', 'pc'].includes(modId)) {
    const indicatorData = stock.indicators[modId === 'wp' ? 'williamsPasa' : modId === 'nc' ? 'nizamiCedid' : modId === 'er' ? 'emaRibbon' : 'pearson'];
    if (!indicatorData) return true;
    leftVal = (indicatorData as any)[leftDef.field];
  } else if (modId === 'extra') {
    leftVal = leftDef.field === 'changePercent' ? stock.changePercent : (stock.indicators.extra as any)[leftDef.field];
  } else {
    if (leftDef.field === 'fundamentalScore') {
      leftVal = stock.fundamentalScore;
    } else if (leftDef.field === 'piotroskiScore') {
      leftVal = stock.piotroskiScore;
    } else if (leftDef.field === 'combinedScore') {
      leftVal = stock.combinedScore;
    } else {
      if (!finData) return false; // If financials are not loaded yet, exclude it from matching if rule is active
      leftVal = finData[leftDef.field];
    }
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
    if (['wp', 'nc', 'er', 'pc'].includes(rightModId)) {
      const indicatorData = stock.indicators[rightModId === 'wp' ? 'williamsPasa' : rightModId === 'nc' ? 'nizamiCedid' : rightModId === 'er' ? 'emaRibbon' : 'pearson'];
      rightVal = indicatorData ? (indicatorData as any)[rightDef.field] : null;
    } else if (rightModId === 'extra') {
      rightVal = rightDef.field === 'changePercent' ? stock.changePercent : (stock.indicators.extra as any)[rightDef.field];
    } else {
      if (rightDef.field === 'fundamentalScore') {
        rightVal = stock.fundamentalScore;
      } else if (rightDef.field === 'piotroskiScore') {
        rightVal = stock.piotroskiScore;
      } else if (rightDef.field === 'combinedScore') {
        rightVal = stock.combinedScore;
      } else {
        rightVal = finData ? finData[rightDef.field] : null;
      }
    }
  }

  if (rightVal === null || rightVal === undefined) return false;

  // Scale Nizami Cedid values for display percentage parity (so typing 1 means 1%)
  let scaledLeft = leftVal;
  const scaledRight = rightVal;
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

export interface PresetConfig {
  name: string;
  rules: RuleConfig[];
  columns: Record<string, boolean>;
}

export const PRESETS: Record<string, PresetConfig> = {
  goldenCross: {
    name: 'Golden Cross (50/200)',
    rules: [
      { id: 'gc_1', leftFieldKey: 'extra_sma50', operator: '>', rightType: 'field', rightValue: 'extra_sma200' },
      { id: 'gc_2', leftFieldKey: 'extra_volumeRatio', operator: '>', rightType: 'number', rightValue: '1.5' }
    ],
    columns: { wp: false, nc: false, er: false, pc: false, extra: true, netProfit: false, revGrowth: false, equity: false, kpis: false }
  },
  oversold: {
    name: 'Aşırı Satım Tepki',
    rules: [
      { id: 'os_1', leftFieldKey: 'wp_value', operator: '<', rightType: 'number', rightValue: '20' },
      { id: 'os_2', leftFieldKey: 'pc_pos', operator: '>', rightType: 'number', rightValue: '-1.8' },
      { id: 'os_3', leftFieldKey: 'pc_pos', operator: '<', rightType: 'number', rightValue: '-0.5' }
    ],
    columns: { wp: true, nc: false, er: false, pc: true, extra: false, netProfit: false, revGrowth: false, equity: false, kpis: false }
  },
  momentum: {
    name: 'Hacimli Momentum Kırılımı',
    rules: [
      { id: 'mo_1', leftFieldKey: 'extra_changePercent', operator: '>', rightType: 'number', rightValue: '0' },
      { id: 'mo_2', leftFieldKey: 'wp_value', operator: '>', rightType: 'field', rightValue: 'wp_ema' },
      { id: 'mo_3', leftFieldKey: 'extra_volumeRatio', operator: '>', rightType: 'number', rightValue: '2.0' }
    ],
    columns: { wp: true, nc: false, er: false, pc: false, extra: true, netProfit: false, revGrowth: false, equity: false, kpis: false }
  },
  valueGrowth: {
    name: 'Değer & Büyüme (Temel)',
    rules: [
      { id: 'vg_1', leftFieldKey: 'kpis_fk', operator: '<', rightType: 'number', rightValue: '15' },
      { id: 'vg_2', leftFieldKey: 'kpis_fk', operator: '>', rightType: 'number', rightValue: '0' },
      { id: 'vg_3', leftFieldKey: 'kpis_pddd', operator: '<', rightType: 'number', rightValue: '2.5' },
      { id: 'vg_4', leftFieldKey: 'kpis_pddd', operator: '>', rightType: 'number', rightValue: '0' },
      { id: 'vg_5', leftFieldKey: 'revGrowth_revenueGrowth', operator: '>', rightType: 'number', rightValue: '20' },
      { id: 'vg_6', leftFieldKey: 'kpis_roe', operator: '>', rightType: 'number', rightValue: '20' }
    ],
    columns: { wp: false, nc: false, er: false, pc: false, extra: false, netProfit: false, revGrowth: true, equity: false, kpis: true }
  }
};

// Global module-level memory cache for financials to prevent refetching and temporary blank fields on navigation
let cachedFinancials: Record<string, StockFinancialData | null> = {};
try {
  const savedFin = localStorage.getItem('temist_scanner_financials');
  if (savedFin) {
    const parsed = JSON.parse(savedFin);
    const keys = Object.keys(parsed);
    if (keys.length > 0) {
      const firstVal = parsed[keys[0]];
      if (firstVal && 'fk' in firstVal) {
        cachedFinancials = parsed;
      } else {
        localStorage.removeItem('temist_scanner_financials');
      }
    } else {
      cachedFinancials = parsed;
    }
  }
} catch (e) {
  console.error('Failed to parse cached financials:', e);
}

export default function MarketAnalysis({
  onSymbolClick,
  watchlists = [],
  onAddSymbolToList,
  onAddList,
}: Props) {
  const { toast } = useToast();

  // Selection states
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; visible: boolean; stockSymbol: string } | null>(null);

  // Close context menu on any window click or scroll
  useEffect(() => {
    const handleCloseMenu = () => {
      if (contextMenu) setContextMenu(null);
    };
    window.addEventListener('click', handleCloseMenu);
    window.addEventListener('scroll', handleCloseMenu, { passive: true });
    return () => {
      window.removeEventListener('click', handleCloseMenu);
      window.removeEventListener('scroll', handleCloseMenu);
    };
  }, [contextMenu]);

  // Tabs
  const [activeTab, setActiveTab] = useState<'smart' | 'indicator'>(() => {
    const saved = localStorage.getItem('temist_scanner_active_tab');
    return (saved === 'smart' || saved === 'indicator') ? saved : 'indicator';
  });

  // Clear selections when tab changes
  useEffect(() => {
    setSelectedSymbols(new Set());
  }, [activeTab]);

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
      extra: false,
      netProfit: false,
      revGrowth: false,
      equity: false,
      kpis: false,
    };
  });

  // Rule Matching Mode: VE (AND) or VEYA (OR)
  const [ruleMatchingMode, setRuleMatchingMode] = useState<'and' | 'or'>(() => {
    const saved = localStorage.getItem('temist_scanner_rule_matching_mode');
    return (saved === 'and' || saved === 'or') ? saved : 'and';
  });

  interface FilterTemplate {
    id: string;
    name: string;
    rules: RuleConfig[];
    visibleColumns: Record<string, boolean>;
    ruleMatchingMode: 'and' | 'or';
  }

  // Saved templates state
  const [savedTemplates, setSavedTemplates] = useState<FilterTemplate[]>(() => {
    const saved = localStorage.getItem('temist_scanner_templates');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // fallback
      }
    }
    return [];
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

  useEffect(() => {
    localStorage.setItem('temist_scanner_rule_matching_mode', ruleMatchingMode);
  }, [ruleMatchingMode]);

  useEffect(() => {
    localStorage.setItem('temist_scanner_templates', JSON.stringify(savedTemplates));
  }, [savedTemplates]);

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

  // Sector and Symbol Info States
  const [selectedSector, setSelectedSector] = useState<string>(() => {
    return localStorage.getItem('temist_scanner_selected_sector') || 'Tümü';
  });

  useEffect(() => {
    localStorage.setItem('temist_scanner_selected_sector', selectedSector);
  }, [selectedSector]);

  const [symbolInfoMap, setSymbolInfoMap] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchSymbols().then(res => {
      const map: Record<string, string> = {};
      for (const s of res.stocks) {
        map[s.name] = s.displayName;
      }
      for (const idx of res.indices) {
        map[idx.name] = idx.displayName;
      }
      setSymbolInfoMap(map);
    }).catch(err => {
      console.error('Failed to fetch symbols for sector mapping:', err);
    });
  }, []);

  const getSymbolDisplayName = useCallback((symbol: string): string => {
    return symbolInfoMap[symbol] || '';
  }, [symbolInfoMap]);

  // Akıllı Tarama Filters & Search
  const [filterBullishWP, setFilterBullishWP] = useState(() => localStorage.getItem('temist_scanner_f_wp') === 'true');
  const [filterBullishNC, setFilterBullishNC] = useState(() => localStorage.getItem('temist_scanner_f_nc') === 'true');
  const [filterBullishER, setFilterBullishER] = useState(() => localStorage.getItem('temist_scanner_f_er') === 'true');
  const [filterBullishPC, setFilterBullishPC] = useState(() => localStorage.getItem('temist_scanner_f_pc') === 'true');
  const [filterHighScore, setFilterHighScore] = useState(() => localStorage.getItem('temist_scanner_f_high') === 'true');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'heatmap'>(() => (localStorage.getItem('temist_scanner_view_mode') as 'table' | 'heatmap') || 'table');
  const [heatmapColorBy, setHeatmapColorBy] = useState<'change' | 'score'>('change');
  const [selectedStockHistory, setSelectedStockHistory] = useState<OHLCVData[] | null>(null);

  useEffect(() => {
    localStorage.setItem('temist_scanner_view_mode', viewMode);
  }, [viewMode]);

  useEffect(() => { localStorage.setItem('temist_scanner_f_wp', String(filterBullishWP)); }, [filterBullishWP]);
  useEffect(() => { localStorage.setItem('temist_scanner_f_nc', String(filterBullishNC)); }, [filterBullishNC]);
  useEffect(() => { localStorage.setItem('temist_scanner_f_er', String(filterBullishER)); }, [filterBullishER]);
  useEffect(() => { localStorage.setItem('temist_scanner_f_pc', String(filterBullishPC)); }, [filterBullishPC]);
  useEffect(() => { localStorage.setItem('temist_scanner_f_high', String(filterHighScore)); }, [filterHighScore]);

  // Financial data loading state
  const [financialsData, setFinancialsData] = useState<Record<string, StockFinancialData | null>>(() => cachedFinancials);
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

  useEffect(() => {
    if (!selectedStock) {
      setSelectedStockHistory(null);
      return;
    }
    let active = true;
    const loadHistory = async () => {
      const cached = await getCacheItem<OHLCVData[]>('history', selectedStock.symbol);
      if (cached && active) {
        setSelectedStockHistory(cached);
        return;
      }
      try {
        const history = await fetchHistory(selectedStock.symbol);
        if (history && active) {
          setSelectedStockHistory(history);
        }
      } catch (e) {
        console.error('Failed to load history for sparkline:', e);
      }
    };
    loadHistory();
    return () => {
      active = false;
    };
  }, [selectedStock]);

  // Fetch financials for selectedStock when drawer is opened
  useEffect(() => {
    if (!selectedStock) return;
    if (financialsData[selectedStock.symbol] !== undefined) return;
    
    let active = true;
    const loadSelectedFin = async () => {
      const metrics = await fetchStockFinancialData(selectedStock.symbol, selectedStock.close);
      if (active) {
        setFinancialsData(prev => {
          const next = { ...prev, [selectedStock.symbol]: metrics };
          cachedFinancials = next;
          try {
            localStorage.setItem('temist_scanner_financials', JSON.stringify(next));
          } catch (e) {
            console.error('Failed to save financials to localStorage:', e);
          }
          return next;
        });
      }
    };
    loadSelectedFin();
    return () => {
      active = false;
    };
  }, [selectedStock, financialsData]);

  // Sorting for Smart Scanner
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const saved = localStorage.getItem('temist_scanner_sort_key');
    return saved && ['symbol', 'close', 'changePercent', 'overallScore', 'williamsPasa', 'nizamiCedid', 'emaRibbon', 'pearson'].includes(saved) ? (saved as SortKey) : 'overallScore';
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

  const handleApplyPreset = (p: PresetConfig) => {
    setRules(p.rules);
    setVisibleColumns(p.columns);
    setRuleMatchingMode('and');
  };


  // Toggle visible columns
  const handleToggleColumn = (mod: string) => {
    setVisibleColumns(prev => ({
      ...prev,
      [mod]: !prev[mod]
    }));
  };

  const handleSaveTemplate = () => {
    const name = prompt('Lütfen şablon için bir isim girin:');
    if (!name || name.trim() === '') return;

    const newTemplate: FilterTemplate = {
      id: Math.random().toString(36).substr(2, 9),
      name: name.trim(),
      rules,
      visibleColumns,
      ruleMatchingMode
    };

    setSavedTemplates(prev => [...prev, newTemplate]);
  };

  const handleLoadTemplate = (tmpl: FilterTemplate) => {
    setRules(tmpl.rules);
    setVisibleColumns(tmpl.visibleColumns);
    setRuleMatchingMode(tmpl.ruleMatchingMode);
  };

  const handleDeleteTemplate = (id: string) => {
    if (confirm('Bu şablonu silmek istediğinize emin misiniz?')) {
      setSavedTemplates(prev => prev.filter(t => t.id !== id));
    }
  };

  const handleExportTemplates = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(savedTemplates, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "temist_scanner_templates.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportTemplates = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    if (e.target.files && e.target.files[0]) {
      fileReader.readAsText(e.target.files[0], "UTF-8");
      fileReader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target?.result as string);
          if (Array.isArray(parsed)) {
            const valid = parsed.every(t => t.name && Array.isArray(t.rules) && t.visibleColumns);
            if (valid) {
              setSavedTemplates(prev => {
                const merged = [...prev];
                for (const item of parsed) {
                  if (!merged.some(m => m.name === item.name)) {
                    merged.push(item);
                  }
                }
                return merged;
              });
              alert('Şablonlar başarıyla içe aktarıldı!');
            } else {
              alert('Geçersiz şablon dosyası formatı!');
            }
          } else {
            alert('Dosya formatı şablon listesi olmalıdır (Array).');
          }
        } catch {
          alert('Dosya okunurken bir hata oluştu.');
        }
      };
    }
  };

  const handleExportCSV = () => {
    const headers = ['Hisse', 'Kapanış', 'Günlük Değişim (%)'];
    const colKeys: { label: string; getValue: (stock: ScannedStock) => string }[] = [];

    if (visibleColumns.wp) {
      headers.push('Williams %R', '%R EMA');
      colKeys.push(
        { label: 'Williams %R', getValue: s => s.indicators.williamsPasa.value.toFixed(1) + '%' },
        { label: '%R EMA', getValue: s => s.indicators.williamsPasa.ema.toFixed(1) + '%' }
      );
    }
    if (visibleColumns.nc) {
      headers.push('NC Delta', 'NC MACD', 'NC Signal', 'NC eMACD');
      colKeys.push(
        { label: 'NC Delta', getValue: s => (s.indicators.nizamiCedid.value * 100).toFixed(2) + '%' },
        { label: 'NC MACD', getValue: s => (s.indicators.nizamiCedid.macd * 100).toFixed(2) + '%' },
        { label: 'NC Signal', getValue: s => (s.indicators.nizamiCedid.macdSignal * 100).toFixed(2) + '%' },
        { label: 'NC eMACD', getValue: s => (s.indicators.nizamiCedid.emacd * 100).toFixed(2) + '%' }
      );
    }
    if (visibleColumns.er) {
      headers.push('ER Spread');
      colKeys.push({ label: 'ER Spread', getValue: s => s.indicators.emaRibbon.value.toFixed(3) });
    }
    if (visibleColumns.pc) {
      headers.push(
        'Pearson R (Ort.)', 'Kanal Konum (Ort.)',
        'Pearson En Kısa R', 'Pearson En Kısa Konum', 'Pearson En Kısa Eğilim',
        'Pearson Kısa R', 'Pearson Kısa Konum', 'Pearson Kısa Eğilim',
        'Pearson Uzun R', 'Pearson Uzun Konum', 'Pearson Uzun Eğilim',
        'Pearson En Uzun R', 'Pearson En Uzun Konum', 'Pearson En Uzun Eğilim'
      );
      colKeys.push(
        { label: 'Pearson R (Ort.)', getValue: s => s.indicators.pearson.value.toFixed(2) },
        { label: 'Kanal Konum (Ort.)', getValue: s => s.indicators.pearson.pos.toFixed(2) },
        { label: 'Pearson En Kısa R', getValue: s => s.indicators.pearson.extra_short_r.toFixed(2) },
        { label: 'Pearson En Kısa Konum', getValue: s => s.indicators.pearson.extra_short_pos.toFixed(2) },
        { label: 'Pearson En Kısa Eğilim', getValue: s => (s.indicators.pearson.extra_short_slope_pct >= 0 ? '+' : '') + s.indicators.pearson.extra_short_slope_pct.toFixed(4) + '%' },
        { label: 'Pearson Kısa R', getValue: s => s.indicators.pearson.short_r.toFixed(2) },
        { label: 'Pearson Kısa Konum', getValue: s => s.indicators.pearson.short_pos.toFixed(2) },
        { label: 'Pearson Kısa Eğilim', getValue: s => (s.indicators.pearson.short_slope_pct >= 0 ? '+' : '') + s.indicators.pearson.short_slope_pct.toFixed(4) + '%' },
        { label: 'Pearson Uzun R', getValue: s => s.indicators.pearson.long_r.toFixed(2) },
        { label: 'Pearson Uzun Konum', getValue: s => s.indicators.pearson.long_pos.toFixed(2) },
        { label: 'Pearson Uzun Eğilim', getValue: s => (s.indicators.pearson.long_slope_pct >= 0 ? '+' : '') + s.indicators.pearson.long_slope_pct.toFixed(4) + '%' },
        { label: 'Pearson En Uzun R', getValue: s => s.indicators.pearson.extra_long_r.toFixed(2) },
        { label: 'Pearson En Uzun Konum', getValue: s => s.indicators.pearson.extra_long_pos.toFixed(2) },
        { label: 'Pearson En Uzun Eğilim', getValue: s => (s.indicators.pearson.extra_long_slope_pct >= 0 ? '+' : '') + s.indicators.pearson.extra_long_slope_pct.toFixed(4) + '%' }
      );
    }

    if (visibleColumns.extra) {
      headers.push('SMA 50', 'SMA 200', 'EMA 21', 'EMA 100', 'Hacim Oranı');
      colKeys.push(
        { label: 'SMA 50', getValue: s => s.indicators.extra.sma50?.toFixed(2) ?? '-' },
        { label: 'SMA 200', getValue: s => s.indicators.extra.sma200?.toFixed(2) ?? '-' },
        { label: 'EMA 21', getValue: s => s.indicators.extra.ema21?.toFixed(2) ?? '-' },
        { label: 'EMA 100', getValue: s => s.indicators.extra.ema100?.toFixed(2) ?? '-' },
        { label: 'Hacim Oranı', getValue: s => s.indicators.extra.volumeRatio?.toFixed(2) ?? '-' }
      );
    }
    if (visibleColumns.netProfit) {
      headers.push('Net Kar');
      colKeys.push({ label: 'Net Kar', getValue: s => {
        const fin = financialsData[s.symbol];
        return fin && fin.netProfit !== null ? String(fin.netProfit) : '-';
      }});
    }
    if (visibleColumns.revGrowth) {
      headers.push('Satış Büyümesi');
      colKeys.push({ label: 'Satış Büyümesi', getValue: s => {
        const fin = financialsData[s.symbol];
        return fin && fin.revenueGrowth !== null ? fin.revenueGrowth.toFixed(1) + '%' : '-';
      }});
    }
    if (visibleColumns.equity) {
      headers.push('Özkaynaklar');
      colKeys.push({ label: 'Özkaynaklar', getValue: s => {
        const fin = financialsData[s.symbol];
        return fin && fin.equity !== null ? String(fin.equity) : '-';
      }});
    }
    if (visibleColumns.kpis) {
      headers.push('F/K', 'PD/DD', 'ROE (%)', 'Net Kar Marjı (%)', 'Brüt Kar Marjı (%)', 'Borç/Özkaynak', 'Piyasa Değeri');
      colKeys.push(
        { label: 'F/K', getValue: s => {
          const fin = financialsData[s.symbol];
          return fin && fin.fk !== null ? fin.fk.toFixed(2) : '-';
        }},
        { label: 'PD/DD', getValue: s => {
          const fin = financialsData[s.symbol];
          return fin && fin.pddd !== null ? fin.pddd.toFixed(2) : '-';
        }},
        { label: 'ROE (%)', getValue: s => {
          const fin = financialsData[s.symbol];
          return fin && fin.roe !== null ? fin.roe.toFixed(2) + '%' : '-';
        }},
        { label: 'Net Kar Marjı (%)', getValue: s => {
          const fin = financialsData[s.symbol];
          return fin && fin.netKarMarji !== null ? fin.netKarMarji.toFixed(2) + '%' : '-';
        }},
        { label: 'Brüt Kar Marjı (%)', getValue: s => {
          const fin = financialsData[s.symbol];
          return fin && fin.brutKarMarji !== null ? fin.brutKarMarji.toFixed(2) + '%' : '-';
        }},
        { label: 'Borç/Özkaynak', getValue: s => {
          const fin = financialsData[s.symbol];
          return fin && fin.borcOzkaynak !== null ? fin.borcOzkaynak.toFixed(2) : '-';
        }},
        { label: 'Piyasa Değeri', getValue: s => {
          const fin = financialsData[s.symbol];
          return fin && fin.piyasaDegeri !== null ? String(fin.piyasaDegeri) : '-';
        }}
      );
    }

    const csvRows = [headers.join(';')];
    for (const stock of indicatorFilteredAndSorted) {
      const rowData = [
        stock.symbol,
        stock.close.toFixed(2),
        stock.changePercent.toFixed(2) + '%'
      ];
      for (const col of colKeys) {
        rowData.push(col.getValue(stock));
      }
      csvRows.push(rowData.join(';'));
    }

    const BOM = "\uFEFF";
    const csvContent = BOM + csvRows.join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `temist_tarama_sonuclari_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

      default:
        return stock[key];
    }
  };

  // Apply filters and sorting to Smart Scanner
  const filteredAndSorted = useMemo(() => {
    let list = [...results];

    // Sector filter
    if (selectedSector !== 'Tümü') {
      list = list.filter(item => getStockSector(item.symbol, getSymbolDisplayName(item.symbol)) === selectedSector);
    }

    // Search query filter
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(item => item.symbol.toLowerCase().includes(q));
    }

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
  }, [results, filterBullishWP, filterBullishNC, filterBullishER, filterBullishPC, filterHighScore, sortKey, sortDirection, searchQuery, selectedSector, getSymbolDisplayName]);

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
    setSelectedSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(stock.symbol)) {
        next.delete(stock.symbol);
      } else {
        next.add(stock.symbol);
      }
      return next;
    });
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

  // ── Financial Data Batch Loader ─────────────────

  const fetchStockFinancialData = async (symbol: string, close: number): Promise<StockFinancialData | null> => {
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

      // Compute KPIs
      const dummyOhlcv = [{ close }] as any[];
      const kpis = computeKPIs(json, dummyOhlcv);

      return {
        netProfit,
        revenueGrowth,
        equity: lastEquity,
        equityGrowth,
        latestPeriod: lastPeriod,
        fk: kpis.fk,
        pddd: kpis.pddd,
        netKarMarji: kpis.netKarMarji,
        brutKarMarji: kpis.brutKarMarji,
        roe: kpis.roe,
        borcOzkaynak: kpis.borcOzkaynak,
        piyasaDegeri: kpis.piyasaDegeri,
      };
    } catch (e) {
      console.error(`Error loading financials for ${symbol}:`, e);
      return null;
    }
  };

  // Filter computed results technically based on OUR active indicator rules (used for optimizing financial downloads in AND mode)
  const technicallyFiltered = useMemo(() => {
    let list = [...results];

    // Sector filter
    if (selectedSector !== 'Tümü') {
      list = list.filter(item => getStockSector(item.symbol, getSymbolDisplayName(item.symbol)) === selectedSector);
    }

    // Evaluate active technical rules
    const techRules = rules.filter(r => {
      const fieldDef = ALL_FIELDS.find(f => f.key === r.leftFieldKey);
      return fieldDef && ['wp', 'nc', 'er', 'pc', 'extra'].includes(fieldDef.module);
    });

    for (const rule of techRules) {
      list = list.filter(item => evaluateRule(item, rule));
    }

    return list;
  }, [results, rules, selectedSector, getSymbolDisplayName]);

  // Background financials loader triggered by technical filters / matching rules
  useEffect(() => {
    if (activeTab !== 'indicator') return;

    // Check if at least one active rule references financial modules, OR if financial columns are manually enabled
    const hasFinActive = rules.some(r => {
      const fieldDef = ALL_FIELDS.find(f => f.key === r.leftFieldKey);
      return fieldDef && ['netProfit', 'revGrowth', 'equity', 'kpis'].includes(fieldDef.module);
    }) || visibleColumns.netProfit || visibleColumns.revGrowth || visibleColumns.equity || visibleColumns.kpis;

    if (!hasFinActive) return;

    // In OR mode, any stock might match a financial rule, so we fetch financials for all results.
    // In AND mode, only stocks passing technical filters can match, so we fetch only for those.
    const targetList = ruleMatchingMode === 'or' ? results : technicallyFiltered;

    const needed = targetList
      .map(item => ({ symbol: item.symbol, close: item.close }))
      .filter(x => financialsData[x.symbol] === undefined);

    if (needed.length === 0) return;

    let active = true;
    setLoadingFinancials(true);

    const loadBatch = async () => {
      const BATCH = 8;
      for (let i = 0; i < needed.length; i += BATCH) {
        if (!active) break;
        const batch = needed.slice(i, i + BATCH);
        const promises = batch.map(async x => {
          const metrics = await fetchStockFinancialData(x.symbol, x.close);
          return { sym: x.symbol, metrics };
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
  }, [technicallyFiltered, results, activeTab, financialsData, rules, visibleColumns, ruleMatchingMode]);

  const getIndSortValue = (stock: ScannedStock, key: string): any => {
    if (key === 'symbol') return stock.symbol;
    if (key === 'close') return stock.close;
    if (key === 'changePercent') return stock.changePercent;

    const fieldDef = ALL_FIELDS.find(f => f.key === key);
    if (!fieldDef) return 0;

    const modId = fieldDef.module;
    if (['wp', 'nc', 'er', 'pc'].includes(modId)) {
      const indicatorData = stock.indicators[modId === 'wp' ? 'williamsPasa' : modId === 'nc' ? 'nizamiCedid' : modId === 'er' ? 'emaRibbon' : 'pearson'];
      if (!indicatorData) return 0;
      return (indicatorData as any)[fieldDef.field];
    } else if (modId === 'extra') {
      return (stock.indicators.extra as any)[fieldDef.field];
    } else {
      if (fieldDef.field === 'fundamentalScore') return stock.fundamentalScore;
      if (fieldDef.field === 'piotroskiScore') return stock.piotroskiScore;
      if (fieldDef.field === 'combinedScore') return stock.combinedScore;
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

  // Apply financials filters and sort for indicator tab (unified AND/OR logic)
  const indicatorFilteredAndSorted = useMemo(() => {
    let list = [...results];

    // Sector filter
    if (selectedSector !== 'Tümü') {
      list = list.filter(item => getStockSector(item.symbol, getSymbolDisplayName(item.symbol)) === selectedSector);
    }

    // Search query filter
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(item => item.symbol.toLowerCase().includes(q));
    }

    if (rules.length > 0) {
      list = list.filter(item => {
        const fin = financialsData[item.symbol];

        if (ruleMatchingMode === 'or') {
          return rules.some(rule => evaluateRule(item, rule, fin));
        } else {
          return rules.every(rule => evaluateRule(item, rule, fin));
        }
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
  }, [results, financialsData, rules, ruleMatchingMode, indSortKey, indSortDirection, searchQuery, selectedSector, getSymbolDisplayName]);

  const heatmapData = useMemo(() => {
    const list = activeTab === 'smart' ? filteredAndSorted : indicatorFilteredAndSorted;
    return list.map(s => {
      const fin = financialsData[s.symbol];
      return {
        symbol: s.symbol,
        close: s.close,
        changePercent: s.changePercent,
        overallScore: s.overallScore,
        marketCap: fin ? fin.piyasaDegeri || 0 : 0
      } as HeatmapItem;
    });
  }, [activeTab, filteredAndSorted, indicatorFilteredAndSorted, financialsData]);

  const handleRowSelectToggle = (symbol: string) => {
    setSelectedSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) {
        next.delete(symbol);
      } else {
        next.add(symbol);
      }
      return next;
    });
  };

  const currentTabStocks = useMemo(() => {
    return activeTab === 'smart' ? filteredAndSorted : indicatorFilteredAndSorted;
  }, [activeTab, filteredAndSorted, indicatorFilteredAndSorted]);

  const isAllSelected = useMemo(() => {
    if (currentTabStocks.length === 0) return false;
    return currentTabStocks.every(s => selectedSymbols.has(s.symbol));
  }, [currentTabStocks, selectedSymbols]);

  const handleSelectAllToggle = () => {
    if (isAllSelected) {
      setSelectedSymbols((prev) => {
        const next = new Set(prev);
        currentTabStocks.forEach(s => next.delete(s.symbol));
        return next;
      });
    } else {
      setSelectedSymbols((prev) => {
        const next = new Set(prev);
        currentTabStocks.forEach(s => next.add(s.symbol));
        return next;
      });
    }
  };

  const handleContextMenu = (e: React.MouseEvent, stockSymbol: string) => {
    e.preventDefault();
    setSelectedSymbols((prev) => {
      const next = new Set(prev);
      if (!next.has(stockSymbol)) {
        next.clear();
        next.add(stockSymbol);
      }
      return next;
    });
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      visible: true,
      stockSymbol,
    });
  };

  const handleBulkAdd = (listId: string) => {
    const symbolArray = Array.from(selectedSymbols);
    if (symbolArray.length === 0) return;

    if (listId === '__new__') {
      const listName = prompt('Yeni takip listesi adı:');
      if (listName && listName.trim()) {
        onAddList?.(listName.trim(), symbolArray);
        toast(`${symbolArray.length} hisse yeni "${listName.trim()}" listesine eklendi.`, 'success');
        setSelectedSymbols(new Set());
      }
    } else {
      const targetList = watchlists.find(l => l.id === listId);
      if (targetList) {
        symbolArray.forEach(sym => onAddSymbolToList?.(listId, sym));
        toast(`${symbolArray.length} hisse "${targetList.name}" listesine eklendi.`, 'success');
        setSelectedSymbols(new Set());
      }
    }
  };

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
      return `Nizami Cedid delta değeri pozitif (${(nc.value * 100).toFixed(2)}%) seviyesindedir. Hacim ağırlıklı hareketli ortalamalarda momentumun yükseliş yönlü güçlendiğini teyit eder.`;
    }
    if (nc.signal === 'bearish') {
      return `Nizami Cedid delta değeri negatif (${(nc.value * 100).toFixed(2)}%) seviyesindedir. Satış baskısının ve momentum kaybının arttığını göstermektedir.`;
    }
    return `Nizami Cedid delta değeri nötr (${(nc.value * 100).toFixed(2)}%) seviyesindedir, belirgin bir yön kararı bulunmamaktadır.`;
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
      return `En kısa, kısa, uzun ve en uzun vadeli Pearson regresyon kanalları genel olarak yukarı eğilimlidir (R = ${pc.value.toFixed(2)}) ve fiyat kanal ortalamalarına (Pozisyon = ${pc.pos.toFixed(2)}) yakın destekleyici bölgelerdedir.`;
    }
    if (pc.signal === 'bearish') {
      return `Pearson kanalları aşağı eğilimlidir (R = ${pc.value.toFixed(2)}) ve fiyat direnç bölgelerine yakın seyretmektedir. Düşüş eğilimi kanal boyunca devam edebilir.`;
    }
    return `Pearson regresyon kanalları yatay veya karışık yönlerde. Trend gücü (Korelasyon R = ${pc.value.toFixed(2)}) belirgin bir yöne işaret etmemektedir.`;
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

        {/* Search & Sector Filter Box */}
        {results.length > 0 && (
          <div className="search-and-filter-row">
            <div className="search-box-wrap">
              <svg
                className="search-icon"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                className="scanner-search-input"
                placeholder="Hisse senedi kodu arayın... (Örn: THYAO, EREGL)"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  className="search-clear-btn"
                  onClick={() => setSearchQuery('')}
                  title="Aramayı Temizle"
                >
                  &times;
                </button>
              )}
            </div>

            <div className="sector-filter-wrap">
              <select
                value={selectedSector}
                onChange={e => setSelectedSector(e.target.value)}
                className="sector-filter-dropdown"
              >
                <option value="Tümü">Tüm Sektörler</option>
                {SECTORS.map(sec => (
                  <option key={sec} value={sec}>
                    {sec}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

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

            {/* Smart Table / Heatmap */}
            <div className="scanner-table-section">
              <div className="scanner-table-info-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
                <div className="scanner-table-info">
                  Gösterilen: <strong>{filteredAndSorted.length}</strong> / {results.length} hisse
                </div>
                <div className="view-mode-controls" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div className="view-mode-toggle" style={{ display: 'flex', gap: '4px' }}>
                    <button
                      className={`view-mode-btn ${viewMode === 'table' ? 'active' : ''}`}
                      onClick={() => setViewMode('table')}
                    >
                      📋 Liste Görünümü
                    </button>
                    <button
                      className={`view-mode-btn ${viewMode === 'heatmap' ? 'active' : ''}`}
                      onClick={() => setViewMode('heatmap')}
                    >
                      🗺️ Isı Haritası
                    </button>
                  </div>
                  {viewMode === 'heatmap' && (
                    <div className="heatmap-color-select" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Renk:</span>
                      <select
                        value={heatmapColorBy}
                        onChange={e => setHeatmapColorBy(e.target.value as 'change' | 'score')}
                        className="heatmap-color-dropdown"
                      >
                        <option value="change">Günlük Değişim (%)</option>
                        <option value="score">Teknik Skor</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {viewMode === 'heatmap' ? (
                <div className="heatmap-container-wrap" style={{ height: '500px', width: '100%', marginBottom: '16px' }}>
                  <ScanHeatmap
                    data={heatmapData}
                    colorBy={heatmapColorBy}
                    onNodeClick={(symbol) => {
                      const found = results.find(r => r.symbol === symbol);
                      if (found) {
                        handleRowClick(found);
                      }
                    }}
                  />
                </div>
              ) : (
                <div ref={tableWrapRef} className="scanner-table-wrap" onScroll={handleScroll}>
                  <table className="scanner-table">
                    <thead>
                      <tr>
                        <th className="checkbox-th">
                          <input
                            type="checkbox"
                            checked={isAllSelected}
                            onChange={handleSelectAllToggle}
                          />
                        </th>
                        <th onClick={() => handleSort('symbol')} className="sortable">
                          Hisse {sortKey === 'symbol' && (sortDirection === 'asc' ? '▲' : '▼')}
                        </th>
                        <th onClick={() => handleSort('close')} className="sortable text-right">
                          Kapanış {sortKey === 'close' && (sortDirection === 'asc' ? '▲' : '▼')}
                        </th>
                        <th onClick={() => handleSort('changePercent')} className="sortable text-right">
                          Günlük Değ. {sortKey === 'changePercent' && (sortDirection === 'asc' ? '▲' : '▼')}
                        </th>
                        <th onClick={() => handleSort('overallScore')} className="sortable text-center">
                          Teknik {sortKey === 'overallScore' && (sortDirection === 'asc' ? '▲' : '▼')}
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

                      </tr>
                    </thead>
                    <tbody>
                      {filteredAndSorted.map(stock => (
                        <tr
                          key={stock.symbol}
                          onClick={() => handleRowClick(stock)}
                          onContextMenu={(e) => handleContextMenu(e, stock.symbol)}
                          className={`stock-row ${selectedStock?.symbol === stock.symbol ? 'selected' : ''} ${selectedSymbols.has(stock.symbol) ? 'row-selected' : ''}`}
                          draggable
                          onDragStart={(e) => {
                            let symbolsToDrag = [stock.symbol];
                            if (selectedSymbols.has(stock.symbol)) {
                              symbolsToDrag = Array.from(selectedSymbols);
                            }
                            e.dataTransfer.setData('text/plain', JSON.stringify(symbolsToDrag));
                            e.dataTransfer.effectAllowed = 'copy';
                          }}
                        >
                          <td className="checkbox-td">
                            <input
                              type="checkbox"
                              checked={selectedSymbols.has(stock.symbol)}
                              readOnly
                            />
                          </td>
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
                             {stock.overallScore >= 70 && (
                               <span className="neon-pulse-dot" title="Yüksek Skor (Teknik)" />
                             )}
                          </td>
                          <td className="text-right font-mono">{stock.close.toFixed(2)}</td>
                          <td className={`text-right font-mono font-semibold ${stock.changePercent > 0 ? 'text-bullish' : stock.changePercent < 0 ? 'text-bearish' : 'text-neutral'}`}>
                            {stock.changePercent > 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                          </td>
                          <td className="text-center font-mono font-semibold" style={{ color: getScoreColor(stock.overallScore) }}>
                            {stock.overallScore}
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
            )}
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
                    checked={visibleColumns.extra}
                    onChange={() => handleToggleColumn('extra')}
                  />
                  <span>Teknik Ortalamalar</span>
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
                <label className="filter-pill">
                  <input
                    type="checkbox"
                    checked={visibleColumns.kpis}
                    onChange={() => handleToggleColumn('kpis')}
                  />
                  <span>Finansal Rasyolar (F/K, PD/DD, ROE)</span>
                </label>
              </div>
            </div>

            {/* Template Management Panel */}
            <div className="template-management-panel">
              <div className="template-header">
                <span className="section-title-sm">Filtre Şablonları</span>
                <div className="template-actions">
                  <button className="template-action-btn save" onClick={handleSaveTemplate}>
                    💾 Şablonu Kaydet
                  </button>
                  <button className="template-action-btn export" onClick={handleExportTemplates}>
                    📤 Şablonları Dışa Aktar
                  </button>
                  <label className="template-action-btn import">
                    📥 Şablonları İçe Aktar
                    <input type="file" accept=".json" onChange={handleImportTemplates} style={{ display: 'none' }} />
                  </label>
                </div>
              </div>
              <div className="template-list">
                {savedTemplates.length === 0 ? (
                  <span className="no-templates-text">Kayıtlı şablon bulunamadı. Mevcut filtrelerinizi şablon olarak kaydedebilirsiniz.</span>
                ) : (
                  savedTemplates.map(tmpl => (
                    <div key={tmpl.id} className="template-pill">
                      <span className="template-name" onClick={() => handleLoadTemplate(tmpl)}>
                        📁 {tmpl.name}
                      </span>
                      <button className="template-delete-btn" onClick={() => handleDeleteTemplate(tmpl.id)} title="Şablonu Sil">
                        &times;
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Presets Library Panel */}
            <div className="presets-library-panel">
              <div className="presets-header">
                <span className="section-title-sm">📚 Hazır Strateji Kütüphanesi</span>
                <span className="presets-subtitle" style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '10px' }}>
                  Popüler tarama kurallarını tek tıkla uygulayın
                </span>
              </div>
              <div className="presets-list">
                {Object.entries(PRESETS).map(([key, preset]) => (
                  <button
                    key={key}
                    className="preset-btn"
                    onClick={() => handleApplyPreset(preset)}
                  >
                    🚀 {preset.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Manual Rules Builder Panel */}
            <div className="scanner-filters manual-rules-panel">
              <div className="filter-top-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
                <span className="section-title-sm">Tarama Filtre Kuralları (Tümüyle Manuel)</span>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div className="filter-matching-mode" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className="mode-label" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Filtre Mantığı:</span>
                    <button
                      className={`mode-btn ${ruleMatchingMode === 'and' ? 'active' : ''}`}
                      onClick={() => setRuleMatchingMode('and')}
                    >
                      VE (Tüm Kurallar)
                    </button>
                    <button
                      className={`mode-btn ${ruleMatchingMode === 'or' ? 'active' : ''}`}
                      onClick={() => setRuleMatchingMode('or')}
                    >
                      VEYA (Herhangi Biri)
                    </button>
                  </div>
                  <button className="add-rule-btn" onClick={addRule}>
                    + Filtre Kuralı Ekle
                  </button>
                </div>
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
              <div className="scanner-table-info-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
                <div className="scanner-table-info">
                  Gösterilen: <strong>{indicatorFilteredAndSorted.length}</strong> / {results.length} hisse
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <div className="view-mode-controls" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div className="view-mode-toggle" style={{ display: 'flex', gap: '4px' }}>
                      <button
                        className={`view-mode-btn ${viewMode === 'table' ? 'active' : ''}`}
                        onClick={() => setViewMode('table')}
                      >
                        📋 Liste Görünümü
                      </button>
                      <button
                        className={`view-mode-btn ${viewMode === 'heatmap' ? 'active' : ''}`}
                        onClick={() => setViewMode('heatmap')}
                      >
                        🗺️ Isı Haritası
                      </button>
                    </div>
                    {viewMode === 'heatmap' && (
                      <div className="heatmap-color-select" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Renk:</span>
                        <select
                          value={heatmapColorBy}
                          onChange={e => setHeatmapColorBy(e.target.value as 'change' | 'score')}
                          className="heatmap-color-dropdown"
                        >
                          <option value="change">Günlük Değişim (%)</option>
                          <option value="score">Teknik Skor</option>
                        </select>
                      </div>
                    )}
                  </div>
                  <button className="export-csv-btn" onClick={handleExportCSV} title="Sonuçları Excel (CSV) olarak indir">
                    📊 Excel'e Aktar (CSV)
                  </button>
                </div>
              </div>
              {viewMode === 'heatmap' ? (
                <div className="heatmap-container-wrap" style={{ height: '500px', width: '100%', marginBottom: '16px' }}>
                  <ScanHeatmap
                    data={heatmapData}
                    colorBy={heatmapColorBy}
                    onNodeClick={(symbol) => {
                      const found = results.find(r => r.symbol === symbol);
                      if (found) {
                        handleRowClick(found);
                      }
                    }}
                  />
                </div>
              ) : (
                <div ref={tableWrapRef} className="scanner-table-wrap" onScroll={handleScroll}>
                  <table className="scanner-table indicator-table">
                  <thead>
                    <tr>
                      <th className="checkbox-th">
                        <input
                          type="checkbox"
                          checked={isAllSelected}
                          onChange={handleSelectAllToggle}
                        />
                      </th>
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
                            Pearson R (Ort.) {indSortKey === 'pc_value' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('pc_pos')} className="sortable text-center">
                            Kanal Konum (Ort.) {indSortKey === 'pc_pos' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('pc_extra_short_r')} className="sortable text-center">
                            En Kısa R {indSortKey === 'pc_extra_short_r' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('pc_extra_short_pos')} className="sortable text-center">
                            En Kısa Konum {indSortKey === 'pc_extra_short_pos' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('pc_extra_short_slope_pct')} className="sortable text-center">
                            En Kısa Eğilim {indSortKey === 'pc_extra_short_slope_pct' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('pc_short_r')} className="sortable text-center">
                            Kısa R {indSortKey === 'pc_short_r' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('pc_short_pos')} className="sortable text-center">
                            Kısa Konum {indSortKey === 'pc_short_pos' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('pc_short_slope_pct')} className="sortable text-center">
                            Kısa Eğilim {indSortKey === 'pc_short_slope_pct' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('pc_long_r')} className="sortable text-center">
                            Uzun R {indSortKey === 'pc_long_r' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('pc_long_pos')} className="sortable text-center">
                            Uzun Konum {indSortKey === 'pc_long_pos' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('pc_long_slope_pct')} className="sortable text-center">
                            Uzun Eğilim {indSortKey === 'pc_long_slope_pct' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('pc_extra_long_r')} className="sortable text-center">
                            En Uzun R {indSortKey === 'pc_extra_long_r' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('pc_extra_long_pos')} className="sortable text-center">
                            En Uzun Konum {indSortKey === 'pc_extra_long_pos' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('pc_extra_long_slope_pct')} className="sortable text-center">
                            En Uzun Eğilim {indSortKey === 'pc_extra_long_slope_pct' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                        </>
                      )}

                      {visibleColumns.extra && (
                        <>
                          <th onClick={() => handleIndSort('extra_sma50')} className="sortable text-right">
                            SMA 50 {indSortKey === 'extra_sma50' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('extra_sma200')} className="sortable text-right">
                            SMA 200 {indSortKey === 'extra_sma200' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('extra_ema21')} className="sortable text-right">
                            EMA 21 {indSortKey === 'extra_ema21' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('extra_ema100')} className="sortable text-right">
                            EMA 100 {indSortKey === 'extra_ema100' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('extra_volumeRatio')} className="sortable text-right">
                            Hacim Oranı {indSortKey === 'extra_volumeRatio' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                        </>
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
                      {visibleColumns.kpis && (
                        <>
                          <th onClick={() => handleIndSort('kpis_fk')} className="sortable text-right">
                            F/K {indSortKey === 'kpis_fk' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('kpis_pddd')} className="sortable text-right">
                            PD/DD {indSortKey === 'kpis_pddd' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('kpis_roe')} className="sortable text-right">
                            ROE (%) {indSortKey === 'kpis_roe' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('kpis_netKarMarji')} className="sortable text-right">
                            Net Kar Marjı {indSortKey === 'kpis_netKarMarji' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('kpis_brutKarMarji')} className="sortable text-right">
                            Brüt Kar Marjı {indSortKey === 'kpis_brutKarMarji' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('kpis_borcOzkaynak')} className="sortable text-right">
                            Borç/Özk. {indSortKey === 'kpis_borcOzkaynak' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('kpis_piyasaDegeri')} className="sortable text-right">
                            Piyasa Değeri {indSortKey === 'kpis_piyasaDegeri' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('kpis_fundamentalScore')} className="sortable text-right">
                            Temel Puan {indSortKey === 'kpis_fundamentalScore' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('kpis_piotroskiScore')} className="sortable text-right">
                            Piotroski {indSortKey === 'kpis_piotroskiScore' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleIndSort('kpis_combinedScore')} className="sortable text-right">
                            Birleşik Puan {indSortKey === 'kpis_combinedScore' && (indSortDirection === 'asc' ? '▲' : '▼')}
                          </th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {indicatorFilteredAndSorted.map(stock => {
                      const wp = stock.indicators.williamsPasa;
                      const nc = stock.indicators.nizamiCedid;
                      const er = stock.indicators.emaRibbon;
                      const pc = stock.indicators.pearson;


                      const fin = financialsData[stock.symbol];

                      return (
                        <tr
                          key={stock.symbol}
                          onClick={() => handleRowClick(stock)}
                          onContextMenu={(e) => handleContextMenu(e, stock.symbol)}
                          className={`stock-row-indicator ${selectedStock?.symbol === stock.symbol ? 'selected' : ''} ${selectedSymbols.has(stock.symbol) ? 'row-selected' : ''}`}
                          draggable
                          onDragStart={(e) => {
                            let symbolsToDrag = [stock.symbol];
                            if (selectedSymbols.has(stock.symbol)) {
                              symbolsToDrag = Array.from(selectedSymbols);
                            }
                            e.dataTransfer.setData('text/plain', JSON.stringify(symbolsToDrag));
                            e.dataTransfer.effectAllowed = 'copy';
                          }}
                        >
                          <td className="checkbox-td">
                            <input
                              type="checkbox"
                              checked={selectedSymbols.has(stock.symbol)}
                              readOnly
                            />
                          </td>
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
                            {stock.overallScore >= 80 && (
                              <span className="neon-pulse-dot" title="Yüksek Skor (Boğa İvmesi)" />
                            )}
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
                              <td className={`text-center font-mono ${pc.extra_short_r > 0.2 ? 'text-bullish' : pc.extra_short_r < -0.2 ? 'text-bearish' : 'text-neutral'}`}>
                                {pc.extra_short_r.toFixed(2)}
                              </td>
                              <td className={`text-center font-mono font-semibold ${pc.extra_short_pos > 1.2 ? 'text-bullish' : pc.extra_short_pos < -1.2 ? 'text-bearish' : ''}`}>
                                {pc.extra_short_pos.toFixed(2)}
                              </td>
                              <td className={`text-center font-mono ${pc.extra_short_slope_pct > 0 ? 'text-bullish' : pc.extra_short_slope_pct < 0 ? 'text-bearish' : 'text-neutral'}`}>
                                {(pc.extra_short_slope_pct >= 0 ? '+' : '') + pc.extra_short_slope_pct.toFixed(4)}%
                              </td>
                              <td className={`text-center font-mono ${pc.short_r > 0.2 ? 'text-bullish' : pc.short_r < -0.2 ? 'text-bearish' : 'text-neutral'}`}>
                                {pc.short_r.toFixed(2)}
                              </td>
                              <td className={`text-center font-mono font-semibold ${pc.short_pos > 1.2 ? 'text-bullish' : pc.short_pos < -1.2 ? 'text-bearish' : ''}`}>
                                {pc.short_pos.toFixed(2)}
                              </td>
                              <td className={`text-center font-mono ${pc.short_slope_pct > 0 ? 'text-bullish' : pc.short_slope_pct < 0 ? 'text-bearish' : 'text-neutral'}`}>
                                {(pc.short_slope_pct >= 0 ? '+' : '') + pc.short_slope_pct.toFixed(4)}%
                              </td>
                              <td className={`text-center font-mono ${pc.long_r > 0.2 ? 'text-bullish' : pc.long_r < -0.2 ? 'text-bearish' : 'text-neutral'}`}>
                                {pc.long_r.toFixed(2)}
                              </td>
                              <td className={`text-center font-mono font-semibold ${pc.long_pos > 1.2 ? 'text-bullish' : pc.long_pos < -1.2 ? 'text-bearish' : ''}`}>
                                {pc.long_pos.toFixed(2)}
                              </td>
                              <td className={`text-center font-mono ${pc.long_slope_pct > 0 ? 'text-bullish' : pc.long_slope_pct < 0 ? 'text-bearish' : 'text-neutral'}`}>
                                {(pc.long_slope_pct >= 0 ? '+' : '') + pc.long_slope_pct.toFixed(4)}%
                              </td>
                              <td className={`text-center font-mono ${pc.extra_long_r > 0.2 ? 'text-bullish' : pc.extra_long_r < -0.2 ? 'text-bearish' : 'text-neutral'}`}>
                                {pc.extra_long_r.toFixed(2)}
                              </td>
                              <td className={`text-center font-mono font-semibold ${pc.extra_long_pos > 1.2 ? 'text-bullish' : pc.extra_long_pos < -1.2 ? 'text-bearish' : ''}`}>
                                {pc.extra_long_pos.toFixed(2)}
                              </td>
                              <td className={`text-center font-mono ${pc.extra_long_slope_pct > 0 ? 'text-bullish' : pc.extra_long_slope_pct < 0 ? 'text-bearish' : 'text-neutral'}`}>
                                {(pc.extra_long_slope_pct >= 0 ? '+' : '') + pc.extra_long_slope_pct.toFixed(4)}%
                              </td>
                            </>
                          )}

                          {visibleColumns.extra && (
                            <>
                              <td className="text-right font-mono">
                                {stock.indicators.extra.sma50 ? stock.indicators.extra.sma50.toFixed(2) : '-'}
                              </td>
                              <td className="text-right font-mono">
                                {stock.indicators.extra.sma200 ? stock.indicators.extra.sma200.toFixed(2) : '-'}
                              </td>
                              <td className="text-right font-mono">
                                {stock.indicators.extra.ema21 ? stock.indicators.extra.ema21.toFixed(2) : '-'}
                              </td>
                              <td className="text-right font-mono">
                                {stock.indicators.extra.ema100 ? stock.indicators.extra.ema100.toFixed(2) : '-'}
                              </td>
                              <td className={`text-right font-mono font-semibold ${stock.indicators.extra.volumeRatio && stock.indicators.extra.volumeRatio > 1.5 ? 'text-bullish' : ''}`}>
                                {stock.indicators.extra.volumeRatio ? stock.indicators.extra.volumeRatio.toFixed(2) : '1.00'}
                              </td>
                            </>
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
                          {visibleColumns.kpis && (
                            <>
                              <td className="text-right font-mono">
                                {fin && fin.fk !== null ? fin.fk.toFixed(2) : <span className="cell-loading">-</span>}
                              </td>
                              <td className="text-right font-mono">
                                {fin && fin.pddd !== null ? fin.pddd.toFixed(2) : <span className="cell-loading">-</span>}
                              </td>
                              <td className={`text-right font-mono font-semibold ${fin && fin.roe && fin.roe > 20 ? 'text-bullish' : fin && fin.roe && fin.roe < 0 ? 'text-bearish' : ''}`}>
                                {fin && fin.roe !== null ? `${fin.roe.toFixed(1)}%` : <span className="cell-loading">-</span>}
                              </td>
                              <td className={`text-right font-mono ${fin && fin.netKarMarji && fin.netKarMarji > 15 ? 'text-bullish' : fin && fin.netKarMarji && fin.netKarMarji < 0 ? 'text-bearish' : ''}`}>
                                {fin && fin.netKarMarji !== null ? `${fin.netKarMarji.toFixed(1)}%` : <span className="cell-loading">-</span>}
                              </td>
                              <td className={`text-right font-mono ${fin && fin.brutKarMarji && fin.brutKarMarji > 25 ? 'text-bullish' : fin && fin.brutKarMarji && fin.brutKarMarji < 0 ? 'text-bearish' : ''}`}>
                                {fin && fin.brutKarMarji !== null ? `${fin.brutKarMarji.toFixed(1)}%` : <span className="cell-loading">-</span>}
                              </td>
                              <td className={`text-right font-mono ${fin && fin.borcOzkaynak && fin.borcOzkaynak > 1.5 ? 'text-bearish' : fin && fin.borcOzkaynak && fin.borcOzkaynak < 0.5 ? 'text-bullish' : ''}`}>
                                {fin && fin.borcOzkaynak !== null ? fin.borcOzkaynak.toFixed(2) : <span className="cell-loading">-</span>}
                              </td>
                              <td className="text-right font-mono">
                                {fin && fin.piyasaDegeri !== null ? formatLargeMoney(fin.piyasaDegeri) : <span className="cell-loading">-</span>}
                              </td>
                              <td className="text-right font-mono font-semibold">
                                {stock.fundamentalScore}/10
                              </td>
                              <td className="text-right font-mono font-semibold">
                                {stock.piotroskiScore}/9
                              </td>
                              <td className="text-right font-mono font-semibold">
                                {stock.combinedScore}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                    {indicatorFilteredAndSorted.length === 0 && (
                      <tr>
                        <td colSpan={4 + (visibleColumns.wp ? 2 : 0) + (visibleColumns.nc ? 4 : 0) + (visibleColumns.er ? 1 : 0) + (visibleColumns.pc ? 14 : 0) + (visibleColumns.extra ? 5 : 0) + (visibleColumns.netProfit ? 1 : 0) + (visibleColumns.revGrowth ? 1 : 0) + (visibleColumns.equity ? 1 : 0) + (visibleColumns.kpis ? 10 : 0)} className="no-results-cell">
                          Filtrelere uygun hisse senedi bulunamadı.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
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
                <span className="drawer-sector" style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Sektör: {getStockSector(selectedStock.symbol, getSymbolDisplayName(selectedStock.symbol))}
                </span>
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

              {/* Spider chart representing the 5 indicator scores */}
              <div className="drawer-radar-card">
                <IndicatorRadarChart
                  scores={{
                    williamsPasa: selectedStock.indicators.williamsPasa.score,
                    nizamiCedid: selectedStock.indicators.nizamiCedid.score,
                    emaRibbon: selectedStock.indicators.emaRibbon.score,
                    pearson: selectedStock.indicators.pearson.score,
                  }}
                />
              </div>

              {/* Sparkline chart */}
              <div className="drawer-sparkline-card">
                <h4 className="card-title-sm" style={{ marginBottom: '10px', color: 'var(--text-bright)', fontSize: '14px', fontWeight: 'semibold' }}>Son 30 Günlük Fiyat & Hacim Trendi</h4>
                <MiniSparklineChart historyData={selectedStockHistory} />
              </div>

              {/* Fundamental Analysis Summary */}
              <div className="drawer-fundamental-card">
                <h4 className="card-title-sm" style={{ marginBottom: '10px', color: 'var(--text-bright)', fontSize: '14px', fontWeight: 'semibold' }}>Temel Analiz & Rasyolar</h4>
                <div className="fundamental-scores-row" style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '12px' }}>
                  <div className="fun-score-item" style={{ flex: 1, textAlign: 'center', background: 'rgba(255, 255, 255, 0.03)', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                    <span className="fun-score-val" style={{ display: 'block', fontSize: '16px', fontWeight: 'bold', color: 'var(--accent-cyan)' }}>
                      {selectedStock.fundamentalScore} <span className="fun-score-max" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>/10</span>
                    </span>
                    <span className="fun-score-lbl" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Temel Sağlık</span>
                  </div>
                  <div className="fun-score-item" style={{ flex: 1, textAlign: 'center', background: 'rgba(255, 255, 255, 0.03)', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                    <span className="fun-score-val" style={{ display: 'block', fontSize: '16px', fontWeight: 'bold', color: 'var(--accent-orange)' }}>
                      {selectedStock.piotroskiScore} <span className="fun-score-max" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>/9</span>
                    </span>
                    <span className="fun-score-lbl" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Piotroski F-Skor</span>
                  </div>
                  <div className="fun-score-item" style={{ flex: 1, textAlign: 'center', background: 'rgba(255, 255, 255, 0.03)', padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                    <span className="fun-score-val" style={{ display: 'block', fontSize: '16px', fontWeight: 'bold', color: getScoreColor(selectedStock.combinedScore) }}>
                      {selectedStock.combinedScore} <span className="fun-score-max" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>/100</span>
                    </span>
                    <span className="fun-score-lbl" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Birleşik Puan</span>
                  </div>
                </div>
                
                {financialsData[selectedStock.symbol] ? (
                  (() => {
                    const fin = financialsData[selectedStock.symbol]!;
                    return (
                      <div className="drawer-kpis-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', background: 'rgba(255, 255, 255, 0.02)', padding: '8px', borderRadius: '4px' }}>
                        <div className="kpi-grid-item" style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className="kpi-lbl" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>F/K Oranı</span>
                          <span className="kpi-val font-mono" style={{ fontSize: '12px', color: 'var(--text-bright)', fontWeight: 'semibold' }}>{fin.fk !== null ? fin.fk.toFixed(2) : '-'}</span>
                        </div>
                        <div className="kpi-grid-item" style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className="kpi-lbl" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>PD/DD Oranı</span>
                          <span className="kpi-val font-mono" style={{ fontSize: '12px', color: 'var(--text-bright)', fontWeight: 'semibold' }}>{fin.pddd !== null ? fin.pddd.toFixed(2) : '-'}</span>
                        </div>
                        <div className="kpi-grid-item" style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className="kpi-lbl" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Özkaynak Karlılığı</span>
                          <span className="kpi-val font-mono" style={{ fontSize: '12px', color: fin.roe && fin.roe > 20 ? 'var(--neon-green)' : 'var(--text-bright)', fontWeight: 'semibold' }}>{fin.roe !== null ? fin.roe.toFixed(1) + '%' : '-'}</span>
                        </div>
                        <div className="kpi-grid-item" style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className="kpi-lbl" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Net Kar Marjı</span>
                          <span className="kpi-val font-mono" style={{ fontSize: '12px', color: fin.netKarMarji && fin.netKarMarji > 15 ? 'var(--neon-green)' : 'var(--text-bright)', fontWeight: 'semibold' }}>{fin.netKarMarji !== null ? fin.netKarMarji.toFixed(1) + '%' : '-'}</span>
                        </div>
                        <div className="kpi-grid-item" style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className="kpi-lbl" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Borç / Özkaynak</span>
                          <span className="kpi-val font-mono" style={{ fontSize: '12px', color: 'var(--text-bright)', fontWeight: 'semibold' }}>{fin.borcOzkaynak !== null ? fin.borcOzkaynak.toFixed(2) : '-'}</span>
                        </div>
                        <div className="kpi-grid-item" style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className="kpi-lbl" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Satış Büyümesi</span>
                          <span className="kpi-val font-mono" style={{ fontSize: '12px', color: fin.revenueGrowth && fin.revenueGrowth > 20 ? 'var(--neon-green)' : 'var(--text-bright)', fontWeight: 'semibold' }}>{fin.revenueGrowth !== null ? fin.revenueGrowth.toFixed(1) + '%' : '-'}</span>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div style={{ color: 'var(--text-muted)', fontSize: '11px', textAlign: 'center', padding: '8px' }}>
                    Finansal rasyolar yükleniyor veya bulunamadı.
                  </div>
                )}
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

      {/* Floating Bulk Actions Bar */}
      {selectedSymbols.size > 0 && (
        <div className="scanner-bulk-action-bar animate-slide-up">
          <div className="bulk-info">
            <span className="bulk-count">{selectedSymbols.size}</span> hisse seçildi
          </div>
          <div className="bulk-actions">
            <select
              className="bulk-select"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  handleBulkAdd(e.target.value);
                  e.target.value = ""; // Reset selection after triggering action
                }
              }}
            >
              <option value="" disabled>Takip Listesine Ekle...</option>
              {watchlists.map(list => (
                <option key={list.id} value={list.id}>{list.name}</option>
              ))}
              <option value="__new__">+ Yeni Liste Oluştur...</option>
            </select>
            <button className="bulk-clear-btn" onClick={() => setSelectedSymbols(new Set())}>
              Vazgeç
            </button>
          </div>
        </div>
      )}

      {/* Custom Context Menu */}
      {contextMenu && contextMenu.visible && (
        <div
          className="custom-context-menu animate-fade-in"
          style={{
            top: `${contextMenu.y}px`,
            left: `${contextMenu.x}px`
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="menu-header">{contextMenu.stockSymbol}</div>
          <div className="menu-section-title">Takip Listesine Ekle</div>
          {watchlists.map(list => {
            const isInList = list.symbols.includes(contextMenu.stockSymbol);
            return (
              <button
                key={list.id}
                className="menu-item"
                onClick={() => {
                  handleBulkAdd(list.id);
                  setContextMenu(null);
                }}
              >
                📁 {list.name} {isInList && <span className="menu-item-check">✓</span>}
              </button>
            );
          })}
          <button
            className="menu-item new-list-item"
            onClick={() => {
              handleBulkAdd('__new__');
              setContextMenu(null);
            }}
          >
            ➕ Yeni Liste Oluştur...
          </button>
          <div className="menu-separator" />
          <button
            className="menu-item action-item"
            onClick={() => {
              onSymbolClick?.(contextMenu.stockSymbol);
              setContextMenu(null);
            }}
          >
            📈 Grafiğini Detaylı Aç
          </button>
          <button
            className="menu-item action-item"
            onClick={() => {
              const stockObj = results.find(s => s.symbol === contextMenu.stockSymbol);
              if (stockObj) {
                handleRowClick(stockObj);
              }
              setContextMenu(null);
            }}
          >
            🔍 Detayları İncele
          </button>
        </div>
      )}
    </div>
  );
}
