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

export function getSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    // Merge with defaults defensively
    const depositMaxFee = parsed?.depositMaxFee ?? defaultSettings.depositMaxFee;
    if (depositMaxFee) {
      if (depositMaxFee.type === 'fixed' && typeof (depositMaxFee as any).amount !== 'number') {
        return defaultSettings;
      }
      if (depositMaxFee.type === 'rate' && typeof (depositMaxFee as any).satPerVbyte !== 'number') {
        return defaultSettings;
      }
      if (depositMaxFee.type === 'networkRecommended' && typeof (depositMaxFee as any).leewaySatPerVbyte !== 'number') {
        return defaultSettings;
      }
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
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function getFiatSettings(): FiatSettings {
  try {
    const raw = localStorage.getItem(FIAT_SETTINGS_KEY);
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
  localStorage.setItem(FIAT_SETTINGS_KEY, JSON.stringify(settings));
}
