import React, { ReactNode, useState } from 'react';
import { Transition } from '@headlessui/react';
import { CloseIcon, BackIcon } from '../Icons';

type SlideDirection = 'left' | 'right' | 'up' | 'down';

interface SlideInPageProps {
  children: ReactNode;
  title: string;
  /** Close button style: 'close' shows X on right, 'back' shows < on left */
  closeStyle?: 'close' | 'back';
  onClose: () => void;
  /** Direction the page slides in from (default: 'left') */
  slideFrom?: SlideDirection;
  /** Optional footer content */
  footer?: ReactNode;
}

const slideTransforms: Record<SlideDirection, { from: string; to: string }> = {
  left: { from: 'translate-x-[-100%]', to: 'translate-x-0' },
  right: { from: 'translate-x-full', to: 'translate-x-0' },
  up: { from: 'translate-y-full', to: 'translate-y-0' },
  down: { from: 'translate-y-[-100%]', to: 'translate-y-0' },
};

/**
 * SlideInPage - A reusable full-screen page component with:
 * - Slide-in animation from any direction
 * - Safe area handling (top for header, bottom for footer)
 * - Solid background (no grid showing through)
 * - Consistent header with title and close/back button
 * - Optional footer with safe area bottom padding
 */
const SlideInPage: React.FC<SlideInPageProps> = ({
  children,
  title,
  closeStyle = 'close',
  onClose,
  slideFrom = 'left',
  footer,
}) => {
  const [isOpen, setIsOpen] = useState(true);

  const handleClose = () => {
    setIsOpen(false);
    setTimeout(onClose, 220);
  };

  const { from, to } = slideTransforms[slideFrom];

  return (
    <div className="absolute inset-0 z-50 overflow-hidden">
      <Transition show={isOpen} appear as="div" className="absolute inset-0">
        <Transition.Child
          as="div"
          enter="transform transition ease-out duration-300"
          enterFrom={from}
          enterTo={to}
          leave="transform transition ease-in duration-200"
          leaveFrom={to}
          leaveTo={from}
          className="absolute inset-0 flex flex-col bg-spark-surface"
        >
          {/* Header with safe area top padding */}
          <header
            className="flex-shrink-0 border-b border-spark-border"
            style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
          >
            <div className="relative px-4 py-4 flex items-center justify-center">
              <h1 className="text-center font-display text-lg font-semibold text-spark-text-primary">
                {title}
              </h1>

              {closeStyle === 'back' ? (
                <button
                  onClick={handleClose}
                  className="absolute left-4 top-1/2 -translate-y-1/2 p-2 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors"
                  aria-label="Go back"
                >
                  <BackIcon size="md" />
                </button>
              ) : (
                <button
                  onClick={handleClose}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors"
                  aria-label="Close"
                >
                  <CloseIcon size="md" />
                </button>
              )}
            </div>
          </header>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {children}
          </div>

          {/* Optional footer with safe area bottom padding */}
          {footer && (
            <footer
              className="flex-shrink-0 border-t border-spark-border bg-spark-surface"
              style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
            >
              <div className="p-4">
                <div className="max-w-xl mx-auto">
                  {footer}
                </div>
              </div>
            </footer>
          )}
        </Transition.Child>
      </Transition>
    </div>
  );
};

export default SlideInPage;
