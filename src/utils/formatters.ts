export function formatPrice(price: number): string {
  if (price >= 10000) {
    return price.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return price.toFixed(2);
}

export function formatVolume(volume: number): string {
  if (volume === null || volume === undefined || isNaN(volume)) return '0';
  const isNegative = volume < 0;
  const absVolume = Math.abs(volume);
  
  let formatted = '';
  if (absVolume >= 1_000_000_000) {
    formatted = (absVolume / 1_000_000_000).toFixed(2) + 'B';
  } else if (absVolume >= 1_000_000) {
    formatted = (absVolume / 1_000_000).toFixed(2) + 'M';
  } else if (absVolume >= 1_000) {
    formatted = (absVolume / 1_000).toFixed(1) + 'K';
  } else {
    formatted = Number.isInteger(absVolume) ? absVolume.toString() : absVolume.toFixed(2);
  }
  
  return isNegative ? '-' + formatted : formatted;
}

export function formatChange(current: number, previous: number): { value: string; percent: string; positive: boolean } {
  const diff = current - previous;
  const percent = previous !== 0 ? (diff / previous) * 100 : 0;
  const positive = diff >= 0;
  return {
    value: (positive ? '+' : '') + formatPrice(diff),
    percent: (positive ? '+' : '') + percent.toFixed(2) + '%',
    positive,
  };
}
