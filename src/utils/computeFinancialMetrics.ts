/**
 * Pure functions for computing financial KPIs and chart data series
 * from AllFinancialsResponse + OHLCV price data.
 */
import type { AllFinancialsResponse, FinancialRow } from '../api/borsaApi';
import type { OHLCVData } from '../api/borsaApi';

// ── Helpers ──────────────────────────────────

export function findRowFlex(data: FinancialRow[], itemNames: string[]): FinancialRow | undefined {
  for (const name of itemNames) {
    const found = data.find((r) => r.item === name);
    if (found) return found;
  }
  
  // Try clean lowercase alphanumeric comparison
  const clean = (str: string) => str.toLowerCase().replace(/[^a-z0-9çğıöşü]/g, '');
  for (const name of itemNames) {
    const cleanName = clean(name);
    if (!cleanName) continue;
    const found = data.find((r) => {
      const cleanItem = clean(r.item);
      return cleanItem.includes(cleanName) || cleanName.includes(cleanItem);
    });
    if (found) return found;
  }
  return undefined;
}

export function sumRowsFlex(data: FinancialRow[], itemNamesList: string[][]): FinancialRow | undefined {
  const foundRows: FinancialRow[] = [];
  for (const itemNames of itemNamesList) {
    const found = findRowFlex(data, itemNames);
    if (found) {
      foundRows.push(found);
    }
  }
  if (foundRows.length === 0) return undefined;
  if (foundRows.length === 1) return foundRows[0];
  
  const virtualRow: FinancialRow = { item: 'Virtual Sum Row' };
  const periods = Object.keys(foundRows[0]).filter(k => k !== 'item');
  for (const p of periods) {
    let sum = 0;
    let hasValue = false;
    for (const row of foundRows) {
      const val = row[p];
      if (typeof val === 'number' && !isNaN(val)) {
        sum += val;
        hasValue = true;
      }
    }
    virtualRow[p] = hasValue ? sum : null;
  }
  return virtualRow;
}

function findRow(data: FinancialRow[], itemName: string): FinancialRow | undefined {
  return findRowFlex(data, [itemName]);
}

function val(row: FinancialRow | undefined, period: string): number | null {
  if (!row) return null;
  const v = row[period];
  return typeof v === 'number' ? v : null;
}

function getYearlyPeriods(periods: string[]): string[] {
  return periods.filter((p) => p.endsWith('/12'));
}

export function formatPeriodLabel(p: string): string {
  const parts = p.split('/');
  if (parts.length === 2) {
    const month = parseInt(parts[1]);
    if (month === 12) return parts[0];
    const qMap: Record<number, string> = { 3: 'Q1', 6: 'Q2', 9: 'Q3' };
    return parts[0] + '/' + (qMap[month] || `M${month}`);
  }
  return p;
}

// ── KPIs ─────────────────────────────────────

export interface FinancialKPIs {
  fk: number | null;
  pddd: number | null;
  netKarMarji: number | null;
  brutKarMarji: number | null;
  roe: number | null;
  borcOzkaynak: number | null;
  piyasaDegeri: number | null;
  lastPrice: number | null;
  latestPeriod: string | null;
}

const NULL_KPIS: FinancialKPIs = {
  fk: null,
  pddd: null,
  netKarMarji: null,
  brutKarMarji: null,
  roe: null,
  borcOzkaynak: null,
  piyasaDegeri: null,
  lastPrice: null,
  latestPeriod: null,
};

function getTTMValueForRow(row: FinancialRow | undefined, currentPeriod: string, periods: string[]): number | null {
  if (!row) return null;

  const currentVal = val(row, currentPeriod);
  if (currentVal === null) return null;

  const parts = currentPeriod.split('/');
  if (parts.length !== 2) return currentVal;

  const month = parseInt(parts[1]);
  if (month === 12) {
    return currentVal; // For year-end, cumulative is already TTM
  }

  const year = parseInt(parts[0]);
  const prevYearEndPeriod = `${year - 1}/12`;
  const prevYearCumulativePeriod = `${year - 1}/${parts[1]}`;

  if (periods.includes(prevYearEndPeriod) && periods.includes(prevYearCumulativePeriod)) {
    const prevYearEndVal = val(row, prevYearEndPeriod);
    const prevYearCumulativeVal = val(row, prevYearCumulativePeriod);

    if (prevYearEndVal !== null && prevYearCumulativeVal !== null) {
      return currentVal + prevYearEndVal - prevYearCumulativeVal;
    }
  }

  // Fallback: Scale the current cumulative value to 12 months
  return (currentVal / month) * 12;
}

