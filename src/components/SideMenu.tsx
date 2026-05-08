import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Transition, TransitionChild } from '@headlessui/react';
import { isPasskeyMode } from '@/services/passkeyService';
import { RefundIcon, BackupIcon, SettingsIcon, LogoutIcon, CloseIcon, AlertTriangleIcon } from './Icons';
import { safeAreaTop, safeAreaBottom } from '../utils/safeAreaInsets';
import { useStatusBarColor } from '../hooks/useStatusBarColor';
import { STATUS_BAR_SURFACE, STATUS_BAR_DIALOG_SCRIM } from '../utils/statusBarManager';
import { useBackButton } from '../hooks/useBackButton';
import GlowLogo from './GlowLogo';

// External-store measurement of the content-root's left offset, used
// to anchor the drawer panel to the centered max-w-4xl column.
// Module-level so identities are stable for useSyncExternalStore.
//
// Only window resize changes the offset; scroll does not. A previous
// version of this listener also subscribed to capture-phase scroll,
// which on mobile fired dozens of forced synchronous layouts per
// inertial scroll burst (every getBoundingClientRect call) and stalled
// the main thread enough to drop frames on the drawer's slide-in.
const subscribeContentRoot = (notify: () => void) => {
  let rafId: number | null = null;
  const initialNotify = () => {
    rafId = null;
    notify();
  };
  // Re-notify after subscribe so the first render (null result before
  // content-root is in the DOM) gets re-evaluated next frame.
  rafId = requestAnimationFrame(initialNotify);
  window.addEventListener('resize', notify);
  return () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    window.removeEventListener('resize', notify);
  };
};

const getContentRootLeft = (): number | null => {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById('content-root');
  return el ? el.getBoundingClientRect().left : null;
};

// SSR contract for useSyncExternalStore. SideMenu is client-only.
const getServerSnapshot = (): number | null => null;

interface SideMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenBackup: () => void;
  onOpenRefund?: () => void;
  hasRejectedDeposits?: boolean;
}

