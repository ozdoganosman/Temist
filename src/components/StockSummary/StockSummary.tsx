import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { OHLCVData } from '../../api/borsaApi';
import { formatPrice, formatVolume, formatChange } from '../../utils/formatters';
import './StockSummary.css';

interface StockSummaryProps {
  symbol: string;
  displayName: string;
  data: OHLCVData[];
}

const StockSummary = memo(function StockSummary({ symbol, displayName, data }: StockSummaryProps) {
  const { t } = useTranslation();

  const stats = useMemo(() => {
    if (data.length === 0) return null;
    const last = data[data.length - 1];
    const prev = data.length > 1 ? data[data.length - 2] : last;
    const change = formatChange(last.close, prev.close);

    const start252 = Math.max(0, data.length - 252);
    let high52w = -Infinity, low52w = Infinity;
    for (let i = start252; i < data.length; i++) {
      if (data[i].high > high52w) high52w = data[i].high;
      if (data[i].low < low52w) low52w = data[i].low;
    }

    const start20 = Math.max(0, data.length - 20);
    let volSum = 0;
    const volCount = data.length - start20;
    for (let i = start20; i < data.length; i++) volSum += data[i].volume;
    const avgVol20 = volSum / volCount;

    return { last, change, high52w, low52w, avgVol20 };
  }, [data]);

  if (!stats) return null;
  const { last, change, high52w, low52w, avgVol20 } = stats;

  return (
    <div className="stock-summary">
      <div className="ss-header">
        <span className="ss-symbol">{symbol}</span>
        <span className="ss-name">{displayName}</span>
      </div>
      <div className="ss-grid">
        <div className="ss-item">
          <span className="ss-label">{t('stockSummary.lastPrice')}</span>
          <span className={`ss-value ${change.positive ? 'positive' : 'negative'}`}>{formatPrice(last.close)}</span>
        </div>
        <div className="ss-item">
          <span className="ss-label">{t('stockSummary.change')}</span>
          <span className={`ss-value ${change.positive ? 'positive' : 'negative'}`}>
            {change.value} ({change.percent})
          </span>
        </div>
        <div className="ss-item">
          <span className="ss-label">{t('stockSummary.volume')}</span>
          <span className="ss-value">{formatVolume(last.volume)}</span>
        </div>
        <div className="ss-item">
          <span className="ss-label">{t('stockSummary.avgVolume20')}</span>
          <span className="ss-value">{formatVolume(avgVol20)}</span>
        </div>
        <div className="ss-item">
          <span className="ss-label">{t('stockSummary.high52w')}</span>
          <span className="ss-value">{formatPrice(high52w)}</span>
        </div>
        <div className="ss-item">
          <span className="ss-label">{t('stockSummary.low52w')}</span>
          <span className="ss-value">{formatPrice(low52w)}</span>
        </div>
      </div>
    </div>
  );
});

export default StockSummary;
