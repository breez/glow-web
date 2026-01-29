import { MaxFee } from "@breeztech/breez-sdk-spark/web";

export interface UserSettings {
  depositMaxFee: MaxFee;
  syncIntervalSecs?: number;
  lnurlDomain?: string;
  preferSparkOverLightning?: boolean;
}

export interface FiatSettings {
  // Ordered list of selected currency IDs (e.g., ['USD', 'EUR', 'GBP'])
  selectedCurrencies: string[];
}

const SETTINGS_KEY = 'user_settings_v1';
const FIAT_SETTINGS_KEY = 'fiat_settings_v1';

const defaultSettings: UserSettings = {
  depositMaxFee: { type: 'rate', satPerVbyte: 1 },
};

const defaultFiatSettings: FiatSettings = {
  selectedCurrencies: ['USD'],
};

// In-memory cache for localStorage reads (js-cache-storage optimization)
const storageCache = new Map<string, string | null>();

function getCachedItem(key: string): string | null {
  if (!storageCache.has(key)) {
    storageCache.set(key, localStorage.getItem(key));
  }
  return storageCache.get(key) ?? null;
}

function setCachedItem(key: string, value: string): void {
  localStorage.setItem(key, value);
  storageCache.set(key, value);
}

export function getSettings(): UserSettings {
  try {
    const raw = getCachedItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    // Merge with defaults defensively
    const depositMaxFee = parsed?.depositMaxFee ?? defaultSettings.depositMaxFee;
    if (depositMaxFee) {
      /* eslint-disable @typescript-eslint/no-explicit-any -- validating parsed JSON shape at runtime */
      if (depositMaxFee.type === 'fixed' && typeof (depositMaxFee as any).amount !== 'number') {
        return defaultSettings;
      }
      if (depositMaxFee.type === 'rate' && typeof (depositMaxFee as any).satPerVbyte !== 'number') {
        return defaultSettings;
      }
      if (depositMaxFee.type === 'networkRecommended' && typeof (depositMaxFee as any).leewaySatPerVbyte !== 'number') {
        return defaultSettings;
      }
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }
    const out: UserSettings = {
      depositMaxFee: depositMaxFee as MaxFee,
      syncIntervalSecs: typeof parsed.syncIntervalSecs === 'number' ? parsed.syncIntervalSecs : undefined,
      lnurlDomain: typeof parsed.lnurlDomain === 'string' ? parsed.lnurlDomain : undefined,
      preferSparkOverLightning: typeof parsed.preferSparkOverLightning === 'boolean' ? parsed.preferSparkOverLightning : undefined,
    };
    return out;
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: UserSettings): void {
  setCachedItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function getFiatSettings(): FiatSettings {
  try {
    const raw = getCachedItem(FIAT_SETTINGS_KEY);
    if (!raw) return defaultFiatSettings;
    const parsed = JSON.parse(raw) as Partial<FiatSettings>;
    return {
      selectedCurrencies: Array.isArray(parsed.selectedCurrencies) 
        ? parsed.selectedCurrencies 
        : defaultFiatSettings.selectedCurrencies,
    };
  } catch {
    return defaultFiatSettings;
  }
}

export function saveFiatSettings(settings: FiatSettings): void {
  setCachedItem(FIAT_SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Check if console logging is enabled.
 * Controlled via VITE_CONSOLE_LOGGING env var when present; defaults to dev mode.
 */
export function isConsoleLoggingEnabled(): boolean {
  const envValue = import.meta.env.VITE_CONSOLE_LOGGING;

  if (typeof envValue === 'string') {
    const normalized = envValue.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }

  // Default: enabled in dev, disabled in production
  return import.meta.env.DEV;
}