const SideMenu: React.FC<SideMenuProps> = ({ isOpen, onClose, onLogout, onOpenSettings, onOpenBackup, onOpenRefund, hasRejectedDeposits = false }) => {
  // While the drawer is open, push the solid spark-surface tone over
  // the wallet page's glass tint so the status bar matches the drawer
  // panel's solid bg. Tied to isOpen so popping happens on close.
  useStatusBarColor(STATUS_BAR_SURFACE, isOpen);

  const leftOffset = useSyncExternalStore(
    subscribeContentRoot,
    getContentRootLeft,
    getServerSnapshot
  );
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // When the logout confirmation dialog opens, dim the system bars to
  // the same scrim tone the React backdrop applies to the content
  // behind the dialog. Tied to showLogoutConfirm so closing the
  // dialog restores the drawer's surface tone (which in turn restores
  // the wallet page glass on drawer close).
  useStatusBarColor(STATUS_BAR_DIALOG_SCRIM, showLogoutConfirm);

  // Hardware back button: close the logout confirm dialog if it's
  // up; otherwise close the drawer. Two registrations so they stack
  // in LIFO order — the logout confirm is registered last, so it's
  // on top of the drawer's own handler when both are showing.
  useBackButton(() => {
    onClose();
  }, isOpen);
  useBackButton(() => {
    setShowLogoutConfirm(false);
  }, showLogoutConfirm);

  const isPasskey = isPasskeyMode();

  // Stars animate after the 300ms slide-in delay. Derived from isOpen
  // so close flips it off immediately without a reset in an effect.
  const [starsLit, setStarsLit] = useState(false);
  const starsAnimating = isOpen && starsLit;

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => setStarsLit(true), 300);
    return () => {
      clearTimeout(timer);
      setStarsLit(false);
    };
  }, [isOpen]);

  // Close the drawer first, then fire the navigation callback once the
  // drawer's leave animation completes. Kept sequential (not
  // concurrent) so the drawer's left-edge motion doesn't compete with
  // SlideInPage's left-edge enter — even though z-60 on SlideInPage
  // makes the drawer invisible for most of the overlap, running them
  // back-to-back feels cleaner and gives the user a moment to see the
  // drawer close before the new page arrives. 100ms matches the
  // drawer panel `duration-100` leave transition below — if that
  // changes, bump this too.
  const DRAWER_LEAVE_MS = 100;
  const closeDrawerThen = (fn: () => void) => {
    onClose();
    setTimeout(fn, DRAWER_LEAVE_MS);
  };

  const menuItems = [
    // Get Refund - only show when there are rejected deposits
    ...(hasRejectedDeposits && onOpenRefund ? [{
      icon: <RefundIcon />,
      label: 'Get Refund',
      onClick: () => closeDrawerThen(onOpenRefund),
      highlight: true
    }] : []),
    {
      icon: <BackupIcon />,
      label: 'Backup',
      onClick: () => closeDrawerThen(onOpenBackup)
    },
    {
      icon: <SettingsIcon />,
      label: 'Settings',
      onClick: () => closeDrawerThen(onOpenSettings)
    },
    {
      icon: <LogoutIcon />,
      label: 'Logout',
      onClick: () => { setShowLogoutConfirm(true); }
    }
  ];

  const handleConfirmLogout = () => {
    setShowLogoutConfirm(false);
    onClose();
    onLogout();
  };

  return createPortal(
    <Transition show={isOpen} as="div" className="fixed inset-0 z-50">
      {/* Backdrop — Material 3 emphasized easing (decelerate enter /
          accelerate exit) at 100ms. Duration is faster than M3's
          `motionDurationMedium4` canonical nav-drawer spec (400ms);
          we prioritise snap over the full M3 arc. */}
      <TransitionChild
        as="div"
        enter="transition-opacity ease-m3-emphasized-decelerate duration-150"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity ease-m3-emphasized-accelerate duration-100"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
        className="fixed inset-0"
      >
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      </TransitionChild>

      {/* Panel */}
      {leftOffset !== null && (
        <div
          className="fixed top-0 bottom-0 w-72 overflow-hidden"
          style={{ left: leftOffset }}
        >
          <TransitionChild
            as="div"
            enter="transition transform ease-m3-emphasized-decelerate duration-150"
            enterFrom="-translate-x-full"
            enterTo="translate-x-0"
            leave="transition transform ease-m3-emphasized-accelerate duration-100"
            leaveFrom="translate-x-0"
            leaveTo="-translate-x-full"
            className="w-72 h-full bg-spark-surface border-r border-spark-border shadow-glass-lg px-6 flex flex-col"
            style={{ paddingTop: safeAreaTop, paddingBottom: safeAreaBottom }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-8 pt-6">
              <div className="flex items-center gap-2.5">
                <GlowLogo sizePx={40} starsAnimating={starsAnimating} />
                <h2 className="font-display text-xl font-bold text-spark-text-primary">Glow</h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 -mr-2 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors"
                aria-label="Close"
              >
                <CloseIcon />
              </button>
            </div>

            {/* Navigation */}
            <nav className="space-y-1 flex-1">
              {menuItems.map((item, index) => (
                <button
                  key={index}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                    ('highlight' in item && item.highlight)
                      ? 'text-spark-warning hover:text-spark-warning hover:bg-spark-warning/10'
                      : 'text-spark-text-secondary hover:text-spark-text-primary hover:bg-white/5'
                  }`}
                  onClick={item.onClick}
                >
                  {item.icon}
                  <span className="font-display font-medium">{item.label}</span>
                </button>
              ))}
            </nav>

            {/* Footer */}
            <div className="pt-6 pb-6 border-t border-spark-border">
              <a
                href="https://breez.technology/sdk/"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-spark-text-muted text-center hover:text-spark-text-secondary transition-colors"
              >
                Powered by Breez SDK
              </a>
            </div>

            {/* Logout Confirmation Dialog */}
            <Transition show={showLogoutConfirm} as="div" className="fixed inset-0 z-60">
              <TransitionChild
                as="div"
                enter="transition-opacity ease-out duration-150"
                enterFrom="opacity-0"
                enterTo="opacity-100"
                leave="transition-opacity ease-in duration-100"
                leaveFrom="opacity-100"
                leaveTo="opacity-0"
                className="fixed inset-0 bg-black/85 backdrop-blur-md"
                onClick={() => setShowLogoutConfirm(false)}
              />
              <div className="fixed inset-0 flex items-center justify-center p-4">
                <TransitionChild
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
                      <AlertTriangleIcon className="w-7 h-7 text-spark-warning" />
                    </div>
                  </div>

                  <h3 className="font-display text-lg font-semibold text-spark-text-primary text-center mb-2">
                    Logout Warning
                  </h3>
                  <p className="text-spark-text-secondary text-sm text-center mb-6">
                    {isPasskey
                      ? "You'll need to authenticate with the same passkey to access your funds again."
                      : "Make sure you've saved your recovery phrase before logging out. You'll need it to access your funds again."}
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
                </TransitionChild>
              </div>
            </Transition>
          </TransitionChild>
        </div>
      )}
    </Transition>,
    document.body
  );
};

export default SideMenu;
