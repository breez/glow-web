const MNEMONIC_KEY = 'walletMnemonic';

export interface MnemonicStorage {
  save: (mnemonic: string) => void;
  get: () => string | null;
  clear: () => void;
}

export const mnemonicStorage: MnemonicStorage = {
  save: (mnemonic: string): void => {
    localStorage.setItem(MNEMONIC_KEY, mnemonic);
  },
  get: (): string | null => {
    return localStorage.getItem(MNEMONIC_KEY);
  },
  clear: (): void => {
    localStorage.removeItem(MNEMONIC_KEY);
  },
};
