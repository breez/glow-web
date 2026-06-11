import React, { ReactNode, forwardRef, useCallback, useState } from 'react';
import { Sheet } from 'react-modal-sheet';
import { useStatusBarColor } from '../../../hooks/useStatusBarColor';
import { STATUS_BAR_SURFACE } from '../../../utils/statusBarManager';
import { useBackButton } from '../../../hooks/useBackButton';
import { BottomSheetCardContext } from './BottomSheetCardContext';

/**
 * Bottom sheet adapter over react-modal-sheet.
 *
 * Keeps the BottomSheetContainer / BottomSheetCard API the app always
 * had while delegating gestures, snap physics, and soft-keyboard
 * avoidance to the library (visualViewport / VirtualKeyboard handling,
 * input scroll-into-view, drag lockout while the keyboard is up).
 * Platform glue stays ours: Android back-button dismiss, system bar
 * tinting, the web viewport manager's page pinning, and the native
 * adjustResize path.
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
  maxWidth?: BottomSheetMaxWidth;
  /** Maximum height as viewport percentage (default: 100) */
  maxHeightVh?: number;
  /** Whether sheet takes full height (for QR scanner, etc.) */
  fullHeight?: boolean;
  /** Whether to show a backdrop overlay */
  showBackdrop?: boolean;
  /**
   * Fires once the close animation finishes (react-modal-sheet's
   * onCloseEnd). Never fires while the page is hidden (animations are
   * paused), so any wait on it must be bounded by a timeout.
   */
  afterLeave?: () => void;
}

export const BottomSheetContainer: React.FC<BottomSheetContainerProps> = ({
  isOpen,
  children,
  className = '',
  onClose,
  maxWidth = 'full',
  maxHeightVh = 100,
  fullHeight = false,
  showBackdrop = false,
  afterLeave,
}) => {
  const dismiss = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    onClose?.();
  }, [onClose]);

  // Wire the Android hardware back button to close the sheet while
  // it's open, via the shared LIFO stack so nested sheets dismiss
  // topmost-first. No-op on non-native platforms.
  useBackButton(() => {
    dismiss();
  }, isOpen);

  // System bar tinting on native: nav bar matches the sheet surface
  // for the whole time it's open (the card always meets the nav bar);
  // status bar only when the sheet covers the top of the screen.
  useStatusBarColor(STATUS_BAR_SURFACE, isOpen, 'nav');
  useStatusBarColor(STATUS_BAR_SURFACE, isOpen && fullHeight, 'status');

  return (
    <Sheet
      isOpen={isOpen}
      onClose={dismiss}
      onCloseEnd={afterLeave}
      detent={fullHeight ? 'full' : 'content'}
      // Drop the library's decorative styles (white card, grey pills);
      // the surface look comes from our classes below.
      unstyled
      // Keep sheets in the app's existing z order (confirm dialogs and
      // toasts render at z-50 in the same stacking context); the
      // library would otherwise default to 9999.
      style={{ zIndex: 50 }}
    >
      <Sheet.Container
        className={`bg-spark-surface ${fullHeight ? '' : 'bottom-sheet-card-bordered'} shadow-glass-lg w-full ${maxWidthMap[maxWidth]} mx-auto ${className}`}
        style={
          maxHeightVh < 100 ? { maxHeight: `${maxHeightVh}dvh` } : undefined
        }
      >
        {children}
      </Sheet.Container>
      {showBackdrop && (
        <Sheet.Backdrop className="bg-black/60" onTap={dismiss} />
      )}
    </Sheet>
  );
};

export interface BottomSheetCardProps {
  children: ReactNode;
  className?: string;
}

/**
 * Sheet body: drag handle header + scrollable content area. Must be
 * rendered as the direct child of BottomSheetContainer (it expands to
 * react-modal-sheet's Header/Content pair, which the library expects
 * as direct children of its container for keyboard avoidance and
 * scroll handling).
 */
export const BottomSheetCard = forwardRef<HTMLDivElement, BottomSheetCardProps>(
  ({ children, className = '' }, ref) => {
    const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);

    return (
      <>
        <Sheet.Header>
          <div
            className="bottom-sheet-handle-zone shrink-0"
            style={{ touchAction: 'none' }}
          >
            <div className="bottom-sheet-handle" />
          </div>
        </Sheet.Header>
        <Sheet.Content scrollClassName="scrollbar-hidden">
          <div
            ref={(el) => {
              setCardEl(el);
              if (typeof ref === 'function') ref(el);
              else if (ref) ref.current = el;
            }}
            className={`px-6 pt-3 pb-4 ${className}`}
            style={{
              paddingBottom: 'calc(1em + env(safe-area-inset-bottom, 0px))',
            }}
          >
            <BottomSheetCardContext.Provider value={cardEl}>
              {children}
            </BottomSheetCardContext.Provider>
          </div>
        </Sheet.Content>
      </>
    );
  },
);

BottomSheetCard.displayName = 'BottomSheetCard';
