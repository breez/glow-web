// THROWAWAY: wallet-page shots for ?recovermock, and the providers and page
// every sheet and dialog shot sits on.
// Shot registries and fixture helpers sit beside components; fast refresh does not matter here.
/* eslint-disable react-refresh/only-export-components */
import React, { useState } from 'react';
import type { BreezSdk, GetInfoResponse, Payment, RecoveryTxKind } from '@breeztech/breez-sdk-spark';
import AppShell from '@/components/layout/AppShell';
import { ToastProvider } from '@/contexts/ToastContext';
import { WalletInfoProvider, WalletProvider } from '@/contexts/WalletContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { ContactsProvider } from '@/contexts/ContactsContext';
import WalletPage from '@/pages/WalletPage';
import {
  savePendingExit,
  savePlan,
  saveRecoveries,
  type ExitSdk,
  type PendingExit,
  type UnilateralExitPlan,
  type WalletKey,
} from '@/features/unilateral-exit/driver';
import { startUnilateralExitEngine } from '@/features/unilateral-exit/engine';
import type { ArchivedExit } from '@/features/unilateral-exit/archive';
import { quoteFigures, quotedSweepFeeSat } from '@/features/unilateral-exit/quote';
import { plan, ready, tx } from '@/features/unilateral-exit/testFixtures';
import type { ChainClient, ChainUtxo } from '@/services/chain';
import {
  BALANCE_SATS,
  COSIGNED_LEAVES,
  COSIGNED_QUOTE,
  COSIGNED_TXIDS,
  DESTINATION,
  EXIT_FEE_ADDRESS,
  FEE_RATES,
  IDENTITY_PUBKEY,
  MIXED_QUOTE,
  NETWORK,
  STRANDED_QUOTE,
} from './fixtures';

export const WALLET_KEY: WalletKey = { identityPubkey: IDENTITY_PUBKEY, network: NETWORK };

/** getInfo's recoverable total sits beside the balance, not in it. */
export const mockWalletInfo = (recoverableFundsSats: number, balanceSats = BALANCE_SATS): GetInfoResponse => ({
  identityPubkey: IDENTITY_PUBKEY,
  balanceSats,
  tokenBalances: new Map(),
  recoverableFundsSats,
});

const now = () => Math.floor(Date.now() / 1000);
const DAY = 86_400;

/** Ordinary history under Payments, the same in every wallet shot unless its scene trims it. */
export const historyPayments = (): Payment[] => {
  const t = now();
  return [
    {
      id: 'hist-ln-in',
      paymentType: 'receive',
      status: 'completed',
      amount: 25_000n,
      fees: 0n,
      timestamp: t - 2 * DAY - 3_600,
      method: 'lightning',
      details: {
        type: 'lightning',
        description: 'Dinner split',
        invoice: 'lnbc250u1mock',
        destinationPubkey: IDENTITY_PUBKEY,
        htlcDetails: { paymentHash: '00'.repeat(32), expiryTime: 0, status: 'preimageShared' },
      },
    },
    {
      id: 'hist-ln-out',
      paymentType: 'send',
      status: 'completed',
      amount: 4_200n,
      fees: 3n,
      timestamp: t - 3 * DAY - 7_200,
      method: 'lightning',
      details: {
        type: 'lightning',
        description: 'Coffee',
        invoice: 'lnbc42u1mock',
        destinationPubkey: '03' + 'de'.repeat(32),
        htlcDetails: { paymentHash: '11'.repeat(32), expiryTime: 0, status: 'preimageShared' },
      },
    },
    {
      id: 'hist-spark-in',
      paymentType: 'receive',
      status: 'completed',
      amount: 12_610n,
      fees: 0n,
      timestamp: t - 6 * DAY,
      method: 'spark',
      details: { type: 'spark' },
    },
    {
      id: 'hist-deposit',
      paymentType: 'receive',
      status: 'completed',
      amount: 150_000n,
      fees: 212n,
      timestamp: t - 11 * DAY,
      method: 'deposit',
      details: { type: 'deposit', txId: '5d'.repeat(32), vout: 0 },
    },
    {
      id: 'hist-ln-out-2',
      paymentType: 'send',
      status: 'completed',
      amount: 8_000n,
      fees: 8n,
      timestamp: t - 14 * DAY,
      method: 'lightning',
      details: {
        type: 'lightning',
        description: 'Podcast boost',
        invoice: 'lnbc80u1mock',
        destinationPubkey: '02' + 'be'.repeat(32),
        htlcDetails: { paymentHash: '22'.repeat(32), expiryTime: 0, status: 'preimageShared' },
      },
    },
  ] as Payment[];
};