function getTTMValue(data: FinancialRow[], itemNames: string[], currentPeriod: string, periods: string[]): number | null {
  const row = findRowFlex(data, itemNames);
  return getTTMValueForRow(row, currentPeriod, periods);
}

export function computeKPIs(allFin: AllFinancialsResponse, ohlcvData: OHLCVData[]): FinancialKPIs {
  const periods = allFin.income_stmt.periods;
  const latestPeriod = periods.length > 0 ? periods[periods.length - 1] : null;
  if (!latestPeriod) return NULL_KPIS;

  const lastPrice = ohlcvData.length > 0 ? ohlcvData[ohlcvData.length - 1].close : null;

  // Use TTM values for income statement metrics (revenue, gross profit, net income)
  const revenueRow = sumRowsFlex(allFin.income_stmt.data, [
    ['Satış Gelirleri', 'Hasılat'],
    ['Faiz Gelirleri', 'Faiz Geliri'],
    ['Hayat Dışı Teknik Gelir', 'A- Hayat Dışı Teknik Gelir'],
    ['Hayat Teknik Gelir', 'D- Hayat Teknik Gelir'],
    ['Emeklilik Teknik Gelir', 'G- Emeklilik Teknik Gelir'],
    ['Esas Faaliyet Gelirleri', 'I. ESAS FAALİYET GELİRLERİ']
  ]);
  const revenue = getTTMValueForRow(revenueRow, latestPeriod, periods);

  const grossProfitRow = findRowFlex(allFin.income_stmt.data, [
    'BRÜT KAR (ZARAR)', 'Brüt Kar (Zarar)',
    'NET FAİZ GELİRİ/GİDERİ (I - II)', 'Net Faiz Geliri',
    'Genel Teknik Bölüm Dengesi', 'J- Genel Teknik Bölüm Dengesi',
    'NET FAALİYET K/Z', 'NET FAALİYET KARI (ZARARI)', 'Net Faaliyet Karı (Zararı)', 'VII. NET FAALİYET K/Z'
  ]);
  const grossProfit = getTTMValueForRow(grossProfitRow, latestPeriod, periods);

  const netIncomeRow = findRowFlex(allFin.income_stmt.data, [
    'Ana Ortaklık Payları', 'Dönem Net Karı', 'Grubun Karı/Zararı',
    'NET DÖNEM KARI/ZARARI (XVII+XXII)', 'Dönem Net Kar/Zararı',
    'NET DÖNEM KARI (ZARARI)', 'NET DÖNEM KARI veya ZARARI',
    'Dönem Net Karı veya Zararı', 'Dönem Net Kar veya Zararı',
    'NET DÖNEM KARI VEYA ZARARI'
  ]);
  const netIncome = getTTMValueForRow(netIncomeRow, latestPeriod, periods);

  // Balance sheet uses the latest balance sheet period directly (point-in-time snapshot)
  const bsPeriods = allFin.balance_sheet.periods;
  const bsPeriod = bsPeriods.length > 0 ? bsPeriods[bsPeriods.length - 1] : null;

  const equity = bsPeriod ? val(findRowFlex(allFin.balance_sheet.data, [
    'Özkaynaklar', 'Özsermaye', 'Özsermaye Toplamı', 'Ana Ortaklığa Ait Özkaynaklar',
    'ÖZ KAYNAKLAR', 'Özkaynaklar Toplamı'
  ]), bsPeriod) : null;
  const paidInCapital = bsPeriod ? val(findRowFlex(allFin.balance_sheet.data, [
    'Ödenmiş Sermaye', 'Ödenmiş Sermaye (Nominal)', 'A- Ödenmiş Sermaye', '13.1 Ödenmiş Sermaye'
  ]), bsPeriod) : null;
  const shortTermDebt = bsPeriod
    ? val(findRowFlex(allFin.balance_sheet.data, ['Kısa Vadeli Yükümlülükler']), bsPeriod)
    : null;
  const longTermDebt = bsPeriod ? val(findRowFlex(allFin.balance_sheet.data, ['Uzun Vadeli Yükümlülükler']), bsPeriod) : null;

  // Shares outstanding = Ödenmiş Sermaye (BIST nominal = 1 TL)
  const shares = paidInCapital;
  const marketCap = lastPrice != null && shares != null ? lastPrice * shares : null;
  const eps = netIncome != null && shares != null && shares !== 0 ? netIncome / shares : null;

  const fk = lastPrice != null && eps != null && eps !== 0 ? lastPrice / eps : null;
  const pddd = marketCap != null && equity != null && equity !== 0 ? marketCap / equity : null;
  const netKarMarji = netIncome != null && revenue != null && revenue !== 0 ? (netIncome / revenue) * 100 : null;
  const brutKarMarji = grossProfit != null && revenue != null && revenue !== 0 ? (grossProfit / revenue) * 100 : null;
  const roe = netIncome != null && equity != null && equity !== 0 ? (netIncome / equity) * 100 : null;
  
  let totalDebt = (shortTermDebt ?? 0) + (longTermDebt ?? 0);
  if (shortTermDebt === null && longTermDebt === null) {
    // Bank/Insurance/Factoring layout: total debt can be represented by Total Liabilities (Pasif Toplamı) - Equity (Özkaynaklar)
    const pasifToplami = bsPeriod ? val(findRowFlex(allFin.balance_sheet.data, ['PASİF TOPLAMI', 'Pasif Toplamı']), bsPeriod) : null;
    if (pasifToplami !== null && equity !== null) {
      totalDebt = pasifToplami - equity;
    }
  }
  const borcOzkaynak = equity != null && equity !== 0 ? totalDebt / equity : null;

  return { fk, pddd, netKarMarji, brutKarMarji, roe, borcOzkaynak, piyasaDegeri: marketCap, lastPrice, latestPeriod };
}

