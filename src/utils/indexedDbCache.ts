const DB_NAME = 'temist_cache_db';
const DB_VERSION = 1;

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

export async function getCacheItem<T>(storeName: 'history' | 'financials', key: string): Promise<T | null> {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => {
        resolve((request.result as T) || null);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (err) {
    console.warn(`Failed to get item ${key} from IndexedDB store ${storeName}:`, err);
    return null;
  }
}

export async function setCacheItem<T>(storeName: 'history' | 'financials', key: string, value: T): Promise<void> {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(value, key);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (err) {
    console.warn(`Failed to set item ${key} in IndexedDB store ${storeName}:`, err);
  }
}