// The methods a mounted wallet page reaches. Anything else resolves to nothing.
const clientMethods = (walletInfo: GetInfoResponse, payments: Payment[]): Record<string, unknown> => ({
  getInfo: async () => walletInfo,
  listPayments: async () => ({ payments }),
  listUnclaimedDeposits: async () => ({ deposits: [] }),
  syncWallet: async () => ({}),
  listFiatRates: async () => ({ rates: [{ coin: 'USD', value: 110_000 }] }),
  listFiatCurrencies: async () => ({
    currencies: [
      {
        id: 'USD',
        info: {
          name: 'United States Dollar',
          fractionSize: 2,
          symbol: { grapheme: '$', template: '$1', rtl: false, position: 1 },
          localizedName: [],
          localeOverrides: [],
        },
      },
    ],
  }),
  getUserSettings: async () => ({ sparkPrivateModeEnabled: false }),
  listContacts: async () => [],
  addEventListener: async () => 'recovermock-listener',
  removeEventListener: async () => {},
  getLightningAddress: async () => ({
    description: 'Pay to satoshi',
    lightningAddress: 'satoshi@breez.tips',
    lnurl: { url: 'https://breez.tips/lnurlp/satoshi', bech32: 'lnurl1mock' },
    username: 'satoshi',
  }),
});

// Props a caller probes that must read as absent, or the stub turns thenable.
const NOT_METHODS = new Set(['then', 'catch', 'finally', 'toJSON', 'constructor', '$$typeof']);

/** A client whose listed methods return fixtures and every other one is an async no-op. */
function mockClient(walletInfo: GetInfoResponse, payments: Payment[] = historyPayments()): BreezSdk {
  return new Proxy(clientMethods(walletInfo, payments), {
    get(target, prop) {
      if (typeof prop === 'symbol' || NOT_METHODS.has(prop)) return undefined;
      return prop in target ? target[prop] : async () => undefined;
    },
  }) as unknown as BreezSdk;
}

/**
 * The provider stack App.tsx mounts a connected wallet in. `walletInfo`
 * defaults to shot 01's wallet; a shot passes its own to differ.
 */
export const MockProviders: React.FC<{ children: React.ReactNode; walletInfo?: GetInfoResponse }> = ({
  children,
  walletInfo,
}) => {
  const info = walletInfo ?? mockWalletInfo(COSIGNED_QUOTE.recoverableValueSats);
  const [sdk] = useState(() => mockClient(info));
  return (
    <AppShell>
      <ToastProvider>
        <WalletProvider client={sdk} isConnected>
          <WalletInfoProvider walletInfo={info}>
            <FiatDataProvider>
              <StableBalanceProvider>
                <ContactsProvider>{children}</ContactsProvider>
              </StableBalanceProvider>
            </FiatDataProvider>
          </WalletInfoProvider>
        </WalletProvider>
      </ToastProvider>
    </AppShell>
  );
};

const noop = () => {};

/** The real wallet page, fed fixtures. Exit rows come from the engine's module state. */
const MockWalletPage: React.FC<{ recoverableFundsSats: number; balanceSats?: number; transactions: Payment[] }> = ({
  recoverableFundsSats,
  balanceSats,
  transactions,
}) => (
  <WalletPage
    walletInfo={mockWalletInfo(recoverableFundsSats, balanceSats)}
    transactions={transactions}
    unclaimedDeposits={[]}
    refreshWalletData={async () => true}
    isSyncing={false}
    error={null}
    onClearError={noop}
    onLogout={noop}
    hasRejectedDeposits={false}
    onOpenGetRefund={noop}
    onOpenSettings={noop}
    onOpenUnilateralExit={noop}
    onBuyBitcoin={async () => {}}
    network={NETWORK}
  />
);

/**
 * What the wallet page shows at one moment of the walkthrough. A sheet or
 * dialog shot names the moment it belongs to, so the page behind it agrees.
 */
export interface WalletScene {
  recoverableFundsSats: number;
  /** Shot 01's balance when absent. An exit takes the leaves it moves out of it. */
  balanceSats?: number;
  /** The ordinary history under Payments; historyPayments() when absent. */
  history?: () => Payment[];
  /** Saves the engine state the page reads. Runs before the page mounts. */
  seed?: () => void;
}

/** Shot 01: the co-signed funds found, nothing recovered yet. */
export const FOUND: WalletScene = { recoverableFundsSats: COSIGNED_QUOTE.recoverableValueSats };