// ── Chart 1: Revenue + Net Income ────────────

export interface RevenueProfitPoint {
  label: string;
  revenue: number | null;
  netIncome: number | null;
}

export function deriveRevenueProfitTrend(allFin: AllFinancialsResponse, quarterly: boolean): RevenueProfitPoint[] {
  const section = allFin.income_stmt;
  const periods = quarterly ? section.periods : getYearlyPeriods(section.periods);
  const revenueRow = sumRowsFlex(section.data, [
    ['Satış Gelirleri', 'Hasılat'],
    ['Faiz Gelirleri', 'Faiz Geliri'],
    ['Hayat Dışı Teknik Gelir', 'A- Hayat Dışı Teknik Gelir'],
    ['Hayat Teknik Gelir', 'D- Hayat Teknik Gelir'],
    ['Emeklilik Teknik Gelir', 'G- Emeklilik Teknik Gelir'],
    ['Esas Faaliyet Gelirleri', 'I. ESAS FAALİYET GELİRLERİ']
  ]);
  const profitRow = findRowFlex(section.data, [
    'Ana Ortaklık Payları', 'Dönem Net Karı', 'Grubun Karı/Zararı',
    'NET DÖNEM KARI/ZARARI (XVII+XXII)', 'Dönem Net Kar/Zararı',
    'NET DÖNEM KARI (ZARARI)', 'NET DÖNEM KARI veya ZARARI',
    'Dönem Net Karı veya Zararı', 'Dönem Net Kar veya Zararı',
    'NET DÖNEM KARI VEYA ZARARI'
  ]);

  return periods.map((p) => ({
    label: formatPeriodLabel(p),
    revenue: val(revenueRow, p),
    netIncome: val(profitRow, p),
  }));
}

