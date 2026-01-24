import React, { useState, useEffect } from 'react';
import { Transition } from '@headlessui/react';

const INSTALL_PROMPT_DISMISSED_KEY = 'install_prompt_dismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallPromptProps {
  onClose?: () => void;
}

/**
 * A prompt that appears to help users install the app as a PWA.
 * Only shows if the browser supports installation and user hasn't dismissed it.
 */
const InstallPrompt: React.FC<InstallPromptProps> = ({ onClose }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    // Check if already dismissed
    const dismissed = localStorage.getItem(INSTALL_PROMPT_DISMISSED_KEY);
    if (dismissed === 'true') return;

    // Check if already installed (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);

      // Delay showing the prompt for better UX
      setTimeout(() => {
        setIsVisible(true);
      }, 3000);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    setIsInstalling(true);

    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      if (outcome === 'accepted') {
        setIsVisible(false);
        onClose?.();
      }
    } finally {
      setIsInstalling(false);
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(INSTALL_PROMPT_DISMISSED_KEY, 'true');
    setIsVisible(false);
    onClose?.();
  };

  if (!isVisible || !deferredPrompt) return null;

  return (
    <Transition
      show={isVisible}
      enter="transform transition ease-out duration-300"
      enterFrom="translate-y-full opacity-0"
      enterTo="translate-y-0 opacity-100"
      leave="transform transition ease-in duration-200"
      leaveFrom="translate-y-0 opacity-100"
      leaveTo="translate-y-full opacity-0"
      className="fixed bottom-4 left-4 right-4 z-40 max-w-md mx-auto"
    >
      <div className="bg-spark-surface border border-spark-border rounded-2xl p-4 shadow-glass-lg">
        <div className="flex items-start gap-3">
          {/* Download icon */}
          <div className="flex-shrink-0 w-10 h-10 bg-spark-primary/20 rounded-xl flex items-center justify-center">
            <svg
              className="w-5 h-5 text-spark-primary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="font-display font-semibold text-spark-text-primary text-sm">
              Install Glow
            </h3>
            <p className="text-xs text-spark-text-muted mt-1">
              Add to your home screen for quick access and a better experience.
            </p>

            <div className="flex gap-2 mt-3">
              <button
                onClick={handleInstall}
                disabled={isInstalling}
                className="flex-1 px-3 py-2 bg-spark-primary text-white text-sm font-medium rounded-xl hover:bg-spark-primary-light transition-colors disabled:opacity-50"
              >
                {isInstalling ? 'Installing...' : 'Install'}
              </button>
              <button
                onClick={handleDismiss}
                disabled={isInstalling}
                className="px-3 py-2 text-spark-text-muted text-sm font-medium hover:text-spark-text-secondary transition-colors"
              >
                Not now
              </button>
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 p-1 text-spark-text-muted hover:text-spark-text-secondary transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </Transition>
  );
};

export default InstallPrompt;
