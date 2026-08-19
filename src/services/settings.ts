import { MaxFee } from "@breeztech/breez-sdk-spark/web";
import type { Network } from "@breeztech/breez-sdk-spark";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
/** Provider identifiers matching the SDK's BuyBitcoinRequest tagged union */
export type BuyBitcoinProvider = 'moonpay' | 'cashApp';

/**
 * iOS surfaces Cash App only, and only while it is installed: what is left
 * there is a hand-off to an app the user already has, not the purchase link
 * App Review read as Glow operating an exchange (#281). MoonPay is that
 * purchase link, so it stays off iOS. Web and Android keep both providers.
 * `cashAppInstalled` comes from useCashAppInstalled() and is ignored off iOS.
 */
export function filterProvidersByPlatform(
  providers: BuyBitcoinProvider[],
  cashAppInstalled: boolean,
): BuyBitcoinProvider[] {
  if (Capacitor.getPlatform() !== 'ios') return providers;
  return cashAppInstalled ? providers.filter((p) => p === 'cashApp') : [];
}

/**
 * Whether the provider list is worth offering in Settings. iOS is not a
 * shorter version of that list: it has one destination and no MoonPay, so
 * there is nothing to order or switch off. Adding funds from Cash App is its
 * own thing there, sharing the flow rather than the settings.
 */
export function hasBuyProviderSettings(): boolean {
  return Capacitor.getPlatform() !== 'ios';
}

/**
 * iOS names the destination instead of the act, since "Buy" is what App Review
 * read as Glow selling bitcoin. Other platforms keep their existing wording.
 */
export function buyCopy(elsewhere: string): string {
  return Capacitor.getPlatform() === 'ios' ? 'Add funds from Cash App' : elsewhere;
}

/**
 * The header pill drops its label on iOS: "Add funds from Cash App" does not
 * fit next to the Refund pill on a small phone, and truncating it would leave
 * wording App Review reads differently than intended. The icon keeps its name
 * as an aria-label. It also carries Cash App's own mark rather than the
 * generic currency glyph, since naming the destination is the whole point.
 */
export function isBuyIconOnly(): boolean {
  return Capacitor.getPlatform() === 'ios';
}

/** Filter out providers unavailable on the current network (e.g. CashApp is mainnet-only) */
export function filterProvidersByNetwork(providers: BuyBitcoinProvider[], network?: Network): BuyBitcoinProvider[] {
  if (network === 'mainnet') return providers;
  return providers.filter((p) => p !== 'cashApp');
}

