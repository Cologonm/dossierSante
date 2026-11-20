// Stockage local (IndexedDB). Tout ce qui est écrit ici est déjà chiffré.
//  - store "meta"  : "keys" (clés emballées, sels), "vault" (coffre chiffré)
//  - store "files" : un PDF chiffré par identifiant

const DB_NAME = 'dossier-sante';
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('meta');
      req.result.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const get = (store, key) => run(store, 'readonly', (s) => s.get(key));
export const put = (store, key, value) => run(store, 'readwrite', (s) => s.put(value, key));
export const del = (store, key) => run(store, 'readwrite', (s) => s.delete(key));
export const keys = (store) => run(store, 'readonly', (s) => s.getAllKeys());
export const clear = (store) => run(store, 'readwrite', (s) => s.clear());

export async function wipe() {
  await clear('meta');
  await clear('files');
}

/** Demande à iOS de ne pas effacer les données quand l'espace manque. */
export async function askPersistence() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
