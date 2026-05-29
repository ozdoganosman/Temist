/**
 * Pure functions for computing financial KPIs and chart data series
 * from AllFinancialsResponse + OHLCV price data.
 */
import type { AllFinancialsResponse, FinancialRow } from '../api/borsaApi';
import type { OHLCVData } from '../api/borsaApi';

// ── Helpers ──────────────────────────────────

function findRow(data: FinancialRow[], itemName: string): FinancialRow | undefined {
  return data.find((r) => r.item === itemName);
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

function getTTMValue(data: FinancialRow[], itemName: string, currentPeriod: string, periods: string[]): number | null {
  const row = findRow(data, itemName);
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

export function computeKPIs(allFin: AllFinancialsResponse, ohlcvData: OHLCVData[]): FinancialKPIs {
  const periods = allFin.income_stmt.periods;
  const latestPeriod = periods.length > 0 ? periods[periods.length - 1] : null;
  if (!latestPeriod) return NULL_KPIS;

  const lastPrice = ohlcvData.length > 0 ? ohlcvData[ohlcvData.length - 1].close : null;

  // Use TTM values for income statement metrics (revenue, gross profit, net income)
  const revenue = getTTMValue(allFin.income_stmt.data, 'Satış Gelirleri', latestPeriod, periods);
  const grossProfit = getTTMValue(allFin.income_stmt.data, 'BRÜT KAR (ZARAR)', latestPeriod, periods);
  const netIncome = getTTMValue(allFin.income_stmt.data, 'Ana Ortaklık Payları', latestPeriod, periods);

  // Balance sheet uses the latest balance sheet period directly (point-in-time snapshot)
  const bsPeriods = allFin.balance_sheet.periods;
  const bsPeriod = bsPeriods.length > 0 ? bsPeriods[bsPeriods.length - 1] : null;

  const equity = bsPeriod ? val(findRow(allFin.balance_sheet.data, 'Özkaynaklar'), bsPeriod) : null;
  const paidInCapital = bsPeriod ? val(findRow(allFin.balance_sheet.data, 'Ödenmiş Sermaye'), bsPeriod) : null;
  const shortTermDebt = bsPeriod
    ? val(findRow(allFin.balance_sheet.data, 'Kısa Vadeli Yükümlülükler'), bsPeriod)
    : null;
  const longTermDebt = bsPeriod ? val(findRow(allFin.balance_sheet.data, 'Uzun Vadeli Yükümlülükler'), bsPeriod) : null;

  // Shares outstanding = Ödenmiş Sermaye (BIST nominal = 1 TL)
  const shares = paidInCapital;
  const marketCap = lastPrice != null && shares != null ? lastPrice * shares : null;
  const eps = netIncome != null && shares != null && shares !== 0 ? netIncome / shares : null;

  const fk = lastPrice != null && eps != null && eps !== 0 ? lastPrice / eps : null;
  const pddd = marketCap != null && equity != null && equity !== 0 ? marketCap / equity : null;
  const netKarMarji = netIncome != null && revenue != null && revenue !== 0 ? (netIncome / revenue) * 100 : null;
  const brutKarMarji = grossProfit != null && revenue != null && revenue !== 0 ? (grossProfit / revenue) * 100 : null;
  const roe = netIncome != null && equity != null && equity !== 0 ? (netIncome / equity) * 100 : null;
  const totalDebt = (shortTermDebt ?? 0) + (longTermDebt ?? 0);
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
  const revenueRow = findRow(section.data, 'Satış Gelirleri');
  const profitRow = findRow(section.data, 'Ana Ortaklık Payları');

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
  const revenueRow = findRow(section.data, 'Satış Gelirleri');
  const grossRow = findRow(section.data, 'BRÜT KAR (ZARAR)');
  const opRow = findRow(section.data, 'FAALİYET KARI (ZARARI)');
  const netRow = findRow(section.data, 'Ana Ortaklık Payları');

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
  const ca = findRow(section.data, 'Dönen Varlıklar');
  const nca = findRow(section.data, 'Duran Varlıklar');
  const stl = findRow(section.data, 'Kısa Vadeli Yükümlülükler');
  const ltl = findRow(section.data, 'Uzun Vadeli Yükümlülükler');
  const eq = findRow(section.data, 'Özkaynaklar');

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
  const opRow = findRow(section.data, 'İşletme Faaliyetlerinden Kaynaklanan Net Nakit');
  const invRow = findRow(section.data, 'Yatırım Faaliyetlerinden Kaynaklanan Nakit');
  const finRow = findRow(section.data, 'Finansman Faaliyetlerden Kaynaklanan Nakit');
  const fcfRow = findRow(section.data, 'Serbest Nakit Akım');

  return periods.map((p) => ({
    label: formatPeriodLabel(p),
    operating: val(opRow, p),
    investing: val(invRow, p),
    financing: val(finRow, p),
    freeCashFlow: val(fcfRow, p),
  }));
}
