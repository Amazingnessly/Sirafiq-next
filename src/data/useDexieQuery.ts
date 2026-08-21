import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';

export function useDexieQuery<T>(query: () => Promise<T>, deps: readonly unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    const subscription = liveQuery(query).subscribe({
      next: setValue,
      error: (error) => console.error('IndexedDB query failed', error),
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return value;
}
