export type ValidatedWatchItem = {
  id: string;
  title: string;
  url: string;
  collection: string;
  status: 'À voir' | 'En cours' | 'Terminé';
  priority?: 'Maintenant' | 'Bientôt' | 'Plus tard';
  resumeNote?: string;
  lastOpenedAt?: string;
  addedAt: string;
};

export function normalizeWatchUrl(value: unknown): string | null;
export function validateWatchItems(value: unknown): { ok: boolean; items: ValidatedWatchItem[] };
