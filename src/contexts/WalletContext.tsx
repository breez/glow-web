import React, { createContext, useContext } from 'react';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';

const WalletContext = createContext<BreezSdk | null>(null);

export const WalletProvider: React.FC<{
  children: React.ReactNode;
  client: BreezSdk | null;
}> = ({ children, client }) => (
  <WalletContext.Provider value={client}>{children}</WalletContext.Provider>
);

/**
 * Returns the connected BreezSdk instance.
 * Only use in components rendered after connection.
 */
export const useWallet = (): BreezSdk => {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error('useWallet: SDK not connected. This component should only render after connection.');
  }
  return ctx;
};
