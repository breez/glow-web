import { vi } from 'vitest';
import type {
  BreezSdk,
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
  LnurlCallbackStatus,
  DepositInfo,
  GetPaymentResponse,
  RecommendedFees,
  SignMessageResponse,
  CheckMessageResponse,
  UserSettings,
  FiatCurrency,
  Rate,
} from '@breeztech/breez-sdk-spark';

// Store for event listeners
const eventListeners = new Map<string, (event: SdkEvent) => void>();
let listenerIdCounter = 0;

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
 * Creates a mock BreezSdk client for unit testing.
 * All methods are vi.fn() mocks that can be spied on and have their return values customized.
 */
export function createMockClient(overrides?: Partial<BreezSdk>): BreezSdk {
  // Reset state for fresh mock
  eventListeners.clear();
  listenerIdCounter = 0;

  const defaultMock = {
    // Lifecycle
    disconnect: vi.fn().mockResolvedValue(undefined),

    // Parse input
    // Note: We use `as unknown as InputType` because the full SDK types require many fields
    // that aren't needed for unit testing. This gives us flexibility in mocks while maintaining type safety.
    parse: vi.fn().mockImplementation(async (input: string): Promise<InputType> => {
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

    lnurlAuth: vi.fn().mockResolvedValue({ type: 'ok' } as LnurlCallbackStatus),

    // Send payment
    prepareSendPayment: vi.fn().mockResolvedValue({
      paymentMethod: { type: 'spark', address: 'sp1test' },
      payAmount: { amountSats: 1000 },
    } as unknown as PrepareSendPaymentResponse),

    sendPayment: vi.fn().mockResolvedValue({
      payment: createMockPayment('send'),
    } as SendPaymentResponse),

    // Receive payment
    receivePayment: vi.fn().mockImplementation(async ({ paymentMethod }: { paymentMethod: { type: string } }) => {
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
    listUnclaimedDeposits: vi.fn().mockResolvedValue({ deposits: [] as DepositInfo[] }),
    claimDeposit: vi.fn().mockResolvedValue({ payment: createMockPayment('receive') }),
    refundDeposit: vi.fn().mockResolvedValue(undefined),

    // Info & data
    getInfo: vi.fn().mockResolvedValue({
      identityPubkey: 'test-identity-pubkey',
      balanceSats: 10000,
      tokenBalances: new Map(),
    } as unknown as GetInfoResponse),

    listPayments: vi.fn().mockResolvedValue({ payments: [] as Payment[] }),

    getPayment: vi.fn().mockResolvedValue({
      payment: createMockPayment('receive'),
    } as GetPaymentResponse),

    // Wallet operations
    syncWallet: vi.fn().mockResolvedValue({}),
    recommendedFees: vi.fn().mockResolvedValue({
      fastestFee: 25,
      halfHourFee: 15,
      hourFee: 10,
      economyFee: 5,
      minimumFee: 1,
    } as RecommendedFees),
    signMessage: vi.fn().mockResolvedValue({
      pubkey: 'test-pubkey',
      signature: 'test-signature',
    } as SignMessageResponse),
    checkMessage: vi.fn().mockResolvedValue({
      isValid: true,
    } as CheckMessageResponse),

    // Events
    addEventListener: vi.fn().mockImplementation(async (listener: { onEvent: (event: SdkEvent) => void }) => {
      const id = `listener-${++listenerIdCounter}`;
      eventListeners.set(id, listener.onEvent);
      return id;
    }),

    removeEventListener: vi.fn().mockImplementation(async (id: string) => {
      eventListeners.delete(id);
    }),

    // Lightning Address
    getLightningAddress: vi.fn().mockResolvedValue(undefined as LightningAddressInfo | undefined),
    checkLightningAddressAvailable: vi.fn().mockResolvedValue(true),
    registerLightningAddress: vi.fn().mockResolvedValue(undefined),
    deleteLightningAddress: vi.fn().mockResolvedValue(undefined),

    // User settings
    getUserSettings: vi.fn().mockResolvedValue({} as UserSettings),
    updateUserSettings: vi.fn().mockResolvedValue(undefined),

    // Fiat currencies
    listFiatCurrencies: vi.fn().mockResolvedValue({
      currencies: [
        { id: 'USD', info: { name: 'US Dollar', fractionSize: 2, symbol: { grapheme: '$' } } },
        { id: 'EUR', info: { name: 'Euro', fractionSize: 2, symbol: { grapheme: '\u20ac' } } },
      ] as unknown as FiatCurrency[],
    }),

    listFiatRates: vi.fn().mockResolvedValue({
      rates: [
        { coin: 'USD', value: 100000 },
        { coin: 'EUR', value: 92000 },
      ] as Rate[],
    }),

    // Buy Bitcoin
    buyBitcoin: vi.fn().mockResolvedValue({ url: 'https://buy.moonpay.com/test' }),
  };

  return { ...defaultMock, ...overrides } as unknown as BreezSdk;
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
