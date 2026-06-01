import { useState, useEffect, useRef, useMemo } from 'react';
import type { Interval } from '../components/Chart/types';
import { isIntraday } from '../components/Chart/types';
import { fetchHistory, fetchHistoryLive } from '../api/borsaApi';
import type { OHLCVData } from '../api/borsaApi';
import { aggregateOHLCV } from '../utils/aggregateOHLCV';
import { getFromMemory, saveToMemory, getFromDB, saveToDB } from '../utils/historyCache';

// ── Helpers ───────────────────────────────────────

/** Max age before a background refresh is triggered */
const STALE_MS = 4 * 3600_000; // 4 hours

// ── Hook ──────────────────────────────────────────

/**
 * Fetches OHLCV history with multi-layer caching.
 *
 * Layer 1: Module-level Map  (instant, survives re-renders)
 * Layer 2: IndexedDB          (persists across page reloads)
 * Layer 3: Static JSON fetch  (pre-built data)
 *
 * Always fetches/caches daily data, then aggregates
 * to the requested interval (weekly/monthly/quarterly).
 */
export function useHistoryData(symbol: string, interval: Interval) {
  const [rawData, setRawData] = useState<OHLCVData[]>([]);
  const [loading, setLoading] = useState(true);

  const dataRef = useRef<OHLCVData[]>([]);

  // ── Data loading ────
  // Intraday → always fetch live from backend (no cache)
  // Daily+  → multi-layer cache (memory → IndexedDB → static JSON)
  useEffect(() => {
    let cancelled = false;

    async function loadIntraday() {
      setLoading(true);
      try {
        const records = await fetchHistoryLive(symbol, undefined, interval);
        if (!cancelled) {
          setRawData(records);
          dataRef.current = records;
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setRawData([]);
          dataRef.current = [];
          setLoading(false);
        }
      }
    }

    async function loadDaily() {
      // 1. Memory cache → instant
      const mem = getFromMemory(symbol, '1d');
      if (mem && mem.data.length > 0) {
        setRawData(mem.data);
        dataRef.current = mem.data;
        setLoading(false);

        // Background refresh if stale
        if (Date.now() - mem.fetchedAt > STALE_MS) {
          backgroundRefresh();
        }
        return;
      }

      // 2. IndexedDB → fast (async)
      const cached = await getFromDB(symbol, '1d');
      if (!cancelled && cached && cached.data.length > 0) {
        saveToMemory(symbol, '1d', cached.data, cached.fetchedAt);
        setRawData(cached.data);
        dataRef.current = cached.data;
        setLoading(false);

        // Background refresh if stale
        if (Date.now() - cached.fetchedAt > STALE_MS) {
          backgroundRefresh();
        }
        return;
      }

      // 3. Static JSON fetch
      setLoading(true);
      try {
        const records = await fetchHistory(symbol, 'max', '1d');
        if (!cancelled) {
          persist(records);
          setRawData(records);
          dataRef.current = records;
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setRawData([]);
          dataRef.current = [];
          setLoading(false);
        }
      }
    }

    /** Fetch silently and update data + caches */
    function backgroundRefresh() {
      fetchHistory(symbol, 'max', '1d')
        .then((records) => {
          if (!cancelled && records.length > 0) {
            persist(records);
            setRawData(records);
            dataRef.current = records;
          }
        })
        .catch(() => {});
    }

    /** Write to both memory and IndexedDB */
    function persist(records: OHLCVData[]) {
      saveToMemory(symbol, '1d', records);
      saveToDB(symbol, '1d', records);
    }

    if (isIntraday(interval)) {
      loadIntraday();
    } else {
      loadDaily();
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval]);

  // Apply aggregation based on interval (daily → weekly/monthly/quarterly)
  const data = useMemo(() => aggregateOHLCV(rawData, interval), [rawData, interval]);

  return { data, loading };
}
