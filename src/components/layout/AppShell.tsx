import React, { ReactNode, createContext, useContext } from 'react';

interface AppShellContextValue {
  /** Whether safe areas are handled by AppShell */
  safeAreasApplied: boolean;
}

const AppShellContext = createContext<AppShellContextValue>({ safeAreasApplied: true });

/**
 * Hook to check if AppShell is handling safe areas
 * Components can use this to avoid applying duplicate safe area padding
 */
export const useAppShell = () => useContext(AppShellContext);

interface AppShellProps {
  children: ReactNode;
}

/**
 * AppShell - Global wrapper that handles safe area insets from a single source of truth
 *
 * This component wraps the entire app and applies safe area padding to the top and bottom.
 * All pages and components render within the safe area, so they don't need to handle
 * safe areas individually.
 *
 * Benefits:
 * 1. Single source of truth - change safe area logic here affects all pages
 * 2. No need to add safe-area classes on every page individually
 * 3. Consistent behavior across the entire app
 *
 * For pages with full-bleed designs (like background effects that should extend
 * behind the notch), use absolute positioning for those elements while keeping
 * interactive content within the safe area.
 */
const AppShell: React.FC<AppShellProps> = ({ children }) => {
  return (
    <AppShellContext.Provider value={{ safeAreasApplied: true }}>
      <div className="app-shell">
        {children}
      </div>
    </AppShellContext.Provider>
  );
};

export default AppShell;
