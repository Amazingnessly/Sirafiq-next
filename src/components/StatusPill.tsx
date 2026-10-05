import type { LocalResourceStatus, SyncState } from '../data/db';

export function StatusPill({ status, syncState }: { status: LocalResourceStatus; syncState: SyncState }) {
  if (status === 'failed') return <span className="status status--danger">Extraction à revoir</span>;
  if (syncState === 'error') return <span className="status status--warning">À resynchroniser</span>;
  if (syncState === 'pending') return <span className="status status--soft">En attente de synchro</span>;
  return <span className="status status--success">Synchronisé</span>;
}
