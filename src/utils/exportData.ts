import * as XLSX from 'xlsx';
import type { OHLCVData } from '../api/borsaApi';
import { computeWilliamsPasa, computeNizamiCedid } from './indicators';

interface ExportRow {
  Tarih: string;
  Acilis: number;
  Yuksek: number;
  Dusuk: number;
  Kapanis: number;
  Hacim: number;
  [key: string]: string | number | null;
}

function buildRows(data: OHLCVData[], includeIndicators: boolean): ExportRow[] {
  const rows: ExportRow[] = data.map((d) => ({
    Tarih: d.date,
    Acilis: d.open,
    Yuksek: d.high,
    Dusuk: d.low,
    Kapanis: d.close,
    Hacim: d.volume,
  }));

  if (!includeIndicators || data.length < 30) return rows;

  const highs = data.map((d) => d.high);
  const lows = data.map((d) => d.low);
  const closes = data.map((d) => d.close);
  const volumes = data.map((d) => d.volume);

  // Williams Paşa
  const wp = computeWilliamsPasa(highs, lows, closes);
  for (let i = 0; i < rows.length; i++) {
    rows[i]['WilliamsPasa_R'] = wp.percentR[i] ?? null;
    rows[i]['WilliamsPasa_EMA'] = wp.emaWil[i] ?? null;
  }

  // Nizami Cedid
  const nc = computeNizamiCedid(closes, volumes);
  for (let i = 0; i < rows.length; i++) {
    rows[i]['NizamiCedid_MACD'] = nc.macd[i] ?? null;
    rows[i]['NizamiCedid_Signal'] = nc.signal[i] ?? null;
    rows[i]['NizamiCedid_Delta'] = nc.delta[i] ?? null;
  }

  return rows;
}

export function exportCSV(data: OHLCVData[], symbol: string, includeIndicators: boolean): void {
  const rows = buildRows(data, includeIndicators);
  if (rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const bom = '\uFEFF';
  const lines = [
    headers.join(';'),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = row[h];
          if (val === null || val === undefined) return '';
          if (typeof val === 'number') return val.toString().replace('.', ',');
          return `"${String(val).replace(/"/g, '""')}"`;
        })
        .join(';'),
    ),
  ];

  const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const suffix = includeIndicators ? '-indikatorler' : '';
  a.download = `${symbol}${suffix}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportXLSX(data: OHLCVData[], symbol: string, includeIndicators: boolean): void {
  const rows = buildRows(data, includeIndicators);
  if (rows.length === 0) return;

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, symbol);
  const suffix = includeIndicators ? '-indikatorler' : '';
  XLSX.writeFile(wb, `${symbol}${suffix}.xlsx`);
}
