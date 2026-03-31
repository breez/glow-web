import { createContext, useContext } from 'react';

export const BottomSheetCardContext = createContext<HTMLDivElement | null>(null);
export const useBottomSheetCardEl = () => useContext(BottomSheetCardContext);
