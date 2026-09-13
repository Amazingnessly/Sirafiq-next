const DB_NAME = 'sirafiq-next';
const DB_VERSION = 3;
const PAYLOAD_STORE = 'supports';
const META_STORE = 'support-meta';
const CHUNK_STORE = 'support-payload-chunks';
const CHUNK_INDEX = 'supportId';
const PAYLOAD_CHUNK_SIZE = 4 * 1024 * 1024;
const CHUNK_CACHE_LIMIT = 3;

export const SUPPORT_METADATA_CHANGED_EVENT = 'sirafiq:support-metadata-changed';
export type SupportMetadataChange = { id: string; deleted?: boolean; metadata?: { id: string; [key: string]: unknown } };
export type SupportByteSource = {
  size: number;
  readRange: (begin: number, end: number) => Promise<Uint8Array>;
  close: () => void;
};

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

type PayloadMetadata = {
  id: string;
  size?: number;
  type?: string;
  payloadKind?: 'chunks';
  payloadChunkSize?: number;
  payloadChunkCount?: number;
  [key: string]: unknown;
};

type PayloadChunk = {
  supportId: string;
  index: number;
  data: ArrayBuffer;
};

let dbPromise: Promise<IDBDatabase> | null = null;
let persistencePromise: Promise<boolean> | null = null;

function notifyMetadataChanged(detail: SupportMetadataChange) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<SupportMetadataChange>(SUPPORT_METADATA_CHANGED_EVENT, { detail }));
}

function metadataChange<T extends { id: string }>(metadata: T): SupportMetadataChange {
  return { id: metadata.id, metadata: metadata as { id: string; [key: string]: unknown } };
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
      const chunkStore = db.objectStoreNames.contains(CHUNK_STORE)
        ? tx.objectStore(CHUNK_STORE)
        : db.createObjectStore(CHUNK_STORE, { keyPath: ['supportId', 'index'] });

      if (!chunkStore.indexNames.contains(CHUNK_INDEX)) {
        chunkStore.createIndex(CHUNK_INDEX, 'supportId', { unique: false });
      }

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
      notifyMetadataChanged(metadataChange(metadata));
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
      notifyMetadataChanged(metadataChange(next));
      resolve(next);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Enregistrement local interrompu.'));
  });
}

async function writePayloadChunk(supportId: string, index: number, data: ArrayBuffer): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHUNK_STORE, 'readwrite');
    tx.objectStore(CHUNK_STORE).put({ supportId, index, data } satisfies PayloadChunk);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Écriture du fichier interrompue.'));
  });
}

async function readPayloadChunk(supportId: string, index: number): Promise<ArrayBuffer> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(CHUNK_STORE, 'readonly').objectStore(CHUNK_STORE).get([supportId, index]);
    request.onsuccess = () => {
      const chunk = request.result as PayloadChunk | undefined;
      if (!chunk?.data) {
        reject(new Error('Une partie du fichier local est introuvable.'));
        return;
      }
      resolve(chunk.data);
    };
    request.onerror = () => reject(request.error);
  });
}

async function deletePayloadChunks(supportId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHUNK_STORE, 'readwrite');
    const index = tx.objectStore(CHUNK_STORE).index(CHUNK_INDEX);
    const cursorRequest = index.openCursor(IDBKeyRange.only(supportId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Nettoyage du fichier interrompu.'));
  });
}

