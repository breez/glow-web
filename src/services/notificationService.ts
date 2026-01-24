/**
 * Push Notification Service for Glow Wallet
 *
 * Handles browser push notifications for payment events,
 * particularly useful for "offline payments" via Lightning Address.
 */

// Extended notification options that include non-standard but widely supported properties
interface ExtendedNotificationOptions extends NotificationOptions {
  renotify?: boolean;
  vibrate?: number[];
  actions?: Array<{ action: string; title: string }>;
}

const NOTIFICATION_SETTINGS_KEY = 'notification_settings_v1';

export interface NotificationSettings {
  enabled: boolean;
  paymentReceived: boolean;
}

const defaultSettings: NotificationSettings = {
  enabled: false,
  paymentReceived: true,
};

/**
 * Check if the browser supports notifications
 */
export function isNotificationSupported(): boolean {
  return 'Notification' in window && 'serviceWorker' in navigator;
}

/**
 * Get current notification permission status
 */
export function getNotificationPermission(): NotificationPermission {
  if (!isNotificationSupported()) {
    return 'denied';
  }
  return Notification.permission;
}

/**
 * Request notification permission from the user
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) {
    console.warn('Notifications not supported in this browser');
    return 'denied';
  }

  try {
    const permission = await Notification.requestPermission();

    if (permission === 'granted') {
      // Update settings to enabled when permission is granted
      const settings = getNotificationSettings();
      settings.enabled = true;
      saveNotificationSettings(settings);
    }

    return permission;
  } catch (error) {
    console.error('Failed to request notification permission:', error);
    return 'denied';
  }
}

/**
 * Get notification settings from localStorage
 */
export function getNotificationSettings(): NotificationSettings {
  try {
    const raw = localStorage.getItem(NOTIFICATION_SETTINGS_KEY);
    if (!raw) return { ...defaultSettings };

    const parsed = JSON.parse(raw) as Partial<NotificationSettings>;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : defaultSettings.enabled,
      paymentReceived: typeof parsed.paymentReceived === 'boolean' ? parsed.paymentReceived : defaultSettings.paymentReceived,
    };
  } catch {
    return { ...defaultSettings };
  }
}

/**
 * Save notification settings to localStorage
 */
export function saveNotificationSettings(settings: NotificationSettings): void {
  localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Check if notifications are enabled and permitted
 */
export function canShowNotifications(): boolean {
  if (!isNotificationSupported()) return false;
  if (Notification.permission !== 'granted') return false;

  const settings = getNotificationSettings();
  return settings.enabled;
}

/**
 * Format satoshi amount for display
 */
function formatSats(amount: number): string {
  return new Intl.NumberFormat().format(amount);
}

/**
 * Show a payment received notification
 */
export async function showPaymentReceivedNotification(
  amountSats: number,
  description?: string
): Promise<void> {
  const settings = getNotificationSettings();

  if (!canShowNotifications() || !settings.paymentReceived) {
    return;
  }

  // Check if app is in foreground - skip notification if visible and focused
  // visibilityState is 'hidden' when minimized or screen off
  // hasFocus() is false when user switched to another app/window
  if (document.visibilityState === 'visible' && document.hasFocus()) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    const options: ExtendedNotificationOptions = {
      body: description
        ? `+${formatSats(amountSats)} sats\n${description}`
        : `+${formatSats(amountSats)} sats`,
      icon: '/icons/Glow-icon-192.png',
      badge: '/icons/Glow-icon-192.png',
      tag: 'payment-received',
      renotify: true,
      vibrate: [200, 100, 200],
      data: {
        type: 'payment_received',
        amount: amountSats,
      },
      actions: [
        { action: 'open', title: 'Open Glow' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    };

    await registration.showNotification('Payment Received', options);
  } catch (error) {
    console.error('Failed to show payment notification:', error);
  }
}

/**
 * Show a deposit claimed notification
 */
export async function showDepositClaimedNotification(
  count: number
): Promise<void> {
  if (!canShowNotifications()) {
    return;
  }

  // Check if app is in foreground - skip notification if visible and focused
  if (document.visibilityState === 'visible' && document.hasFocus()) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    const options: ExtendedNotificationOptions = {
      body: `${count} deposit${count > 1 ? 's' : ''} claimed successfully`,
      icon: '/icons/Glow-icon-192.png',
      badge: '/icons/Glow-icon-192.png',
      tag: 'deposit-claimed',
      data: {
        type: 'deposit_claimed',
        count,
      },
      actions: [
        { action: 'open', title: 'Open Glow' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    };

    await registration.showNotification('Deposits Claimed', options);
  } catch (error) {
    console.error('Failed to show deposit notification:', error);
  }
}

