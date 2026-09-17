import { LogCategory, logger } from '@/services/logger';
import { deviceOnlyStorage, secureStorage } from '@/services/secureStorage';
import { ripemd160 } from '@noble/hashes/legacy';
import { sha256 } from '@noble/hashes/sha2';
import { bech32, hex } from '@scure/base';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync, validateMnemonic } from 'bip39';

export interface FundingKey {
  address: string;
  publicKeyHex: string;
  secretKey: Uint8Array;
}

interface NetworkParams {
  hrp: string;
  coinType: number;
}

const networkParams = (network: string): NetworkParams => {
  switch (network) {
    case 'testnet':
      return { hrp: 'tb', coinType: 1 };
    case 'regtest':
      return { hrp: 'bcrt', coinType: 1 };
    default:
      return { hrp: 'bc', coinType: 0 };
  }
};

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');

/** The P2WPKH address of a public key, which is what a funding key receives at. */
export function fundingAddressOf(publicKey: Uint8Array | string, network: string): string {
  const bytes = typeof publicKey === 'string' ? hex.decode(publicKey) : publicKey;
  const witnessProgram = ripemd160(sha256(bytes));
  return bech32.encode(networkParams(network).hrp, [0, ...bech32.toWords(witnessProgram)]);
}

export function deriveFundingKey(mnemonic: string, network: string, index: number): FundingKey {
  if (!validateMnemonic(mnemonic)) {
    throw new Error('Recovery phrase is not valid');
  }

  const { coinType } = networkParams(network);
  const seed = mnemonicToSeedSync(mnemonic);
  const node = HDKey.fromMasterSeed(seed).derive(`m/84'/${coinType}'/0'/0/${index}`);
  if (!node.publicKey || !node.privateKey) {
    throw new Error('Failed to derive the funding key');
  }

  return {
    address: fundingAddressOf(node.publicKey, network),
    publicKeyHex: toHex(node.publicKey),
    secretKey: node.privateKey,
  };
}

export class MnemonicUnavailableError extends Error {
  constructor() {
    super('Recovery mode needs this wallet\'s recovery phrase on this device');
    this.name = 'MnemonicUnavailableError';
  }
}

/**
 * Thrown when the phrase exists but only a passkey ceremony can produce it, and
 * the caller is not in a position to ask for one.
 */
export class MnemonicNeedsPasskeyError extends Error {
  constructor() {
    super('Signing in with your passkey is needed to continue this exit');
    this.name = 'MnemonicNeedsPasskeyError';
  }
}

const stored = async (): Promise<string | null> => {
  for (const [store, where] of [
    [deviceOnlyStorage, 'device-only storage'],
    [secureStorage, 'biometric storage'],
  ] as const) {
    if (!store.isSupported() || !(await store.hasStoredSeed())) continue;
    try {
      const seed = await store.retrieveSeed();
      if (seed.type === 'mnemonic') return seed.mnemonic;
    } catch (e) {
      logger.warn(LogCategory.AUTH, `Failed to read seed from ${where}`, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return localStorage.getItem('walletMnemonic');
};

/**
 * The phrase the funding key is derived from.
 *
 * A web passkey wallet keeps no copy of it, so there it is re-derived through a
 * passkey ceremony. That needs a user gesture, which `interactive` says the
 * caller has: a background pass does not, and gets
 * {@link MnemonicNeedsPasskeyError} instead of an authentication prompt the
 * user did not ask for.
 */
export async function readWalletMnemonic({ interactive = false } = {}): Promise<string> {
  const cached = await stored();
  if (cached) return cached;

  // Loaded here rather than imported: the passkey module reads
  // `import.meta.env` as it loads, which only a bundled browser build has, and
  // the exit's key derivation is reused outside one.
  const { getPasskeyLabel, isPasskeyMode, signInPinnedToActiveCredential } = await import(
    '@/services/passkeyService'
  );
  if (!isPasskeyMode()) throw new MnemonicUnavailableError();
  if (!interactive) throw new MnemonicNeedsPasskeyError();

  const { wallet } = await signInPinnedToActiveCredential(getPasskeyLabel() ?? undefined);
  if (wallet.seed.type !== 'mnemonic') throw new MnemonicUnavailableError();
  return wallet.seed.mnemonic;
}
