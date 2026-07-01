import { createPortal } from 'react-dom';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';

/**
 * Offline indicator: a compact centered pill pinned below the status
 * bar. It is purely informational, so the wrapper is pointer-events-none
 * (taps pass straight through to the app bar's menu / Buy controls at the
 * top corners) and the pill is centered so it does not sit over them.
 * Portaled to <body> to layer above every screen. Native connectivity
 * comes from @capacitor/network.
 */
const OfflineBanner: React.FC = () => {
  const isOnline = useNetworkStatus();
  if (isOnline) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex justify-center"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
    >
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-1.5 rounded-full border border-spark-border bg-spark-surface/95 px-3 py-1 text-xs font-medium text-spark-text-secondary shadow-glass-lg backdrop-blur-md"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-spark-error" />
        No internet connection
      </div>
    </div>,
    document.body,
  );
};

export default OfflineBanner;
