import type { OHLCVData } from '../api/borsaApi';

const DB_NAME = 'borsa_history';
const DB_VERSION = 1;
const STORE_NAME = 'ohlcv';

// TTL: how long cached data is considered fresh
const MEMORY_TTL_MS = 2 * 60 * 1000;   // 2 min for in-memory (same session)
const DB_TTL_MS     = 5 * 60 * 1000;   // 5 min for IndexedDB (persisted)


interface CacheEntry {
  key: string;
  data: OHLCVData[];
  fetchedAt: number;
}

// ── IndexedDB helpers ──────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

export async function getFromDB(symbol: string, interval: string): Promise<CacheEntry | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const key = `${symbol}_${interval}`;
    const entry = await new Promise<CacheEntry | null>((resolve) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
    if (!entry) return null;
    // TTL check
    if (Date.now() - entry.fetchedAt > DB_TTL_MS) return null;
    return entry;
  } catch {
    return null;
  }
}


export async function saveToDB(symbol: string, interval: string, data: OHLCVData[]): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const key = `${symbol}_${interval}`;
    store.put({ key, data, fetchedAt: Date.now() } satisfies CacheEntry);
  } catch {
    // IndexedDB write failure is non-critical
  }
}

// ── In-memory cache (session-level, instant access) ──

interface MemEntry {
  data: OHLCVData[];
  fetchedAt: number;
}

const memCache = new Map<string, MemEntry>();

export function getFromMemory(symbol: string, interval: string): MemEntry | undefined {
  const entry = memCache.get(`${symbol}_${interval}`);
  if (!entry) return undefined;
  // TTL check
  if (Date.now() - entry.fetchedAt > MEMORY_TTL_MS) {
    memCache.delete(`${symbol}_${interval}`);
    return undefined;
  }
  return entry;
}

export function saveToMemory(symbol: string, interval: string, data: OHLCVData[], fetchedAt?: number): void {
  memCache.set(`${symbol}_${interval}`, { data, fetchedAt: fetchedAt ?? Date.now() });
}
