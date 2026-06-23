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
import { animate } from 'motion/react';
import { usePreventScroll } from '@react-aria/overlays';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
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
 * Extra clearance (px) above the reported keyboard inset. iOS counts
 * the keyboard accessory bar (autofill / dismiss pills, ~44 to 55px)
 * as visible viewport, so a field revealed to the reported keyboard
 * edge sits behind it. Overshoot is harmless: the field just rests a
 * little higher.
 */
const KEYBOARD_ACCESSORY_MARGIN_PX = 64;
/**
 * Content taller than this fraction of the viewport collapses the snap
 * ladder to [closed, full]: an intermediate snap a few px under full
 * is indistinguishable from it.
 */
const CONTENT_SNAP_COLLAPSE_RATIO = 0.9;
/**
 * Margin (px) the focused field is kept clear of the scroller's bottom
 * edge on native. There is no keyboard inset to clear on native (the
 * WebView resizes above the keyboard), only the scroller's own edge.
 */
const NATIVE_REVEAL_MARGIN_PX = 24;

/**
 * BottomSheetCard reports its natural height (handle + content) up to
 * the container, which turns it into the px snap point the sheet opens
 * at. The report fires synchronously from a ref callback so the snap
 * exists before the library computes its open animation target.
 */
const ContentMeasureContext = createContext<(px: number | null) => void>(
  () => {},
);

/**
 * Effective keyboard clearance in px (inset + accessory margin, 0
 * while the keyboard is closed). BottomSheetCard uses it to actively
 * reveal the focused field: Safari's native caret reveal treats the
 * area behind the keyboard accessory bar as visible and ignores
 * scroll-padding, so passive CSS alone left low fields under the
 * autofill pills.
 */
const KeyboardClearanceContext = createContext(0);

// On native the WebView itself resizes with the keyboard (Android
// adjustResize, iOS resize: 'native'), so the library's keyboard
// machinery must stay off: its VirtualKeyboard API path flips
// navigator.virtualKeyboard.overlaysContent inside the already
// resizing Android WebView (double-compensation: env-inset padding
// stacked on the native resize), and transient keyboard-state flips
// added phantom clearance gaps on iOS, which has no accessory bar in
// the native keyboard.
const IS_NATIVE = Capacitor.isNativePlatform();

