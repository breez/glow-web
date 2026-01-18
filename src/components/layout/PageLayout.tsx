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
    <div className="h-[calc(100dvh)] w-full flex flex-col bg-spark-surface relative overflow-hidden">
      {/* Atmospheric background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[300px] bg-gradient-radial from-spark-primary/10 to-transparent blur-3xl" />
      </div>

      {showHeader && (
        <header className="relative z-10 px-4 py-4 border-b border-spark-border bg-spark-surface/80 backdrop-blur-sm">
          <div className="container mx-auto">
            <h1 className="text-center font-display text-xl font-bold text-spark-text-primary">
              {title || "Glow"}
            </h1>
          </div>
          {onBack && (
            <button 
              onClick={onBack} 
              className="absolute top-1/2 left-4 -translate-y-1/2 p-2 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors"
              aria-label="Go back"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
        </header>
      )}

      <main className="relative z-10 flex items-center flex-col w-full mx-auto flex-grow overflow-hidden">
        <div className="flex-1 w-full overflow-y-auto py-6">
          {children}
        </div>
        <div className="flex-shrink-0 w-full pb-4 border-t border-spark-border bg-spark-surface/80 backdrop-blur-sm">
          {footer}
        </div>
      </main>
    </div>
  );
};

export default PageLayout;
