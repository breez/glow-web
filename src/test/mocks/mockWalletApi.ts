import { vi } from 'vitest';
import type { WalletAPI } from '@/services/WalletAPI';
import type {
  GetInfoResponse,
  Payment,
  SdkEvent,
  InputType,
  PrepareSendPaymentResponse,
  SendPaymentResponse,
  ReceivePaymentResponse,
  LightningAddressInfo,
  PrepareLnurlPayResponse,
  LnurlPayResponse,
  DepositInfo,
  UserSettings,
  FiatCurrency,
  Rate,
} from '@breeztech/breez-sdk-spark';

// Store for event listeners
const eventListeners = new Map<string, (event: SdkEvent) => void>();
let listenerIdCounter = 0;

// Storage for mnemonic
let storedMnemonic: string | null = null;

/**
 * Creates a mock Payment object for testing
 */
export function createMockPayment(
  type: 'send' | 'receive',
  overrides?: Partial<Payment>
): Payment {
  const basePayment = {
    id: `payment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    paymentType: type === 'send' ? 'send' : 'receive',
    amount: 1000n,
    fees: 1n,
    timestamp: Math.floor(Date.now() / 1000),
    status: 'completed' as const,
  };

  return { ...basePayment, ...overrides } as Payment;
}

/**
 * Creates a mock WalletAPI for unit testing.
 * All methods are vi.fn() mocks that can be spied on and have their return values customized.
 */
export function createMockWalletApi(overrides?: Partial<WalletAPI>): WalletAPI {
  // Reset state for fresh mock
  eventListeners.clear();
  listenerIdCounter = 0;
  storedMnemonic = null;

  const defaultMock: WalletAPI = {
    // Lifecycle
    initWallet: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    connected: vi.fn().mockReturnValue(true),

    // Payments - parseInput
    // Note: We use `as unknown as InputType` because the full SDK types require many fields
    // that aren't needed for unit testing. This gives us flexibility in mocks while maintaining type safety.
    parseInput: vi.fn().mockImplementation(async (input: string): Promise<InputType> => {
      // Spark address
      if (input.startsWith('sp1')) {
        return {
          type: 'sparkAddress',
          address: input,
          identityPublicKey: 'test-pubkey',
          network: 'regtest',
          source: {},
        } as unknown as InputType;
      }
      // Lightning invoice (mainnet or testnet)
      if (input.startsWith('lnbc') || input.startsWith('lntb') || input.startsWith('lnbcrt')) {
        return {
          type: 'bolt11Invoice',
          invoice: { bolt11: input },
          amountMsat: 100000,
          description: 'Test invoice',
          expiry: 3600,
          minFinalCltvExpiryDelta: 144,
          network: 'regtest',
          payeePubkey: 'test-pubkey',
          paymentHash: 'test-hash',
          paymentSecret: 'test-secret',
          routingHints: [],
          timestamp: Math.floor(Date.now() / 1000),
        } as unknown as InputType;
      }
      // Bitcoin address
      if (input.startsWith('bc1') || input.startsWith('tb1') || input.startsWith('bcrt1')) {
        return {
          type: 'bitcoinAddress',
          address: input,
          network: 'regtest',
        } as unknown as InputType;
      }
      // Lightning address
      if (input.includes('@')) {
        return {
          type: 'lightningAddress',
          address: input,
        } as unknown as InputType;
      }
      // LNURL
      if (input.toLowerCase().startsWith('lnurl')) {
        return {
          type: 'lnurlPay',
          callback: 'https://example.com/lnurl',
          minSendable: 1000,
          maxSendable: 1000000,
          metadataStr: '[]',
          commentAllowed: 0,
          domain: 'example.com',
          url: 'https://example.com/lnurl',
        } as unknown as InputType;
      }
      throw new Error(`Unknown input type: ${input}`);
    }),

    // LNURL
    prepareLnurlPay: vi.fn().mockResolvedValue({
      payAmount: { amountSats: 100 },
      comment: '',
      payRequest: {
        callback: 'https://example.com',
        minSendable: 1000,
        maxSendable: 1000000,
        metadataStr: '[]',
        commentAllowed: 0,
        domain: 'example.com',
        url: 'https://example.com',
      },
      feeSats: 1,
      invoiceDetails: {
        expiry: 3600,
        invoice: { bolt11: 'lntb1000n1test' },
        minFinalCltvExpiryDelta: 144,
        network: 'regtest',
        payeePubkey: 'test-pubkey',
        paymentHash: 'test-hash',
        paymentSecret: 'test-secret',
        routingHints: [],
        timestamp: Math.floor(Date.now() / 1000),
      },
    } as unknown as PrepareLnurlPayResponse),

    lnurlPay: vi.fn().mockResolvedValue({
      payment: createMockPayment('send'),
    } as LnurlPayResponse),

    // Send payment
    prepareSendPayment: vi.fn().mockResolvedValue({
      paymentMethod: { type: 'spark', address: 'sp1test' },
      payAmount: { amountSats: 1000 },
    } as unknown as PrepareSendPaymentResponse),

    sendPayment: vi.fn().mockResolvedValue({
      payment: createMockPayment('send'),
    } as SendPaymentResponse),

    // Receive payment
    receivePayment: vi.fn().mockImplementation(async ({ paymentMethod }) => {
      let paymentRequest = '';

      if (paymentMethod.type === 'sparkAddress') {
        paymentRequest = 'sp1testaddress123456789';
      } else if (paymentMethod.type === 'bitcoinAddress') {
        paymentRequest = 'tb1qtest123456789abcdef';
      } else if (paymentMethod.type === 'bolt11Invoice') {
        paymentRequest = 'lntb1000n1test123456789';
      }

      return {
        paymentRequest,
        fee: 0n,
      } as ReceivePaymentResponse;
    }),

    // Unclaimed deposits
    unclaimedDeposits: vi.fn().mockResolvedValue([] as DepositInfo[]),
    claimDeposit: vi.fn().mockResolvedValue(undefined),
    refundDeposit: vi.fn().mockResolvedValue(undefined),

    // Data
    getWalletInfo: vi.fn().mockResolvedValue({
      identityPubkey: 'test-identity-pubkey',
      balanceSats: 10000,
      tokenBalances: new Map(),
    } as unknown as GetInfoResponse),

    getTransactions: vi.fn().mockResolvedValue([] as Payment[]),

    // Events
    addEventListener: vi.fn().mockImplementation(async (callback: (event: SdkEvent) => void) => {
      const id = `listener-${++listenerIdCounter}`;
      eventListeners.set(id, callback);
      return id;
    }),

    removeEventListener: vi.fn().mockImplementation(async (id: string) => {
      eventListeners.delete(id);
    }),

    // Storage helpers
    saveMnemonic: vi.fn().mockImplementation((mnemonic: string) => {
      storedMnemonic = mnemonic;
    }),
    getSavedMnemonic: vi.fn().mockImplementation(() => storedMnemonic),
    clearMnemonic: vi.fn().mockImplementation(() => {
      storedMnemonic = null;
    }),

    // Lightning Address
    getLightningAddress: vi.fn().mockResolvedValue(null as LightningAddressInfo | null),
    checkLightningAddressAvailable: vi.fn().mockResolvedValue(true),
    registerLightningAddress: vi.fn().mockResolvedValue(undefined),
    deleteLightningAddress: vi.fn().mockResolvedValue(undefined),

    // User settings
    getUserSettings: vi.fn().mockResolvedValue({} as UserSettings),
    setUserSettings: vi.fn().mockResolvedValue(undefined),

    // Fiat currencies
    listFiatCurrencies: vi.fn().mockResolvedValue([
      { id: 'USD', info: { name: 'US Dollar', fractionSize: 2, symbol: { grapheme: '$' } } },
      { id: 'EUR', info: { name: 'Euro', fractionSize: 2, symbol: { grapheme: '\u20ac' } } },
    ] as unknown as FiatCurrency[]),

    listFiatRates: vi.fn().mockResolvedValue([
      { coin: 'USD', value: 100000 },
      { coin: 'EUR', value: 92000 },
    ] as Rate[]),

    // Logs
    getSdkLogs: vi.fn().mockReturnValue(''),
  };

  return { ...defaultMock, ...overrides };
}

/**
 * Emit an SDK event to all registered listeners.
 * Useful for testing event-driven behavior in components.
 */
export function emitSdkEvent(event: SdkEvent): void {
  eventListeners.forEach((callback) => {
    callback(event);
  });
}

/**
 * Get all registered event listeners (for debugging/testing)
 */
export function getEventListeners(): Map<string, (event: SdkEvent) => void> {
  return new Map(eventListeners);
}

/**
 * Clear all event listeners (useful in test cleanup)
 */
export function clearEventListeners(): void {
  eventListeners.clear();
}
