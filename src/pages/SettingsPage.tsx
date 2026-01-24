import React, { useEffect, useState } from 'react';
import { Transition } from '@headlessui/react';
import { FormGroup, FormInput, LoadingSpinner, PrimaryButton } from '../components/ui';
import { getSettings, saveSettings, UserSettings } from '../services/settings';
import type { Config, Network } from '@breeztech/breez-sdk-spark';
import { useWallet } from '@/contexts/WalletContext';
import {
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  getNotificationSettings,
  saveNotificationSettings,
  NotificationSettings,
} from '../services/notificationService';

const DEV_MODE_TAP_COUNT = 5;
const DEV_MODE_STORAGE_KEY = 'spark-dev-mode';

interface SettingsPageProps {
  onBack: () => void;
  config: Config | null;
  onOpenFiatCurrencies: () => void;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ onBack, config, onOpenFiatCurrencies }) => {
  const wallet = useWallet();
  const [isOpen, setIsOpen] = useState(true);
  const [isDevMode, setIsDevMode] = useState<boolean>(false);
  const [devTapCount, setDevTapCount] = useState(0);
  const [selectedNetwork, setSelectedNetwork] = useState<Network>('mainnet');
  const [feeType, setFeeType] = useState<'fixed' | 'rate' | 'networkRecommended'>('fixed');
  const [feeValue, setFeeValue] = useState<string>('1');
  const [syncIntervalSecs, setSyncIntervalSecs] = useState<string>('');
  const [lnurlDomain, setLnurlDomain] = useState<string>('');
  const [preferSparkOverLightning, setPreferSparkOverLightning] = useState<boolean>(false);
  const [sparkPrivateModeEnabled, setSparkPrivateModeEnabled] = useState<boolean>(true);
  const [isLoadingUserSettings, setIsLoadingUserSettings] = useState<boolean>(true);

  // Notification settings state
  const [notificationsSupported, setNotificationsSupported] = useState<boolean>(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>({
    enabled: false,
    paymentReceived: true,
    paymentSent: false,
  });
  const [isRequestingPermission, setIsRequestingPermission] = useState<boolean>(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Check URL param or localStorage for dev mode
    const urlDevMode = params.get('dev') === 'true';
    const storedDevMode = localStorage.getItem(DEV_MODE_STORAGE_KEY) === 'true';
    setIsDevMode(urlDevMode || storedDevMode);
    
    // Get current network from URL
    const network = (params.get('network') || 'mainnet') as Network;
    setSelectedNetwork(network);

    const s = getSettings();
    if (s.depositMaxFee.type === 'fixed') {
      setFeeType('fixed');
      setFeeValue(String(s.depositMaxFee.amount));
    } else if (s.depositMaxFee.type === 'rate') {
      setFeeType('rate');
      setFeeValue(String(s.depositMaxFee.satPerVbyte));
    } else if (s.depositMaxFee.type === 'networkRecommended') {
      setFeeType('networkRecommended');
      setFeeValue(String(s.depositMaxFee.leewaySatPerVbyte));
    }

    const cfg: any = config ?? {};
    setSyncIntervalSecs(
      typeof s.syncIntervalSecs === 'number'
        ? String(s.syncIntervalSecs)
        : (typeof cfg.syncIntervalSecs === 'number' ? String(cfg.syncIntervalSecs) : '')
    );
    setLnurlDomain(
      typeof s.lnurlDomain === 'string'
        ? s.lnurlDomain
        : (typeof cfg.lnurlDomain === 'string' ? cfg.lnurlDomain : '')
    );
    setPreferSparkOverLightning(
      typeof s.preferSparkOverLightning === 'boolean'
        ? s.preferSparkOverLightning
        : (typeof cfg.preferSparkOverLightning === 'boolean' ? cfg.preferSparkOverLightning : false)
    );

    // Load notification settings
    setNotificationsSupported(isNotificationSupported());
    setNotificationPermission(getNotificationPermission());
    setNotificationSettings(getNotificationSettings());

    (async () => {
      try {
        setIsLoadingUserSettings(true);
        const us = await wallet.getUserSettings();
        setSparkPrivateModeEnabled(us.sparkPrivateModeEnabled !== false);
      } catch (e) {
        console.warn('Failed to load user settings from SDK:', e);
      } finally {
        setIsLoadingUserSettings(false);
      }
    })();
  }, [config, wallet]);

  const handleEnableNotifications = async () => {
    setIsRequestingPermission(true);
    try {
      const permission = await requestNotificationPermission();
      setNotificationPermission(permission);

      if (permission === 'granted') {
        const newSettings = { ...notificationSettings, enabled: true };
        setNotificationSettings(newSettings);
        saveNotificationSettings(newSettings);
      }
    } finally {
      setIsRequestingPermission(false);
    }
  };

  const handleToggleNotifications = (enabled: boolean) => {
    const newSettings = { ...notificationSettings, enabled };
    setNotificationSettings(newSettings);
    saveNotificationSettings(newSettings);
  };

  const handleTogglePaymentReceived = (paymentReceived: boolean) => {
    const newSettings = { ...notificationSettings, paymentReceived };
    setNotificationSettings(newSettings);
    saveNotificationSettings(newSettings);
  };

  const handleTogglePaymentSent = (paymentSent: boolean) => {
    const newSettings = { ...notificationSettings, paymentSent };
    setNotificationSettings(newSettings);
    saveNotificationSettings(newSettings);
  };

  const handleClose = () => {
    setIsOpen(false);
    setTimeout(onBack, 220);
  };

  const handleVersionTap = () => {
    const newCount = devTapCount + 1;
    setDevTapCount(newCount);
    
    if (newCount >= DEV_MODE_TAP_COUNT) {
      const newDevMode = !isDevMode;
      setIsDevMode(newDevMode);
      localStorage.setItem(DEV_MODE_STORAGE_KEY, String(newDevMode));
      setDevTapCount(0);
    }
    
    // Reset tap count after 2 seconds of inactivity
    setTimeout(() => setDevTapCount(0), 2000);
  };

  const handleNetworkChange = (network: Network) => {
    setSelectedNetwork(network);
    // Update URL and reload to reconnect with new network
    const url = new URL(window.location.href);
    url.searchParams.set('network', network);
    if (isDevMode) {
      url.searchParams.set('dev', 'true');
    }
    window.location.href = url.toString();
  };

  const handleSave = async () => {
    const n = Number(feeValue);
    if (isDevMode) {
      const updated: UserSettings = {
        ...(feeType === 'fixed'
          ? { depositMaxFee: { type: 'fixed', amount: Math.floor(n) } }
          : feeType === 'rate'
            ? { depositMaxFee: { type: 'rate', satPerVbyte: n } }
            : { depositMaxFee: { type: 'networkRecommended', leewaySatPerVbyte: Math.max(0, Math.floor(n)) } }
        ),
        syncIntervalSecs: syncIntervalSecs !== '' ? Math.max(0, Math.floor(Number(syncIntervalSecs))) : undefined,
        lnurlDomain: lnurlDomain !== '' ? lnurlDomain : undefined,
        preferSparkOverLightning,
      };
      saveSettings(updated);
    }
    try {
      await wallet.setUserSettings({ sparkPrivateModeEnabled });
    } catch (e) {
      console.warn('Failed to update SDK user settings:', e);
    }
    window.location.reload();
  };

  const handleDownloadLogs = () => {
    try {
      const content = wallet.getSdkLogs();
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:]/g, '-');
      a.href = url;
      a.download = `sdk-logs-${ts}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn('Failed to download logs:', e);
    }
  };

  return (
    <div className="absolute inset-0 z-50 overflow-hidden">
      <Transition show={isOpen} appear as="div" className="absolute inset-0">
        <Transition.Child
          as="div"
          enter="transform transition ease-out duration-300"
          enterFrom="translate-x-[-100%]"
          enterTo="translate-x-0"
          leave="transform transition ease-in duration-200"
          leaveFrom="translate-x-0"
          leaveTo="translate-x-[-100%]"
          className="absolute inset-0"
        >
          <div className="flex flex-col h-full bg-spark-surface">
            {/* Header */}
            <div className="relative px-4 py-4 border-b border-spark-border">
              <h1 className="text-center font-display text-lg font-semibold text-spark-text-primary">Settings</h1>
              <button
                onClick={handleClose}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="max-w-xl mx-auto w-full p-4 space-y-4">
                {/* Dev Mode Network Selector */}
                {isDevMode && (
                  <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
                    <h3 className="font-display font-semibold text-spark-text-primary mb-3">Network</h3>
                    <div className="flex gap-2">
                      {(['mainnet', 'regtest'] as Network[]).map((network) => (
                        <button
                          key={network}
                          onClick={() => handleNetworkChange(network)}
                          className={`flex-1 py-2.5 px-3 rounded-xl text-sm font-medium transition-all ${
                            selectedNetwork === network
                              ? 'bg-spark-primary text-white'
                              : 'bg-spark-surface border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light'
                          }`}
                        >
                          {network === 'mainnet' ? 'Mainnet' : 'Regtest'}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-spark-text-muted mt-2">
                      Changing network will reload the app and reconnect.
                    </p>
                  </div>
                )}

                {/* Dev Mode Fee Settings */}
                {isDevMode && (
                  <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
                    <h3 className="font-display font-semibold text-spark-text-primary mb-3">Deposit Claim Fee</h3>
                    <FormGroup>
                      <div className="flex gap-2 items-center">
                        <select
                          value={feeType}
                          onChange={(e) => setFeeType(e.currentTarget.value as 'fixed' | 'rate' | 'networkRecommended')}
                          className="min-w-[160px] bg-spark-surface border border-spark-border rounded-xl px-3 py-3 text-spark-text-primary text-sm focus:border-spark-primary focus:ring-2 focus:ring-spark-primary/20"
                          aria-label="Max fee type"
                        >
                          <option className="bg-spark-surface" value="fixed">Fixed (sats)</option>
                          <option className="bg-spark-surface" value="rate">Rate (sat/vB)</option>
                          <option className="bg-spark-surface" value="networkRecommended">Network + leeway</option>
                        </select>
                        <div className="flex-1">
                          <FormInput
                            id="deposit-fee-default"
                            type="number"
                            min={0}
                            value={feeValue}
                            onChange={(e) => setFeeValue(e.target.value)}
                            placeholder={feeType === 'fixed' ? 'sats' : 'sat/vB'}
                          />
                        </div>
                      </div>
                    </FormGroup>
                  </div>
                )}

                {/* Notifications */}
                {notificationsSupported && (
                  <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
                    <h3 className="font-display font-semibold text-spark-text-primary mb-3">Notifications</h3>

                    {notificationPermission === 'denied' ? (
                      <p className="text-sm text-spark-text-muted">
                        Notifications are blocked. Please enable them in your browser settings.
                      </p>
                    ) : notificationPermission !== 'granted' ? (
                      <button
                        onClick={handleEnableNotifications}
                        disabled={isRequestingPermission}
                        className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-spark-primary text-white rounded-xl hover:bg-spark-primary-light transition-colors disabled:opacity-50"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                        </svg>
                        {isRequestingPermission ? 'Enabling...' : 'Enable Notifications'}
                      </button>
                    ) : (
                      <div className="space-y-3">
                        {/* Master toggle */}
                        <label className="flex items-center justify-between cursor-pointer">
                          <span className="text-sm text-spark-text-secondary">Enable notifications</span>
                          <input
                            type="checkbox"
                            className="w-5 h-5 rounded border-spark-border bg-spark-surface text-spark-primary focus:ring-spark-primary/20 focus:ring-2"
                            checked={notificationSettings.enabled}
                            onChange={(e) => handleToggleNotifications(e.target.checked)}
                          />
                        </label>

                        {notificationSettings.enabled && (
                          <>
                            <div className="border-t border-spark-border/50 my-2" />

                            {/* Payment received toggle */}
                            <label className="flex items-center justify-between cursor-pointer">
                              <div>
                                <span className="text-sm text-spark-text-secondary block">Payment received</span>
                                <span className="text-xs text-spark-text-muted">Get notified when you receive sats</span>
                              </div>
                              <input
                                type="checkbox"
                                className="w-5 h-5 rounded border-spark-border bg-spark-surface text-spark-primary focus:ring-spark-primary/20 focus:ring-2"
                                checked={notificationSettings.paymentReceived}
                                onChange={(e) => handleTogglePaymentReceived(e.target.checked)}
                              />
                            </label>

                            {/* Payment sent toggle */}
                            <label className="flex items-center justify-between cursor-pointer">
                              <div>
                                <span className="text-sm text-spark-text-secondary block">Payment sent</span>
                                <span className="text-xs text-spark-text-muted">Get notified when you send sats</span>
                              </div>
                              <input
                                type="checkbox"
                                className="w-5 h-5 rounded border-spark-border bg-spark-surface text-spark-primary focus:ring-spark-primary/20 focus:ring-2"
                                checked={notificationSettings.paymentSent}
                                onChange={(e) => handleTogglePaymentSent(e.target.checked)}
                              />
                            </label>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Fiat Currencies */}
                <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
                  <h3 className="font-display font-semibold text-spark-text-primary mb-3">Display</h3>
                  <button
                    className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:bg-white/5 transition-colors"
                    type="button"
                    onClick={onOpenFiatCurrencies}
                  >
                    <div className="flex items-center gap-3">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Fiat Currencies</span>
                    </div>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>

                {/* SDK Logs */}
                <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
                  <h3 className="font-display font-semibold text-spark-text-primary mb-3">Diagnostics</h3>
                  <button
                    className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:bg-white/5 transition-colors"
                    type="button"
                    onClick={handleDownloadLogs}
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download Logs
                  </button>
                </div>

                {/* Dev Mode Advanced Settings */}
                {isDevMode && (
                  <>
                    <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
                      <h3 className="font-display font-semibold text-spark-text-primary mb-3">Sync Settings</h3>
                      <FormGroup>
                        <label htmlFor="sync-interval" className="block text-sm text-spark-text-secondary mb-1">
                          Sync interval (seconds)
                        </label>
                        <FormInput
                          id="sync-interval"
                          type="number"
                          min={0}
                          value={syncIntervalSecs}
                          onChange={(e) => setSyncIntervalSecs(e.target.value)}
                          placeholder="e.g. 30"
                        />
                      </FormGroup>
                    </div>

                    <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
                      <h3 className="font-display font-semibold text-spark-text-primary mb-3">LNURL</h3>
                      <FormGroup>
                        <label htmlFor="lnurl-domain" className="block text-sm text-spark-text-secondary mb-1">
                          Custom domain
                        </label>
                        <FormInput
                          id="lnurl-domain"
                          type="text"
                          value={lnurlDomain}
                          onChange={(e) => setLnurlDomain(e.target.value)}
                          placeholder="example.com"
                        />
                      </FormGroup>
                    </div>

                    <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          className="w-5 h-5 rounded border-spark-border bg-spark-surface text-spark-primary focus:ring-spark-primary/20 focus:ring-2"
                          checked={preferSparkOverLightning}
                          onChange={(e) => setPreferSparkOverLightning(e.currentTarget.checked)}
                        />
                        <div>
                          <span className="font-display font-medium text-spark-text-primary block">Prefer Spark</span>
                          <span className="text-sm text-spark-text-muted">Use Spark address over Lightning invoice when available</span>
                        </div>
                      </label>
                    </div>

                    {/* Privacy Settings - Dev Mode only */}
                    <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <h3 className="font-display font-semibold text-spark-text-primary">Privacy</h3>
                        {isLoadingUserSettings && <LoadingSpinner size="small" />}
                      </div>
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          className="w-5 h-5 mt-0.5 rounded border-spark-border bg-spark-surface text-spark-primary focus:ring-spark-primary/20 focus:ring-2"
                          checked={sparkPrivateModeEnabled}
                          disabled={isLoadingUserSettings}
                          onChange={(e) => setSparkPrivateModeEnabled(e.currentTarget.checked)}
                        />
                        <div>
                          <span className="font-display font-medium text-spark-text-primary block">Private Mode</span>
                          <span className="text-sm text-spark-text-muted">Hide your address from public explorers (not suitable for zaps)</span>
                        </div>
                      </label>
                    </div>
                  </>
                )}

                {/* Version / Dev Mode Toggle */}
                <div className="text-center pt-4">
                  <button
                    onClick={handleVersionTap}
                    className="text-spark-text-muted text-xs hover:text-spark-text-secondary transition-colors select-none"
                  >
                    Glow v1.0.0
                    {isDevMode && <span className="ml-1 text-spark-primary">(dev)</span>}
                  </button>
                  {devTapCount > 0 && devTapCount < DEV_MODE_TAP_COUNT && (
                    <p className="text-xs text-spark-text-muted mt-1">
                      {DEV_MODE_TAP_COUNT - devTapCount} more taps to {isDevMode ? 'disable' : 'enable'} dev mode
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Footer - Dev Mode only */}
            {isDevMode && (
              <div className="flex-shrink-0 p-4 pb-8 border-t border-spark-border bg-spark-surface">
                <div className="max-w-xl mx-auto">
                  <PrimaryButton className="w-full" onClick={handleSave}>
                    Save Changes
                  </PrimaryButton>
                </div>
              </div>
            )}
          </div>
        </Transition.Child>
      </Transition>
    </div>
  );
};

export default SettingsPage;
