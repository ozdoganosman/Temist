import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as echarts from 'echarts';
import type { Interval, LegendData, ActiveDrawingTool, ChartDrawing } from './types';
import type { OHLCVData, AllFinancialsResponse } from '../../api/borsaApi';
import { fetchAllFinancials } from '../../api/borsaApi';
import type { BollingerOverlayResult } from '../../utils/regressionChannels';
import { computeAllBollingerOverlays, DEFAULT_BOLLINGER_CONFIGS } from '../../utils/regressionChannels';
import {
  computeCombinedSignals,
  extractCombinedSignalEvents,
  DEFAULT_SIGNAL_CONFIG,
} from '../../utils/signalDetection';
import type { SignalConfig, SignalEvent } from '../../utils/signalDetection';
import { isIntraday } from './types';
import { buildOption, getThemeColors, getPaddingCount, getGridMargins, getPanelTitleHTML } from './chartBuilder';
import type { ComputedIndicators } from './chartBuilder';
import { buildSignalScatterSeries } from './signalRenderer';
import {
  computeRSI,
  computeMACD,
  computeStochRSI,
  computeOBV,
  computeSuperTrend,
  computeIchimoku,
  computeWilliamsPasa,
  computeNizamiCedid,
  computeBollingerBands,
  computeCMF,
  ema,
} from '../../utils/indicators';
import { computeAllPearsonChannels } from '../../utils/pearsonChannels';
import { formatVolume } from '../../utils/formatters';
import { useTheme } from '../../contexts/ThemeContext';
import DrawingToolbar from './DrawingToolbar';
import './ChartContainer.css';

// Keep import reference for future use (signal scatter is already called inside buildOption)
void buildSignalScatterSeries;

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function calculateEMARibbonLast(closes: number[]): { spread: number; score: number; signal: 'bullish' | 'bearish' | 'neutral' } {
  const n = closes.length;
  const periods = [8, 13, 21, 34, 55, 89, 144, 233, 377, 610].filter(p => n >= p);
  if (periods.length < 2) {
    return { spread: 0, score: 10, signal: 'neutral' };
  }

  const closesN = closes as (number | null)[];
  const emas = periods.map(p => ema(closesN, p));
  const lastIdx = n - 1;

  let sumClamped = 0;
  let validPairs = 0;
  const spreadMultiplier = 0.003;

  for (let j = 0; j < periods.length - 1; j++) {
    const emaCurr = emas[j][lastIdx];
    const emaNext = emas[j + 1][lastIdx];
    if (emaCurr !== null && emaNext !== null && emaNext !== 0) {
      const diffRatio = (emaCurr - emaNext) / emaNext;
      const clamped = clamp(diffRatio / spreadMultiplier, -1, 1);
      sumClamped += clamped;
      validPairs++;
    }
  }

  const avgSpread = validPairs > 0 ? sumClamped / validPairs : 0;
  const score = ((avgSpread + 1) / 2) * 20;

  let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (avgSpread > 0.2) signal = 'bullish';
  else if (avgSpread < -0.2) signal = 'bearish';

  return { spread: avgSpread, score: Math.round(score), signal };
}

interface ChartContainerProps {
  data: OHLCVData[];
  symbol: string;
  interval: Interval;
  onLegendUpdate: (data: LegendData | null) => void;
  showBollinger?: boolean;
  showRSI?: boolean;
  showMACD?: boolean;
  showStochRSI?: boolean;
  showSuperTrend?: boolean;
  showIchimoku?: boolean;
  showOBV?: boolean;
  showWilliamsPasa?: boolean;
  showNizamiCedid?: boolean;
  showEMAOverlay?: boolean;
  showPearsonChannels?: boolean;
  showCMF?: boolean;
  showSignals?: boolean;
  signalConfig?: SignalConfig;
  logScale?: boolean;
  showCommentary?: boolean;
}

