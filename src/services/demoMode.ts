import type {
  BreezSdk,
  GetInfoResponse,
  Payment,
  SdkEvent,
  InputType,
  PrepareSendPaymentResponse,
  SendPaymentResponse,
  ReceivePaymentResponse,
  UserSettings,
  FiatCurrency,
  Rate,
  TokenMetadata,
} from '@breeztech/breez-sdk-spark';
import { USDB_TOKEN_IDENTIFIER, USDB_TICKER } from '../constants/stableBalance';

/**
 * App Store reviewer demo mode.
 *
 * Apple's Guideline 2.1 review needs to see a populated, working app without a
 * real funded wallet. Restoring with this reserved phrase drops into a fully
 * local mock: canned balance + history, a real QR on Receive, and a Send that
 * completes offline and updates the balance. Nothing touches the SDK or the
 * network. The phrase is disclosed to App Review (so it is not a hidden
 * feature, Guideline 2.3.1), and is never persisted, so a relaunch returns to
 * onboarding.
 *
 * Canonical BIP39 all-zeros test vector: recognizable as a demo key, and we
 * intercept it before any SDK derivation, so no real wallet is ever connected.
 */
export const DEMO_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/** True when `mnemonic` is the reserved demo phrase (whitespace/case-insensitive). */
export function isDemoSeed(mnemonic: string): boolean {
  return mnemonic.trim().replace(/\s+/g, ' ').toLowerCase() === DEMO_MNEMONIC;
}

const nowSec = () => Math.floor(Date.now() / 1000);
const DAY = 86_400;

// USDB metadata for the stable-balance toggle. 6 decimals, ticker matches "USD"
// so buildTokenDisplayConfig renders it as $ with a 2-digit fraction.
const USDB_METADATA = {
  identifier: USDB_TOKEN_IDENTIFIER,
  issuerPublicKey: 'demo-issuer',
  name: 'US Dollar',
  ticker: USDB_TICKER,
  decimals: 6,
  maxSupply: '0',
  isFreezable: false,
  creationEntityPublicKey: null,
} as unknown as TokenMetadata;

// 1 BTC = $100k (matches the demo fiat rate) and USDB has 6 decimals, so
// 1 sat = 1000 USDB base units. Flat $0.02 fee, purely cosmetic.
const USDB_PER_SAT = 1_000n;
const CONV_FEE_USDB = 20_000n;

function mkPayment(
  paymentType: 'send' | 'receive',
  amount: number,
  fees: number,
  ageSec: number,
  method: 'lightning' | 'spark',
): Payment {
  return {
    id: `demo-${paymentType}-${ageSec}`,
    paymentType,
    status: 'completed',
    amount: BigInt(amount),
    fees: BigInt(fees),
    timestamp: nowSec() - ageSec,
    method,
  } as unknown as Payment;
}

/**
 * A self-contained mock `BreezSdk`. Holds mutable balance + history so a demo
 * send visibly lands: `sendPayment` deducts, prepends a payment, and emits
 * `paymentSucceeded` so `useBreezSdk` refreshes exactly as it would for a real
 * payment. Only the methods the app actually calls are implemented; the object
 * is cast to `BreezSdk` since the full interface is far larger.
 */
