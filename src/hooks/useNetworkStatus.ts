import { useEffect, useState } from 'react';
import { Network } from '@capacitor/network';

/**
 * Tracks device connectivity via @capacitor/network. On native this is
 * the OS connectivity signal, which navigator.onLine is not: inside a
 * mobile WebView navigator.onLine is frequently stuck true. Defaults to
 * online so nothing flashes an offline state before the first read.
 */
export function useNetworkStatus(): boolean {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let remove: (() => void) | undefined;

    Network.getStatus()
      .then(status => {
        if (!cancelled) setIsOnline(status.connected);
      })
      .catch(() => {
        /* status unavailable — assume online */
      });

    Network.addListener('networkStatusChange', status => {
      setIsOnline(status.connected);
    })
      .then(handle => {
        if (cancelled) handle.remove();
        else remove = () => handle.remove();
      })
      .catch(() => {
        /* listener unsupported on this host — ignore */
      });

    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);

  return isOnline;
}
