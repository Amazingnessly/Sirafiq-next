import { getSupportMetadata, SUPPORT_METADATA_CHANGED_EVENT, type SupportMetadataChange } from './storage';

const CHANNEL_NAME = 'sirafiq-support-metadata-v1';
type StoredMetadata = { id: string; [key: string]: unknown };

if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    let dispatchingRemoteChange = false;

    const dispatchRemoteChange = (detail: SupportMetadataChange) => {
      dispatchingRemoteChange = true;
      try {
        window.dispatchEvent(new CustomEvent<SupportMetadataChange>(SUPPORT_METADATA_CHANGED_EVENT, { detail }));
      } finally {
        dispatchingRemoteChange = false;
      }
    };

    const onLocalMetadataChanged = (event: Event) => {
      if (dispatchingRemoteChange) return;
      const detail = (event as CustomEvent<SupportMetadataChange>).detail;
      if (!detail?.id) return;
      try {
        channel.postMessage({ id: detail.id, deleted: Boolean(detail.deleted) } satisfies SupportMetadataChange);
      } catch {
        // La synchronisation inter-onglets est un confort : une erreur ici ne doit jamais bloquer IndexedDB.
      }
    };

    channel.addEventListener('message', (event: MessageEvent<SupportMetadataChange>) => {
      const detail = event.data;
      if (!detail?.id) return;
      if (detail.deleted) {
        dispatchRemoteChange({ id: detail.id, deleted: true });
        return;
      }

      void getSupportMetadata<StoredMetadata>(detail.id).then(metadata => {
        dispatchRemoteChange(metadata
          ? { id: detail.id, metadata }
          : { id: detail.id, deleted: true });
      }).catch(() => {
        // Une lecture distante ratée ne doit pas perturber l’onglet courant.
        // Un prochain événement ou retour de focus resynchronisera l’interface.
      });
    });

    window.addEventListener(SUPPORT_METADATA_CHANGED_EVENT, onLocalMetadataChanged);
  } catch {
    // Certains navigateurs ou contextes privés peuvent refuser BroadcastChannel.
    // Sirāfiq continue alors avec la synchronisation locale à l’onglet.
  }
}
