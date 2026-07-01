import { createContext, useContext } from 'react';

export const BottomSheetCardContext = createContext<HTMLDivElement | null>(null);
export const useBottomSheetCardEl = () => useContext(BottomSheetCardContext);

/**
 * True while the sheet is at its full (top) snap. Content reads this to
 * grow into the extra height when expanded (e.g. a capped list area that
 * should fill the screen once dragged to full).
 */
export const SheetFullSnapContext = createContext(false);
export const useSheetFullSnap = () => useContext(SheetFullSnapContext);
