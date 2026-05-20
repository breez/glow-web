import React, { createContext, useContext, useMemo } from 'react';
import type { BreezSdk, GetInfoResponse } from '@breeztech/breez-sdk-spark';
import type { SdkEventHandler, SdkEventUnsubscribe } from '../hooks/useBreezSdk';

type SubscribeToSdkEvents = (handler: SdkEventHandler) => SdkEventUnsubscribe;

interface WalletContextValue {
  sdk: BreezSdk | null;
  isConnected: boolean;
  subscribeToSdkEvents: SubscribeToSdkEvents;
}

const noopSubscribe: SubscribeToSdkEvents = () => () => {};

const WalletContext = createContext<WalletContextValue>({
  sdk: null,
  isConnected: false,
  subscribeToSdkEvents: noopSubscribe,
});

// Live wallet info (balance, token balances) lives in its own context so that
// SDK consumers (`useWallet`, `useSdkEvents`) don't re-render on every sync.
const WalletInfoContext = createContext<GetInfoResponse | null>(null);

// Derived live status flags (e.g., in-flight auto-conversion). Separate from
// WalletInfoContext so unrelated consumers don't re-render on every refresh.
const WalletStatusContext = createContext<{ hasPendingConversion: boolean }>({
  hasPendingConversion: false,
});

export const WalletProvider: React.FC<{
  children: React.ReactNode;
  client: BreezSdk | null;
  isConnected?: boolean;
  subscribeToSdkEvents?: SubscribeToSdkEvents;
}> = ({ children, client, isConnected = false, subscribeToSdkEvents = noopSubscribe }) => {
  const value = useMemo(
    () => ({ sdk: client, isConnected, subscribeToSdkEvents }),
    [client, isConnected, subscribeToSdkEvents]
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};

/**
 * Provides the latest `walletInfo` (balance, token balances) to descendants.
 * The value is owned by `useBreezSdk`, which auto-refreshes it on `synced`,
 * `paymentSucceeded`, and `claimedDeposits` events. Consumers should read via
 * `useWalletInfo()` and re-render on each refresh.
 */
export const WalletInfoProvider: React.FC<{
  children: React.ReactNode;
  walletInfo: GetInfoResponse | null;
}> = ({ children, walletInfo }) => {
  return <WalletInfoContext.Provider value={walletInfo}>{children}</WalletInfoContext.Provider>;
};

export const WalletStatusProvider: React.FC<{
  children: React.ReactNode;
  hasPendingConversion: boolean;
}> = ({ children, hasPendingConversion }) => {
  const value = useMemo(() => ({ hasPendingConversion }), [hasPendingConversion]);
  return <WalletStatusContext.Provider value={value}>{children}</WalletStatusContext.Provider>;
};

/**
 * Returns the connected BreezSdk instance.
 * Only use in components rendered after connection.
 */
export const useWallet = (): BreezSdk => {
  const { sdk } = useContext(WalletContext);
  if (!sdk) {
    throw new Error('useWallet: SDK not connected. This component should only render after connection.');
  }
  return sdk;
};

/**
 * Returns SDK and connection state. Safe to use before connection.
 */
export const useWalletConnection = () => {
  return useContext(WalletContext);
};

/**
 * Subscribe to the app-wide SDK event stream. Returns the stable subscribe
 * function; call it with a handler and invoke the returned unsubscribe when
 * you're done. Feature hooks should prefer this over calling
 * `sdk.addEventListener` directly so the app only maintains one SDK-level
 * listener.
 */
export const useSdkEvents = (): SubscribeToSdkEvents => {
  return useContext(WalletContext).subscribeToSdkEvents;
};

/**
 * Returns the latest wallet info (balance, token balances) from the global
 * SDK state. Auto-updates on SDK events — callers should not snapshot the
 * value into local state for validation. Returns null until the wallet has
 * loaded.
 */
export const useWalletInfo = (): GetInfoResponse | null => {
  return useContext(WalletInfoContext);
};

/**
 * Returns true while an auto-conversion (or any payment-linked conversion) is
 * still pending. While true, the balance snapshot in `walletInfo` may be mid
 * flight: Send All flows should treat it as unsettled and gate the action.
 */
export const useHasPendingConversion = (): boolean => {
  return useContext(WalletStatusContext).hasPendingConversion;
};
