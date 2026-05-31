const DB_NAME = 'temist_cache_db';
const DB_VERSION = 2; // bumped to add 'cachedAt' index

// TTL constants (milliseconds)
const TTL_MS: Record<'history' | 'financials', number> = {
  history:    5  * 60 * 1000,  // 5 minutes  – price history is live data
  financials: 24 * 60 * 60 * 1000,  // 24 hours – financials change rarely
};

interface CachedEnvelope<T> {
  data: T;
  cachedAt: number;
}

function getDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('history')) {
        db.createObjectStore('history');
      }
      if (!db.objectStoreNames.contains('financials')) {
        db.createObjectStore('financials');
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject(new Error('IndexedDB failed to open: ' + (event.target as IDBOpenDBRequest).error?.message));
    };
  });
}

/**
 * Retrieve a cached item. Returns null if:
 *   - Item does not exist
 *   - Item has expired (TTL exceeded)
 */
export async function getCacheItem<T>(storeName: 'history' | 'financials', key: string): Promise<T | null> {
  try {
    const db = await getDb();
    const raw = await new Promise<CachedEnvelope<T> | T | null>((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve((request.result as CachedEnvelope<T> | T) ?? null);
      request.onerror = () => reject(request.error);
    });

    if (raw === null || raw === undefined) return null;

    // Support both new envelope format { data, cachedAt } and old bare format
    const envelope = raw as CachedEnvelope<T>;
    if (envelope && typeof envelope === 'object' && 'cachedAt' in envelope && 'data' in envelope) {
      const age = Date.now() - envelope.cachedAt;
      if (age > TTL_MS[storeName]) {
        // Expired — delete and return null
        try {
          const delTx = db.transaction(storeName, 'readwrite');
          delTx.objectStore(storeName).delete(key);
        } catch { /* ignore delete failure */ }
        return null;
      }
      return envelope.data;
    }

    // Old format (no envelope) — treat as stale and return null so fresh data is fetched
    return null;
  } catch (err) {
    console.warn(`Failed to get item ${key} from IndexedDB store ${storeName}:`, err);
    return null;
  }
}

/**
 * Store an item with the current timestamp for TTL tracking.
 */
export async function setCacheItem<T>(storeName: 'history' | 'financials', key: string, value: T): Promise<void> {
  try {
    const db = await getDb();
    const envelope: CachedEnvelope<T> = { data: value, cachedAt: Date.now() };
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(envelope, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn(`Failed to set item ${key} in IndexedDB store ${storeName}:`, err);
  }
}
