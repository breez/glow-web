import { useEffect, useState } from 'react';
import { Network } from '@capacitor/network';
import { logger, LogCategory } from '@/services/logger';

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
      // Logged so Share Logs shows whether the OS connectivity event
      // actually fired (vs a banner-render issue) when debugging.
      logger.info(LogCategory.UI, 'Network status change', {
        connected: status.connected,
        connectionType: status.connectionType,
      });
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
