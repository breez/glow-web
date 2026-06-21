import { MaxFee } from "@breeztech/breez-sdk-spark/web";
import type { Network } from "@breeztech/breez-sdk-spark";
/** Provider identifiers matching the SDK's BuyBitcoinRequest tagged union */
export type BuyBitcoinProvider = 'moonpay' | 'cashApp';

/** Filter out providers unavailable on the current network (e.g. CashApp is mainnet-only) */
export function filterProvidersByNetwork(providers: BuyBitcoinProvider[], network?: Network): BuyBitcoinProvider[] {
  if (network === 'mainnet') return providers;
  return providers.filter((p) => p !== 'cashApp');
}

export interface UserSettings {
  depositMaxFee: MaxFee;
  syncIntervalSecs?: number;
  lnurlDomain?: string;
  preferSparkOverLightning?: boolean;
  crossChainEnabled?: boolean;
}

export interface FiatSettings {
  // Ordered list of selected currency IDs (e.g., ['USD', 'EUR', 'GBP'])
  selectedCurrencies: string[];
}

/** All known buy bitcoin providers, in default display order */
export const ALL_BUY_PROVIDERS: BuyBitcoinProvider[] = ['moonpay', 'cashApp'];

const SETTINGS_KEY = 'user_settings_v1';
const FIAT_SETTINGS_KEY = 'fiat_settings_v1';
const BUY_PROVIDERS_KEY = 'buy_providers_v1';

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

function removeCachedItem(key: string): void {
  localStorage.removeItem(key);
  storageCache.delete(key);
}

export function getSettings(): UserSettings {
  try {
    const raw = getCachedItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    // Merge with defaults defensively
    const depositMaxFee = parsed?.depositMaxFee ?? defaultSettings.depositMaxFee;
    if (depositMaxFee) {
      // depositMaxFee comes from untrusted persisted JSON, so the typed
      // shape isn't guaranteed: read each variant's payload as `unknown`
      // and confirm it is actually a number before trusting it.
      const fee = depositMaxFee as { amount?: unknown; satPerVbyte?: unknown; leewaySatPerVbyte?: unknown };
      if (depositMaxFee.type === 'fixed' && typeof fee.amount !== 'number') {
        return defaultSettings;
      }
      if (depositMaxFee.type === 'rate' && typeof fee.satPerVbyte !== 'number') {
        return defaultSettings;
      }
      if (depositMaxFee.type === 'networkRecommended' && typeof fee.leewaySatPerVbyte !== 'number') {
        return defaultSettings;
      }
    }
    const out: UserSettings = {
      depositMaxFee: depositMaxFee as MaxFee,
      syncIntervalSecs: typeof parsed.syncIntervalSecs === 'number' ? parsed.syncIntervalSecs : undefined,
      lnurlDomain: typeof parsed.lnurlDomain === 'string' ? parsed.lnurlDomain : undefined,
      preferSparkOverLightning: typeof parsed.preferSparkOverLightning === 'boolean' ? parsed.preferSparkOverLightning : undefined,
      crossChainEnabled: typeof parsed.crossChainEnabled === 'boolean' ? parsed.crossChainEnabled : undefined,
    };
    return out;
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: UserSettings): void {
  setCachedItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function isCrossChainEnabled(): boolean {
  return getSettings().crossChainEnabled === true;
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

// Stable Balance disclaimer acceptance (one-time)
const STABLE_DISCLAIMER_KEY = 'stable_balance_disclaimer_accepted';

export function hasAcceptedStableDisclaimer(): boolean {
  return getCachedItem(STABLE_DISCLAIMER_KEY) === 'true';
}

export function setStableDisclaimerAccepted(): void {
  setCachedItem(STABLE_DISCLAIMER_KEY, 'true');
}

// Stable Balance active ticker cache (for instant UI on reload)
const STABLE_TICKER_KEY = 'stable_balance_active_ticker';

export function getCachedStableTicker(): string | null {
  return getCachedItem(STABLE_TICKER_KEY);
}

export function setCachedStableTicker(ticker: string | null): void {
  if (ticker) {
    setCachedItem(STABLE_TICKER_KEY, ticker);
  } else {
    removeCachedItem(STABLE_TICKER_KEY);
  }
}

// Stable Balance restore prompt (one-time per wallet)
const STABLE_RESTORE_PROMPTED_KEY = 'stable_balance_restore_prompted';

export function hasPromptedStableRestore(): boolean {
  return getCachedItem(STABLE_RESTORE_PROMPTED_KEY) === 'true';
}

export function setStableRestorePrompted(): void {
  setCachedItem(STABLE_RESTORE_PROMPTED_KEY, 'true');
}

export function clearStableRestorePrompted(): void {
  removeCachedItem(STABLE_RESTORE_PROMPTED_KEY);
}

/** Ordered list of enabled providers. Providers not in the list are disabled. */
export function getBuyProviderSettings(): BuyBitcoinProvider[] {
  try {
    const raw = getCachedItem(BUY_PROVIDERS_KEY);
    if (!raw) return [...ALL_BUY_PROVIDERS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...ALL_BUY_PROVIDERS];
    // Filter to only known providers, preserving order
    return parsed.filter((p: unknown): p is BuyBitcoinProvider =>
      typeof p === 'string' && ALL_BUY_PROVIDERS.includes(p as BuyBitcoinProvider)
    );
  } catch {
    return [...ALL_BUY_PROVIDERS];
  }
}

export function saveBuyProviderSettings(enabledProviders: BuyBitcoinProvider[]): void {
  setCachedItem(BUY_PROVIDERS_KEY, JSON.stringify(enabledProviders));
}

/** Clear the network URL parameter, resetting to mainnet on next load. */
export function clearNetworkOverride(): void {
  const url = new URL(window.location.href);
  if (url.searchParams.has('network')) {
    url.searchParams.delete('network');
    window.history.replaceState({}, '', url.toString());
  }
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
