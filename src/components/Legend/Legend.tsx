import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LegendData } from '../Chart/types';
import { formatPrice, formatVolume, formatChange } from '../../utils/formatters';
import './Legend.css';

interface LegendProps {
  data: LegendData | null;
  symbol: string;
  lastClose: number;
  prevClose: number;
  lastVolume?: number;
}

const Legend = memo(function Legend({ data, symbol, lastClose, prevClose, lastVolume = 0 }: LegendProps) {
  const { t } = useTranslation();
  const displayData = data ?? {
    symbol,
    open: lastClose,
    high: lastClose,
    low: lastClose,
    close: lastClose,
    volume: lastVolume,
    time: '',
    prevClose,
  };

  const change = formatChange(displayData.close, displayData.prevClose || prevClose);

  return (
    <div className="legend">
      <div className="legend-row">
        <span className="legend-symbol">{displayData.symbol}</span>
        <span className={`legend-change ${change.positive ? 'positive' : 'negative'}`}>
          {change.value} ({change.percent})
        </span>
      </div>
      <div className="legend-row">
        <span className="legend-label">{t('legend.open')}</span>
        <span className="legend-value">{formatPrice(displayData.open)}</span>
        <span className="legend-label">{t('legend.high')}</span>
        <span className="legend-value">{formatPrice(displayData.high)}</span>
        <span className="legend-label">{t('legend.low')}</span>
        <span className="legend-value">{formatPrice(displayData.low)}</span>
        <span className="legend-label">{t('legend.close')}</span>
        <span className={`legend-value ${displayData.close >= displayData.open ? 'positive' : 'negative'}`}>
          {formatPrice(displayData.close)}
        </span>
        <span className="legend-label">{t('legend.volume')}</span>
        <span className="legend-value">{formatVolume(displayData.volume)}</span>
      </div>
    </div>
  );
});

export default Legend;
