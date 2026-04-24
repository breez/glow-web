import React, { createContext, useContext, useMemo } from 'react';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
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