export default function ChartContainer({
  data,
  symbol,
  interval,
  onLegendUpdate,
  showBollinger = false,
  showRSI = false,
  showMACD = false,
  showStochRSI = false,
  showSuperTrend = false,
  showIchimoku = false,
  showOBV = false,
  showWilliamsPasa = false,
  showNizamiCedid = false,
  showEMAOverlay = false,
  showPearsonChannels = false,
  showCMF = false,
  showSignals = false,
  signalConfig,
  logScale = false,
  showCommentary = true,
}: ChartContainerProps) {
  const { theme } = useTheme();
  const filtered = data;
  const containerRef = useRef<HTMLDivElement>(null);
  const measureOverlayRef = useRef<HTMLDivElement>(null);
  const measureBadgeRef = useRef<HTMLDivElement>(null);
  const [commentaryOpen, setCommentaryOpen] = useState(() => {
    return localStorage.getItem('temist_chart_commentary_open') !== 'false';
  });

  useEffect(() => {
    localStorage.setItem('temist_chart_commentary_open', String(commentaryOpen));
  }, [commentaryOpen]);

  // ── Commentary generation ──
  const commentaries = useMemo(() => {
    const items: Array<{
      title: string;
      valueText: string;
      signal: 'bullish' | 'bearish' | 'neutral';
      comment: string;
    }> = [];

    if (filtered.length < 10) return items;

    const highs = filtered.map((d) => d.high);
    const lows = filtered.map((d) => d.low);
    const closes = filtered.map((d) => d.close);
    const volumes = filtered.map((d) => d.volume);
    const n = closes.length;
    const lastPrice = closes[n - 1];

    // 1. Bollinger Bands
    if (showBollinger && n >= 20) {
      const bb = computeBollingerBands(closes);
      const upper = bb.upper[n - 1];
      const middle = bb.middle[n - 1];
      const lower = bb.lower[n - 1];
      const pctB = bb.pctB[n - 1];

      if (upper !== null && lower !== null && pctB !== null) {
        let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
        let comment = '';
        if (pctB > 1.0) {
          signal = 'bearish';
          comment = `Fiyat Bollinger üst bandının (${upper.toFixed(2)}) dışına taşmış durumda. Bu güçlü bir yükseliş ivmesi veya kısa vadeli aşırı alım (düzeltme riski) işareti olabilir.`;
        } else if (pctB < 0.0) {
          signal = 'bullish';
          comment = `Fiyat Bollinger alt bandının (${lower.toFixed(2)}) altına sarkmış durumda. Kısa vadeli tepki yükselişi olasılığı bulunan bir aşırı satım bölgesidir.`;
        } else if (pctB >= 0.8) {
          signal = 'bullish';
          comment = `Fiyat üst banda yakın seyrediyor. Yükseliş yönlü ivme güçlü şekilde korunmaktadır (Pozisyon: %${(pctB * 100).toFixed(0)}).`;
        } else if (pctB <= 0.2) {
          signal = 'bearish';
          comment = `Fiyat alt banda yakın seyrediyor. Satıcıların baskısı devam etmektedir (Pozisyon: %${(pctB * 100).toFixed(0)}).`;
        } else {
          signal = 'neutral';
          comment = `Fiyat Bollinger orta bandının (${middle?.toFixed(2)}) çevresinde dengeli ve yatay bir seyir izlemektedir.`;
        }
        items.push({
          title: 'Bollinger Bantları',
          valueText: `Fiyat: ${lastPrice.toFixed(2)}`,
          signal,
          comment,
        });
      }
    }

    // 2. RSI
    if (showRSI && n >= 15) {
      const rsiRes = computeRSI(closes, 14);
      const rsiVal = rsiRes.rsi[n - 1];
      if (rsiVal !== null) {
        let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
        let comment = '';
        if (rsiVal > 70) {
          signal = 'bearish';
          comment = `RSI aşırı alım bölgesinde (${rsiVal.toFixed(1)}). Fiyatta yorulma belirtileri ve kısa vadeli bir düzeltme (kar satışı) beklenebilir.`;
        } else if (rsiVal < 30) {
          signal = 'bullish';
          comment = `RSI aşırı satım bölgesinde (${rsiVal.toFixed(1)}). Buradan tepki alımları veya yukarı yönlü bir dönüş hareketi gelebilir.`;
        } else {
          signal = 'neutral';
          comment = `RSI nötr bölgede (${rsiVal.toFixed(1)}). Aşırı alım veya satım sinyali bulunmuyor, trend dengeli seyretmektedir.`;
        }
        items.push({
          title: 'RSI (14)',
          valueText: `Değer: ${rsiVal.toFixed(1)}`,
          signal,
          comment,
        });
      }
    }

    // 3. MACD
    if (showMACD && n >= 26) {
      const macdRes = computeMACD(closes);
      const mVal = macdRes.macd[n - 1];
      const sVal = macdRes.signal[n - 1];
      if (mVal !== null && sVal !== null) {
        const signal = mVal > sVal ? 'bullish' : 'bearish';
        const comment = mVal > sVal
          ? `MACD çizgisi (${mVal.toFixed(2)}) sinyal çizgisinin (${sVal.toFixed(2)}) üzerinde seyrediyor. Yükseliş ivmesi ve alım iştahı artmaktadır.`
          : `MACD çizgisi (${mVal.toFixed(2)}) sinyal çizgisinin (${sVal.toFixed(2)}) altında seyrediyor. Satış baskısı ve aşağı yönlü momentum korunmaktadır.`;
        items.push({
          title: 'MACD (12/26)',
          valueText: `Hist: ${(mVal - sVal).toFixed(2)}`,
          signal,
          comment,
        });
      }
    }

    // 4. Stochastic RSI
    if (showStochRSI && n >= 28) {
      const stochRes = computeStochRSI(closes);
      const kVal = stochRes.k[n - 1];
      const dVal = stochRes.d[n - 1];
      if (kVal !== null && dVal !== null) {
        let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
        let comment = '';
        if (kVal > 80) {
          signal = 'bearish';
          comment = `StochRSI aşırı alım bölgesinde (%${kVal.toFixed(0)}). Kısa vadede ivme kaybı ve dönüş riski mevcuttur.`;
        } else if (kVal < 20) {
          signal = 'bullish';
          comment = `StochRSI aşırı satım bölgesinde (%${kVal.toFixed(0)}). Kısa vadeli tepki alımları için elverişli bir seviyededir.`;
        } else if (kVal > dVal) {
          signal = 'bullish';
          comment = `StochRSI K çizgisi D çizgisinin üzerinde seyrediyor (%${kVal.toFixed(0)} > %${dVal.toFixed(0)}). Yükseliş yönlü toparlanma eğilimi mevcuttur.`;
        } else {
          signal = 'bearish';
          comment = `StochRSI K çizgisi D çizgisinin altında seyrediyor (%${kVal.toFixed(0)} < %${dVal.toFixed(0)}). Satış baskısı devam ediyor.`;
        }
        items.push({
          title: 'Stochastic RSI',
          valueText: `K: %${kVal.toFixed(0)}`,
          signal,
          comment,
        });
      }
    }

    // 5. SuperTrend
    if (showSuperTrend && n >= 11) {
      const stRes = computeSuperTrend(highs, lows, closes);
      const stVal = stRes.supertrend[n - 1];
      const dirVal = stRes.direction[n - 1];
      if (stVal !== null && dirVal !== null) {
        const signal = dirVal === 1 ? 'bullish' : 'bearish';
        const comment = dirVal === 1
          ? `SuperTrend alım (Bullish) sinyali üretiyor. Trend yönü yukarıdır ve destek seviyesi ${stVal.toFixed(2)} olarak takip edilebilir.`
          : `SuperTrend satım (Bearish) sinyali üretiyor. Trend yönü aşağıdır ve direnç seviyesi ${stVal.toFixed(2)} olarak takip edilebilir.`;
        items.push({
          title: 'SuperTrend',
          valueText: signal === 'bullish' ? 'AL' : 'SAT',
          signal,
          comment,
        });
      }
    }

    // 6. Ichimoku Cloud
    if (showIchimoku && n >= 52) {
      const ichRes = computeIchimoku(highs, lows, closes);
      const tenkanVal = ichRes.tenkan[n - 1];
      const kijunVal = ichRes.kijun[n - 1];
      const senkouAVal = ichRes.senkouA[n - 1];
      const senkouBVal = ichRes.senkouB[n - 1];

      if (tenkanVal !== null && kijunVal !== null && senkouAVal !== null && senkouBVal !== null) {
        let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
        let comment = '';
        if (lastPrice > senkouAVal && lastPrice > senkouBVal) {
          signal = 'bullish';
          comment = `Fiyat bulutun (Kumo) üzerinde seyrediyor. Bu orta-uzun vadede güçlü yükseliş trendini destekler. Tenkan-sen: ${tenkanVal.toFixed(2)}, Kijun-sen: ${kijunVal.toFixed(2)}.`;
        } else if (lastPrice < senkouAVal && lastPrice < senkouBVal) {
          signal = 'bearish';
          comment = `Fiyat bulutun (Kumo) altında seyrediyor. Orta-uzun vadeli düşüş trendinin sürdüğünü teyit eder.`;
        } else if (tenkanVal > kijunVal) {
          signal = 'bullish';
          comment = `Kısa vadeli Tenkan-sen çizgisi uzun vadeli Kijun-sen çizgisini yukarı yönlü kesmiş durumda. Fiyat bulut içinde yön aramaktadır.`;
        } else {
          signal = 'neutral';
          comment = `Fiyat bulutun (Kumo) içinde seyrediyor, kararsız ve konsolidasyon (yatay) aşaması devam etmektedir.`;
        }
        items.push({
          title: 'Ichimoku Bulutu',
          valueText: lastPrice > senkouAVal ? 'Bulut Üstü' : 'Bulut Altı',
          signal,
          comment,
        });
      }
    }

    // 7. OBV
    if (showOBV && n >= 20) {
      const obvRes = computeOBV(closes, volumes);
      const obvVal = obvRes.obv[n - 1];
      const emaVal = obvRes.obvEma[n - 1];
      if (obvVal !== null && emaVal !== null) {
        const signal = obvVal > emaVal ? 'bullish' : 'bearish';
        const comment = obvVal > emaVal
          ? `OBV kendi 20 günlük EMA ortalamasının üzerinde seyrediyor. Hacim fiyat yükselişini destekliyor, piyasaya alıcı girişi mevcuttur.`
          : `OBV kendi 20 günlük EMA ortalamasının altında seyrediyor. Hacimsel zayıflık ve piyasadan para çıkışı emaresi mevcuttur.`;
        items.push({
          title: 'OBV Hacim',
          valueText: obvVal > emaVal ? 'Para Girişi' : 'Para Çıkışı',
          signal,
          comment,
        });
      }
    }

    // 8. Williams Paşa
    if (showWilliamsPasa && n >= 260) {
      const wpRes = computeWilliamsPasa(highs, lows, closes);
      const wpVal = wpRes.percentR[n - 1];
      const emaVal = wpRes.emaWil[n - 1];
      if (wpVal !== null && emaVal !== null) {
        let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
        let comment = '';
        if (wpVal < 20) {
          signal = 'bullish';
          comment = `Williams Paşa %R aşırı satım bölgesinde (${wpVal.toFixed(1)}). Dipten dönüş veya tepki alımları beklenmektedir.`;
        } else if (wpVal > 80) {
          signal = 'bearish';
          comment = `Williams Paşa %R aşırı alım bölgesinde (${wpVal.toFixed(1)}). Kar satışı veya kısa vadeli bir düzeltme riski artmıştır.`;
        } else if (wpVal > emaVal) {
          signal = 'bullish';
          comment = `Williams Paşa %R değeri (${wpVal.toFixed(1)}) kendi EMA seviyesinin (${emaVal.toFixed(1)}) üzerindedir, alım iştahı artıyor.`;
        } else {
          signal = 'bearish';
          comment = `Williams Paşa %R değeri (${wpVal.toFixed(1)}) kendi EMA seviyesinin (${emaVal.toFixed(1)}) altındadır, satış baskısı sürüyor.`;
        }
        items.push({
          title: 'Williams Paşa %R',
          valueText: `Değer: ${wpVal.toFixed(1)}`,
          signal,
          comment,
        });
      }
    }

    // 9. Nizami Cedid
    if (showNizamiCedid && n >= 260) {
      const ncRes = computeNizamiCedid(closes, volumes);
      const deltaVal = ncRes.delta[n - 1];
      if (deltaVal !== null) {
        const signal = deltaVal > 0.002 ? 'bullish' : deltaVal < -0.002 ? 'bearish' : 'neutral';
        const comment = signal === 'bullish'
          ? `Nizami Cedid delta değeri pozitif (${(deltaVal * 100).toFixed(2)}%) seviyesindedir. Hacim ağırlıklı hareketli ortalamalarda momentumun yükseliş yönlü güçlendiğini teyit eder.`
          : signal === 'bearish'
            ? `Nizami Cedid delta değeri negatif (${(deltaVal * 100).toFixed(2)}%) seviyesindedir. Satış baskısının ve momentum kaybının arttığını göstermektedir.`
            : `Nizami Cedid delta değeri nötr (${(deltaVal * 100).toFixed(2)}%) seviyesindedir, belirgin bir yön kararı bulunmamaktadır.`;
        items.push({
          title: 'Nizami Cedid',
          valueText: `Delta: ${(deltaVal * 100).toFixed(2)}%`,
          signal,
          comment,
        });
      }
    }

    // 10. EMA Overlay
    if (showEMAOverlay && n >= 21) {
      const ribbon = calculateEMARibbonLast(closes);
      const spread = ribbon.spread;
      const signal = ribbon.signal;
      let comment = '';
      if (signal === 'bullish') {
        comment = `EMA hareketli ortalamalar şeridi ideal yükseliş sıralamasındadır (Yayılım: ${spread.toFixed(3)}). Güçlü bir yükseliş trendi teyit ediliyor.`;
      } else if (signal === 'bearish') {
        comment = `EMA şeridi ters sıralanmış veya aşağı yönlü açılmaktadır (Yayılım: ${spread.toFixed(3)}). Düşüş trendi ve satış baskısı devam ediyor.`;
      } else {
        comment = `EMA ortalamaları birbirine yakın seyrediyor (Yayılım: ${spread.toFixed(3)}). Yatay konsolidasyon veya trend dönüşüm bölgesindeyiz.`;
      }
      items.push({
        title: 'EMA Şeritleri',
        valueText: `Yayılım: ${spread.toFixed(3)}`,
        signal,
        comment,
      });
    }

    // 11. Pearson Channels
    if (showPearsonChannels && n >= 21) {
      const pResults = computeAllPearsonChannels(closes);
      for (const ch of pResults) {
        const pos = ch.rmse > 0 ? (lastPrice - ch.B) / ch.rmse : 0;
        const r = ch.r;
        let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
        let comment = '';

        if (pos > 0.8) {
          signal = 'bearish';
          comment = `Pearson kanalında (${ch.label}) fiyat kanal üst sınırına yakın (Pozisyon: ${pos.toFixed(2)}). Kar realizasyonu veya dirençten dönüş görülebilir.`;
        } else if (pos < -0.8) {
          signal = 'bullish';
          comment = `Pearson kanalında (${ch.label}) fiyat kanal alt sınırına yakın (Pozisyon: ${pos.toFixed(2)}). Buradan destek bulup tepki vermesi beklenebilir.`;
        } else if (r > 0.6) {
          signal = 'bullish';
          comment = `Pearson kanalında (${ch.label}) güçlü pozitif korelasyon (R = ${r.toFixed(2)}) ile yükseliş trendi hakimdir. Fiyat orta çizgi civarında seyrediyor.`;
        } else if (r < -0.6) {
          signal = 'bearish';
          comment = `Pearson kanalında (${ch.label}) güçlü negatif korelasyon (R = ${r.toFixed(2)}) ile düşüş trendi hakimdir. Fiyat orta çizgi civarında seyrediyor.`;
        } else {
          signal = 'neutral';
          comment = `Pearson kanal korelasyonu (R = ${r.toFixed(2)}) yatay/nötr bir trende işaret etmektedir.`;
        }
        items.push({
          title: `Pearson (${ch.label})`,
          valueText: `Korelasyon: ${r.toFixed(2)}`,
          signal,
          comment,
        });
      }
    }



    // 12. Chaikin Money Flow (CMF)
    if (showCMF && n >= 20) {
      const cmfRes = computeCMF(highs, lows, closes, volumes, 20);
      const cmfVal = cmfRes.cmf[n - 1];
      if (cmfVal !== null) {
        let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
        let comment = '';
        if (cmfVal > 0.20) {
          signal = 'bullish';
          comment = `CMF değeri pozitif ve aşırı alım bölgesinde (${cmfVal.toFixed(2)}). Kurumsal para girişi ve birikim (accumulation) son derece güçlüdür, yükseliş trendini destekler.`;
        } else if (cmfVal < -0.20) {
          signal = 'bearish';
          comment = `CMF değeri negatif ve aşırı satım bölgesinde (${cmfVal.toFixed(2)}). Kurumsal para çıkışı ve dağıtım (distribution) son derece baskındır, düşüş eğilimini teyit eder.`;
        } else if (cmfVal > 0) {
          signal = 'bullish';
          comment = `CMF pozitif alanda dengeli seyrediyor (${cmfVal.toFixed(2)}). Hissede hafif bir para girişi ve alıcı iştahı mevcuttur.`;
        } else {
          signal = 'bearish';
          comment = `CMF negatif alanda dengeli seyrediyor (${cmfVal.toFixed(2)}). Hissede hafif bir para çıkışı ve satıcı baskısı mevcuttur.`;
        }
        items.push({
          title: 'Chaikin Money Flow (20)',
          valueText: `Değer: ${cmfVal.toFixed(2)}`,
          signal,
          comment,
        });
      }
    }

    return items;
  }, [
    filtered,
    showBollinger,
    showRSI,
    showMACD,
    showStochRSI,
    showSuperTrend,
    showIchimoku,
    showOBV,
    showWilliamsPasa,
    showNizamiCedid,
    showEMAOverlay,
    showPearsonChannels,
    showCMF,
  ]);

  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const lastBarRef = useRef<OHLCVData | null>(null);
  const currentDataRef = useRef<OHLCVData[]>([]);
  const symbolRef = useRef(symbol);
  useEffect(() => {
    symbolRef.current = symbol;
  }, [symbol]);
  const intervalRef = useRef(interval);
  useEffect(() => {
    intervalRef.current = interval;
  }, [interval]);
  const onLegendUpdateRef = useRef(onLegendUpdate);
  useEffect(() => {
    onLegendUpdateRef.current = onLegendUpdate;
  }, [onLegendUpdate]);

  const [activeTool, setActiveTool] = useState<ActiveDrawingTool>('pointer');
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [activeDrawing, setActiveDrawing] = useState<ChartDrawing | null>(null);

  // Sync state refs to prevent stale closure in ECharts event handlers
  const activeToolRef = useRef(activeTool);
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  const drawingsRef = useRef(drawings);
  useEffect(() => {
    drawingsRef.current = drawings;
  }, [drawings]);

  const activeDrawingRef = useRef(activeDrawing);
  useEffect(() => {
    activeDrawingRef.current = activeDrawing;
  }, [activeDrawing]);

  // Load drawings from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`temist_drawings_${symbol}`);
      setDrawings(saved ? JSON.parse(saved) : []);
    } catch (e) {
      console.error(e);
      setDrawings([]);
    }
    setActiveTool('pointer');
    setActiveDrawing(null);
  }, [symbol]);

  const saveDrawings = (newDrawings: ChartDrawing[]) => {
    setDrawings(newDrawings);
    try {
      localStorage.setItem(`temist_drawings_${symbol}`, JSON.stringify(newDrawings));
    } catch (e) {
      console.error(e);
    }
  };

  const clearDrawings = () => {
    setDrawings([]);
    setActiveDrawing(null);
    try {
      localStorage.removeItem(`temist_drawings_${symbol}`);
    } catch (e) {
      console.error(e);
    }
  };

  const showRSIRef = useRef(showRSI);
  const showMACDRef = useRef(showMACD);
  const showStochRSIRef = useRef(showStochRSI);
  const showOBVRef = useRef(showOBV);
  const showWilliamsPasaRef = useRef(showWilliamsPasa);
  const showNizamiCedidRef = useRef(showNizamiCedid);
  const showCMFRef = useRef(showCMF);
  const signalConfigRef = useRef(signalConfig);
  const themeColorsRef = useRef<any>(null);
  const subPanelsRef = useRef<string[]>([]);
  const panelBottomsRef = useRef<number[]>([]);

  const [panelHeights, setPanelHeights] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('temist_panel_heights');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return {
      rsi: 120,
      macd: 120,
      stochRsi: 120,
      obv: 120,
      williams_pasa: 120,
      nizami_cedid: 120,
      cmf: 120,
    };
  });

  const [activeResizer, setActiveResizer] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('temist_panel_heights', JSON.stringify(panelHeights));
    } catch (e) {
      console.error(e);
    }
  }, [panelHeights]);

  const handleSplitterMouseDown = (panel: string, e: React.MouseEvent) => {
    e.preventDefault();
    setActiveResizer(panel);
    const startY = e.clientY;
    const startHeight = panelHeights[panel] ?? 120;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dy = startY - moveEvent.clientY;
      const newHeight = Math.max(50, Math.min(400, startHeight + dy));
      
      setPanelHeights((prev) => ({
        ...prev,
        [panel]: newHeight,
      }));
    };

    const handleMouseUp = () => {
      setActiveResizer(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const { subPanels, panelBottoms } = useMemo(() => {
    const panels: string[] = [];
    if (showRSI) panels.push('rsi');
    if (showMACD) panels.push('macd');
    if (showStochRSI) panels.push('stochRsi');
    if (showOBV) panels.push('obv');
    if (showWilliamsPasa) panels.push('williams_pasa');
    if (showNizamiCedid) panels.push('nizami_cedid');
    if (showCMF) panels.push('cmf');

    const bottoms: number[] = [];
    let currentBottom = 40;
    for (let i = 0; i < panels.length; i++) {
      bottoms.push(currentBottom);
      const h = panelHeights[panels[i]] ?? 120;
      currentBottom += h + 10;
    }
    return { subPanels: panels, panelBottoms: bottoms };
  }, [showRSI, showMACD, showStochRSI, showOBV, showWilliamsPasa, showNizamiCedid, showCMF, panelHeights]);

  useEffect(() => {
    subPanelsRef.current = subPanels;
    panelBottomsRef.current = panelBottoms;
  }, [subPanels, panelBottoms]);

  useEffect(() => { showRSIRef.current = showRSI; }, [showRSI]);
  useEffect(() => { showMACDRef.current = showMACD; }, [showMACD]);
  useEffect(() => { showStochRSIRef.current = showStochRSI; }, [showStochRSI]);
  useEffect(() => { showOBVRef.current = showOBV; }, [showOBV]);
  useEffect(() => { showWilliamsPasaRef.current = showWilliamsPasa; }, [showWilliamsPasa]);
  useEffect(() => { showNizamiCedidRef.current = showNizamiCedid; }, [showNizamiCedid]);
  useEffect(() => { showCMFRef.current = showCMF; }, [showCMF]);
  useEffect(() => { signalConfigRef.current = signalConfig; }, [signalConfig]);

  const computedIndicatorsRef = useRef<ComputedIndicators>({});
  const lastHoveredIdxRef = useRef<number | null>(null);
  const updatePanelTitlesRef = useRef<(activeIdx: number) => void>(() => {});

  // Toggle visibility of individual Bollinger bands
  const [visibleBollinger, setVisibleBollinger] = useState<Set<string>>(
    () => new Set(DEFAULT_BOLLINGER_CONFIGS.map((c) => c.id)),
  );

  const toggleBollinger = useCallback((id: string) => {
    setVisibleBollinger((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  void toggleBollinger; // reserved for future UI

  // Compute combined signal events for scatter markers
  const signalEvents = useMemo<SignalEvent[]>(() => {
    if (!showSignals || filtered.length < 60) return [];
    const cfg = signalConfig ?? DEFAULT_SIGNAL_CONFIG;
    const combined = computeCombinedSignals(filtered, cfg);
    return extractCombinedSignalEvents(combined, filtered);
  }, [filtered, showSignals, signalConfig]);

  // Compute Bollinger overlay values for display table
  const bollingerResults = useMemo<BollingerOverlayResult[]>(() => {
    if (!showBollinger || filtered.length < 20) return [];
    const closePrices = filtered.map((d) => d.close);
    return computeAllBollingerOverlays(closePrices);
  }, [filtered, showBollinger]);

  void bollingerResults; // used internally by buildOption

  // Initialize chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = echarts.init(containerRef.current, undefined, { renderer: 'canvas' });
    chartInstanceRef.current = chart;

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    const ro = new ResizeObserver(handleResize);
    ro.observe(containerRef.current);

    // Drag-to-pan: left-click drag pans both X and Y axes simultaneously
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let startZoomStart = 0;
    let startZoomEnd = 100;
    let startYMin = 0;
    let startYMax = 0;
    let dragOnPriceAxis = false;
    let priceAxisDragStartY = 0;
    let priceAxisStartYMin = 0;
    let priceAxisStartYMax = 0;
    let activeYAxisIdx = 0;
    let activeYAxisId = 'y-axis-price';
    // RAF throttle for drag moves
    let dragRafId: number | null = null;
    // Shared drag flag — read by axisPointer handler to suppress legend updates during pan
    const isDraggingRef = { current: false };

    // Shift + Drag measurement variables
    let isMeasuring = false;
    let measureStartX = 0;
    let measureStartY = 0;
    let measureStartPrice = 0;
    let measureStartBarIdx = 0;

    const getBarDate = (idx: number): string => {
      const option = chart.getOption();
      const xAxisData = option?.xAxis?.[0]?.data;
      if (Array.isArray(xAxisData) && idx >= 0 && idx < xAxisData.length) {
        return String(xAxisData[idx]);
      }
      return '';
    };

    // Cursor change on hover over axis areas
    const setCursorOnAll = (cursor: string) => {
      if (!containerRef.current) return;
      containerRef.current.style.cursor = cursor;
      const canvases = containerRef.current.querySelectorAll('canvas');
      canvases.forEach((c) => {
        c.style.cursor = cursor;
      });
    };
    const SLIDER_ZONE_HEIGHT = 34;
    const onHoverMove = (e: MouseEvent) => {
      if (!containerRef.current || dragging || dragOnPriceAxis || isMeasuring) return;
      const rect = containerRef.current.getBoundingClientRect();
      const margins = getGridMargins();
      const gridRight = rect.right - margins.right;
      const gridLeft = rect.left + margins.left;
      const distFromBottom = rect.bottom - e.clientY;
      const clickY = e.clientY - rect.top;

      if (distFromBottom > SLIDER_ZONE_HEIGHT && (e.clientX > gridRight || e.clientX < gridLeft)) {
        const opt = chart.getOption() as any;
        const grids = opt.grid || [];
        const testX = rect.width / 2;
        let overGrid = false;
        for (let i = 0; i < grids.length; i++) {
          if (chart.containPixel({ gridIndex: i }, [testX, clickY])) {
            overGrid = true;
            break;
          }
        }
        if (overGrid) {
          setCursorOnAll('ns-resize');
        } else {
          setCursorOnAll('');
        }
      } else {
        setCursorOnAll('');
      }
    };

    const handleDragStart = (clientX: number, clientY: number, preventDefault: () => void) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const margins = getGridMargins();
      const gridLeft = rect.left + margins.left;
      const gridRight = rect.right - margins.right;
      const distFromBottom = rect.bottom - clientY;
      const clickY = clientY - rect.top;

      // Let ECharts handle slider zone natively
      if (distFromBottom <= SLIDER_ZONE_HEIGHT) {
        return;
      }

      if (clientX < gridLeft || clientX > gridRight) {
        isDraggingRef.current = true;
        dragOnPriceAxis = true;
        priceAxisDragStartY = clientY;

        const opt = chart.getOption() as any;
        const grids = opt.grid || [];
        const yAxes = opt.yAxis || [];
        const testX = rect.width / 2;

        let gIdx = 0;
        for (let i = 0; i < grids.length; i++) {
          if (chart.containPixel({ gridIndex: i }, [testX, clickY])) {
            gIdx = i;
            break;
          }
        }

        activeYAxisIdx = 0;
        activeYAxisId = 'y-axis-price';
        if (clientX < gridLeft) {
          const foundIdx = yAxes.findIndex((y: any) => y.id === 'y-axis-volume');
          if (foundIdx !== -1) {
            activeYAxisIdx = foundIdx;
            activeYAxisId = 'y-axis-volume';
          }
        } else {
          const foundIdx = yAxes.findIndex((y: any) => y.gridIndex === gIdx && y.position !== 'left');
          if (foundIdx !== -1) {
            activeYAxisIdx = foundIdx;
            activeYAxisId = yAxes[foundIdx].id || 'y-axis-price';
          }
        }

        const yAxisModel = (chart as any).getModel()?.getComponent('yAxis', activeYAxisIdx) as any;
        const extent = yAxisModel?.axis?.scale?.getExtent?.();
        if (extent) {
          priceAxisDragStartY = clientY;
          priceAxisStartYMin = extent[0];
          priceAxisStartYMax = extent[1];
        }
        preventDefault();
        return;
      }

      isDraggingRef.current = true;
      dragging = true;
      dragStartX = clientX;
      dragStartY = clientY;
      const opt = chart.getOption() as any;
      const grids = opt.grid || [];
      const yAxes = opt.yAxis || [];
      const testX = rect.width / 2;

      let gIdx = 0;
      for (let i = 0; i < grids.length; i++) {
        if (chart.containPixel({ gridIndex: i }, [testX, clickY])) {
          gIdx = i;
          break;
        }
      }

      startZoomStart = opt.dataZoom?.[0]?.start ?? 0;
      startZoomEnd = opt.dataZoom?.[0]?.end ?? 100;

      activeYAxisIdx = 0;
      activeYAxisId = 'y-axis-price';
      const foundIdx = yAxes.findIndex((y: any) => y.gridIndex === gIdx && y.position !== 'left');
      if (foundIdx !== -1) {
        activeYAxisIdx = foundIdx;
        activeYAxisId = yAxes[foundIdx].id || 'y-axis-price';
      }
      const yAxisModel2 = (chart as any).getModel()?.getComponent('yAxis', activeYAxisIdx) as any;
      const extent2 = yAxisModel2?.axis?.scale?.getExtent?.();
      if (extent2) {
        startYMin = extent2[0];
        startYMax = extent2[1];
      }
      preventDefault();
    };

    const handleDragMove = (clientX: number, clientY: number, preventDefault?: () => void) => {
      if (!containerRef.current) return;

      if (dragOnPriceAxis) {
        if (preventDefault) preventDefault();
        const dy = clientY - priceAxisDragStartY;
        const rect = containerRef.current.getBoundingClientRect();
        const capturedAxisId = activeYAxisId;
        const capturedAxisIdx = activeYAxisIdx;
        const capturedYMin = priceAxisStartYMin;
        const capturedYMax = priceAxisStartYMax;

        if (dragRafId !== null) return; // skip — frame already queued
        dragRafId = requestAnimationFrame(() => {
          dragRafId = null;
          const opt = chart.getOption() as any;
          const yAxes = opt.yAxis || [];
          const gIdx = yAxes[capturedAxisIdx]?.gridIndex ?? 0;
          const gridHeight = gIdx === 0 ? (rect.height - 70) : 120;
          const yRange = capturedYMax - capturedYMin;
          const mid = (capturedYMin + capturedYMax) / 2;
          const scaleFactor = 1 + (dy / gridHeight) * 2;
          const newHalf = (yRange / 2) * Math.max(0.1, scaleFactor);
          chart.setOption({ yAxis: [{ id: capturedAxisId, min: mid - newHalf, max: mid + newHalf }] });
        });
        return;
      }

      if (!dragging) return;
      if (preventDefault) preventDefault();
      const rect = containerRef.current.getBoundingClientRect();

      const dx = clientX - dragStartX;
      const pxRange = rect.width;
      const zoomRange = startZoomEnd - startZoomStart;
      const shift = -(dx / pxRange) * zoomRange;
      const newStart = startZoomStart + shift;
      const newEnd = startZoomEnd + shift;

      // Capture for RAF closure
      const capturedAxisId = activeYAxisId;
      const capturedAxisIdx = activeYAxisIdx;
      const dy = clientY - dragStartY;
      const capturedYMin = startYMin;
      const capturedYMax = startYMax;

      // Always throttle to one RAF frame — skip extra mousemove events
      if (dragRafId !== null) return;
      dragRafId = requestAnimationFrame(() => {
        dragRafId = null;
        chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start: newStart, end: newEnd });
        if (capturedAxisId && capturedAxisId !== '') {
          const opt = chart.getOption() as any;
          const yAxes = opt.yAxis || [];
          const gIdx = yAxes[capturedAxisIdx]?.gridIndex ?? 0;
          const gridHeight = gIdx === 0 ? (rect.height - 70) : 120;
          const yRange = capturedYMax - capturedYMin;
          const yShift = (dy / gridHeight) * yRange;
          chart.setOption({ yAxis: [{ id: capturedAxisId, min: capturedYMin + yShift, max: capturedYMax + yShift }] });
        }
      });
    };

    const handleDragEnd = () => {
      dragging = false;
      dragOnPriceAxis = false;
      isDraggingRef.current = false;
      if (dragRafId !== null) {
        cancelAnimationFrame(dragRafId);
        dragRafId = null;
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;

      if (activeToolRef.current !== 'pointer') {
        const rect = containerRef.current!.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const localY = e.clientY - rect.top;

        let startPrice = 0;
        let startBarIdx = 0;
        try {
          startPrice = chart.convertFromPixel({ yAxisId: 'y-axis-price' }, localY);
          startBarIdx = Math.round(chart.convertFromPixel({ xAxisIndex: 0 }, localX));
        } catch (err) {
          console.error(err);
          return;
        }

        const startDate = getBarDate(startBarIdx);

        const newDrawing: ChartDrawing = {
          id: String(Date.now()),
          type: activeToolRef.current === 'trend' ? 'trend' : activeToolRef.current === 'horizontal' ? 'horizontal' : 'fibonacci',
          startBarIdx,
          startPrice,
          endBarIdx: startBarIdx,
          endPrice: startPrice,
          startDate,
          endDate: startDate,
        };

        if (newDrawing.type === 'horizontal') {
          const updated = [...drawingsRef.current, newDrawing];
          saveDrawings(updated);
          setActiveTool('pointer');
        } else {
          activeDrawingRef.current = newDrawing;
          setActiveDrawing(newDrawing);
        }

        e.stopPropagation();
        e.preventDefault();
        return;
      }

      if (e.shiftKey) {
        // Shift key is held down: start measurement instead of panning
        isMeasuring = true;
        const rect = containerRef.current!.getBoundingClientRect();
        measureStartX = e.clientX;
        measureStartY = e.clientY;

        const localX = e.clientX - rect.left;
        const localY = e.clientY - rect.top;

        // Convert pixels to chart coordinates
        try {
          measureStartPrice = chart.convertFromPixel({ yAxisId: 'y-axis-price' }, localY);
          measureStartBarIdx = Math.round(chart.convertFromPixel({ xAxisIndex: 0 }, localX));
        } catch (err) {
          console.error('ECharts convertFromPixel error:', err);
          isMeasuring = false;
          return;
        }

        // Show overlay & badge (clear existing content/styles)
        if (measureOverlayRef.current && measureBadgeRef.current) {
          measureOverlayRef.current.style.display = 'block';
          measureOverlayRef.current.style.left = `${localX}px`;
          measureOverlayRef.current.style.top = `${localY}px`;
          measureOverlayRef.current.style.width = '0px';
          measureOverlayRef.current.style.height = '0px';
          measureOverlayRef.current.className = 'chart-measure-overlay';

          measureBadgeRef.current.style.display = 'flex';
          measureBadgeRef.current.style.left = `${localX}px`;
          measureBadgeRef.current.style.top = `${localY}px`;
          measureBadgeRef.current.innerHTML = '';
        }

        e.preventDefault();
      } else {
        handleDragStart(e.clientX, e.clientY, () => e.preventDefault());
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (activeDrawingRef.current) {
        const rect = containerRef.current!.getBoundingClientRect();
        const localCurrentX = e.clientX - rect.left;
        const localCurrentY = e.clientY - rect.top;

        let currentPrice = 0;
        let currentBarIdx = 0;
        try {
          currentPrice = chart.convertFromPixel({ yAxisId: 'y-axis-price' }, localCurrentY);
          currentBarIdx = Math.round(chart.convertFromPixel({ xAxisIndex: 0 }, localCurrentX));
        } catch (err) {
          return;
        }

        const endDate = getBarDate(currentBarIdx);
        const updated = {
          ...activeDrawingRef.current,
          endBarIdx: currentBarIdx,
          endPrice: currentPrice,
          endDate,
        };
        activeDrawingRef.current = updated;
        setActiveDrawing(updated);
        e.preventDefault();
        return;
      }

      if (isMeasuring) {
        const rect = containerRef.current!.getBoundingClientRect();
        const currentX = e.clientX;
        const currentY = e.clientY;

        const localStartX = measureStartX - rect.left;
        const localStartY = measureStartY - rect.top;
        const localCurrentX = currentX - rect.left;
        const localCurrentY = currentY - rect.top;

        // Calculate visual dimensions
        const left = Math.min(localStartX, localCurrentX);
        const top = Math.min(localStartY, localCurrentY);
        const width = Math.abs(localStartX - localCurrentX);
        const height = Math.abs(localStartY - localCurrentY);

        // Convert current position to ECharts data
        let currentPrice = 0;
        let currentBarIdx = 0;
        try {
          currentPrice = chart.convertFromPixel({ yAxisId: 'y-axis-price' }, localCurrentY);
          currentBarIdx = Math.round(chart.convertFromPixel({ xAxisIndex: 0 }, localCurrentX));
        } catch (err) {
          currentPrice = measureStartPrice;
          currentBarIdx = measureStartBarIdx;
        }

        // Calculate differences
        const priceDiff = currentPrice - measureStartPrice;
        const pricePct = measureStartPrice !== 0 ? (priceDiff / measureStartPrice) * 100 : 0;
        const isBullish = priceDiff >= 0;

        const sign = isBullish ? '+' : '';
        const colorClass = isBullish ? 'bullish' : 'bearish';

        const barsCount = Math.abs(currentBarIdx - measureStartBarIdx);
        let durationText = '';

        if (currentDataRef.current.length > 0) {
          const padding = getPaddingCount(currentDataRef.current.length, isIntraday(intervalRef.current));
          const startIdx = clamp(measureStartBarIdx - padding, 0, currentDataRef.current.length - 1);
          const currentIdx = clamp(currentBarIdx - padding, 0, currentDataRef.current.length - 1);
          
          const startDate = new Date(currentDataRef.current[startIdx].date);
          const endDate = new Date(currentDataRef.current[currentIdx].date);
          const timeDiffMs = Math.abs(endDate.getTime() - startDate.getTime());

          if (isIntraday(intervalRef.current)) {
            const hours = Math.floor(timeDiffMs / (1000 * 60 * 60));
            const minutes = Math.round((timeDiffMs % (1000 * 60 * 60)) / (1000 * 60));
            if (hours > 0) {
              durationText = `${hours} Saat ${minutes} Dakika`;
            } else {
              durationText = `${minutes} Dakika`;
            }
          } else {
            const days = Math.round(timeDiffMs / (1000 * 60 * 60 * 24));
            durationText = `${days} Gün`;
          }
        }

        // Update Overlay Box
        if (measureOverlayRef.current) {
          measureOverlayRef.current.style.left = `${left}px`;
          measureOverlayRef.current.style.top = `${top}px`;
          measureOverlayRef.current.style.width = `${width}px`;
          measureOverlayRef.current.style.height = `${height}px`;
          measureOverlayRef.current.className = `chart-measure-overlay ${colorClass}`;
        }

        // Update Badge Position
        if (measureBadgeRef.current) {
          const badgeWidth = measureBadgeRef.current.offsetWidth || 150;
          const badgeHeight = measureBadgeRef.current.offsetHeight || 50;

          let badgeLeft = left + width / 2 - badgeWidth / 2;
          let badgeTop = top + height / 2 - badgeHeight / 2;

          badgeLeft = Math.max(10, Math.min(rect.width - badgeWidth - 10, badgeLeft));
          badgeTop = Math.max(10, Math.min(rect.height - badgeHeight - 10, badgeTop));

          measureBadgeRef.current.style.left = `${badgeLeft}px`;
          measureBadgeRef.current.style.top = `${badgeTop}px`;
          measureBadgeRef.current.style.display = 'flex';
          
          measureBadgeRef.current.innerHTML = `
            <div class="chart-measure-badge-diff ${colorClass}">
              ${sign}${priceDiff.toFixed(2)} TL (${sign}${pricePct.toFixed(2)}%)
            </div>
            <div class="chart-measure-badge-info">
              ${barsCount} Bar, ${durationText}
            </div>
          `;
        }
      } else {
        handleDragMove(e.clientX, e.clientY);
      }
    };

    const onMouseUp = () => {
      if (activeDrawingRef.current) {
        const updated = [...drawingsRef.current, activeDrawingRef.current];
        saveDrawings(updated);
        activeDrawingRef.current = null;
        setActiveDrawing(null);
        setActiveTool('pointer');
        return;
      }
      if (isMeasuring) {
        isMeasuring = false;
        if (measureOverlayRef.current) measureOverlayRef.current.style.display = 'none';
        if (measureBadgeRef.current) measureBadgeRef.current.style.display = 'none';
      }
      handleDragEnd();
    };

    const handleDblClickLike = (clientX: number, clientY: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const margins = getGridMargins();
      const gridLeft = rect.left + margins.left;
      const gridRight = rect.right - margins.right;
      const distFromBottom = rect.bottom - clientY;
      const clickY = clientY - rect.top;

      // Let ECharts handle slider zone natively
      if (distFromBottom <= SLIDER_ZONE_HEIGHT) {
        return;
      }

      const opt = chart.getOption() as any;
      const yAxes = opt.yAxis || [];

      // Calculate default volume max limit to prevent volume bars from overlapping the price chart
      const maxVol = filtered.reduce((m, d) => Math.max(m, d.volume), 0);
      const volAxisMax = maxVol > 0 ? maxVol * 10 : 100;

      if (clientX < gridLeft || clientX > gridRight) {
        const grids = opt.grid || [];
        const testX = rect.width / 2;

        let gIdx = 0;
        for (let i = 0; i < grids.length; i++) {
          if (chart.containPixel({ gridIndex: i }, [testX, clickY])) {
            gIdx = i;
            break;
          }
        }

        let targetYAxisId = 'y-axis-price';
        if (clientX < gridLeft) {
          const foundIdx = yAxes.findIndex((y: any) => y.id === 'y-axis-volume');
          if (foundIdx !== -1) {
            targetYAxisId = 'y-axis-volume';
          }
        } else {
          const foundIdx = yAxes.findIndex((y: any) => y.gridIndex === gIdx && y.position !== 'left');
          if (foundIdx !== -1) {
            targetYAxisId = yAxes[foundIdx].id || 'y-axis-price';
          }
        }

        if (targetYAxisId === 'y-axis-volume') {
          chart.setOption({
            yAxis: [
              {
                id: 'y-axis-volume',
                min: 0,
                max: volAxisMax,
              },
            ],
          });
        } else {
          chart.setOption({
            yAxis: [
              {
                id: targetYAxisId,
                min: undefined,
                max: undefined,
              },
            ],
          });
        }
      } else {
        const newYAxisOpt = yAxes.map((y: any) => {
          if (y.id === 'y-axis-volume') {
            return {
              id: y.id,
              min: 0,
              max: volAxisMax,
            };
          }
          return {
            id: y.id,
            min: undefined,
            max: undefined,
          };
        });
        chart.setOption({
          yAxis: newYAxisOpt,
        });
      }
    };

    let lastTapTime = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];

        if (activeToolRef.current !== 'pointer') {
          const rect = containerRef.current!.getBoundingClientRect();
          const localX = touch.clientX - rect.left;
          const localY = touch.clientY - rect.top;

          let startPrice = 0;
          let startBarIdx = 0;
          try {
            startPrice = chart.convertFromPixel({ yAxisId: 'y-axis-price' }, localY);
            startBarIdx = Math.round(chart.convertFromPixel({ xAxisIndex: 0 }, localX));
          } catch (err) {
            return;
          }

          const startDate = getBarDate(startBarIdx);

          const newDrawing: ChartDrawing = {
            id: String(Date.now()),
            type: activeToolRef.current === 'trend' ? 'trend' : activeToolRef.current === 'horizontal' ? 'horizontal' : 'fibonacci',
            startBarIdx,
            startPrice,
            endBarIdx: startBarIdx,
            endPrice: startPrice,
            startDate,
            endDate: startDate,
          };

          if (newDrawing.type === 'horizontal') {
            const updated = [...drawingsRef.current, newDrawing];
            saveDrawings(updated);
            setActiveTool('pointer');
          } else {
            activeDrawingRef.current = newDrawing;
            setActiveDrawing(newDrawing);
          }

          e.stopPropagation();
          if (e.cancelable) e.preventDefault();
          return;
        }

        const now = Date.now();
        const tapDelay = now - lastTapTime;

        if (tapDelay < 300) {
          handleDblClickLike(touch.clientX, touch.clientY);
          lastTapTime = 0;
          if (e.cancelable) e.preventDefault();
          return;
        }
        lastTapTime = now;

        handleDragStart(touch.clientX, touch.clientY, () => {
          if (e.cancelable) e.preventDefault();
        });
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];

        if (activeDrawingRef.current) {
          const rect = containerRef.current!.getBoundingClientRect();
          const localCurrentX = touch.clientX - rect.left;
          const localCurrentY = touch.clientY - rect.top;

          let currentPrice = 0;
          let currentBarIdx = 0;
          try {
            currentPrice = chart.convertFromPixel({ yAxisId: 'y-axis-price' }, localCurrentY);
            currentBarIdx = Math.round(chart.convertFromPixel({ xAxisIndex: 0 }, localCurrentX));
          } catch (err) {
            return;
          }

          const endDate = getBarDate(currentBarIdx);
          const updated = {
            ...activeDrawingRef.current,
            endBarIdx: currentBarIdx,
            endPrice: currentPrice,
            endDate,
          };
          activeDrawingRef.current = updated;
          setActiveDrawing(updated);
          if (e.cancelable) e.preventDefault();
          return;
        }

        handleDragMove(touch.clientX, touch.clientY, () => {
          if (e.cancelable) e.preventDefault();
        });
      }
    };

    const onTouchEnd = () => {
      if (activeDrawingRef.current) {
        const updated = [...drawingsRef.current, activeDrawingRef.current];
        saveDrawings(updated);
        activeDrawingRef.current = null;
        setActiveDrawing(null);
        setActiveTool('pointer');
        return;
      }
      handleDragEnd();
    };

    const el = containerRef.current;
    el.addEventListener('mousedown', onMouseDown, true);
    el.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
    el.addEventListener('mousemove', onHoverMove);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchend', onTouchEnd);

    const onDblClick = (e: MouseEvent) => {
      handleDblClickLike(e.clientX, e.clientY);
    };
    el.addEventListener('dblclick', onDblClick);

    // Key and window visibility listeners to reset measurement
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && isMeasuring) {
        isMeasuring = false;
        if (measureOverlayRef.current) measureOverlayRef.current.style.display = 'none';
        if (measureBadgeRef.current) measureBadgeRef.current.style.display = 'none';
      }
    };
    window.addEventListener('keyup', handleKeyUp);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeDrawingRef.current) {
          activeDrawingRef.current = null;
          setActiveDrawing(null);
          setActiveTool('pointer');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const handleVisibilityChange = () => {
      if (isMeasuring) {
        isMeasuring = false;
        if (measureOverlayRef.current) measureOverlayRef.current.style.display = 'none';
        if (measureBadgeRef.current) measureBadgeRef.current.style.display = 'none';
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Crosshair tracking for legend
    chart.on('updateAxisPointer', (params: unknown) => {
      // Skip all updates during pan/drag to avoid React re-renders
      if (isDraggingRef.current) return;

      const p = params as { axesInfo?: Array<{ axisDim?: string; value?: number }> };
      const xInfo = p.axesInfo?.find((a) => a.axisDim === 'x');
      if (xInfo?.value != null && currentDataRef.current.length > 0) {
        const dataIndex = Math.round(xInfo.value);
        const realIdx = dataIndex - getPaddingCount(currentDataRef.current.length, isIntraday(intervalRef.current));
        
        if (realIdx === lastHoveredIdxRef.current) {
          return;
        }
        lastHoveredIdxRef.current = realIdx;

        const bar = currentDataRef.current[realIdx];
        if (bar) {
          const prevClose = realIdx > 0 ? currentDataRef.current[realIdx - 1].close : bar.open;
          onLegendUpdateRef.current({
            symbol: symbolRef.current,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
            time: bar.date,
            prevClose,
          });

          // Update sub-panel titles dynamically on hover using HTML DOM
          updatePanelTitlesRef.current(realIdx);
        } else {
          onLegendUpdateRef.current(null);
          // Fallback titles to last bar when hovered index is invalid
          const lastIdx = currentDataRef.current.length - 1;
          if (lastIdx >= 0) {
            updatePanelTitlesRef.current(lastIdx);
          }
        }
      }
    });

    chart.on('globalout', () => {
      lastHoveredIdxRef.current = null;
      const lastIdx = currentDataRef.current.length - 1;
      if (lastIdx >= 0) {
        updatePanelTitlesRef.current(lastIdx);
      }
    });

    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('mousemove', onHoverMove);
      el.removeEventListener('dblclick', onDblClick);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      ro.disconnect();
      chart.dispose();
      chartInstanceRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track previous data identity to decide whether to preserve zoom
  const prevDataLenRef = useRef<number>(0);
  const prevSymbolRef = useRef<string>(symbol);

  // Update chart when data/type/timeframe changes
  const updateChart = useCallback(() => {
    const chart = chartInstanceRef.current;
    if (!chart) return;

    const dataChanged = filtered.length !== prevDataLenRef.current || symbol !== prevSymbolRef.current;
    let savedZoom: { start: number; end: number } | null = null;
    if (!dataChanged) {
      const opt = chart.getOption() as { dataZoom?: Array<{ start?: number; end?: number }> } | undefined;
      if (opt?.dataZoom && opt.dataZoom.length > 0) {
        savedZoom = {
          start: opt.dataZoom[0].start ?? 0,
          end: opt.dataZoom[0].end ?? 100,
        };
      }
    }
    prevDataLenRef.current = filtered.length;
    prevSymbolRef.current = symbol;

    currentDataRef.current = [...filtered];
    const themeColors = getThemeColors();
    themeColorsRef.current = themeColors;

    subPanelsRef.current = subPanels;
    panelBottomsRef.current = panelBottoms;

    const highs = filtered.map((d) => d.high);
    const lows = filtered.map((d) => d.low);
    const closes = filtered.map((d) => d.close);
    const volumes = filtered.map((d) => d.volume);
    const cmfResult = showCMF && filtered.length > 20 ? computeCMF(highs, lows, closes, volumes, 20) : null;

    const computed: ComputedIndicators = {};
    if (showRSI && filtered.length > 15) {
      const period = signalConfig?.rsi?.period ?? 14;
      computed.rsi = computeRSI(closes, period).rsi;
    }
    if (showMACD && filtered.length > 35) {
      const fast = signalConfig?.macd?.fast ?? 12;
      const slow = signalConfig?.macd?.slow ?? 26;
      const sigPeriod = signalConfig?.macd?.signalPeriod ?? 9;
      computed.macd = computeMACD(closes, fast, slow, sigPeriod);
    }
    if (showStochRSI && filtered.length > 30) {
      const rsiP = signalConfig?.stochRsi?.rsiPeriod ?? 14;
      const stochP = signalConfig?.stochRsi?.stochPeriod ?? 14;
      const kS = signalConfig?.stochRsi?.kSmooth ?? 3;
      const dS = signalConfig?.stochRsi?.dSmooth ?? 3;
      computed.stochRsi = computeStochRSI(closes, rsiP, stochP, kS, dS);
    }
    if (showOBV && filtered.length > 20) {
      const emaPeriod = signalConfig?.obv?.emaPeriod ?? 20;
      computed.obv = computeOBV(closes, volumes, emaPeriod);
    }
    if (showWilliamsPasa && filtered.length > 260) {
      const length = signalConfig?.williamsPasa?.length ?? 260;
      const emaLen = signalConfig?.williamsPasa?.emaLen ?? 260;
      computed.williamsPasa = computeWilliamsPasa(highs, lows, closes, length, emaLen);
    }
    if (showNizamiCedid && filtered.length > 260) {
      const fast = signalConfig?.nizamiCedid?.fast ?? 120;
      const slow = signalConfig?.nizamiCedid?.slow ?? 260;
      const signalLen = signalConfig?.nizamiCedid?.signalLen ?? 50;
      const vwmaLen = signalConfig?.nizamiCedid?.vwmaLen ?? 185;
      computed.nizamiCedid = computeNizamiCedid(closes, volumes, fast, slow, signalLen, vwmaLen);
    }
    if (showCMF && cmfResult) {
      const ema130Cmf = ema(cmfResult.cmf, 130);
      const ema260Cmf = ema(cmfResult.cmf, 260);
      computed.cmf = {
        cmf: cmfResult.cmf,
        ema130: ema130Cmf,
        ema260: ema260Cmf
      };
    }
    computedIndicatorsRef.current = computed;
    lastHoveredIdxRef.current = null;

    const newOption = buildOption(
      filtered,
      symbol,
      showBollinger,
      visibleBollinger,
      showRSI,
      showMACD,
      showStochRSI,
      logScale,
      themeColors,
      signalEvents,
      signalConfig,
      showSuperTrend,
      showIchimoku,
      showOBV,
      interval,
      showWilliamsPasa,
      showNizamiCedid,
      showEMAOverlay,
      showPearsonChannels,
      showCMF,
      cmfResult,
      null,
      computed,
      panelHeights,
      activeDrawing ? [...drawings, activeDrawing] : drawings
    );

    if (savedZoom && Array.isArray(newOption.dataZoom)) {
      for (const dz of newOption.dataZoom as Array<{ start?: number; end?: number }>) {
        dz.start = savedZoom.start;
        dz.end = savedZoom.end;
      }
    }

    chart.setOption(newOption, true);
    if (filtered.length > 0) {
      lastBarRef.current = { ...filtered[filtered.length - 1] };
    }

    const updatePanelTitles = (activeIdx: number) => {
      const tc = themeColors;
      const computed = computedIndicatorsRef.current;
      const sigConfig = signalConfig;
      const filteredData = filtered;

      subPanels.forEach((panel) => {
        const el = document.getElementById(`subpanel-title-${panel}`);
        if (el) {
          el.innerHTML = getPanelTitleHTML(
            panel,
            activeIdx,
            filteredData,
            computed,
            sigConfig,
            tc
          );
        }
      });
    };
    updatePanelTitlesRef.current = updatePanelTitles;
    if (filtered.length > 0) {
      updatePanelTitles(filtered.length - 1);
    }
  }, [
    filtered,
    symbol,
    interval,
    showBollinger,
    visibleBollinger,
    showRSI,
    showMACD,
    showStochRSI,
    showSuperTrend,
    showIchimoku,
    showOBV,
    showWilliamsPasa,
    showNizamiCedid,
    showEMAOverlay,
    showPearsonChannels,
    showCMF,
    logScale,
    signalEvents,
    signalConfig,
    subPanels,
    panelBottoms,
    panelHeights,
    theme,
    drawings,
    activeDrawing,
  ]);

  useEffect(() => {
    updateChart();
  }, [updateChart]);

  return (
    <div className="chart-outer-container" style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="chart-inner-container" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <DrawingToolbar
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          onClearAll={clearDrawings}
        />
        <div ref={containerRef} className={`chart-container ${activeTool !== 'pointer' ? 'drawing-active' : ''}`} />
        <div ref={measureOverlayRef} className="chart-measure-overlay" />
        <div ref={measureBadgeRef} className="chart-measure-badge" />
        {subPanels.map((panel, idx) => {
          const h = panelHeights[panel] ?? 120;
          const bottom = panelBottoms[idx] + h - 22;
          const margins = getGridMargins();
          const left = margins.left + 5;
          return (
            <div
              key={panel}
              id={`subpanel-title-${panel}`}
              className="chart-subpanel-title"
              style={{
                position: 'absolute',
                left: `${left}px`,
                bottom: `${bottom}px`,
              }}
            />
          );
        })}
        {subPanels.map((panel, idx) => {
          const h = panelHeights[panel] ?? 120;
          const margins = getGridMargins();
          return (
            <div
              key={`resizer-${panel}`}
              className={`chart-subpanel-resizer ${activeResizer === panel ? 'active' : ''}`}
              style={{
                position: 'absolute',
                left: `${margins.left}px`,
                right: `${margins.right}px`,
                bottom: `${panelBottoms[idx] + h - 4}px`,
                height: '8px',
                cursor: 'ns-resize',
                zIndex: 15,
              }}
              onMouseDown={(e) => handleSplitterMouseDown(panel, e)}
            >
              <div className="chart-subpanel-resizer-line" />
            </div>
          );
        })}
      </div>

      {/* 💡 Yorumlayan Bilgi Kutusu */}
      {showCommentary && (
        <div className={`chart-commentary-box ${commentaryOpen ? 'open' : 'collapsed'}`}>
          <div className="commentary-header" onClick={() => setCommentaryOpen(!commentaryOpen)}>
            <span className="commentary-header-title">
              <span>💡</span> İndikatör Analiz & Yorumları
            </span>
            <button className="commentary-toggle-btn">
              {commentaryOpen ? '▼' : '▲'}
            </button>
          </div>
          {commentaryOpen && (
            <div className="commentary-content">
              {commentaries.length === 0 ? (
                <div className="commentary-placeholder">
                  Grafikte yorumlanacak aktif bir indikatör bulunmuyor. Sol üstteki araç çubuğundan indikatörleri açabilirsiniz.
                </div>
              ) : (
                commentaries.map((c, idx) => (
                  <div key={idx} className="commentary-item">
                    <div className="commentary-item-title-row">
                      <span className={`signal-dot ${c.signal}`} />
                      <strong className="commentary-item-title">{c.title}</strong>
                      <span className="commentary-item-value">{c.valueText}</span>
                    </div>
                    <p className="commentary-item-text">{c.comment}</p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
