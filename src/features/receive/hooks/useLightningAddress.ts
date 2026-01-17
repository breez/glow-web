import { useCallback, useState } from 'react';
import type { LightningAddressInfo } from '@breeztech/breez-sdk-spark';
import { useWallet } from '../../../contexts/WalletContext';

export interface UseLightningAddress {
  address: LightningAddressInfo | null;
  isLoading: boolean;
  isEditing: boolean;
  editValue: string;
  error: string | null;
  load: () => Promise<void>;
  beginEdit: (currentAddress?: LightningAddressInfo | null) => void;
  cancelEdit: () => void;
  setEditValue: (v: string) => void;
  save: () => Promise<void>;
  reset: () => void;
}

export const useLightningAddress = (): UseLightningAddress => {
  const wallet = useWallet();

  const [address, setAddress] = useState<LightningAddressInfo | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editValue, setEditValue] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const extractUsername = (value: string): string => {
    if (!value) return '';
    return value.includes('@') ? value.split('@')[0] : value;
  };

  const generateRandomLetterString = (length: number): string => {
    const characters = "abcdefghijklmnopqrstuvwxyz";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  }

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      let addr = await wallet.getLightningAddress();
      if (!addr) {
        // Try up to 3 times with different random usernames
        for (let attempt = 0; attempt < 3; attempt++) {
          const randomString = generateRandomLetterString(8); // Use 8 chars for less collision
          const isAvailable = await wallet.checkLightningAddressAvailable(randomString);
          if (isAvailable) {
            await wallet.registerLightningAddress(randomString, `Pay to ${randomString}@breez.tips`);
            addr = await wallet.getLightningAddress();
            break;
          }
        }
      }
      setAddress(addr);
    } catch (err) {
      console.error('Failed to load Lightning address:', err);
      setError(`Failed to load Lightning address: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  const beginEdit = useCallback((currentAddress?: LightningAddressInfo | null) => {
    const addrStr = currentAddress?.lightningAddress ?? address?.lightningAddress ?? '';
    const initial = extractUsername(addrStr);
    setEditValue(initial);
    setIsEditing(true);
    setError(null);
  }, [address]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditValue('');
    setError(null);
  }, []);

  const save = useCallback(async () => {
    const username = extractUsername(editValue.trim());
    if (!username) {
      setError('Please enter a username');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const isAvailable = await wallet.checkLightningAddressAvailable(username);
      if (!isAvailable) {
        setError('This username is not available');
        setIsLoading(false);
        return;
      }

      await wallet.registerLightningAddress(username, `Pay to ${username}@breez.tips`);
      const actualInfo = await wallet.getLightningAddress();
      setAddress(actualInfo);
      setIsEditing(false);
      setEditValue('');
    } catch (err) {
      console.error('Failed to save Lightning address:', err);
      setError(`Failed to save Lightning address: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  }, [editValue, wallet]);

  const reset = useCallback(() => {
    setIsEditing(false);
    setEditValue('');
    setError(null);
  }, []);

  return {
    address,
    isLoading,
    isEditing,
    editValue,
    error,
    load,
    beginEdit,
    cancelEdit,
    setEditValue,
    save,
    reset,
  };
};