// ── Chart 2: Profitability Margins ───────────

export interface MarginPoint {
  label: string;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
}

export function deriveProfitabilityTrend(allFin: AllFinancialsResponse, quarterly: boolean): MarginPoint[] {
  const section = allFin.income_stmt;
  const periods = quarterly ? section.periods : getYearlyPeriods(section.periods);
  
  const revenueRow = sumRowsFlex(section.data, [
    ['Satış Gelirleri', 'Hasılat'],
    ['Faiz Gelirleri', 'Faiz Geliri'],
    ['Hayat Dışı Teknik Gelir', 'A- Hayat Dışı Teknik Gelir'],
    ['Hayat Teknik Gelir', 'D- Hayat Teknik Gelir'],
    ['Emeklilik Teknik Gelir', 'G- Emeklilik Teknik Gelir'],
    ['Esas Faaliyet Gelirleri', 'I. ESAS FAALİYET GELİRLERİ']
  ]);
  
  const grossRow = findRowFlex(section.data, [
    'BRÜT KAR (ZARAR)', 'Brüt Kar (Zarar)',
    'NET FAİZ GELİRİ/GİDERİ (I - II)', 'Net Faiz Geliri',
    'Genel Teknik Bölüm Dengesi', 'J- Genel Teknik Bölüm Dengesi',
    'NET FAALİYET K/Z', 'NET FAALİYET KARI (ZARARI)', 'Net Faaliyet Karı (Zararı)', 'VII. NET FAALİYET K/Z'
  ]);
  
  const opRow = findRowFlex(section.data, [
    'FAALİYET KARI (ZARARI)', 'Faaliyet Karı (Zararı)',
    'NET FAALİYET KARI/ZARARI (VIII-IX-X)', 'Faaliyet Karı',
    'Genel Teknik Bölüm Dengesi', 'J- Genel Teknik Bölüm Dengesi',
    'NET FAALİYET K/Z', 'NET FAALİYET KARI (ZARARI)', 'Net Faaliyet Karı (Zararı)', 'VII. NET FAALİYET K/Z'
  ]);
  
  const netRow = findRowFlex(section.data, [
    'Ana Ortaklık Payları', 'Dönem Net Karı', 'Grubun Karı/Zararı',
    'NET DÖNEM KARI/ZARARI (XVII+XXII)', 'Dönem Net Kar/Zararı',
    'NET DÖNEM KARI (ZARARI)', 'NET DÖNEM KARI veya ZARARI',
    'Dönem Net Karı veya Zararı', 'Dönem Net Kar veya Zararı',
    'NET DÖNEM KARI VEYA ZARARI'
  ]);

  return periods.map((p) => {
    const rev = val(revenueRow, p);
    const g = val(grossRow, p);
    const o = val(opRow, p);
    const n = val(netRow, p);
    return {
      label: formatPeriodLabel(p),
      grossMargin: rev != null && rev !== 0 && g != null ? (g / rev) * 100 : null,
      operatingMargin: rev != null && rev !== 0 && o != null ? (o / rev) * 100 : null,
      netMargin: rev != null && rev !== 0 && n != null ? (n / rev) * 100 : null,
    };
  });
}

// ── Chart 3: Balance Sheet Composition ───────

export interface BalanceSheetPoint {
  label: string;
  currentAssets: number | null;
  nonCurrentAssets: number | null;
  shortTermLiab: number | null;
  longTermLiab: number | null;
  equity: number | null;
}

