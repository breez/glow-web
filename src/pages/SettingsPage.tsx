import React, { useEffect, useState } from 'react';
import { FormGroup, FormInput, LoadingSpinner, PrimaryButton, Switch } from '../components/ui';
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
import { NotificationIcon, CurrencyIcon, ChevronRightIcon, DownloadIcon } from '../components/Icons';
import SlideInPage from '../components/layout/SlideInPage';
import { logger, LogCategory } from '@/services/logger';

const DEV_MODE_TAP_COUNT = 5;
const DEV_MODE_STORAGE_KEY = 'spark-dev-mode';

interface SettingsPageProps {
  onBack: () => void;
  config: Config | null;
  onOpenFiatCurrencies: () => void;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ onBack, config, onOpenFiatCurrencies }) => {
  const wallet = useWallet();
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
  });
  const [isRequestingPermission, setIsRequestingPermission] = useState<boolean>(false);
  const [isDownloadingLogs, setIsDownloadingLogs] = useState<boolean>(false);

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK config type doesn't expose all fields
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
        logger.warn(LogCategory.SDK, 'Failed to load user settings from SDK', {
          error: e instanceof Error ? e.message : String(e),
        });
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

  const handleVersionTap = () => {
    setDevTapCount(prev => {
      const newCount = prev + 1;

      if (newCount >= DEV_MODE_TAP_COUNT) {
        setIsDevMode(current => {
          const newDevMode = !current;
          localStorage.setItem(DEV_MODE_STORAGE_KEY, String(newDevMode));
          return newDevMode;
        });
        return 0;
      }

      return newCount;
    });

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
      logger.warn(LogCategory.SDK, 'Failed to update SDK user settings', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    window.location.reload();
  };

  const handleShareLogs = async () => {
    setIsDownloadingLogs(true);
    try {
      await wallet.shareOrDownloadLogs();
    } catch (e) {
      logger.warn(LogCategory.SDK, 'Failed to share or download logs', {
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsDownloadingLogs(false);
    }
  };

  const footer = isDevMode ? (
    <PrimaryButton className="w-full" onClick={handleSave}>
      Save Changes
    </PrimaryButton>
  ) : undefined;

  return (
    <SlideInPage title="Settings" onClose={onBack} slideFrom="left" footer={footer}>
      <div className="p-4">
        <div className="max-w-xl mx-auto w-full space-y-4">
          {/* Dev Mode Network Selector */}
          {isDevMode && (
            <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
              <h3 className="font-display font-semibold text-spark-text-primary mb-3">Network</h3>
              <div className="flex gap-2">
                {(['mainnet', 'regtest'] as Network[]).map((network) => (
                  <button
                    key={network}
                    onClick={() => handleNetworkChange(network)}
                    className={`flex-1 py-2.5 px-3 rounded-xl text-sm font-medium transition-all ${selectedNetwork === network
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

          {/* Fiat Currencies */}
          <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
            <h3 className="font-display font-semibold text-spark-text-primary mb-3">Display</h3>
            <button
              className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:bg-white/5 transition-colors"
              type="button"
              onClick={onOpenFiatCurrencies}
            >
              <div className="flex items-center gap-3">
                <CurrencyIcon size="md" />
                <span>Fiat Currencies</span>
              </div>
              <ChevronRightIcon size="md" />
            </button>
          </div>

          {/* SDK Logs */}
          <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
            <h3 className="font-display font-semibold text-spark-text-primary mb-3">Diagnostics</h3>
            <button
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:bg-white/5 transition-colors disabled:opacity-50"
              type="button"
              onClick={handleShareLogs}
              disabled={isDownloadingLogs}
            >
              {isDownloadingLogs ? (
                <LoadingSpinner size="small" />
              ) : (
                <DownloadIcon size="md" />
              )}
              {isDownloadingLogs ? 'Preparing...' : 'Export Logs'}
            </button>
            <p className="text-xs text-spark-text-muted mt-2">
              Export logs from up to 10 recent sessions.
            </p>
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
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="font-display font-medium text-spark-text-primary block">Prefer Spark</span>
                    <span className="text-sm text-spark-text-muted">Use Spark address over Lightning invoice when available</span>
                  </div>
                  <Switch
                    checked={preferSparkOverLightning}
                    onChange={() => setPreferSparkOverLightning(!preferSparkOverLightning)}
                  />
                </div>
              </div>

              {/* Privacy Settings - Dev Mode only */}
              <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="font-display font-semibold text-spark-text-primary">Privacy</h3>
                  {isLoadingUserSettings && <LoadingSpinner size="small" />}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="font-display font-medium text-spark-text-primary block">Private Mode</span>
                    <span className="text-sm text-spark-text-muted">Hide your address from public explorers (not suitable for zaps)</span>
                  </div>
                  <Switch
                    checked={sparkPrivateModeEnabled}
                    onChange={() => setSparkPrivateModeEnabled(!sparkPrivateModeEnabled)}
                    disabled={isLoadingUserSettings}
                  />
                </div>
              </div>

              {/* Notifications - Dev Mode only */}
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
                      <NotificationIcon size="md" />
                      {isRequestingPermission ? 'Enabling...' : 'Enable Notifications'}
                    </button>
                  ) : (
                    <div className="space-y-3">
                      {/* Master toggle */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-spark-text-secondary">Enable notifications</span>
                        <Switch
                          checked={notificationSettings.enabled}
                          onChange={() => handleToggleNotifications(!notificationSettings.enabled)}
                        />
                      </div>

                      {notificationSettings.enabled && (
                        <>
                          <div className="border-t border-spark-border/50 my-2" />

                          {/* Payment received toggle */}
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-sm text-spark-text-secondary block">Payment received</span>
                              <span className="text-xs text-spark-text-muted">Get notified when you receive sats</span>
                            </div>
                            <Switch
                              checked={notificationSettings.paymentReceived}
                              onChange={() => handleTogglePaymentReceived(!notificationSettings.paymentReceived)}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
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
    </SlideInPage>
  );
};

export default SettingsPage;
