import { useState, useCallback, useEffect, useMemo } from 'react';
import type { Contact, SdkEvent } from '@breeztech/breez-sdk-spark';
import { useWalletConnection } from '../contexts/WalletContext';
import { logger, LogCategory } from '../services/logger';
import { formatError } from '../utils/formatError';

const LN_ADDRESS_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function isValidLightningAddress(address: string): boolean {
  return LN_ADDRESS_REGEX.test(address);
}

export function searchContacts(contacts: Contact[], query: string): Contact[] {
  if (!contacts.length || !query.trim()) return [];
  const q = query.toLowerCase();

  const byName: Contact[] = [];
  const byLocal: Contact[] = [];
  const byDomain: Contact[] = [];

  for (const c of contacts) {
    const name = c.name.toLowerCase();
    const addr = c.paymentIdentifier.toLowerCase();
    const atIdx = addr.indexOf('@');
    const domain = atIdx >= 0 ? addr.slice(atIdx + 1) : '';

    if (name.startsWith(q)) byName.push(c);
    else if (addr.startsWith(q)) byLocal.push(c);
    else if (domain.startsWith(q)) byDomain.push(c);
  }

  const alpha = (a: Contact, b: Contact) => a.name.localeCompare(b.name);
  return [...byName.sort(alpha), ...byLocal.sort(alpha), ...byDomain.sort(alpha)];
}

export interface UseContactsReturn {
  contacts: Contact[];
  isLoading: boolean;
  hasSynced: boolean;
  error: string | null;
  addContact: (name: string, paymentIdentifier: string) => Promise<Contact | null>;
  updateContact: (id: string, name: string, paymentIdentifier: string) => Promise<Contact | null>;
  deleteContact: (id: string) => Promise<boolean>;
  findContactByAddress: (address: string) => Contact | undefined;
  refreshContacts: () => Promise<void>;
}

const EMPTY_CONTACTS: Contact[] = [];

export function useContacts(): UseContactsReturn {
  const { sdk: wallet } = useWalletConnection();
  // Underlying state is only meaningful while a wallet is connected. We
  // don't reset it on disconnect (avoiding setState-in-effect); the returned
  // values are gated on `wallet` below so consumers see the cleared shape
  // immediately, derived during render.
  const [contactsState, setContacts] = useState<Contact[]>([]);
  const [isLoadingState, setIsLoading] = useState(false);
  const [hasSyncedState, setHasSynced] = useState(false);
  const [errorState, setError] = useState<string | null>(null);

  const refreshContacts = useCallback(async () => {
    if (!wallet) return;
    try {
      const result = await wallet.listContacts({});
      setContacts(prev => {
        if (prev.length === result.length && prev.every((c, i) =>
          c.id === result[i].id && c.name === result[i].name && c.paymentIdentifier === result[i].paymentIdentifier
        )) {
          return prev; // unchanged: keep reference stable to avoid downstream re-renders
        }
        return result;
      });
      setError(null);
    } catch (e) {
      logger.error(LogCategory.SDK, 'Failed to list contacts', { error: formatError(e) });
      setError('Failed to load contacts');
    }
  }, [wallet]);

  // Adjust-state-on-prop-change pattern (React docs): flip isLoading
  // synchronously when wallet appears, no setState-in-effect.
  const [walletForFetch, setWalletForFetch] = useState(wallet);
  if (walletForFetch !== wallet) {
    setWalletForFetch(wallet);
    if (wallet) setIsLoading(true);
  }

  // No reset on disconnect: the public values below are gated on
  // `wallet`, so consumers see empty when disconnected regardless.
  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    void (async () => {
      try {
        await refreshContacts();
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshContacts, wallet]);

  // Refresh contacts when SDK sync completes (contacts may not be available until first sync)
  useEffect(() => {
    if (!wallet) return;
    let disposed = false;
    let storedListenerId: string | null = null;

    (async () => {
      try {
        const id = await wallet.addEventListener({ onEvent: (event: SdkEvent) => {
          if (event.type === 'synced') {
            setHasSynced(true);
            void refreshContacts();
          }
        } });
        if (disposed) {
          wallet.removeEventListener(id).catch(() => { });
        } else {
          storedListenerId = id;
        }
      } catch (e) {
        logger.warn(LogCategory.SDK, 'Failed to attach contacts event listener', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();

    return () => {
      disposed = true;
      if (storedListenerId) {
        wallet.removeEventListener(storedListenerId).catch(() => { });
      }
    };
  }, [wallet, refreshContacts]);

  // Gate the public values on `wallet` so disconnected consumers see
  // the cleared shape without a reset effect.
  const contacts = wallet ? contactsState : EMPTY_CONTACTS;
  const isLoading = wallet ? isLoadingState : false;
  const hasSynced = wallet ? hasSyncedState : false;
  const error = wallet ? errorState : null;

  const addressMap = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const c of contacts) {
      map.set(c.paymentIdentifier.toLowerCase(), c);
    }
    return map;
  }, [contacts]);

  const findContactByAddress = useCallback(
    (address: string) => addressMap.get(address.toLowerCase()),
    [addressMap],
  );

  const addContact = useCallback(async (name: string, paymentIdentifier: string): Promise<Contact | null> => {
    if (!wallet) return null;
    setError(null);
    try {
      const contact = await wallet.addContact({ name, paymentIdentifier });
      await refreshContacts();
      return contact;
    } catch (e) {
      logger.error(LogCategory.SDK, 'Failed to add contact', { error: formatError(e) });
      setError('Failed to add contact');
      return null;
    }
  }, [wallet, refreshContacts]);

  const updateContact = useCallback(async (id: string, name: string, paymentIdentifier: string): Promise<Contact | null> => {
    if (!wallet) return null;
    setError(null);
    try {
      const contact = await wallet.updateContact({ id, name, paymentIdentifier });
      await refreshContacts();
      return contact;
    } catch (e) {
      logger.error(LogCategory.SDK, 'Failed to update contact', { error: formatError(e) });
      setError('Failed to update contact');
      return null;
    }
  }, [wallet, refreshContacts]);

  const deleteContact = useCallback(async (id: string): Promise<boolean> => {
    if (!wallet) return false;
    setError(null);
    try {
      await wallet.deleteContact(id);
      await refreshContacts();
      return true;
    } catch (e) {
      logger.error(LogCategory.SDK, 'Failed to delete contact', { error: formatError(e) });
      setError('Failed to delete contact');
      return false;
    }
  }, [wallet, refreshContacts]);

  return {
    contacts,
    isLoading,
    hasSynced,
    error,
    addContact,
    updateContact,
    deleteContact,
    findContactByAddress,
    refreshContacts,
  };
}