export const WalletBackdrop: React.FC<{ scene?: WalletScene }> = ({ scene = FOUND }) => {
  const [transactions] = useState(() => (scene.history ?? historyPayments)());
  return (
    <MockWalletPage
      recoverableFundsSats={scene.recoverableFundsSats}
      balanceSats={scene.balanceSats}
      transactions={transactions}
    />
  );
};

/** A chain whose fee address holds `coins`. */
export const mockChain = (coins: ChainUtxo[] = [], tip = 915_400): ChainClient => ({
  feeRates: async () => FEE_RATES,
  addressUtxos: async () => coins,
  tipHeight: async () => tip,
  broadcast: async () => {},
  broadcastPackage: async () => {},
});

export const seedPending = (pending: PendingExit, coins: ChainUtxo[] = []) => (): void => {
  savePendingExit(WALLET_KEY, pending);
  startUnilateralExitEngine(WALLET_KEY, mockChain(coins));
};

/** With `driver`, the engine's first pass reads the plan back through it, as the app's does. */
export const seedPlan = (built: UnilateralExitPlan, tip: number, driver?: ExitSdk) => (): void => {
  savePlan(WALLET_KEY, built);
  startUnilateralExitEngine(WALLET_KEY, mockChain([], tip), driver);
};

// archive.ts keeps its storage key private, and the mock has no finished plan to archive.
const ARCHIVE_KEY = `unilateral-exit-archive:${WALLET_KEY.identityPubkey.slice(0, 16)}:${WALLET_KEY.network}`;

export const seedArchive = (entries: ArchivedExit[]) => (): void => {
  localStorage.setItem(ARCHIVE_KEY, JSON.stringify(entries));
  startUnilateralExitEngine(WALLET_KEY, mockChain());
};

export const COOPERATIVE: RecoveryTxKind = 'cooperative';

/** Glow's record of the co-signed recovery, kept from recoverFunds' response: both transactions out, unconfirmed. */
export const keptRecovery: UnilateralExitPlan = plan(
  COSIGNED_TXIDS.map((txid, i) => tx({ txid, kind: COOPERATIVE, nodeId: COSIGNED_LEAVES[i].leafId, status: ready })),
  {
    network: NETWORK,
    destination: DESTINATION,
    feeRateSatPerVbyte: FEE_RATES.medium,
    quotedSweepFeeSat: quotedSweepFeeSat(COSIGNED_QUOTE, null),
    mode: 'recover',
    exit: {
      leaves: COSIGNED_LEAVES,
      recoverableValueSats: COSIGNED_QUOTE.recoverableValueSats,
      totalFeeSats: COSIGNED_QUOTE.totalFeeSats,
      cooperativeFeeSats: COSIGNED_QUOTE.cooperativeFeeSats,
      cpfpFeeSats: 0,
      sweepFeeSats: 0,
      feeRateSatPerVbyte: FEE_RATES.medium,
      destination: DESTINATION,
    },
  },
);

const keepCosigned = (): void => saveRecoveries(WALLET_KEY, [keptRecovery]);

/**
 * Shot 06: the recovery is out and Glow keeps it. Its leaves stay in getInfo's
 * total until it confirms and a check reads that back, and the kept record
 * takes them out of the Recoverable Funds row.
 */
export const afterCosigned: WalletScene = {
  recoverableFundsSats: COSIGNED_QUOTE.recoverableValueSats,
  seed: () => {
    keepCosigned();
    startUnilateralExitEngine(WALLET_KEY, mockChain());
  },
};

const stranded = quoteFigures(STRANDED_QUOTE);

/** A stranded recovery saved at the fee screen, owing its whole exit fee, as the flow saves one. */
export const strandedPending: PendingExit = {
  network: NETWORK,
  destination: STRANDED_QUOTE.destination,
  feeRateSatPerVbyte: STRANDED_QUOTE.feeRateSatPerVbyte,
  fundingAddressIndex: 0,
  fundingAddress: EXIT_FEE_ADDRESS,
  required: { sat: stranded.exitFeeSat, inputs: 1 },
  willReceiveSat: stranded.willReceiveSat,
  mode: 'recover',
};

export const walletShots: Record<string, WalletScene> = {
  '01-wallet-row': FOUND,
  '06-wallet-after-cosigned': afterCosigned,
  // Both parts stay in the total until their transactions confirm and are read
  // back. The kept recovery and the saved exit each take a row in its place.
  '13-wallet-after-split': {
    recoverableFundsSats: MIXED_QUOTE.recoverableValueSats,
    seed: () => {
      keepCosigned();
      seedPending(strandedPending)();
    },
  },
};
