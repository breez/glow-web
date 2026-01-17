import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Transition } from '@headlessui/react';

interface SideMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenBackup: () => void;
}

const SideMenu: React.FC<SideMenuProps> = ({ isOpen, onClose, onLogout, onOpenSettings, onOpenBackup }) => {
  const [leftOffset, setLeftOffset] = useState<number | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  useEffect(() => {
    const calc = () => {
      const el = document.getElementById('content-root');
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setLeftOffset(rect.left);
    };
    calc();
    window.addEventListener('resize', calc);
    window.addEventListener('scroll', calc, true);
    return () => {
      window.removeEventListener('resize', calc);
      window.removeEventListener('scroll', calc, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const el = document.getElementById('content-root');
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setLeftOffset(rect.left);
  }, [isOpen]);

  const menuItems = [
    {
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
        </svg>
      ),
      label: 'Backup',
      onClick: () => { onOpenBackup(); onClose(); }
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      label: 'Settings',
      onClick: () => { onOpenSettings(); onClose(); }
    },
    {
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      ),
      label: 'Logout',
      onClick: () => { setShowLogoutConfirm(true); },
      danger: true
    }
  ];

  const handleConfirmLogout = () => {
    setShowLogoutConfirm(false);
    onClose();
    onLogout();
  };

  return createPortal(
    <Transition show={isOpen} as="div" className="fixed inset-0 z-50">
      {/* Backdrop */}
      <Transition.Child
        as="div"
        enter="transition-opacity ease-out duration-200"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity ease-in duration-150"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
        className="fixed inset-0"
      >
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      </Transition.Child>

      {/* Panel */}
      {leftOffset !== null && (
        <div
          className="fixed top-0 bottom-0 w-72 overflow-hidden"
          style={{ left: leftOffset }}
        >
          <Transition.Child
            as="div"
            enter="transition transform ease-out duration-300"
            enterFrom="-translate-x-full"
            enterTo="translate-x-0"
            leave="transition transform ease-in duration-200"
            leaveFrom="translate-x-0"
            leaveTo="-translate-x-full"
            className="w-72 h-full bg-spark-surface border-r border-spark-border shadow-glass-lg p-6 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-spark-amber to-spark-amber/80 flex items-center justify-center shadow-glow-amber">
                  <svg className="w-6 h-6 text-black" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z" />
                  </svg>
                </div>
                <div>
                  <h2 className="font-display font-bold text-spark-text-primary">Spark</h2>
                  <p className="text-xs text-spark-text-muted">Wallet</p>
                </div>
              </div>
              <button 
                onClick={onClose} 
                className="p-2 -mr-2 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors" 
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Navigation */}
            <nav className="space-y-1 flex-1">
              {menuItems.map((item, index) => (
                <button
                  key={index}
                  className={`
                    w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all
                    ${item.danger 
                      ? 'text-spark-error hover:bg-spark-error/10' 
                      : 'text-spark-text-secondary hover:text-spark-text-primary hover:bg-white/5'
                    }
                  `}
                  onClick={item.onClick}
                >
                  {item.icon}
                  <span className="font-display font-medium">{item.label}</span>
                </button>
              ))}
            </nav>

            {/* Footer */}
            <div className="pt-6 border-t border-spark-border">
              <p className="text-xs text-spark-text-muted text-center">
                Powered by Breez SDK
              </p>
            </div>

            {/* Logout Confirmation Dialog */}
            <Transition show={showLogoutConfirm} as="div" className="fixed inset-0 z-60">
              <Transition.Child
                as="div"
                enter="transition-opacity ease-out duration-150"
                enterFrom="opacity-0"
                enterTo="opacity-100"
                leave="transition-opacity ease-in duration-100"
                leaveFrom="opacity-100"
                leaveTo="opacity-0"
                className="fixed inset-0 bg-black/70"
                onClick={() => setShowLogoutConfirm(false)}
              />
              <div className="fixed inset-0 flex items-center justify-center p-4">
                <Transition.Child
                  as="div"
                  enter="transition transform ease-out duration-200"
                  enterFrom="opacity-0 scale-95"
                  enterTo="opacity-100 scale-100"
                  leave="transition transform ease-in duration-150"
                  leaveFrom="opacity-100 scale-100"
                  leaveTo="opacity-0 scale-95"
                  className="w-full max-w-sm bg-spark-surface border border-spark-border rounded-2xl p-6 shadow-glass-lg"
                >
                  {/* Warning Icon */}
                  <div className="flex justify-center mb-4">
                    <div className="w-14 h-14 rounded-full bg-spark-warning/15 flex items-center justify-center">
                      <svg className="w-7 h-7 text-spark-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                  </div>

                  <h3 className="font-display text-lg font-semibold text-spark-text-primary text-center mb-2">
                    Logout Warning
                  </h3>
                  <p className="text-spark-text-secondary text-sm text-center mb-6">
                    Make sure you've saved your recovery phrase before logging out. You'll need it to access your wallet again.
                  </p>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowLogoutConfirm(false)}
                      className="flex-1 px-4 py-3 border border-spark-border text-spark-text-secondary rounded-xl font-medium hover:text-spark-text-primary hover:border-spark-border-light transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleConfirmLogout}
                      className="flex-1 px-4 py-3 bg-spark-error text-white rounded-xl font-medium hover:bg-spark-error/90 transition-colors"
                    >
                      Logout
                    </button>
                  </div>
                </Transition.Child>
              </div>
            </Transition>
          </Transition.Child>
        </div>
      )}
    </Transition>,
    document.body
  );
};

export default SideMenu;
