import { installSyncTriggers, requestSync } from './sync';
import { retryTransientSyncFailuresNow } from './retryableSync';

/**
 * Extends the regular sync triggers for iPad/Safari lifecycle behaviour.
 * Safari can suspend intervals while the app is backgrounded and may restore
 * a page from the back/forward cache without emitting a fresh online event.
 */
export function installResilientSyncTriggers(): () => void {
  const uninstallBaseTriggers = installSyncTriggers();

  const syncWhenVisible = () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      void requestSync();
    }
  };

  const syncAfterPageRestore = () => {
    if (navigator.onLine) void requestSync();
  };

  const retryAfterReconnect = () => {
    void retryTransientSyncFailuresNow();
  };

  document.addEventListener('visibilitychange', syncWhenVisible);
  window.addEventListener('pageshow', syncAfterPageRestore);
  window.addEventListener('online', retryAfterReconnect);

  return () => {
    uninstallBaseTriggers();
    document.removeEventListener('visibilitychange', syncWhenVisible);
    window.removeEventListener('pageshow', syncAfterPageRestore);
    window.removeEventListener('online', retryAfterReconnect);
  };
}
