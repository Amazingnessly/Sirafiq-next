import { SUPPORT_METADATA_CHANGED_EVENT, type SupportMetadataChange } from './storage';

const CHANNEL_NAME = 'sirafiq-support-metadata-v1';

if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    let dispatchingRemoteChange = false;

    const onLocalMetadataChanged = (event: Event) => {
      if (dispatchingRemoteChange) return;
      const detail = (event as CustomEvent<SupportMetadataChange>).detail;
      if (!detail?.id) return;
      try {
        channel.postMessage(detail);
      } catch {
        // La synchronisation inter-onglets est un confort : une erreur ici ne doit jamais bloquer IndexedDB.
      }
    };

    channel.addEventListener('message', (event: MessageEvent<SupportMetadataChange>) => {
      const detail = event.data;
      if (!detail?.id) return;
      dispatchingRemoteChange = true;
      try {
        window.dispatchEvent(new CustomEvent<SupportMetadataChange>(SUPPORT_METADATA_CHANGED_EVENT, { detail }));
      } finally {
        dispatchingRemoteChange = false;
      }
    });

    window.addEventListener(SUPPORT_METADATA_CHANGED_EVENT, onLocalMetadataChanged);
  } catch {
    // Certains navigateurs ou contextes privés peuvent refuser BroadcastChannel.
    // Sirāfiq continue alors avec la synchronisation locale à l’onglet.
  }
}