const EDITABLE_SELECTOR = 'input, textarea, [contenteditable="true"]';

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
  const { isKeyboardOpen, keyboardHeight } = useVirtualKeyboard({
    isEnabled: isOpen && !IS_NATIVE,
    // The default 100ms debounce left the web sheet sitting behind the
    // keyboard until the next interaction: the keyboard-open state
    // settled too late to pad / reveal the focused field on first
    // focus. Detect on the leading edge so the reveal runs immediately.
    debounceDelay: 0,
  });
  const clearancePx = isKeyboardOpen
    ? keyboardHeight + KEYBOARD_ACCESSORY_MARGIN_PX
    : 0;

  // Keyboard-free viewport height, the stable basis for the snap
  // ladder's collapse rule. It must NOT shrink when the native
  // keyboard resizes the WebView: that reshaped [closed, content,
  // full] into [closed, full] mid keyboard, silently turning snap
  // index 1 from content height into fullscreen (the spurious
  // auto-fullscreen on focus). The keyboard only ever changes height,
  // never width, so we recompute solely on width changes (orientation
  // / window resize) and leave it untouched for every keyboard event.
  const [stableViewportH, setStableViewportH] = useState(() => {
    // A sheet can first mount while the keyboard is already up (a child
    // sheet opening over a focused parent). On native the WebView is
    // already shrunk, so window.innerHeight is the keyboard-up height;
    // add the reported keyboard inset back so the basis is keyboard-free.
    // On web the keyboard overlays (innerHeight stays full), so no
    // adjustment is needed.
    if (IS_NATIVE) {
      const kb = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          '--keyboard-height',
        ),
      );
      if (Number.isFinite(kb) && kb > 0) return window.innerHeight + kb;
    }
    return window.innerHeight;
  });
  useEffect(() => {
    let lastWidth = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth !== lastWidth) {
        // Orientation / window resize: re-baseline to the new width.
        lastWidth = window.innerWidth;
        setStableViewportH(window.innerHeight);
      } else {
        // Height-only change is the keyboard, which only ever shrinks the
        // viewport. The keyboard-free height is the tallest it gets, so
        // track the max: this self-corrects a basis that was seeded
        // shrunken (mounted with the keyboard up) the first time the
        // keyboard closes, without letting the keyboard collapse it.
        setStableViewportH((prev) => Math.max(prev, window.innerHeight));
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // True while focus is inside this sheet's container; the viewport
  // re-snap uses it to freeze sheets that do not own the keyboard.
  const focusWithin = useRef(false);

  // Snap ladder: [closed, content height, full] with drag-to-expand
  // between the last two; collapses to [closed, full] for near-full
  // content. Values are px from the sheet bottom.
  const useContentSnap =
    !fullHeight &&
    contentPx !== null &&
    contentPx > MIN_CONTENT_SNAP_PX &&
    contentPx < stableViewportH * CONTENT_SNAP_COLLAPSE_RATIO;
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

  // Race-free native re-position. The keyboard resizes the WebView, so
  // the resting snap offset must shrink with it. react-modal-sheet only
  // moves the sheet via snapTo(), which animates to a snapValueY cached
  // against the asynchronously re-measured root height: that loses the
  // race against the keyboard resize and leaves the sheet gapped above
  // the keyboard. Instead we drive the exposed `y` MotionValue directly
  // from the LIVE viewport height, so the sheet sits flush regardless of
  // when the library re-measures.
  const repositionRef = useRef<(animated: boolean) => void>(() => {});
  const lastReposTargetRef = useRef<number | null>(null);
  // Live keyboard height, set from the Keyboard plugin events (below) on
  // both platforms. The resting position is derived purely from this plus
  // the stable keyboard-free height, never window.innerHeight.
  const keyboardHeightRef = useRef(0);
  // Reassigned after every commit so it reads the latest contentPx /
  // snap without re-subscribing the resize listener.
  useEffect(() => {
    repositionRef.current = (animated: boolean) => {
      const sheet = sheetRef.current;
      if (!IS_NATIVE || !sheet || fullHeight || !fullyOpen.current) return;
      const idx = currentSnap.current;
      if (idx <= 0) return;
      const active = document.activeElement;
      const editableActive =
        active instanceof HTMLElement && active.matches(EDITABLE_SELECTOR);
      // A background sheet (an editable is focused but not inside this
      // sheet) holds its offset so it stays visually put under the child.
      if (editableActive && !focusWithin.current) {
        return;
      }
      // Effective viewport bottom == top of the keyboard, derived from the
      // stable keyboard-free height minus the reported keyboard height,
      // NOT window.innerHeight (iOS defers its resize ~0.5s; Android's
      // back-button dismissal fires none). The keyboard only counts as up
      // for THIS sheet while one of its own fields is focused: once
      // navigation unmounts the focused field (or it blurs), treat it as
      // gone immediately and drop to the full-height snap rather than
      // waiting on the possibly-delayed keyboardDidHide. That removes the
      // mispositioned / half-expanded transient when returning to a sheet
      // with the keyboard still up.
      const kb = editableActive ? keyboardHeightRef.current : 0;
      const bottom = Math.max(0, stableViewportH - kb);
      // Index 2 (full) or the collapsed [0, 1] ladder rest at y 0 (top
      // of the keyboard). The content snap rests contentPx px above it.
      const targetY =
        !useContentSnap || idx >= 2
          ? 0
          : Math.max(0, bottom - (contentPx ?? bottom));
      if (lastReposTargetRef.current === targetY) return;
      lastReposTargetRef.current = targetY;
      if (animated) {
        animate(sheet.y, targetY, {
          type: 'tween',
          ease: 'easeOut',
          duration: 0.2,
        });
      } else {
        // Instant set tracks the keyboard frame-by-frame on Android and
        // matches iOS's single-step WebView resize without a trailing
        // tween.
        sheet.y.set(targetY);
      }
    };
  });

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

  // NATIVE ONLY. The keyboard resizes the WebView (Android
  // adjustResize, iOS resize: 'native'), shrinking the sheet root. Drive
  // the sheet's y to match the new viewport bottom via the race-free
  // reposition above on every resize (keyboard show/hide, rotation).
  //
  // Web is deliberately excluded: there the keyboard OVERLAYS (only the
  // visual viewport shrinks, the root keeps its size), so moving the
  // sheet would leave a band below it and the field still behind the
  // keyboard. Web keyboard handling is purely the content padding +
  // reveal in BottomSheetCard.
  useEffect(() => {
    if (!IS_NATIVE || !isOpen || fullHeight) return;
    const onResize = () => repositionRef.current(false);
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, [isOpen, fullHeight]);

  // NATIVE. Drive the re-position off the Keyboard plugin events, which
  // fire reliably with the keyboard height on both platforms: willShow
  // for a snappy lift, didHide for the drop. This is the only reliable
  // signal: iOS resize:'native' defers its setFrame ~0.5s, and Android's
  // back-button dismissal fires no resize, so a resize-only approach
  // leaves the sheet stuck (open, or after back half-expanded with a
  // keyboard-sized gap). A field switch fires willShow with the same
  // height (deduped by lastReposTargetRef) and no didHide, so the sheet
  // does not flap between fields.
  useEffect(() => {
    if (!IS_NATIVE || !isOpen || fullHeight) {
      return;
    }
    let cancelled = false;
    const handles: PluginListenerHandle[] = [];
    const track = (h: PluginListenerHandle) => {
      if (cancelled) h.remove();
      else handles.push(h);
    };
    void Keyboard.addListener('keyboardWillShow', (info) => {
      keyboardHeightRef.current = info.keyboardHeight;
      repositionRef.current(true);
    }).then(track);
    void Keyboard.addListener('keyboardDidHide', () => {
      keyboardHeightRef.current = 0;
      repositionRef.current(true);
    }).then(track);
    return () => {
      cancelled = true;
      handles.forEach((h) => h.remove());
    };
  }, [isOpen, fullHeight]);

  // Content grew or shrank while resting at the content snap (error
  // banners, async rows): re-fit so the sheet tracks its content the
  // way the old auto-height implementation did. Native uses the
  // race-free reposition; web re-snaps (no native resize race there).
  useEffect(() => {
    if (!isOpen || !useContentSnap || !fullyOpen.current) return;
    if (currentSnap.current !== 1) return;
    if (IS_NATIVE) {
      repositionRef.current(true);
    } else {
      sheetRef.current?.snapTo(1);
    }
  }, [contentPx, isOpen, useContentSnap]);

  // Chrome Android (HTTPS) sets overlaysContent = true via the
  // VirtualKeyboard API, so the visual viewport never shrinks and the
  // webViewportManager can't detect the keyboard. Drive the CSS var
  // from the hook's state as well (uses the VK geometrychange event).
  useEffect(() => {
    if (IS_NATIVE || !isOpen) return;
    const html = document.documentElement;
    if (isKeyboardOpen && keyboardHeight > 0) {
      html.style.setProperty('--sheet-kb-offset', `-${keyboardHeight}px`);
      html.classList.add('keyboard-visible');
    } else {
      html.style.setProperty('--sheet-kb-offset', '0px');
      html.classList.remove('keyboard-visible');
    }
    return () => {
      html.style.setProperty('--sheet-kb-offset', '0px');
      html.classList.remove('keyboard-visible');
    };
  }, [isOpen, isKeyboardOpen, keyboardHeight]);

  return (
    <Sheet
      ref={sheetRef}
      isOpen={isOpen}
      onClose={dismiss}
      onOpenEnd={() => {
        fullyOpen.current = true;
        // Settle the position in case the keyboard resized the WebView
        // during the open animation: the resize reposition is gated on
        // fullyOpen and would have been skipped while opening.
        repositionRef.current(false);
      }}
      onCloseStart={() => {
        fullyOpen.current = false;
        lastReposTargetRef.current = null;
        keyboardHeightRef.current = 0;
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
      //
      // Constrain the library's position:fixed root to the app content
      // column (#content-root is max-w-4xl) and center it, so on wide web
      // viewports the sheet tracks the page width instead of spanning the
      // whole window. The old hand-rolled sheet was absolute inside the
      // column and inherited this for free. The backdrop is a separate
      // fixed child and still covers the full viewport.
      style={{ zIndex: 50, maxWidth: '56rem', marginInline: 'auto' }}
      // Portal into #root, not document.body: the web viewport
      // manager pins #root against Safari's focus pan, and sheets
      // portaled outside it stayed uncompensated. That is what let a
      // parent sheet slide up behind its child while typing, and
      // left sheets mispositioned after keyboard dismissal (iOS 26
      // does not always reset the viewport offset).
      mountPoint={document.getElementById('root') ?? undefined}
    >
      <Sheet.Container
        onFocusCapture={() => {
          focusWithin.current = true;
        }}
        onBlurCapture={(e) => {
          const next = e.relatedTarget;
          if (!(next instanceof Node) || !e.currentTarget.contains(next)) {
            focusWithin.current = false;
          }
        }}
        className={`bg-spark-surface ${fullHeight || isFullSnap ? 'rounded-none' : 'bottom-sheet-card-bordered'} shadow-glass-lg w-full ${maxWidthMap[maxWidth]} mx-auto ${className}`}
        style={
          {
            // Effective keyboard clearance, consumed by the content
            // scroller's padding and scroll-padding. The reported
            // inset alone is not enough on iOS: the viewport treats
            // the keyboard accessory bar (autofill / dismiss pills)
            // as visible, so fields revealed to the reported edge
            // land behind it. The margin lifts them clear.
            '--keyboard-clearance': isKeyboardOpen
              ? `calc(env(keyboard-inset-height, var(--keyboard-inset-height, 0px)) + ${KEYBOARD_ACCESSORY_MARGIN_PX}px)`
              : '0px',
            ...(maxHeightVh < 100
              ? { maxHeight: `${maxHeightVh}dvh` }
              : null),
          } as React.CSSProperties
        }
      >
        <ContentMeasureContext.Provider value={setContentPx}>
          <KeyboardClearanceContext.Provider value={clearancePx}>
            {children}
          </KeyboardClearanceContext.Provider>
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
    const clearancePx = useContext(KeyboardClearanceContext);
    const handleRef = useRef<HTMLDivElement | null>(null);
    const scrollerRef = useRef<HTMLDivElement | null>(null);

    // Scroll the focused field clear of the keyboard + accessory bar.
    // Runs when the keyboard inset settles (first focus) and on every
    // focus moving within the card (field switches while typing).
    const revealFocused = useCallback(() => {
      const scroller = scrollerRef.current;
      const active = document.activeElement;
      // On native the WebView resizes above the keyboard, so the field
      // only needs to clear the scroller's own bottom edge by a small
      // margin (clearancePx is 0 on native: useVirtualKeyboard is web
      // only). On web it must clear the reported inset + accessory bar.
      // This runs on every focus move within the card, so it reveals the
      // newly-focused field when switching fields while the keyboard is
      // already up (no fresh keyboardDidShow fires on a field switch).
      const clearance = IS_NATIVE ? NATIVE_REVEAL_MARGIN_PX : clearancePx;
      if (!scroller || clearance <= 0) return;
      if (!(active instanceof HTMLElement) || !scroller.contains(active)) {
        return;
      }
      if (!active.matches('input, textarea, [contenteditable="true"]')) {
        return;
      }
      const overlap =
        active.getBoundingClientRect().bottom -
        (scroller.getBoundingClientRect().bottom - clearance);
      if (overlap > 0) {
        scroller.scrollBy({ top: overlap, behavior: 'smooth' });
      }
    }, [clearancePx]);

    useEffect(() => {
      revealFocused();
    }, [revealFocused]);

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
          scrollRef={scrollerRef}
          // Manual keyboard avoidance (avoidKeyboard is off on the
          // root): the container computes --keyboard-clearance from
          // the live keyboard inset plus the iOS accessory-bar
          // margin. The padding gives the scroller room; the actual
          // positioning is revealFocused above (passive
          // scroll-padding is not honored by Safari's caret reveal).
          scrollStyle={{
            paddingBottom: 'var(--keyboard-clearance, 0px)',
          }}
        >
          <div
            onFocusCapture={() => {
              // rAF: let the focus settle and any pending layout
              // (keyboard padding) apply before measuring.
              requestAnimationFrame(revealFocused);
            }}
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
            className={`bottom-sheet-content-pad px-6 pt-3 ${className}`}
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
