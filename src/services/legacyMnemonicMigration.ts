/**
 * The legacy `walletMnemonic` localStorage key and its drain into the native
 * vault. It predates the vault, so on native it is a leftover the vault has
 * since replaced and startup should not leave behind. Web has no vault and
 * keeps using it as the only seed store.
 */
import { deviceOnlyStorage } from './secureStorage';
import { logger, LogCategory } from './logger';

const MNEMONIC_KEY = 'walletMnemonic';

export const saveMnemonic = (m: string) => localStorage.setItem(MNEMONIC_KEY, m);
export const getSavedMnemonic = () => localStorage.getItem(MNEMONIC_KEY);
export const clearMnemonic = () => localStorage.removeItem(MNEMONIC_KEY);

/**
 * On native, move any legacy mnemonic into the device-only tier (NOT the
 * biometric-bound tier: these are pre-0.0.3 non-passkey users who never opted
 * into biometrics). Idempotent and non-fatal: retried every startup until
 * done, legacy path keeps working in the meantime.
 *
 * A seed already in the vault wins, and the legacy copy is dropped only when
 * it is that same seed. One that differs is left in place: it can be the
 * device's only copy of another wallet, and deleting it burns those funds.
 */
export async function migrateLegacyMnemonicIfNeeded(): Promise<void> {
  if (!deviceOnlyStorage.isSupported()) return;
  const legacy = getSavedMnemonic();
  if (!legacy) return;
  try {
    if (await deviceOnlyStorage.hasStoredSeed()) {
      const stored = await deviceOnlyStorage.retrieveSeed();
      // A vault passphrase derives a different wallet, so it counts as a mismatch.
      const sameSeed = stored.type === 'mnemonic'
        && stored.mnemonic === legacy
        && !stored.passphrase;
      if (!sameSeed) {
        logger.warn(LogCategory.AUTH, 'Plaintext mnemonic differs from the stored seed; leaving it in place');
        return;
      }
      clearMnemonic();
      logger.info(LogCategory.AUTH, 'Removed plaintext mnemonic already held in device-only secure storage');
      return;
    }
    await deviceOnlyStorage.storeSeed({ type: 'mnemonic', mnemonic: legacy });
    clearMnemonic();
    logger.info(LogCategory.AUTH, 'Migrated plaintext mnemonic into device-only secure storage');
  } catch {
    // deviceOnlyStorage logged the typed error; we'll retry next startup.
  }
}
