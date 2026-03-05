import React, { createContext, useContext } from 'react';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';

const ClientContext = createContext<BreezSdk | null>(null);

export const ClientProvider: React.FC<{
  children: React.ReactNode;
  client: BreezSdk | null;
}> = ({ children, client }) => (
  <ClientContext.Provider value={client}>{children}</ClientContext.Provider>
);

/**
 * Returns the connected BreezSdk instance.
 * Only use in components rendered after connection.
 */
export const useClient = (): BreezSdk => {
  const ctx = useContext(ClientContext);
  if (!ctx) {
    throw new Error('useClient: SDK not connected. This component should only render after connection.');
  }
  return ctx;
};
