import React, { ReactNode } from 'react';
import { BackIcon } from '../Icons';
import { safeAreaTop, safeAreaBottom } from '../../utils/safeAreaInsets';
import { useStatusBarColor } from '../../hooks/useStatusBarColor';
import { STATUS_BAR_SURFACE } from '../../utils/statusBarManager';

interface PageLayoutProps {
  children: ReactNode;
  footer: ReactNode
  onBack: () => void | null;
  title?: string;
  showHeader?: boolean;
  onClearError?: () => void;
}

const PageLayout: React.FC<PageLayoutProps> = ({
  children,
  title,
  footer,
  onBack = null,
  showHeader = true,
}) => {
  // Generic PageLayout screens (get refund, etc.) use a solid
  // spark-surface background; match the system bars to that tone.
  useStatusBarColor(STATUS_BAR_SURFACE);

  return (
    <div className="min-h-dvh h-dvh w-full flex flex-col bg-spark-surface relative">
      {showHeader && (
        <header
          className="relative z-10 flex-shrink-0 border-b border-spark-border bg-spark-surface/80 backdrop-blur-sm"
          style={{ paddingTop: safeAreaTop }}
        >
          {/* Fixed h-14 (56dp) Material toolbar height, matching the
              wallet page CollapsingWalletHeader top row so the back button
              lands at the same screen y coordinate when navigating. */}
          <div className="relative px-4 h-14 flex items-center justify-center">
            <h1 className="text-center font-display text-xl font-bold text-spark-text-primary">
              {title || "Glow"}
            </h1>
            {onBack && (
              <button
                onClick={onBack}
                className="absolute left-4 top-1/2 -translate-y-1/2 p-2 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors"
                aria-label="Go back"
              >
                <BackIcon />
              </button>
            )}
          </div>
        </header>
      )}

      {/* Scrollable content area */}
      <main 
        className="relative z-10 flex-1 w-full overflow-y-auto p-4"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {children}
      </main>

      {/* Fixed footer */}
      {footer && (
        <footer
          className="relative z-10 flex-shrink-0 w-full border-t border-spark-border bg-spark-surface/80 backdrop-blur-sm"
          style={{ paddingBottom: safeAreaBottom }}
        >
          <div className="px-4 py-4">
            {footer}
          </div>
        </footer>
      )}
    </div>
  );
};

export default PageLayout;
