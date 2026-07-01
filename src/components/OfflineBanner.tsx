import { createPortal } from 'react-dom';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';

/**
 * Thin banner shown while the device is offline. Balance + payment
 * actions depend on the SDK reaching the network, so surfacing the
 * state beats letting actions fail with a generic error. Pinned under
 * the status bar (safe-area-inset-top) and portaled to <body> so it
 * layers above every screen.
 */
const OfflineBanner: React.FC = () => {
  const isOnline = useNetworkStatus();
  if (isOnline) return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[80] flex items-center justify-center gap-2 border-b border-spark-border bg-spark-surface/95 py-1.5 text-xs font-medium text-spark-text-secondary backdrop-blur-md"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.375rem)' }}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-spark-error" />
      No internet connection
    </div>,
    document.body,
  );
};

export default OfflineBanner;