export function deriveBalanceSheetTrend(allFin: AllFinancialsResponse, quarterly: boolean): BalanceSheetPoint[] {
  const section = allFin.balance_sheet;
  const periods = quarterly ? section.periods : getYearlyPeriods(section.periods);
  const ca = findRowFlex(section.data, ['Dönen Varlıklar']);
  const nca = findRowFlex(section.data, ['Duran Varlıklar']);
  const stl = findRowFlex(section.data, ['Kısa Vadeli Yükümlülükler']);
  const ltl = findRowFlex(section.data, ['Uzun Vadeli Yükümlülükler']);
  const eq = findRowFlex(section.data, [
    'Özkaynaklar', 'Özsermaye', 'Özsermaye Toplamı', 'Ana Ortaklığa Ait Özkaynaklar',
    'ÖZ KAYNAKLAR', 'Özkaynaklar Toplamı'
  ]);

  return periods.map((p) => ({
    label: formatPeriodLabel(p),
    currentAssets: val(ca, p),
    nonCurrentAssets: val(nca, p),
    shortTermLiab: val(stl, p),
    longTermLiab: val(ltl, p),
    equity: val(eq, p),
  }));
}

// ── Chart 4: Cash Flow ───────────────────────

export interface CashFlowPoint {
  label: string;
  operating: number | null;
  investing: number | null;
  financing: number | null;
  freeCashFlow: number | null;
}

export function deriveCashFlowTrend(allFin: AllFinancialsResponse, quarterly: boolean): CashFlowPoint[] {
  const section = allFin.cashflow;
  const periods = quarterly ? section.periods : getYearlyPeriods(section.periods);
  const opRow = findRowFlex(section.data, ['İşletme Faaliyetlerinden Kaynaklanan Net Nakit']);
  const invRow = findRowFlex(section.data, ['Yatırım Faaliyetlerinden Kaynaklanan Nakit']);
  const finRow = findRowFlex(section.data, ['Finansman Faaliyetlerden Kaynaklanan Nakit']);
  const fcfRow = findRowFlex(section.data, ['Serbest Nakit Akım']);

  return periods.map((p) => ({
    label: formatPeriodLabel(p),
    operating: val(opRow, p),
    investing: val(invRow, p),
    financing: val(finRow, p),
    freeCashFlow: val(fcfRow, p),
  }));
}

// ── Historical P/E Valuation Bands ───────────

export interface PEBandsResult {
  dates: string[];
  minBand: (number | null)[];
  avgBand: (number | null)[];
  maxBand: (number | null)[];
  peMin: number;
  peAvg: number;
  peMax: number;
  currentPe: number | null;
}

export function getLatestActivePeriod(dateStr: string, availablePeriods: string[]): string | null {
  if (availablePeriods.length === 0) return null;
  
  const partsStr = dateStr.split('-');
  if (partsStr.length !== 3) return null;
  const year = parseInt(partsStr[0]);
  const month = parseInt(partsStr[1]);
  const day = parseInt(partsStr[2]);
  
  const currentDateInt = year * 10000 + month * 100 + day;
  
  let bestPeriod: string | null = null;
  let bestActiveDateInt = -1;
  
  for (const p of availablePeriods) {
    const parts = p.split('/');
    if (parts.length !== 2) continue;
    const pYear = parseInt(parts[0]);
    const pMonth = parseInt(parts[1]);
    
    let activeDateInt = 0;
    if (pMonth === 3) {
      activeDateInt = pYear * 10000 + 601; // June 1
    } else if (pMonth === 6) {
      activeDateInt = pYear * 10000 + 901; // Sept 1
    } else if (pMonth === 9) {
      activeDateInt = pYear * 10000 + 1201; // Dec 1
    } else if (pMonth === 12) {
      activeDateInt = (pYear + 1) * 10000 + 315; // March 15 of next year
    } else {
      const days = pMonth === 12 ? 75 : 60;
      const targetMonth = (pMonth + Math.floor(days / 30)) % 12 || 12;
      const targetYear = pYear + (pMonth + Math.floor(days / 30) > 12 ? 1 : 0);
      activeDateInt = targetYear * 10000 + targetMonth * 100 + 15;
    }
    
    if (currentDateInt >= activeDateInt) {
      if (activeDateInt > bestActiveDateInt) {
        bestActiveDateInt = activeDateInt;
        bestPeriod = p;
      }
    }
  }
  
  if (bestPeriod === null) {
    const sorted = [...availablePeriods].sort((a, b) => {
      const partsA = a.split('/');
      const partsB = b.split('/');
      const valA = parseInt(partsA[0]) * 100 + parseInt(partsA[1]);
      const valB = parseInt(partsB[0]) * 100 + parseInt(partsB[1]);
      return valA - valB;
    });
    return sorted[0];
  }
  
  return bestPeriod;
}

