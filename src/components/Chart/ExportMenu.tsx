import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { OHLCVData } from '../../api/borsaApi';
import { exportCSV, exportXLSX } from '../../utils/exportData';
import './ExportMenu.css';

interface ExportMenuProps {
  data: OHLCVData[];
  symbol: string;
}

export default function ExportMenu({ data, symbol }: ExportMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handle = (fn: () => void) => {
    fn();
    setOpen(false);
  };

  if (data.length === 0) return null;

  return (
    <div className="export-menu-wrapper" ref={ref}>
      <button className="export-trigger-btn" onClick={() => setOpen((v) => !v)} title="Veri Aktar">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        {t('export.export')}
      </button>

      {open && (
        <div className="export-dropdown">
          <button className="export-option" onClick={() => handle(() => exportCSV(data, symbol, false))}>
            {t('export.csvOhlcv')}
            <span className="export-option-desc">{t('export.csvOhlcvDesc')}</span>
          </button>
          <button className="export-option" onClick={() => handle(() => exportCSV(data, symbol, true))}>
            {t('export.csvAll')}
            <span className="export-option-desc">{t('export.csvAllDesc')}</span>
          </button>
          <button className="export-option" onClick={() => handle(() => exportXLSX(data, symbol, false))}>
            {t('export.excelOhlcv')}
            <span className="export-option-desc">{t('export.excelOhlcvDesc')}</span>
          </button>
          <button className="export-option" onClick={() => handle(() => exportXLSX(data, symbol, true))}>
            {t('export.excelAll')}
            <span className="export-option-desc">{t('export.excelAllDesc')}</span>
          </button>
          <button className="export-option" onClick={() => handle(() => window.dispatchEvent(new CustomEvent('temist-export-chart-png')))}>
            {t('export.png')}
            <span className="export-option-desc">{t('export.pngDesc')}</span>
          </button>
        </div>
      )}
    </div>
  );
}
