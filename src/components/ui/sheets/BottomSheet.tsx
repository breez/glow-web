import React, { ReactNode, forwardRef, useState, useRef, useCallback, useEffect } from 'react';
import { Transition, TransitionChild } from '@headlessui/react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import type { PluginListenerHandle } from '@capacitor/core';
import { useStatusBarColor } from '../../../hooks/useStatusBarColor';
import { STATUS_BAR_SURFACE } from '../../../utils/statusBarManager';
import { useBackButton } from '../../../hooks/useBackButton';

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
  // Effective viewport height in CSS pixels. The canonical source is
  // window.visualViewport.height — it reflects the currently-visible
  // web content area, correctly accounting for whatever Android/iOS
  // has retracted for the soft keyboard. We deliberately do NOT
  // derive this from `initialInnerHeight − keyboardHeight` via the
  // @capacitor/keyboard plugin: keyboardHeight is reported as
  // imeInsets.bottom which includes the nav bar inset, while
  // innerHeight already excludes the nav bar, so the naive
  // subtraction double-counts the nav bar and leaves a gap between
  // the sheet's footer and the top of the keyboard.
  const [viewportHeight, setViewportHeight] = useState<number>(() => {
    return window.visualViewport?.height ?? window.innerHeight;
  });

  const dragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);
  const source = useRef<'handle' | 'body'>('body');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  // Keep viewportHeight in sync with the visible viewport.
  // visualViewport.resize is the primary signal. On native Capacitor
  // we also subscribe to @capacitor/keyboard show/hide events and
  // force a re-read inside requestAnimationFrame — a safety net for
  // WebViews where visualViewport.resize is delayed or coalesced
  // and fires before the WebView has finished re-laying out.
  useEffect(() => {
    const readViewport = () => {
      setViewportHeight(window.visualViewport?.height ?? window.innerHeight);
    };

    const vv = window.visualViewport;
    vv?.addEventListener('resize', readViewport);
    vv?.addEventListener('scroll', readViewport);

    let cancelled = false;
    const capHandles: PluginListenerHandle[] = [];

    if (Capacitor.isNativePlatform()) {
      // Re-read viewport after the keyboard has finished showing/hiding.
      // rAF ensures the WebView has committed its own resize before we
      // sample innerHeight / visualViewport.height.
      const delayedRead = () => requestAnimationFrame(readViewport);

      void Keyboard.addListener('keyboardWillShow', delayedRead).then((h) => {
        if (cancelled) h.remove();
        else capHandles.push(h);
      });
      void Keyboard.addListener('keyboardDidShow', delayedRead).then((h) => {
        if (cancelled) h.remove();
        else capHandles.push(h);
      });
      void Keyboard.addListener('keyboardWillHide', delayedRead).then((h) => {
        if (cancelled) h.remove();
        else capHandles.push(h);
      });
      void Keyboard.addListener('keyboardDidHide', delayedRead).then((h) => {
        if (cancelled) h.remove();
        else capHandles.push(h);
      });
    }

    return () => {
      cancelled = true;
      vv?.removeEventListener('resize', readViewport);
      vv?.removeEventListener('scroll', readViewport);
      capHandles.forEach((h) => {
        void h.remove();
      });
    };
  }, []);

  const maxPx = useCallback(() => {
    return viewportHeight * (maxHeightVh / 100);
  }, [viewportHeight, maxHeightVh]);

  const getSnapPoints = useCallback((): number[] => {
    const full = maxPx();
    // If content fills most of the screen, only one snap point
    if (contentHeight >= full * 0.9) return [full];
    return [contentHeight, full];
  }, [maxPx, contentHeight]);

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
        setContentHeight(wrapperRef.current.getBoundingClientRect().height);
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

  // No reset-on-close needed: consumers either re-mount this sheet on
  // every open (via parent-managed `key={openSession}` or conditional
  // render), so on each open the internal state — snapIndex, dragHeight,
  // bodyDragY, animating, dragging.current — starts at its useState/useRef
  // default. State left over from a prior session is dropped with the
  // unmount.

  // Wire the Android hardware back button to close the sheet while
  // it's open. Uses the shared LIFO back-button stack in
  // utils/backButton.ts so nested sheets dismiss in the order the
  // user opened them (topmost first). No-op on non-native platforms.
  useBackButton(() => {
    dismiss();
  }, isOpen);

  const maxWidthClass = maxWidthMap[maxWidth];
  const isExpanded = snapIndex > 0 || dragHeight !== null;
  // Full screen when snapped to top or dragged near max height
  const isFullScreen = fullHeight || snapIndex > 0 || (dragHeight !== null && dragHeight > maxPx() * 0.85);

  // System bar tinting on native:
  //
  //  * Nav bar   → push spark-surface (#151520) for the entire time the
  //    sheet is open. Every bottom sheet, no matter how expanded,
  //    reaches the bottom of the viewport and its card bg meets the
  //    Android nav bar, so the nav bar always needs to match the
  //    sheet's surface color while open.
  //
  //  * Status bar → only push spark-surface once the sheet is fully
  //    expanded and covers the top of the screen. At the collapsed
  //    snap index the wallet page (or whatever is underneath) is
  //    still visible at the top and the status bar should keep its
  //    parent tint via the default fallback in statusBarManager.
  //
  // The stack pops on close via the disposer returned from each push.
  useStatusBarColor(STATUS_BAR_SURFACE, isOpen, 'nav');
  useStatusBarColor(STATUS_BAR_SURFACE, isOpen && isFullScreen, 'status');

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
    // Material 3 emphasized easing for snap-point height/transform
    // transitions. Bidirectional so we use the neutral emphasized
    // curve rather than decelerate/accelerate.
    wrapperStyle.transition = 'height 250ms cubic-bezier(0.2, 0.0, 0, 1.0), transform 250ms cubic-bezier(0.2, 0.0, 0, 1.0)';
  }

  return (
    // `unmount={false}` keeps the whole sheet subtree in the React
    // tree across open/close cycles. Without it, HeadlessUI tears
    // down every descendant (BottomSheetCard, DialogHeader, InputStep
    // / workflows, address + QR displays, contact autocomplete, etc.)
    // when `show` flips to false — so the first-ever open after a
    // cold WalletPage mount pays the full reconciliation + hook-init
    // cost synchronously between the tap and the first paint, which
    // reads as a ~200-400ms dead window before the sheet starts
    // sliding up. With `unmount={false}` React keeps component state
    // warm; HeadlessUI just toggles the `hidden` HTML attribute so
    // the browser skips layout + paint while closed, and re-opens
    // only pay browser layout/paint (no React mount).
    <Transition
      show={isOpen}
      // `appear` animates on the very first mount when show is already
      // true. Needed so consumers that remount this component on each
      // open (via key) still get the enter animation.
      appear
      unmount={false}
      as="div"
      className="absolute inset-x-0 top-0 z-50 overflow-hidden flex flex-col justify-end pointer-events-none"
      style={{ height: `${viewportHeight}px` }}
    >
      {showBackdrop && (
        <TransitionChild
          as="div"
          // `unmount={false}` mirrors the outer Transition so the
          // backdrop's `hidden` toggle stays in lockstep with the
          // sheet panel's. Without it the child would unmount at
          // close even if the parent kept its DOM, defeating the
          // whole point of pre-mounting.
          unmount={false}
          // Material 3 bottom-sheet scrim motion: emphasized decelerate
          // on enter (fade arrives softly), emphasized accelerate on
          // exit (fade leaves quickly) so the scrim stays in sync with
          // the panel slide below.
          enter="transition-opacity ease-m3-emphasized-decelerate duration-250"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="transition-opacity ease-m3-emphasized-accelerate duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
          className="absolute inset-0 bg-black/60 pointer-events-auto z-0"
          onClick={onClose}
        />
      )}
      <TransitionChild
        as="div"
        unmount={false}
        // Material 3 bottom-sheet panel motion. `motionDurationMedium1`
        // (250ms) enter with emphasized decelerate, `motionDurationShort4`
        // (200ms) exit with emphasized accelerate. Exit keeps the
        // pre-existing `translate-y-1/2` shortcut so the drop feels
        // quick even though the duration is 50ms shorter than enter.
        enter="transform transition ease-m3-emphasized-decelerate duration-250"
        enterFrom="translate-y-full opacity-0"
        enterTo="translate-y-0 opacity-100"
        leave="transform transition ease-m3-emphasized-accelerate duration-200"
        leaveFrom="translate-y-0 opacity-100"
        leaveTo="translate-y-1/2 opacity-0"
        className={`mx-auto w-full ${maxWidthClass} pointer-events-auto z-10 ${className}`}
        style={wrapperStyle}
        ref={wrapperRef}
        onPointerDown={(e) => {
          const target = e.target as HTMLElement;
          // Handle zone owns its own drag flow — skip the body drag
          // handler so the user can freely resize the sheet from the
          // grip above the content.
          if (target.closest('.bottom-sheet-handle-zone')) return;
          // Never hijack pointer events on interactive children.
          // onDown calls setPointerCapture, which on Android Chromium
          // blocks the native tap-to-focus flow for inputs nested in
          // the sheet — the caret would appear to move but keystrokes
          // would land on the captured pointer instead of the input's
          // value.
          if (
            target.closest(
              'input, textarea, select, button, [contenteditable="true"], a[href]',
            )
          ) {
            return;
          }
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
      </TransitionChild>
    </Transition>
  );
};

import { BottomSheetCardContext } from './BottomSheetCardContext';

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
    const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);

    return (
      <BottomSheetCardContext.Provider value={cardEl}>
        <div
          ref={(el) => {
            setCardEl(el);
            if (typeof ref === 'function') ref(el);
            else if (ref) ref.current = el;
          }}
          className={`relative bottom-sheet-card bg-spark-surface border-spark-border shadow-glass-lg overflow-hidden w-full ${_expanded ? 'h-full flex flex-col' : 'max-h-[85dvh] flex flex-col'} ${_isFullScreen ? 'rounded-none' : 'bottom-sheet-card-bordered'} ${className}`}
        >
          {/* Handle hit area: large touch target, small visual indicator */}
          <div
            className="bottom-sheet-handle-zone shrink-0"
            onPointerDown={_onHandlePointerDown}
            style={{ touchAction: 'none' }}
          >
            <div className="bottom-sheet-handle" />
          </div>
          <div className="pt-3 flex-1 overflow-y-auto min-h-0 scrollbar-hidden">
            {children}
          </div>
        </div>
      </BottomSheetCardContext.Provider>
    );
  }
);

BottomSheetCard.displayName = 'BottomSheetCard';