export async function saveNewSupportFile<T extends { id: string; size: number; type?: string }>(support: T, file: Blob): Promise<void> {
  await requestPersistentStorage();
  const chunkCount = Math.ceil(file.size / PAYLOAD_CHUNK_SIZE);

  try {
    for (let index = 0; index < chunkCount; index += 1) {
      const begin = index * PAYLOAD_CHUNK_SIZE;
      const end = Math.min(file.size, begin + PAYLOAD_CHUNK_SIZE);
      const data = await blobToArrayBuffer(file.slice(begin, end));
      await writePayloadChunk(support.id, index, data);
    }

    const metadata = {
      ...withoutPayload(support),
      payloadKind: 'chunks' as const,
      payloadChunkSize: PAYLOAD_CHUNK_SIZE,
      payloadChunkCount: chunkCount,
    };
    await saveSupportMetadata(metadata);
  } catch (error) {
    await deletePayloadChunks(support.id).catch(() => undefined);
    throw error;
  }
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
      notifyMetadataChanged(metadataChange(metadata));
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Import local interrompu.'));
  });
}

export async function deleteSupportRecord(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([PAYLOAD_STORE, META_STORE, CHUNK_STORE], 'readwrite');
    tx.objectStore(PAYLOAD_STORE).delete(id);
    tx.objectStore(META_STORE).delete(id);
    const cursorRequest = tx.objectStore(CHUNK_STORE).index(CHUNK_INDEX).openCursor(IDBKeyRange.only(id));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
    tx.oncomplete = () => {
      notifyMetadataChanged({ id, deleted: true });
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

async function loadLegacySupportBlob(id: string, fallbackType: string): Promise<Blob> {
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

export async function loadSupportBlob(id: string, fallbackType = 'application/octet-stream'): Promise<Blob> {
  const metadata = await getSupportMetadata<PayloadMetadata>(id);
  if (metadata?.payloadKind !== 'chunks') return loadLegacySupportBlob(id, fallbackType);

  const chunkCount = metadata.payloadChunkCount ?? 0;
  const parts: ArrayBuffer[] = [];
  for (let index = 0; index < chunkCount; index += 1) {
    parts.push(await readPayloadChunk(id, index));
  }
  return new Blob(parts, { type: metadata.type || fallbackType });
}

export async function createSupportByteSource(id: string, fallbackType = 'application/octet-stream'): Promise<SupportByteSource> {
  const metadata = await getSupportMetadata<PayloadMetadata>(id);
  if (!metadata) throw new Error('Support local introuvable.');

  if (metadata.payloadKind !== 'chunks' || !metadata.payloadChunkSize) {
    const blob = await loadLegacySupportBlob(id, metadata.type || fallbackType);
    return {
      size: blob.size,
      readRange: async (begin, end) => new Uint8Array(await blobToArrayBuffer(blob.slice(begin, end))),
      close: () => undefined,
    };
  }

  const chunkSize = metadata.payloadChunkSize;
  const size = metadata.size ?? 0;
  const cache = new Map<number, Uint8Array>();

  const getChunk = async (index: number) => {
    const cached = cache.get(index);
    if (cached) {
      cache.delete(index);
      cache.set(index, cached);
      return cached;
    }

    const chunk = new Uint8Array(await readPayloadChunk(id, index));
    cache.set(index, chunk);
    while (cache.size > CHUNK_CACHE_LIMIT) {
      const oldest = cache.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return chunk;
  };

  return {
    size,
    readRange: async (begin, end) => {
      const safeBegin = Math.min(size, Math.max(0, Math.floor(begin)));
      const safeEnd = Math.min(size, Math.max(safeBegin, Math.floor(end)));
      const result = new Uint8Array(safeEnd - safeBegin);
      if (!result.length) return result;

      const firstChunk = Math.floor(safeBegin / chunkSize);
      const lastChunk = Math.floor((safeEnd - 1) / chunkSize);
      for (let index = firstChunk; index <= lastChunk; index += 1) {
        const chunk = await getChunk(index);
        const chunkStart = index * chunkSize;
        const from = Math.max(safeBegin, chunkStart) - chunkStart;
        const to = Math.min(safeEnd, chunkStart + chunk.length) - chunkStart;
        if (to <= from) continue;
        result.set(chunk.subarray(from, to), chunkStart + from - safeBegin);
      }
      return result;
    },
    close: () => cache.clear(),
  };
}
