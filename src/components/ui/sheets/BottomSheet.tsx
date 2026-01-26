import React, { ReactNode, forwardRef, useState, useRef } from 'react';
import { Transition } from '@headlessui/react';

/**
 * Bottom sheet components for modal dialogs that slide up from the bottom.
 * Includes swipe-to-close gesture handling.
 */

export type BottomSheetMaxWidth = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const maxWidthMap: Record<BottomSheetMaxWidth, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-full',
};

export interface BottomSheetContainerProps {
  isOpen: boolean;
  children: ReactNode;
  className?: string;
  onClose?: () => void;
  /** Maximum width of the sheet (default: 'full' - uses parent container width) */
  maxWidth?: BottomSheetMaxWidth;
  /** Maximum height as viewport percentage (default: 90) */
  maxHeightVh?: number;
  /** Whether sheet takes full height (for QR scanner, etc.) */
  fullHeight?: boolean;
  /** Whether to show a backdrop overlay (useful for nested sheets) */
  showBackdrop?: boolean;
}

export const BottomSheetContainer: React.FC<BottomSheetContainerProps> = ({
  isOpen,
  children,
  className = "",
  onClose,
  maxWidth = 'full',
  maxHeightVh = 90,
  fullHeight = false,
  showBackdrop = false,
}) => {
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startY = useRef(0);
  const currentY = useRef(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    startY.current = e.touches[0].clientY;
    currentY.current = e.touches[0].clientY;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    e.stopPropagation();
    currentY.current = e.touches[0].clientY;
    const diff = currentY.current - startY.current;
    if (diff > 0) {
      setDragY(diff);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    setIsDragging(false);
    if (dragY > 100 && onClose) {
      // Prevent the touch event from propagating to elements underneath
      e.preventDefault();
      e.stopPropagation();
      // Blur any focused element
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      onClose();
    }
    setDragY(0);
  };

  const maxWidthClass = maxWidthMap[maxWidth];
  const heightClass = fullHeight ? 'h-full' : `max-h-[${maxHeightVh}vh]`;

  return (
    <Transition show={isOpen} as="div" className="absolute inset-0 z-50 overflow-hidden flex flex-col justify-end pointer-events-none">
      {/* Optional backdrop for nested sheets */}
      {showBackdrop && (
        <Transition.Child
          as="div"
          enter="transition-opacity ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="transition-opacity ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
          className="absolute inset-0 bg-black/60 pointer-events-auto z-0"
          onClick={onClose}
        />
      )}
      <Transition.Child
        as="div"
        enter="transform transition ease-out duration-300"
        enterFrom="translate-y-full opacity-0"
        enterTo="translate-y-0 opacity-100"
        leave="transform transition ease-out duration-300"
        leaveFrom="translate-y-0 opacity-100"
        leaveTo="translate-y-1/2 opacity-0"
        className={`mx-auto w-full ${maxWidthClass} ${heightClass} pointer-events-auto z-10 ${className}`}
        style={{ transform: dragY > 0 ? `translateY(${dragY}px)` : undefined }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </Transition.Child>
    </Transition>
  );
};

export interface BottomSheetCardProps {
  children: ReactNode;
  className?: string;
}

export const BottomSheetCard = forwardRef<HTMLDivElement, BottomSheetCardProps>(
  ({ children, className = "" }, ref) => {
    return (
      <div
        ref={ref}
        className={`bg-spark-surface border-t border-spark-border rounded-t-3xl shadow-glass-lg overflow-hidden w-full ${className}`}
      >
        {/* Drag handle indicator */}
        <div className="bottom-sheet-handle" />
        <div className="px-6 pb-6 pt-3 safe-area-bottom">
          {children}
        </div>
      </div>
    );
  }
);

BottomSheetCard.displayName = 'BottomSheetCard';
