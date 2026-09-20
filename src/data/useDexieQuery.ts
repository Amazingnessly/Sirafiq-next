import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';

export function useDexieQuery<T>(query: () => Promise<T>, deps: readonly unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    // A dependency change means this value belongs to a different query scope.
    // Clear the previous result immediately so navigation cannot briefly expose
    // data from the previously selected subject/resource while IndexedDB loads.
    setValue(initial);

    const subscription = liveQuery(query).subscribe({
      next: setValue,
      error: (error) => console.error('IndexedDB query failed', error),
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return value;
}