export function computePEBands(
  ohlcv: OHLCVData[],
  allFin: AllFinancialsResponse
): PEBandsResult | null {
  if (ohlcv.length === 0 || !allFin.income_stmt?.periods?.length) return null;

  const periods = allFin.income_stmt.periods;
  
  const netIncomeRow = findRowFlex(allFin.income_stmt.data, [
    'Ana Ortaklık Payları', 'Dönem Net Karı', 'Grubun Karı/Zararı',
    'NET DÖNEM KARI/ZARARI (XVII+XXII)', 'Dönem Net Kar/Zararı',
    'NET DÖNEM KARI (ZARARI)', 'NET DÖNEM KARI veya ZARARI',
    'Dönem Net Karı veya Zararı', 'Dönem Net Kar veya Zararı',
    'NET DÖNEM KARI VEYA ZARARI'
  ]);
  
  const paidInCapitalRow = findRowFlex(allFin.balance_sheet.data, [
    'Ödenmiş Sermaye', 'Ödenmiş Sermaye (Nominal)', 'A- Ödenmiş Sermaye', '13.1 Ödenmiş Sermaye'
  ]);

  if (!netIncomeRow || !paidInCapitalRow) return null;

  const epsMap = new Map<string, number>();
  
  periods.forEach((p) => {
    const netIncome = getTTMValueForRow(netIncomeRow, p, periods);
    const paidInCapital = val(paidInCapitalRow, p);
    
    if (netIncome !== null && paidInCapital !== null && paidInCapital !== 0) {
      const eps = netIncome / paidInCapital;
      epsMap.set(p, eps);
    }
  });

  const dailyEps: number[] = new Array(ohlcv.length).fill(0);
  const dailyPeList: number[] = [];
  
  for (let i = 0; i < ohlcv.length; i++) {
    const bar = ohlcv[i];
    const p = getLatestActivePeriod(bar.date, periods);
    const eps = p ? epsMap.get(p) : null;
    
    if (eps !== null && eps !== undefined) {
      dailyEps[i] = eps;
      const fiveYearsAgo = new Date();
      fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
      const barDate = new Date(bar.date);
      
      if (barDate >= fiveYearsAgo && eps > 0 && bar.close > 0) {
        dailyPeList.push(bar.close / eps);
      }
    } else {
      dailyEps[i] = 0;
    }
  }

  if (dailyPeList.length === 0) return null;

  dailyPeList.sort((a, b) => a - b);
  
  const getPercentile = (arr: number[], pct: number): number => {
    const idx = Math.floor(arr.length * pct);
    return arr[Math.min(idx, arr.length - 1)];
  };

  const peMin = getPercentile(dailyPeList, 0.15); // 15th percentile
  const peAvg = getPercentile(dailyPeList, 0.50); // 50th percentile (median)
  const peMax = getPercentile(dailyPeList, 0.85); // 85th percentile

  const lastPrice = ohlcv[ohlcv.length - 1].close;
  const lastEps = dailyEps[dailyEps.length - 1];
  const currentPe = lastPrice > 0 && lastEps > 0 ? lastPrice / lastEps : null;

  const minBand: (number | null)[] = [];
  const avgBand: (number | null)[] = [];
  const maxBand: (number | null)[] = [];

  for (let i = 0; i < ohlcv.length; i++) {
    const eps = dailyEps[i];
    if (eps && eps > 0) {
      minBand.push(peMin * eps);
      avgBand.push(peAvg * eps);
      maxBand.push(peMax * eps);
    } else {
      minBand.push(null);
      avgBand.push(null);
      maxBand.push(null);
    }
  }

  return {
    dates: ohlcv.map(d => d.date),
    minBand,
    avgBand,
    maxBand,
    peMin,
    peAvg,
    peMax,
    currentPe
  };
}
