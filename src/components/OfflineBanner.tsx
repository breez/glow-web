import { createPortal } from 'react-dom';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { safeAreaTop } from '../utils/safeAreaInsets';

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
    // Align the pill's top edge with the app bar Buy button: the header
    // row is h-14 (56px) with the h-9 (36px) button centered, so the
    // button top sits 10px below the safe-area top. Uses safeAreaTop
    // because env(safe-area-inset-top) is unreliable on the Android WebView.
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex justify-center"
      style={{ paddingTop: `calc(${safeAreaTop} + 10px)` }}
    >
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-spark-surface px-3 py-1 text-xs font-medium text-spark-text-secondary shadow-glass-lg"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-spark-error" />
        No internet connection
      </div>
    </div>,
    document.body,
  );
};

export default OfflineBanner;
