import { getSupportMetadata, SUPPORT_METADATA_CHANGED_EVENT, type SupportMetadataChange } from './storage';

const CHANNEL_NAME = 'sirafiq-support-metadata-v1';
const STORAGE_SIGNAL_KEY = 'sirafiq-support-metadata-sync-v1';
const SEEN_SIGNAL_LIMIT = 100;

type StoredMetadata = { id: string; [key: string]: unknown };
type SyncSignal = { id: string; deleted?: boolean; nonce?: string };

function isSyncSignal(value: unknown): value is SyncSignal {
  if (!value || typeof value !== 'object') return false;
  const signal = value as Partial<SyncSignal>;
  return typeof signal.id === 'string' && Boolean(signal.id.trim()) && (signal.deleted === undefined || typeof signal.deleted === 'boolean');
}

if (typeof window !== 'undefined') {
  let dispatchingRemoteChange = false;
  let channel: BroadcastChannel | null = null;
  const seenSignals = new Set<string>();

  const dispatchRemoteChange = (detail: SupportMetadataChange) => {
    dispatchingRemoteChange = true;
    try {
      window.dispatchEvent(new CustomEvent<SupportMetadataChange>(SUPPORT_METADATA_CHANGED_EVENT, { detail }));
    } finally {
      dispatchingRemoteChange = false;
    }
  };

  const rememberSignal = (signal: SyncSignal) => {
    if (!signal.nonce) return true;
    if (seenSignals.has(signal.nonce)) return false;
    seenSignals.add(signal.nonce);
    while (seenSignals.size > SEEN_SIGNAL_LIMIT) {
      const oldest = seenSignals.values().next().value as string | undefined;
      if (!oldest) break;
      seenSignals.delete(oldest);
    }
    return true;
  };

  const relaySignal = (value: unknown) => {
    if (!isSyncSignal(value) || !rememberSignal(value)) return;
    void getSupportMetadata<StoredMetadata>(value.id).then(metadata => {
      dispatchRemoteChange(metadata
        ? { id: value.id, metadata }
        : { id: value.id, deleted: true });
    }).catch(() => {
      // Une lecture distante ratée ne doit jamais perturber l’onglet courant.
      // Un prochain événement ou retour de focus pourra resynchroniser l’interface.
    });
  };

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.addEventListener('message', (event: MessageEvent<unknown>) => relaySignal(event.data));
    } catch {
      channel = null;
    }
  }

  const onLocalMetadataChanged = (event: Event) => {
    if (dispatchingRemoteChange) return;
    const detail = (event as CustomEvent<SupportMetadataChange>).detail;
    if (!detail?.id) return;

    const nonce = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
    const signal: SyncSignal = { id: detail.id, deleted: Boolean(detail.deleted), nonce };

    try {
      channel?.postMessage(signal);
    } catch {
      // Le fallback storage ci-dessous reste disponible.
    }

    try {
      window.localStorage.setItem(STORAGE_SIGNAL_KEY, JSON.stringify(signal));
    } catch {
      // La synchronisation inter-onglets reste un confort et ne doit jamais bloquer IndexedDB.
    }
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_SIGNAL_KEY || !event.newValue) return;
    try {
      relaySignal(JSON.parse(event.newValue));
    } catch {
      // Ignorer un signal de stockage illisible.
    }
  };

  window.addEventListener(SUPPORT_METADATA_CHANGED_EVENT, onLocalMetadataChanged);
  window.addEventListener('storage', onStorage);
}
