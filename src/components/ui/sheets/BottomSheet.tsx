import React, { ReactNode, forwardRef, useState, useRef, useCallback, useEffect } from 'react';
import { Transition } from '@headlessui/react';

/**
 * Bottom sheet inspired by @gorhom/react-native-bottom-sheet.
 *
 * Snap points: [contentHeight, maxHeightVh%]
 * - Dynamic sizing: first snap point is auto-measured from content
 * - Second snap point is maxHeightVh (default 90vh)
 * - Dragging below first snap point dismisses (pan-down-to-close)
 * - Over-drag has resistance factor
 *
 * Gestures:
 * - Handle: drag freely up/down to resize between snap points
 * - Body: drag down to collapse or dismiss
 */

export type BottomSheetMaxWidth = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const maxWidthMap: Record<BottomSheetMaxWidth, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-full',
};

/** Over-drag resistance: higher = stiffer (à la gorhom) */
const OVER_DRAG_RESISTANCE = 2.5;
/** Velocity threshold (px) — snap toward the direction of the gesture */
const SNAP_VELOCITY_THRESHOLD = 50;

/** Find the nearest snap point, biased by drag direction */
function resolveSnap(height: number, snapPoints: number[], dy: number): number {
  // If dragged past threshold in a direction, snap toward that direction
  if (dy < -SNAP_VELOCITY_THRESHOLD) {
    // Swiped up: find next snap point above current height
    for (const sp of snapPoints) {
      if (sp > height + 10) return sp;
    }
    return snapPoints[snapPoints.length - 1];
  }
  if (dy > SNAP_VELOCITY_THRESHOLD) {
    // Swiped down: find next snap point below current height, or -1 (close)
    for (let i = snapPoints.length - 1; i >= 0; i--) {
      if (snapPoints[i] < height - 10) return snapPoints[i];
    }
    return -1; // below all snap points → close
  }
  // No clear direction: snap to nearest
  let nearest = snapPoints[0];
  let minDist = Math.abs(height - nearest);
  for (let i = 1; i < snapPoints.length; i++) {
    const dist = Math.abs(height - snapPoints[i]);
    if (dist < minDist) {
      nearest = snapPoints[i];
      minDist = dist;
    }
  }
  // If closer to "below first snap" than to first snap, close
  if (height < snapPoints[0] * 0.5) return -1;
  return nearest;
}

/** Apply rubber-band resistance for over-drag */
function applyResistance(overAmount: number): number {
  return overAmount / OVER_DRAG_RESISTANCE;
}

export interface BottomSheetContainerProps {
  isOpen: boolean;
  children: ReactNode;
  className?: string;
  onClose?: () => void;
  maxWidth?: BottomSheetMaxWidth;
  /** Maximum height as viewport percentage (default: 90) */
  maxHeightVh?: number;
  /** Whether sheet takes full height (for QR scanner, etc.) */
  fullHeight?: boolean;
  /** Whether to show a backdrop overlay */
  showBackdrop?: boolean;
}

