const DB_NAME = 'sirafiq-next';
const DB_VERSION = 2;
const PAYLOAD_STORE = 'supports';
const META_STORE = 'support-meta';

export const SUPPORT_METADATA_CHANGED_EVENT = 'sirafiq:support-metadata-changed';

type StoredRecord = {
  id: string;
  type?: string;
  bytes?: ArrayBuffer;
  blob?: Blob;
  dataUrl?: string;
  [key: string]: unknown;
};

type PayloadFields = {
  bytes?: ArrayBuffer;
  blob?: Blob;
  dataUrl?: string;
};

let dbPromise: Promise<IDBDatabase> | null = null;
let persistencePromise: Promise<boolean> | null = null;

function notifyMetadataChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SUPPORT_METADATA_CHANGED_EVENT));
}

async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  if (!persistencePromise) {
    persistencePromise = navigator.storage.persist().catch(() => false);
  }
  return persistencePromise;
}

function withoutPayload<T extends { id: string }>(support: T): Omit<T, 'bytes' | 'blob' | 'dataUrl'> {
  const record = support as T & PayloadFields;
  const { bytes: _bytes, blob: _blob, dataUrl: _dataUrl, ...metadata } = record;
  return metadata as Omit<T, 'bytes' | 'blob' | 'dataUrl'>;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      if (!tx) return;

      const payloadStore = db.objectStoreNames.contains(PAYLOAD_STORE)
        ? tx.objectStore(PAYLOAD_STORE)
        : db.createObjectStore(PAYLOAD_STORE, { keyPath: 'id' });
      const metaStore = db.objectStoreNames.contains(META_STORE)
        ? tx.objectStore(META_STORE)
        : db.createObjectStore(META_STORE, { keyPath: 'id' });

      if (event.oldVersion < 2) {
        const cursorRequest = payloadStore.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          metaStore.put(withoutPayload(cursor.value as StoredRecord));
          cursor.continue();
        };
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Impossible d’ouvrir le stockage local.'));
    };
  });

  return dbPromise;
}

export async function listSupportMetadata<T extends { id: string }>(): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

export async function getSupportMetadata<T extends { id: string }>(id: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get(id);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSupportMetadata<T extends { id: string }>(support: T): Promise<void> {
  const db = await openDb();
  const metadata = withoutPayload(support);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put(metadata);
    tx.oncomplete = () => {
      notifyMetadataChanged();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Enregistrement local interrompu.'));
  });
}

export async function patchSupportMetadata<T extends { id: string }>(id: string, patch: Partial<Omit<T, 'id'>>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    const store = tx.objectStore(META_STORE);
    const request = store.get(id);
    let next: T | null = null;

    request.onsuccess = () => {
      const current = request.result as T | undefined;
      if (!current) {
        tx.abort();
        reject(new Error('Support local introuvable.'));
        return;
      }
      next = { ...current, ...patch, id } as T;
      store.put(withoutPayload(next));
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => {
      if (!next) {
        reject(new Error('Support local introuvable.'));
        return;
      }
      notifyMetadataChanged();
      resolve(next);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Enregistrement local interrompu.'));
  });
}

export async function saveNewSupport<T extends { id: string } & PayloadFields>(support: T): Promise<void> {
  await requestPersistentStorage();
  const db = await openDb();
  const metadata = withoutPayload(support);
  return new Promise((resolve, reject) => {
    const tx = db.transaction([PAYLOAD_STORE, META_STORE], 'readwrite');
    tx.objectStore(PAYLOAD_STORE).put(support);
    tx.objectStore(META_STORE).put(metadata);
    tx.oncomplete = () => {
      notifyMetadataChanged();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Import local interrompu.'));
  });
}

export async function deleteSupportRecord(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([PAYLOAD_STORE, META_STORE], 'readwrite');
    tx.objectStore(PAYLOAD_STORE).delete(id);
    tx.objectStore(META_STORE).delete(id);
    tx.oncomplete = () => {
      notifyMetadataChanged();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Suppression locale interrompue.'));
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(',', 2);
  if (!header || payload === undefined) throw new Error('Fichier local illisible.');
  const mime = header.match(/^data:([^;,]+)/)?.[1] || 'application/octet-stream';
  const bytes = header.includes(';base64') ? atob(payload) : decodeURIComponent(payload);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: mime });
}

export function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('Lecture binaire impossible.'));
    reader.onerror = () => reject(reader.error ?? new Error('Lecture binaire impossible.'));
    reader.readAsArrayBuffer(blob);
  });
}

export async function loadSupportBlob(id: string, fallbackType = 'application/octet-stream'): Promise<Blob> {
  const db = await openDb();
  const record = await new Promise<StoredRecord | null>((resolve, reject) => {
    const request = db.transaction(PAYLOAD_STORE, 'readonly').objectStore(PAYLOAD_STORE).get(id);
    request.onsuccess = () => resolve((request.result as StoredRecord | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });

  if (!record) throw new Error('Fichier local introuvable.');
  if (record.bytes instanceof ArrayBuffer) return new Blob([record.bytes], { type: record.type || fallbackType });
  if (record.blob instanceof Blob) return record.blob;
  if (typeof record.dataUrl === 'string') return dataUrlToBlob(record.dataUrl);
  throw new Error('Fichier local illisible.');
}
