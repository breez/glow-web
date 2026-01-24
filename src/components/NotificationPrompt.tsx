import React, { useState, useEffect } from 'react';
import { Transition } from '@headlessui/react';
import {
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  getNotificationSettings,
  saveNotificationSettings,
} from '../services/notificationService';

const PROMPT_DISMISSED_KEY = 'notification_prompt_dismissed';

interface NotificationPromptProps {
  /** Called when prompt is closed (either by enabling or dismissing) */
  onClose?: () => void;
}

/**
 * A prompt that appears to ask users to enable push notifications.
 * Only shows if notifications are supported, not yet granted, and not previously dismissed.
 */
const NotificationPrompt: React.FC<NotificationPromptProps> = ({ onClose }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);

  useEffect(() => {
    // Check if we should show the prompt
    const shouldShow = () => {
      if (!isNotificationSupported()) return false;

      const permission = getNotificationPermission();
      if (permission === 'granted' || permission === 'denied') return false;

      // Check if user has dismissed the prompt before
      const dismissed = localStorage.getItem(PROMPT_DISMISSED_KEY);
      if (dismissed === 'true') return false;

      return true;
    };

    // Delay showing the prompt slightly for better UX
    const timer = setTimeout(() => {
      if (shouldShow()) {
        setIsVisible(true);
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  const handleEnable = async () => {
    setIsRequesting(true);

    try {
      const permission = await requestNotificationPermission();

      if (permission === 'granted') {
        // Enable notification settings
        const settings = getNotificationSettings();
        settings.enabled = true;
        settings.paymentReceived = true;
        saveNotificationSettings(settings);
      }
    } finally {
      setIsRequesting(false);
      setIsVisible(false);
      onClose?.();
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(PROMPT_DISMISSED_KEY, 'true');
    setIsVisible(false);
    onClose?.();
  };

  if (!isVisible) return null;

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
          {/* Bell icon */}
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
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
              />
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="font-display font-semibold text-spark-text-primary text-sm">
              Enable Notifications
            </h3>
            <p className="text-xs text-spark-text-muted mt-1">
              Get notified when you receive payments, even when the app is in the background.
            </p>

            <div className="flex gap-2 mt-3">
              <button
                onClick={handleEnable}
                disabled={isRequesting}
                className="flex-1 px-3 py-2 bg-spark-primary text-white text-sm font-medium rounded-xl hover:bg-spark-primary-light transition-colors disabled:opacity-50"
              >
                {isRequesting ? 'Enabling...' : 'Enable'}
              </button>
              <button
                onClick={handleDismiss}
                disabled={isRequesting}
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

export default NotificationPrompt;
