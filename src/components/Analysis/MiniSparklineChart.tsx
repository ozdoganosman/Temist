import type { OHLCVData } from '../../api/borsaApi';

interface Props {
  historyData: OHLCVData[];
}

export default function MiniSparklineChart({ historyData }: Props) {
  if (!historyData || historyData.length === 0) {
    return (
      <div className="sparkline-placeholder" style={{ height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '12px', background: '#161820', borderRadius: '10px' }}>
        Geçmiş veri yüklenemedi.
      </div>
    );
  }

  // Get last 30 data points (or all if less than 30)
  const data = historyData.slice(-30);
  const prices = data.map((d) => d.close);
  const volumes = data.map((d) => d.volume);

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;

  const minVolume = Math.min(...volumes);
  const maxVolume = Math.max(...volumes);
  const volumeRange = maxVolume - minVolume || 1;

  // Chart dimensions
  const width = 360;
  const height = 120;
  const padding = 6;
  const chartHeight = height - padding * 2;
  const chartWidth = width;

  // Coordinates mapping
  const points = prices.map((price, idx) => {
    const x = (idx / (prices.length - 1)) * chartWidth;
    // Map price to height (Y is inverted in SVG, Y=0 is top)
    const y = padding + (1 - (price - minPrice) / priceRange) * chartHeight;
    return { x, y };
  });

  const pathD = points.reduce((acc, p, idx) => {
    if (idx === 0) return `M ${p.x} ${p.y}`;
    // Draw smooth cubic curves
    const prev = points[idx - 1];
    const cpX1 = prev.x + (p.x - prev.x) / 3;
    const cpY1 = prev.y;
    const cpX2 = prev.x + (2 * (p.x - prev.x)) / 3;
    const cpY2 = p.y;
    return `${acc} C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${p.x} ${p.y}`;
  }, '');

  // Close the area path for the gradient fill
  const areaD = `${pathD} L ${chartWidth} ${height} L 0 ${height} Z`;

  // Color theme: green for positive return over 30 days, red for negative
  const isUp = prices[prices.length - 1] >= prices[0];
  const strokeColor = isUp ? '#10b981' : '#ef4444';
  const fillGradientId = `sparkline-grad-${isUp ? 'up' : 'down'}`;

  // Volume bar mapping
  const volumeBars = volumes.map((volume, idx) => {
    const barWidth = Math.max(2, chartWidth / volumes.length - 2);
    const x = (idx / volumes.length) * chartWidth + 1;
    const barHeight = ((volume - minVolume) / volumeRange) * 30 + 4; // max 30px height, min 4px height
    const y = height - barHeight;
    return { x, y, width: barWidth, height: barHeight };
  });

  const firstPrice = prices[0];
  const lastPrice = prices[prices.length - 1];
  const totalChange = ((lastPrice - firstPrice) / firstPrice) * 100;

  return (
    <div className="mini-sparkline-container" style={{ background: '#161820', borderRadius: '10px', padding: '12px', border: '1px solid var(--border-primary)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div className="sparkline-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
        <span style={{ fontWeight: 600 }}>SON 30 GÜNLÜK TREND (GÜNLÜK)</span>
        <span style={{ color: strokeColor, fontWeight: 700, fontFamily: 'monospace' }}>
          {totalChange >= 0 ? '+' : ''}{totalChange.toFixed(1)}%
        </span>
      </div>

      <div style={{ position: 'relative', width: '100%', height: `${height}px` }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id={fillGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.25" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Volume Bars at the bottom */}
          {volumeBars.map((bar, idx) => (
            <rect
              key={idx}
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              fill={strokeColor}
              opacity="0.10"
              rx="1"
            />
          ))}

          {/* Area Fill */}
          <path d={areaD} fill={`url(#${fillGradientId})`} />

          {/* Sparkline Line */}
          <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />

          {/* Start and End dots */}
          {points.length > 0 && (
            <>
              <circle cx={points[0].x} cy={points[0].y} r="3.5" fill={strokeColor} />
              <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="4.5" fill="#ffffff" stroke={strokeColor} strokeWidth="2" />
            </>
          )}
        </svg>
      </div>

      <div className="sparkline-footer" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
        <span>Min: {minPrice.toFixed(2)} ₺</span>
        <span>Max: {maxPrice.toFixed(2)} ₺</span>
      </div>
    </div>
  );
}
