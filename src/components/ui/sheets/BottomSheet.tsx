import React, {
  ReactNode,
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Sheet, useVirtualKeyboard, type SheetRef } from 'react-modal-sheet';
import { usePreventScroll } from '@react-aria/overlays';
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

/**
 * Below this measured content height the content snap is not trusted
 * (mid-mount measurements, test environments) and the sheet falls back
 * to [closed, full].
 */
const MIN_CONTENT_SNAP_PX = 50;
/**
 * Content taller than this fraction of the viewport collapses the snap
 * ladder to [closed, full]: an intermediate snap a few px under full
 * is indistinguishable from it.
 */
const CONTENT_SNAP_COLLAPSE_RATIO = 0.9;

/**
 * BottomSheetCard reports its natural height (handle + content) up to
 * the container, which turns it into the px snap point the sheet opens
 * at. The report fires synchronously from a ref callback so the snap
 * exists before the library computes its open animation target.
 */
const ContentMeasureContext = createContext<(px: number | null) => void>(
  () => {},
);

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
  const sheetRef = useRef<SheetRef>(null);
  const [contentPx, setContentPx] = useState<number | null>(null);
  const currentSnap = useRef(1);
  const fullyOpen = useRef(false);
  const [snapIndex, setSnapIndex] = useState(1);

  // Manual keyboard mode (avoidKeyboard is off below): the hook keeps
  // --keyboard-inset-height up to date and we pad the content scroller
  // with it, so the sheet KEEPS its current snap while the keyboard is
  // up. The library's built-in avoidance instead snaps to the last
  // (fullscreen) snap on focus, which expanded the sheet on every
  // input tap and raced its scroll-into-view against the snap
  // animation, leaving the focused field off-screen.
  const { isKeyboardOpen } = useVirtualKeyboard({ isEnabled: isOpen });

  // Snap ladder: [closed, content height, full] with drag-to-expand
  // between the last two; collapses to [closed, full] for near-full
  // content. Values are px from the sheet bottom.
  const useContentSnap =
    !fullHeight &&
    contentPx !== null &&
    contentPx > MIN_CONTENT_SNAP_PX &&
    contentPx < window.innerHeight * CONTENT_SNAP_COLLAPSE_RATIO;
  const snapPoints = fullHeight
    ? undefined
    : useContentSnap
      ? [0, contentPx, 1]
      : [0, 1];

  // Expanded-to-fullscreen state (user dragged a content-sized sheet
  // to the top snap): square corners + status bar tint, matching the
  // old implementation. Near-full single-snap sheets keep the rounded
  // look, as before.
  const isFullSnap = useContentSnap && snapIndex === 2;

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
  useStatusBarColor(
    STATUS_BAR_SURFACE,
    isOpen && (fullHeight || isFullSnap),
    'status',
  );

  // Scroll lock + iOS focus-pan suppression from the maintained
  // react-aria package instead of the library's vendored snapshot:
  // the snapshot predates Adobe's iOS 26 fixes, and Safari's focus
  // pan slipping through is what briefly shoves the page behind the
  // sheet off-screen when the keyboard opens (the pan is invisible
  // to JS until it finishes, so it can only be prevented, not
  // corrected). The matching disableScrollLocking on <Sheet> below
  // keeps the two locks from stacking.
  usePreventScroll({ isDisabled: !isOpen });

  // Content grew or shrank while resting at the content snap (error
  // banners, async rows): re-snap so the sheet tracks its content the
  // way the old auto-height implementation did.
  useEffect(() => {
    if (!isOpen || !useContentSnap || !fullyOpen.current) return;
    if (currentSnap.current === 1) {
      sheetRef.current?.snapTo(1);
    }
  }, [contentPx, isOpen, useContentSnap]);

  return (
    <Sheet
      ref={sheetRef}
      isOpen={isOpen}
      onClose={dismiss}
      onCloseEnd={afterLeave}
      onOpenEnd={() => {
        fullyOpen.current = true;
      }}
      onCloseStart={() => {
        fullyOpen.current = false;
        // Back to the content snap for the next open: onSnap only
        // fires on changes, so a fullscreen index from this session
        // would otherwise leak into the next one.
        currentSnap.current = 1;
        setSnapIndex(1);
      }}
      onSnap={(index) => {
        currentSnap.current = index;
        setSnapIndex(index);
      }}
      // "full" for every sheet: the top snap must reach the real top
      // of the screen. detent "default" reserves safe-area-top + 34px,
      // which read as a gap when a sheet was dragged to fullscreen.
      detent="full"
      snapPoints={snapPoints}
      initialSnap={1}
      avoidKeyboard={false}
      // While typing, drags would fight the keyboard inset and the
      // focused field; the built-in avoidance had the same lockout.
      disableDrag={isKeyboardOpen}
      // The vendored lock is replaced by usePreventScroll above.
      disableScrollLocking
      // Drop the library's decorative styles (white card, grey pills);
      // the surface look comes from our classes below.
      unstyled
      // Keep sheets in the app's existing z order (confirm dialogs and
      // toasts render at z-50 in the same stacking context); the
      // library would otherwise default to 9999.
      style={{ zIndex: 50 }}
    >
      <Sheet.Container
        className={`bg-spark-surface ${fullHeight || isFullSnap ? 'rounded-none' : 'bottom-sheet-card-bordered'} shadow-glass-lg w-full ${maxWidthMap[maxWidth]} mx-auto ${className}`}
        style={
          maxHeightVh < 100 ? { maxHeight: `${maxHeightVh}dvh` } : undefined
        }
      >
        <ContentMeasureContext.Provider value={setContentPx}>
          {children}
        </ContentMeasureContext.Provider>
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
    const reportHeight = useContext(ContentMeasureContext);
    const handleRef = useRef<HTMLDivElement | null>(null);

    const measure = useCallback(
      (el: HTMLDivElement | null) => {
        if (!el) return;
        reportHeight(el.offsetHeight + (handleRef.current?.offsetHeight ?? 0));
      },
      [reportHeight],
    );

    // Track content growth/shrink after mount (error banners, lists
    // loading in) so the container can re-snap to the new height.
    useEffect(() => {
      if (!cardEl) return;
      const observer = new ResizeObserver(() => measure(cardEl));
      observer.observe(cardEl);
      return () => {
        observer.disconnect();
        reportHeight(null);
      };
    }, [cardEl, measure, reportHeight]);

    return (
      <>
        <Sheet.Header>
          <div
            ref={handleRef}
            className="bottom-sheet-handle-zone shrink-0"
            style={{ touchAction: 'none' }}
          >
            <div className="bottom-sheet-handle" />
          </div>
        </Sheet.Header>
        <Sheet.Content
          scrollClassName="scrollbar-hidden"
          // Manual keyboard avoidance (avoidKeyboard is off on the
          // root): pad the scroller by the keyboard inset kept up to
          // date by useVirtualKeyboard, so the focused field scrolls
          // above the keyboard while the sheet keeps its snap. env()
          // wins on Chromium with the VirtualKeyboard API; the CSS
          // var is the visualViewport fallback (iOS).
          scrollStyle={{
            paddingBottom:
              'env(keyboard-inset-height, var(--keyboard-inset-height, 0px))',
          }}
        >
          <div
            ref={(el) => {
              setCardEl(el);
              // Synchronous first measurement: the ref attaches during
              // commit, before the library's open effect computes its
              // animation target, so the sheet opens straight to the
              // content snap with no full-height flash.
              measure(el);
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
