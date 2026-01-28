import React, { ReactNode } from 'react';
import { usePlatform } from '../../hooks/usePlatform';

interface AppShellProps {
  children: ReactNode;
}

/**
 * AppShell - Applies safe area padding via CSS env() variables.
 * Top/left/right insets are handled here; bottom inset is handled
 * by individual components (e.g. bottom-bar, SideMenu).
 */
const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const { isStandalone, isIOS, isAndroid } = usePlatform();

  return (
    <div className='main-wrapper'>
      <div id="content-root" className='max-w-4xl mx-auto'>
        <div className="app-shell" data-pwa={isStandalone} data-ios={isIOS} data-android={isAndroid}>
          <div className='page-layout'>{children}</div>
        </div>
      </div>
    </div>
  );
};

export default AppShell;
