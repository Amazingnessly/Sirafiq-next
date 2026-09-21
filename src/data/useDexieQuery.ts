import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';

export class LocalDataReadError extends Error {
  constructor(public readonly cause: unknown) {
    super('IndexedDB query failed');
    this.name = 'LocalDataReadError';
  }
}

export function useDexieQuery<T>(query: () => Promise<T>, deps: readonly unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    // A dependency change means this value belongs to a different query scope.
    // Clear the previous result immediately so navigation cannot briefly expose
    // data from the previously selected subject/resource while IndexedDB loads.
    setValue(initial);
    setError(null);

    const subscription = liveQuery(query).subscribe({
      next: setValue,
      error: (queryError) => {
        console.error('IndexedDB query failed', queryError);
        setError(new LocalDataReadError(queryError));
      },
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  if (error) throw error;
  return value;
}
