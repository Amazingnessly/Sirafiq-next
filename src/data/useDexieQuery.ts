import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';

export class LocalDataReadError extends Error {
  constructor(public readonly cause: unknown) {
    super('IndexedDB query failed');
    this.name = 'LocalDataReadError';
  }
}

type QueryState<T> = {
  deps: readonly unknown[];
  value: T;
  error: unknown;
};

function sameDeps(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}

export function useDexieQuery<T>(query: () => Promise<T>, deps: readonly unknown[], initial: T): T {
  const [state, setState] = useState<QueryState<T>>({ deps, value: initial, error: null });
  const currentState = sameDeps(state.deps, deps) ? state : { deps, value: initial, error: null };

  useEffect(() => {
    // Scope the result to the dependency snapshot that produced it. Effects run
    // after render, so clearing state only here can expose the previous query's
    // value for one paint after navigation. A stale subscription may also emit
    // before React runs its cleanup; tagging every emission with its dependency
    // snapshot keeps that old value hidden during the transition.
    setState((previous) => sameDeps(previous.deps, deps) ? previous : { deps, value: initial, error: null });

    const subscription = liveQuery(query).subscribe({
      next: (value) => setState({ deps, value, error: null }),
      error: (queryError) => {
        console.error('IndexedDB query failed', queryError);
        setState({ deps, value: initial, error: new LocalDataReadError(queryError) });
      },
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  if (currentState.error) throw currentState.error;
  return currentState.value;
}
