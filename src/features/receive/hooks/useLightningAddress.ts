import { useCallback, useEffect, useRef, useState } from 'react';
import type { LightningAddressInfo } from '@breeztech/breez-sdk-spark';
import { useWallet } from '../../../contexts/WalletContext';
import { generateRandomName } from '../../../utils/randomName';
import { logger, LogCategory } from '@/services/logger';
import { formatError } from '@/utils/formatError';
import { useLatest } from '../../../hooks/useLatest';

export interface UseLightningAddress {
  address: LightningAddressInfo | null;
  isLoading: boolean;
  isEditing: boolean;
  editValue: string;
  error: string | null;
  isSupported: boolean;
  supportMessage: string | null;
  load: () => Promise<void>;
  beginEdit: (currentAddress?: LightningAddressInfo | null) => void;
  cancelEdit: () => void;
  setEditValue: (v: string) => void;
  save: () => Promise<void>;
  reset: () => void;
}

const UNSUPPORTED_MESSAGE = 'Lightning addresses are not available in this environment.';

export const useLightningAddress = (): UseLightningAddress => {
  const wallet = useWallet();

  const [address, setAddress] = useState<LightningAddressInfo | null>(null);
  // Default to `true` so the first paint of the Receive sheet shows
  // the Lightning-address loading spinner instead of the
  // `!address && !isEditing` fallback ("Create Lightning Address"
  // button). Without this, users briefly see the Create button flash
  // between the sheet opening and `load()`'s `setIsLoading(true)`
  // landing on the next tick — confusing on first-launch passkey
  // onboarding where the address is being auto-registered. `load()`
  // always sets it back to `false` in its `finally` block.
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editValue, setEditValue] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [supportMessage, setSupportMessage] = useState<string | null>(null);

  const markUnsupported = useCallback(() => {
    setIsSupported(false);
    setSupportMessage(UNSUPPORTED_MESSAGE);
    setIsEditing(false);
    setEditValue('');
    setError(null);
  }, []);

  const extractUsername = (value: string): string => {
    if (!value) return '';
    return value.includes('@') ? value.split('@')[0] : value;
  };

  // Ref lets `load` short-circuit when the address is already cached
  // without depending on `address` in its closure — keeps the
  // callback reference stable across address updates so effects +
  // consumers don't re-fire every time the address changes.
  const addressRef = useLatest(address);
  // Parallel in-flight guard. Without it the auto-load on mount can
  // race with the `loadLightningAddress()` the Receive dialog fires
  // from its isOpen useEffect — both start their own SDK roundtrip
  // because neither sees a cached address yet. The second call's
  // setAddress overwrites the first with the same value, but the
  // second auto-register collision branch is genuinely wasteful.
  const loadInFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (!isSupported) {
      if (!supportMessage) {
        setSupportMessage(UNSUPPORTED_MESSAGE);
      }
      return;
    }
    // Already loaded from a prior call — skip the SDK roundtrip.
    // `load()` fires on every Receive-dialog open + every Lightning
    // tab switch; without this short-circuit each reopening pays
    // for another `getLightningAddress` roundtrip, which shows up
    // as a flash of the loading spinner + a small stall while the
    // SDK call resolves. The auto-load on mount (below) seeds the
    // cache once so first-ever open is fast too.
    if (addressRef.current) return;
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;

    setIsLoading(true);
    try {
      let addr = await wallet.getLightningAddress();
      if (!addr) {
        // Generate a base username, then try with random 4-digit suffixes on collision
        const baseName = generateRandomName();
        for (let attempt = 0; attempt < 3; attempt++) {
          const suffix = attempt === 0 ? '' : String(Math.floor(1000 + Math.random() * 9000));
          const username = baseName + suffix;
          const isAvailable = await wallet.checkLightningAddressAvailable({ username });
          if (isAvailable) {
            await wallet.registerLightningAddress({ username, description: `Pay to ${username}@breez.tips` });
            addr = await wallet.getLightningAddress();
            break;
          }
        }
      }
      setAddress(addr ?? null);
    } catch (err) {
      logger.error(LogCategory.PAYMENT, 'Failed to load Lightning address', {
        error: formatError(err),
      });
      if (err instanceof Error && /lnurl server is not configured/i.test(err.message)) {
        markUnsupported();
      } else {
        setError(`Failed to load Lightning address: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    } finally {
      setIsLoading(false);
      loadInFlightRef.current = false;
    }
  }, [wallet, isSupported, markUnsupported, supportMessage, addressRef]);

  // Pre-load the Lightning address as soon as the hook mounts (which
  // happens on WalletPage mount, well before the user taps Receive).
  // Moves the cold `getLightningAddress` SDK roundtrip (plus any
  // auto-registration chain for a fresh passkey label: `checkAvailable`
  // then `register` then `getAddress` again) out of the Receive-open
  // animation critical path. Without this, the user sees a visible
  // dead window between tapping Receive and the sheet sliding up on
  // first launch while the WASM bridge + network calls complete. The
  // `hasAttemptedMountLoad` ref guards against React 18 Strict-Mode
  // double-invocation in dev + re-fires on dep changes.
  //
  // The fetch runs inside an async IIFE so all setStates fire after
  // `await load()` resolves, satisfying react-hooks/set-state-in-effect.
  const hasAttemptedMountLoad = useRef(false);
  useEffect(() => {
    if (hasAttemptedMountLoad.current) return;
    if (!isSupported) return;
    hasAttemptedMountLoad.current = true;
    void (async () => {
      await load();
    })();
  }, [isSupported, load]);

  const beginEdit = useCallback((currentAddress?: LightningAddressInfo | null) => {
    if (!isSupported) {
      return;
    }
    const addrStr = currentAddress?.lightningAddress ?? address?.lightningAddress ?? '';
    const initial = extractUsername(addrStr);
    setEditValue(initial);
    setIsEditing(true);
    setError(null);
  }, [address, isSupported]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditValue('');
    setError(null);
  }, []);

  const save = useCallback(async () => {
    if (!isSupported) {
      markUnsupported();
      return;
    }
    const username = extractUsername(editValue.trim());
    if (!username) {
      setError('Please enter a username');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const isAvailable = await wallet.checkLightningAddressAvailable({ username });
      if (!isAvailable) {
        setError('This username is not available');
        setIsLoading(false);
        return;
      }

      await wallet.registerLightningAddress({ username, description: `Pay to ${username}@breez.tips` });
      const actualInfo = await wallet.getLightningAddress();
      setAddress(actualInfo ?? null);
      setIsEditing(false);
      setEditValue('');
    } catch (err) {
      logger.error(LogCategory.PAYMENT, 'Failed to save Lightning address', {
        error: formatError(err),
      });
      if (err instanceof Error && /lnurl server is not configured/i.test(err.message)) {
        markUnsupported();
      } else {
        setError(`Failed to save Lightning address: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    } finally {
      setIsLoading(false);
    }
  }, [editValue, wallet, isSupported, markUnsupported]);

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
    isSupported,
    supportMessage,
    load,
    beginEdit,
    cancelEdit,
    setEditValue,
    save,
    reset,
  };
};
