import React, { ReactNode, forwardRef, useState, useRef, useCallback } from 'react';
import { Transition } from '@headlessui/react';

/**
 * Bottom sheet components for modal dialogs that slide up from the bottom.
 * Supports swipe-to-close and swipe-up-to-expand gestures.
 */

export type BottomSheetMaxWidth = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const maxWidthMap: Record<BottomSheetMaxWidth, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-full',
};

/** Minimum upward drag distance to trigger expansion */
const EXPAND_THRESHOLD = 50;
/** Minimum downward drag distance to trigger close/collapse */
const CLOSE_THRESHOLD = 100;

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
  const [isExpanded, setIsExpanded] = useState(false);
  const startY = useRef(0);
  const currentY = useRef(0);
  const dragSource = useRef<'handle' | 'body'>('body');

  const handleTouchStart = useCallback((e: React.TouchEvent, source: 'handle' | 'body') => {
    e.stopPropagation();
    startY.current = e.touches[0].clientY;
    currentY.current = e.touches[0].clientY;
    dragSource.current = source;
    setIsDragging(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return;
    e.stopPropagation();
    currentY.current = e.touches[0].clientY;
    const diff = currentY.current - startY.current;

    if (dragSource.current === 'handle') {
      // Handle allows both directions
      setDragY(diff);
    } else {
      // Body only allows downward drag
      if (diff > 0) {
        setDragY(diff);
      }
    }
  }, [isDragging]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    setIsDragging(false);
    const diff = currentY.current - startY.current;

    if (diff < -EXPAND_THRESHOLD && dragSource.current === 'handle' && !isExpanded) {
      // Swipe up on handle → expand
      setIsExpanded(true);
    } else if (diff > CLOSE_THRESHOLD) {
      if (isExpanded) {
        // Swipe down from expanded → collapse
        setIsExpanded(false);
      } else if (onClose) {
        // Swipe down from collapsed → close
        e.preventDefault();
        e.stopPropagation();
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        onClose();
      }
    }

    setDragY(0);
  }, [isExpanded, onClose]);

  // Reset expanded state when sheet closes
  const handleAfterLeave = useCallback(() => {
    setIsExpanded(false);
  }, []);

  const maxWidthClass = maxWidthMap[maxWidth];
  const heightClass = fullHeight
    ? 'h-full'
    : isExpanded
      ? `h-[${maxHeightVh}vh]`
      : `max-h-[${maxHeightVh}vh]`;

  return (
    <Transition
      show={isOpen}
      as="div"
      className="absolute inset-0 z-50 overflow-hidden flex flex-col justify-end pointer-events-none"
      afterLeave={handleAfterLeave}
    >
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
        className={`mx-auto w-full ${maxWidthClass} ${heightClass} pointer-events-auto z-10 ${!isDragging ? 'transition-[height] duration-300 ease-out' : ''} ${className}`}
        style={{ transform: dragY !== 0 ? `translateY(${dragY > 0 ? dragY : 0}px)` : undefined }}
        onTouchStart={(e) => handleTouchStart(e, 'body')}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {React.Children.map(children, child => {
          if (React.isValidElement(child) && child.type === BottomSheetCard) {
            return React.cloneElement(child as React.ReactElement<BottomSheetCardInternalProps>, {
              _isExpanded: isExpanded,
              _onHandleTouchStart: (e: React.TouchEvent) => handleTouchStart(e, 'handle'),
            });
          }
          return child;
        })}
      </Transition.Child>
    </Transition>
  );
};

export interface BottomSheetCardProps {
  children: ReactNode;
  className?: string;
}

/** Internal props injected by BottomSheetContainer */
interface BottomSheetCardInternalProps extends BottomSheetCardProps {
  _isExpanded?: boolean;
  _onHandleTouchStart?: (e: React.TouchEvent) => void;
}

export const BottomSheetCard = forwardRef<HTMLDivElement, BottomSheetCardProps>(
  (props, ref) => {
    const { children, className = "", ...rest } = props as BottomSheetCardInternalProps;
    const { _isExpanded, _onHandleTouchStart } = rest;

    return (
      <div
        ref={ref}
        className={`bottom-sheet-card bg-spark-surface border-t border-spark-border rounded-t-3xl shadow-glass-lg overflow-hidden w-full ${_isExpanded ? 'h-full flex flex-col' : ''} ${className}`}
      >
        {/* Drag handle — swipe zone for expand/collapse */}
        <div
          className="bottom-sheet-handle"
          onTouchStart={_onHandleTouchStart}
        />
        <div className={`pt-3 ${_isExpanded ? 'flex-1 overflow-y-auto min-h-0' : ''}`}>
          {children}
        </div>
      </div>
    );
  }
);

BottomSheetCard.displayName = 'BottomSheetCard';