export interface UserSettings {
  depositMaxFee: MaxFee;
  /**
   * Last value entered for each limit type, so switching the type back and
   * forth keeps what the user chose instead of resetting to the default.
   * Only the active type is what the SDK is given.
   */
  depositMaxFeeByType?: Partial<Record<DepositMaxFeeType, number>>;
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
const ACTIVE_FIAT_KEY = 'fiat_active_currency';
const BUY_PROVIDERS_KEY = 'buy_providers_v1';

export type DepositMaxFeeType = MaxFee['type'];

/**
 * Deposits are claimed automatically while the claim fee stays under this
 * limit. Each type carries its own default, so switching type gives a
 * sensible starting value rather than reusing a number in the wrong unit.
 */
export const DEFAULT_DEPOSIT_MAX_FEE_BY_TYPE: Record<DepositMaxFeeType, number> = {
  fixed: 500,
  rate: 1,
  networkRecommended: 0,
};

const defaultSettings: UserSettings = {
  depositMaxFee: { type: 'fixed', amount: DEFAULT_DEPOSIT_MAX_FEE_BY_TYPE.fixed },
};

/** The number carried by a limit, whatever unit its type uses. */
export function depositMaxFeeValue(fee: MaxFee): number {
  if (fee.type === 'fixed') return fee.amount;
  if (fee.type === 'rate') return fee.satPerVbyte;
  return fee.leewaySatPerVbyte;
}

/**
 * Build a limit from what the user typed. Returns null when the field holds
 * nothing usable, which the caller treats as "leave the stored limit alone":
 * persisting a malformed one would fail validation on the next read and take
 * every other setting down with it.
 */
export function buildDepositMaxFee(type: DepositMaxFeeType, input: string): MaxFee | null {
  const n = Number(input);
  if (input.trim() === '' || !Number.isFinite(n) || n < 0) return null;
  // Every variant is a u64 in the SDK, rates included. A fraction crossing
  // the wasm boundary fails to deserialize and takes the connection with it,
  // so round down rather than hand one over.
  if (type === 'fixed') return { type: 'fixed', amount: Math.floor(n) };
  if (type === 'rate') return { type: 'rate', satPerVbyte: Math.floor(n) };
  return { type: 'networkRecommended', leewaySatPerVbyte: Math.floor(n) };
}

/** Starting field value for every limit type: the active limit first, then what was last entered for that type, then its default. */
export function depositMaxFeeDrafts(settings: UserSettings): Record<DepositMaxFeeType, string> {
  const byType = settings.depositMaxFeeByType ?? {};
  const draft = (type: DepositMaxFeeType) =>
    String(
      settings.depositMaxFee.type === type
        ? depositMaxFeeValue(settings.depositMaxFee)
        : byType[type] ?? DEFAULT_DEPOSIT_MAX_FEE_BY_TYPE[type],
    );
  return { fixed: draft('fixed'), rate: draft('rate'), networkRecommended: draft('networkRecommended') };
}

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

/** Drops any remembered per-type value that is not a usable number. */
function sanitizeFeeByType(raw: unknown): UserSettings['depositMaxFeeByType'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    ([type, value]) => type in DEFAULT_DEPOSIT_MAX_FEE_BY_TYPE && typeof value === 'number' && Number.isFinite(value) && value >= 0,
  );
  return entries.length > 0 ? (Object.fromEntries(entries) as UserSettings['depositMaxFeeByType']) : undefined;
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
    const byType = parsed.depositMaxFeeByType;
    const out: UserSettings = {
      depositMaxFee: depositMaxFee as MaxFee,
      depositMaxFeeByType: sanitizeFeeByType(byType),
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

/**
 * Stored cross-chain flag. Send is always enabled regardless; this remains the
 * persisted toggle reserved for gating cross-chain receive.
 */
export function isCrossChainEnabled(): boolean {
  return getSettings().crossChainEnabled === true;
}

/**
 * Hold every wallet in Spark private mode. Private mode is not optional in
 * Glow, so this runs on every connect rather than one time.
 *
 * `Config.privateEnabledDefault` is applied only to storage the SDK has never
 * initialized, so wallets used before that default (or seeds restored from
 * another app) keep whatever they had. Writes only when the setting is off,
 * to keep repeat connects off the sync record.
 */
export async function ensureSparkPrivateMode(sdk: {
  getUserSettings(): Promise<{ sparkPrivateModeEnabled: boolean }>;
  updateUserSettings(request: { sparkPrivateModeEnabled: boolean }): Promise<unknown>;
}): Promise<void> {
  const current = await sdk.getUserSettings();
  if (current.sparkPrivateModeEnabled) return;
  await sdk.updateUserSettings({ sparkPrivateModeEnabled: true });
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
 * The fiat currency the balance header is showing: the one the user last
 * cycled to, else the top of their list. Other fiat surfaces read this so
 * they denominate in the same currency the balance does.
 */
export function getDisplayFiatCurrency(): string {
  const { selectedCurrencies } = getFiatSettings();
  const active = getCachedItem(ACTIVE_FIAT_KEY);
  return active && selectedCurrencies.includes(active)
    ? active
    : (selectedCurrencies[0] ?? 'USD');
}

export function setDisplayFiatCurrency(currencyId: string): void {
  setCachedItem(ACTIVE_FIAT_KEY, currencyId);
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

/**
 * Durable native mirror of the active stable ticker.
 *
 * The localStorage cache above is a same-partition value: on native it lives
 * in the WebView storage that shares fate with the SDK's IndexedDB, so an app
 * upgrade / cleared WebView data wipes both and the mode silently reverts to
 * BTC. Preferences writes to the native tier (Android SharedPreferences / iOS
 * UserDefaults, the same tier as the seed vault), which survives a WebView-
 * storage wipe — so it's the recovery source when the SDK comes up empty.
 * On web, Preferences falls back to localStorage (no durability gain, no harm).
 */
export async function getNativeStableTicker(): Promise<string | null> {
  try {
    const { value } = await Preferences.get({ key: STABLE_TICKER_KEY });
    return value ?? null;
  } catch {
    return null;
  }
}

export async function setNativeStableTicker(ticker: string | null): Promise<void> {
  try {
    if (ticker) {
      await Preferences.set({ key: STABLE_TICKER_KEY, value: ticker });
    } else {
      await Preferences.remove({ key: STABLE_TICKER_KEY });
    }
  } catch {
    // Best-effort: the localStorage cache still covers the non-wipe path.
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

const DEV_MODE_KEY = 'spark-dev-mode';

/**
 * `?dev=true` in the URL, read once per page load. Deliberately never
 * written to storage: a link would otherwise leave the dev surfaces
 * (database export, network switch) on for the life of the install, with
 * nothing on screen saying so. Only the settings tap toggle persists.
 */
const devModeFromUrl =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('dev') === 'true';

export function isDevMode(): boolean {
  return devModeFromUrl || localStorage.getItem(DEV_MODE_KEY) === 'true';
}

export function setDevMode(enabled: boolean): void {
  localStorage.setItem(DEV_MODE_KEY, String(enabled));
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
