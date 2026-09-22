import { createContext, useContext, useEffect, type Dispatch, type SetStateAction } from 'react';
import { useLatest } from '../../../hooks/useLatest';

export const BottomSheetCardContext = createContext<HTMLDivElement | null>(null);
export const useBottomSheetCardEl = () => useContext(BottomSheetCardContext);

/**
 * True while the sheet is at its full (top) snap. Content reads this to
 * grow into the extra height when expanded (e.g. a capped list area that
 * should fill the screen once dragged to full).
 */
export const SheetFullSnapContext = createContext(false);
export const useSheetFullSnap = () => useContext(SheetFullSnapContext);

export const SetSheetOwnsScrollContext = createContext<((delta: number) => void) | null>(null);

/**
 * Declares that the content on screen scrolls itself, which takes the sheet's
 * drag off the content area. The handle still drags. react-modal-sheet
 * arbitrates drag against its OWN scroller, which a step that caps an inner
 * list leaves unscrollable: the sheet then reads every swipe over the list as
 * a drag, and the list moves only when the browser wins the race.
 *
 * Counted, not a flag: a workflow and the step component inside it both
 * register, and their effects run child-first.
 */
export function useSheetOwnsScroll(enabled = true): void {
  const register = useContext(SetSheetOwnsScrollContext);
  useEffect(() => {
    if (!register || !enabled) return;
    register(1);
    return () => register(-1);
  }, [register, enabled]);
}

type SheetBack = (() => void) | null;

/** The back action the step on screen lends the sheet header's arrow. */
export const SheetBackContext = createContext<SheetBack>(null);
export const SetSheetBackContext = createContext<Dispatch<SetStateAction<SheetBack>> | null>(null);

/**
 * Puts `onBack` behind the sheet header's back arrow, in place of a Back
 * button beside the step's call to action. `undefined` hides the arrow, e.g.
 * while the step is busy. One step at a time: a workflow whose sub-step
 * registers its own must pass `undefined` meanwhile.
 */
export function useSheetBack(onBack: (() => void) | undefined): void {
  const setBack = useContext(SetSheetBackContext);
  const latest = useLatest(onBack);
  const active = onBack !== undefined;
  useEffect(() => {
    if (!setBack || !active) return;
    // A stable wrapper, so a parent's inline handler does not re-register
    // (and re-render the sheet) on every render.
    const back = () => latest.current?.();
    setBack(() => back);
    return () => setBack(current => (current === back ? null : current));
  }, [setBack, active, latest]);
}