export function createDemoSdk(): BreezSdk {
  let balanceSats = 143_180;
  // USDB starts at 0: the reviewer mints it by switching to stable mode, which
  // avoids an intrusive "USD balance detected" auto-prompt on entry.
  let usdbBase = 0n;
  let stableLabel: string | null = null;
  const payments: Payment[] = [
    mkPayment('receive', 15_000, 0, 3 * 3600, 'lightning'),
    mkPayment('send', 1_200, 1, 9 * 3600, 'lightning'),
    mkPayment('send', 3_450, 2, 1 * DAY, 'lightning'),
    mkPayment('receive', 25_000, 0, 2 * DAY, 'lightning'),
    mkPayment('send', 8_900, 1, 3 * DAY, 'spark'),
    mkPayment('send', 620, 1, 4 * DAY, 'lightning'),
    mkPayment('receive', 50_000, 0, 6 * DAY, 'lightning'),
    mkPayment('send', 12_400, 3, 9 * DAY, 'lightning'),
    mkPayment('receive', 7_800, 0, 12 * DAY, 'spark'),
    mkPayment('send', 45_000, 9, 16 * DAY, 'lightning'),
    mkPayment('receive', 120_000, 0, 22 * DAY, 'lightning'),
  ];

  const listeners = new Map<string, (event: SdkEvent) => void>();
  let listenerId = 0;
  const emit = (event: SdkEvent) => listeners.forEach(fn => fn(event));

  // Best-effort sats amount from whatever prepare response the send flow passes.
  const argAmount = (arg: unknown): number => {
    const r = (arg as { prepareResponse?: { amount?: bigint; payAmount?: { amountSats?: number } } })
      ?.prepareResponse;
    if (typeof r?.amount === 'bigint') return Number(r.amount);
    if (typeof r?.payAmount?.amountSats === 'number') return r.payAmount.amountSats;
    return 1_000;
  };

  const completeSend = (arg: unknown): SendPaymentResponse => {
    const amount = argAmount(arg);
    const payment = mkPayment('send', amount, 1, 0, 'lightning');
    payments.unshift(payment);
    balanceSats = Math.max(0, balanceSats - amount - 1);
    emit({ type: 'paymentSucceeded', payment } as unknown as SdkEvent);
    return { payment } as SendPaymentResponse;
  };

  const demo = {
    // Lifecycle
    disconnect: async () => undefined,
    syncWallet: async () => ({}),

    // Info & data
    getInfo: async (): Promise<GetInfoResponse> =>
      ({
        identityPubkey: 'demo-identity',
        balanceSats,
        tokenBalances: new Map([
          [USDB_TOKEN_IDENTIFIER, { balance: usdbBase, tokenMetadata: USDB_METADATA }],
        ]),
      } as unknown as GetInfoResponse),
    listPayments: async () => ({ payments: [...payments] }),
    getPayment: async ({ paymentId }: { paymentId: string }) => ({
      payment: payments.find(p => (p as unknown as { id: string }).id === paymentId) ?? payments[0],
    }),
    listUnclaimedDeposits: async () => ({ deposits: [] }),

    // Parse
    parse: async (input: string): Promise<InputType> => {
      const s = input.trim();
      if (s.startsWith('sp1')) return { type: 'sparkAddress', address: s } as unknown as InputType;
      if (/^ln(bc|tb|bcrt)/i.test(s))
        return {
          type: 'bolt11Invoice',
          invoice: { bolt11: s },
          amountMsat: 3_000_000,
          description: 'Demo invoice',
        } as unknown as InputType;
      if (/^(bc1|tb1|bcrt1|[13])/.test(s)) return { type: 'bitcoinAddress', address: s } as unknown as InputType;
      // ponytail: the LNURL/lightning-address send path needs address resolution
      // we don't fake, so the reviewer instructions steer the send test to pasting
      // a bolt11 invoice (embedded amount => straight to confirm). Full LNURL fake
      // if a reviewer ever insists on the address path.
      if (s.includes('@')) return { type: 'lightningAddress', address: s } as unknown as InputType;
      // Any other text is treated as a spark address so the demo never dead-ends.
      return { type: 'sparkAddress', address: s } as unknown as InputType;
    },

    // Send. The stable-balance toggle calls this with `conversionOptions`; return
    // a conversionEstimate so the fee-confirm sheet shows a real figure.
    prepareSendPayment: async (
      { amount, conversionOptions }: { amount?: bigint; conversionOptions?: unknown },
    ): Promise<PrepareSendPaymentResponse> =>
      ({
        paymentMethod: { type: 'sparkAddress', address: 'sp1demo', fee: '1' },
        amount: amount ?? 3_000n,
        feePolicy: 'default',
        ...(conversionOptions
          ? {
              conversionEstimate: {
                options: conversionOptions,
                amountIn: amount ?? 0n,
                amountOut: amount ?? 0n,
                fee: CONV_FEE_USDB,
              },
            }
          : {}),
      } as unknown as PrepareSendPaymentResponse),
    sendPayment: async (arg: unknown): Promise<SendPaymentResponse> => completeSend(arg),

    // LNURL (lightning address path)
    prepareLnurlPay: async ({ amountSats }: { amountSats?: number }) =>
      ({
        payAmount: { amountSats: amountSats ?? 3_000 },
        comment: '',
        feeSats: 1,
        invoiceDetails: { invoice: { bolt11: 'lnbc1demo' } },
      } as unknown),
    lnurlPay: async (arg: unknown): Promise<SendPaymentResponse> => completeSend(arg),
    lnurlAuth: async () => ({ type: 'ok' }),

    // Receive
    receivePayment: async ({ paymentMethod }: { paymentMethod: { type: string } }): Promise<ReceivePaymentResponse> => {
      const paymentRequest =
        paymentMethod.type === 'bitcoinAddress'
          ? 'bc1qdemoreceiveaddrq9zj7k3l0demo0qx8s5vh2demoaddr'
          : paymentMethod.type === 'bolt11Invoice'
            ? 'lnbc30u1pdemoinvoicexq9zj7k3l0demo0qx8s5vh2demogeneratedbytheglowreviewerdemomode0k3l'
            : 'sp1demoreceivesparkaddress0qx8s5vh2demo0k3l7demoaddr';
      return { paymentRequest, fee: 0n } as ReceivePaymentResponse;
    },

    // Fiat
    listFiatRates: async () => ({ rates: [{ coin: 'USD', value: 100_000 }] as Rate[] }),
    listFiatCurrencies: async () => ({
      currencies: [
        { id: 'USD', info: { name: 'US Dollar', fractionSize: 2, symbol: { grapheme: '$' } } },
      ] as unknown as FiatCurrency[],
    }),

    // Stable balance. Toggling stores the label AND simulates the conversion, so
    // the toggle flow's balance-increase poll resolves on its first tick instead
    // of timing out. ponytail: full-balance convert each way, so repeated toggles
    // compound the numbers. Fine for a single review pass.
    getUserSettings: async () => ({ stableBalanceActiveLabel: stableLabel } as unknown as UserSettings),
    updateUserSettings: async (
      s: { stableBalanceActiveLabel?: { type: 'set' | 'unset'; label?: string } },
    ) => {
      const op = s?.stableBalanceActiveLabel;
      if (op?.type === 'set') {
        if (balanceSats > 0) {
          usdbBase += BigInt(balanceSats) * USDB_PER_SAT - CONV_FEE_USDB;
          balanceSats = 0;
        }
        stableLabel = op.label ?? USDB_TICKER;
      } else if (op?.type === 'unset') {
        if (usdbBase > 0n) {
          balanceSats += Number(usdbBase / USDB_PER_SAT);
          usdbBase = 0n;
        }
        stableLabel = null;
      }
      return undefined;
    },
    getTokensMetadata: async () => ({ tokensMetadata: [USDB_METADATA] }),

    // Events
    addEventListener: async (listener: { onEvent: (event: SdkEvent) => void }) => {
      const id = `demo-listener-${++listenerId}`;
      listeners.set(id, listener.onEvent);
      return id;
    },
    removeEventListener: async (id: string) => {
      listeners.delete(id);
    },

    // Contacts (empty book; CRUD echoes back so the UI stays consistent)
    listContacts: async () => [],
    addContact: async ({ name, paymentIdentifier }: { name: string; paymentIdentifier: string }) => ({
      id: `demo-contact-${++listenerId}`,
      name,
      paymentIdentifier,
    }),
    updateContact: async ({ id, name, paymentIdentifier }: { id: string; name: string; paymentIdentifier: string }) => ({
      id,
      name,
      paymentIdentifier,
    }),
    deleteContact: async () => undefined,

    // Lightning address (none registered in demo; receive falls back to invoices)
    getLightningAddress: async () => undefined,
    checkLightningAddressAvailable: async () => true,
    registerLightningAddress: async () => undefined,
    deleteLightningAddress: async () => undefined,

    // Buy (opens external browser; harmless stub)
    buyBitcoin: async () => ({ url: 'https://buy.moonpay.com' }),
  };

  return demo as unknown as BreezSdk;
}