export const BottomSheetContainer: React.FC<BottomSheetContainerProps> = ({
  isOpen,
  children,
  className = "",
  onClose,
  maxWidth = 'full',
  maxHeightVh = 100,
  fullHeight = false,
  showBackdrop = false,
}) => {
  // Current snap index: 0 = content, 1 = full. null = not yet measured.
  const [snapIndex, setSnapIndex] = useState(0);
  // Explicit height during drag (null = use snap point)
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  // Body dismiss translateY
  const [bodyDragY, setBodyDragY] = useState(0);
  const [animating, setAnimating] = useState(false);

  const dragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);
  const source = useRef<'handle' | 'body'>('body');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentHeight = useRef(0);

  const maxPx = useCallback(() => {
    return window.innerHeight * (maxHeightVh / 100);
  }, [maxHeightVh]);

  const getSnapPoints = useCallback((): number[] => {
    const content = contentHeight.current;
    const full = maxPx();
    // If content fills most of the screen, only one snap point
    if (content >= full * 0.9) return [full];
    return [content, full];
  }, [maxPx]);

  const getSnapHeight = useCallback((index: number): number => {
    const points = getSnapPoints();
    return points[Math.min(index, points.length - 1)] ?? points[0];
  }, [getSnapPoints]);

  const dismiss = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    onClose?.();
  }, [onClose]);

  // Measure content height after mount / content changes
  useEffect(() => {
    if (!isOpen || !wrapperRef.current) return;
    // Use rAF to measure after layout
    const id = requestAnimationFrame(() => {
      if (wrapperRef.current) {
        contentHeight.current = wrapperRef.current.getBoundingClientRect().height;
      }
    });
    return () => cancelAnimationFrame(id);
  }, [isOpen, children]);

  const onDown = useCallback((e: React.PointerEvent, src: 'handle' | 'body') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragging.current = true;
    startY.current = e.clientY;
    source.current = src;
    setAnimating(false);
    if (wrapperRef.current) {
      startHeight.current = wrapperRef.current.getBoundingClientRect().height;
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dy = e.clientY - startY.current;

    if (source.current === 'handle') {
      const raw = startHeight.current - dy;
      const full = maxPx();
      // Apply rubber-band resistance at boundaries
      let clamped: number;
      if (raw > full) {
        clamped = full + applyResistance(raw - full);
      } else if (raw < 0) {
        clamped = -applyResistance(-raw);
      } else {
        clamped = raw;
      }
      setDragHeight(clamped);
    } else {
      // Body: translate down with resistance past 0
      setBodyDragY(Math.max(0, dy));
    }
  }, [maxPx]);

  const onUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    const dy = e.clientY - startY.current;
    setAnimating(true);

    if (source.current === 'handle') {
      const currentHeight = startHeight.current - dy;
      const snapPoints = getSnapPoints();
      const target = resolveSnap(currentHeight, snapPoints, dy);

      if (target === -1) {
        dismiss();
      } else {
        const idx = snapPoints.indexOf(target);
        setSnapIndex(idx >= 0 ? idx : 0);
      }
      setDragHeight(null);
    } else {
      if (dy > SNAP_VELOCITY_THRESHOLD) {
        if (snapIndex > 0) {
          // Collapse to previous snap
          setSnapIndex(snapIndex - 1);
        } else {
          // At lowest snap → dismiss
          dismiss();
        }
      }
      setBodyDragY(0);
    }
  }, [snapIndex, dismiss, getSnapPoints]);

  const onCancel = useCallback(() => {
    dragging.current = false;
    setAnimating(true);
    setDragHeight(null);
    setBodyDragY(0);
  }, []);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setSnapIndex(0);
      setDragHeight(null);
      setBodyDragY(0);
      setAnimating(false);
      dragging.current = false;
    }
  }, [isOpen]);

  const maxWidthClass = maxWidthMap[maxWidth];
  const isExpanded = snapIndex > 0 || dragHeight !== null;
  // Full screen when snapped to top or dragged near max height
  const isFullScreen = fullHeight || snapIndex > 0 || (dragHeight !== null && dragHeight > maxPx() * 0.85);

  const wrapperStyle: React.CSSProperties = {
    maxHeight: fullHeight ? undefined : `${maxHeightVh}vh`,
  };

  if (fullHeight) {
    wrapperStyle.height = '100%';
  } else if (dragHeight !== null) {
    wrapperStyle.height = `${Math.max(0, dragHeight)}px`;
  } else if (snapIndex > 0) {
    wrapperStyle.height = `${getSnapHeight(snapIndex)}px`;
  }
  // snapIndex 0 + no dragHeight = auto/content height

  if (bodyDragY > 0) {
    wrapperStyle.transform = `translateY(${bodyDragY}px)`;
  }

  if (animating && dragHeight === null && bodyDragY === 0) {
    wrapperStyle.transition = 'height 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94), transform 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
  }

  return (
    <Transition
      show={isOpen}
      as="div"
      className="absolute inset-0 z-50 overflow-hidden flex flex-col justify-end pointer-events-none"
    >
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
        className={`mx-auto w-full ${maxWidthClass} pointer-events-auto z-10 ${className}`}
        style={wrapperStyle}
        ref={wrapperRef}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('.bottom-sheet-handle-zone')) return;
          onDown(e, 'body');
        }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
      >
        {React.Children.map(children, child => {
          if (React.isValidElement(child) && child.type === BottomSheetCard) {
            return React.cloneElement(child as React.ReactElement<BottomSheetCardInternalProps>, {
              _expanded: isExpanded,
              _isFullScreen: isFullScreen,
              _onHandlePointerDown: (e: React.PointerEvent) => onDown(e, 'handle'),
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

interface BottomSheetCardInternalProps extends BottomSheetCardProps {
  _expanded?: boolean;
  _isFullScreen?: boolean;
  _onHandlePointerDown?: (e: React.PointerEvent) => void;
}

export const BottomSheetCard = forwardRef<HTMLDivElement, BottomSheetCardProps>(
  (props, ref) => {
    const { children, className = "", ...rest } = props as BottomSheetCardInternalProps;
    const { _expanded, _isFullScreen, _onHandlePointerDown } = rest;

    return (
      <div
        ref={ref}
        className={`bottom-sheet-card bg-spark-surface border-spark-border shadow-glass-lg overflow-hidden w-full ${_expanded ? 'h-full flex flex-col' : 'max-h-[85dvh] flex flex-col'} ${_isFullScreen ? 'rounded-none' : 'bottom-sheet-card-bordered'} ${className}`}
      >
        {/* Handle hit area: large touch target, small visual indicator */}
        <div
          className="bottom-sheet-handle-zone flex-shrink-0"
          onPointerDown={_onHandlePointerDown}
          style={{ touchAction: 'none' }}
        >
          <div className="bottom-sheet-handle" />
        </div>
        <div className="pt-3 flex-1 overflow-y-auto min-h-0 scrollbar-hidden">
          {children}
        </div>
      </div>
    );
  }
);

BottomSheetCard.displayName = 'BottomSheetCard';
