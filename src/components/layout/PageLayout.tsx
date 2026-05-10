import React, { ReactNode } from 'react';
import { BackIcon } from '../Icons';
import { safeAreaTop, safeAreaBottom } from '../../utils/safeAreaInsets';
import { useStatusBarColor } from '../../hooks/useStatusBarColor';
import { STATUS_BAR_SURFACE } from '../../utils/statusBarManager';

interface PageLayoutProps {
  children: ReactNode;
  footer: ReactNode;
  onBack?: () => void;
  title?: string;
  showHeader?: boolean;
  onClearError?: () => void;
}

const PageLayout: React.FC<PageLayoutProps> = ({
  children,
  title,
  footer,
  onBack,
  showHeader = true,
}) => {
  useStatusBarColor(STATUS_BAR_SURFACE);

  return (
    <div className="relative h-dvh flex flex-col bg-spark-surface">
      {showHeader && (
        <header
          className="relative z-10 shrink-0 border-b border-spark-border bg-spark-surface/80 backdrop-blur-sm"
          style={{ paddingTop: safeAreaTop }}
        >
          <div className="relative flex h-14 items-center justify-center px-4">
            <h1 className="font-display text-xl font-bold text-spark-text-primary">
              {title || 'Glow'}
            </h1>
            {onBack && (
              <button
                onClick={onBack}
                aria-label="Go back"
                className="absolute left-4 top-1/2 -translate-y-1/2 p-2 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors"
              >
                <BackIcon />
              </button>
            )}
          </div>
        </header>
      )}

      <main
        className="relative z-10 flex-1 overflow-y-auto p-4"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {children}
      </main>

      {footer && (
        <footer
          className="relative z-10 shrink-0 border-t border-spark-border bg-spark-surface/80 backdrop-blur-sm"
          style={{ paddingBottom: safeAreaBottom }}
        >
          <div className="p-4">{footer}</div>
        </footer>
      )}
    </div>
  );
};

export default PageLayout;
