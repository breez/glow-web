import React, { ReactNode } from 'react';

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
  return (
    <div className="h-full w-full flex flex-col bg-spark-surface relative overflow-hidden">
      {showHeader && (
        <header
          className="relative z-10 border-b border-spark-border bg-spark-surface/80 backdrop-blur-sm"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <div className="relative px-4 py-4 flex items-center justify-center">
            <h1 className="text-center font-display text-xl font-bold text-spark-text-primary">
              {title || "Glow"}
            </h1>
            {onBack && (
              <button
                onClick={onBack}
                className="absolute left-4 top-1/2 -translate-y-1/2 p-2 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors"
                aria-label="Go back"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
          </div>
        </header>
      )}

      <main className="relative z-10 flex items-center flex-col w-full mx-auto flex-grow overflow-hidden">
        <div className="flex-1 w-full overflow-y-auto p-4">
          {children}
        </div>
        <div
          className="flex-shrink-0 w-full border-t border-spark-border bg-spark-surface/80 backdrop-blur-sm"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <div className="px-4 py-4">
            {footer}
          </div>
        </div>
      </main>
    </div>
  );
};

export default PageLayout;
