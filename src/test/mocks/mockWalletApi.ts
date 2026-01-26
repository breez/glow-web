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
    parseInput: vi.fn().mockImplementation(async (input: string): Promise<InputType> => {
      // Spark address
      if (input.startsWith('sp1')) {
        return {
          type: 'sparkAddress',
          address: input,
        } as InputType;
      }
      // Lightning invoice (mainnet or testnet)
      if (input.startsWith('lnbc') || input.startsWith('lntb') || input.startsWith('lnbcrt')) {
        return {
          type: 'bolt11Invoice',
          invoice: input,
          amountMsat: 100000n,
          description: 'Test invoice',
        } as InputType;
      }
      // Bitcoin address
      if (input.startsWith('bc1') || input.startsWith('tb1') || input.startsWith('bcrt1')) {
        return {
          type: 'bitcoinAddress',
          address: input,
        } as InputType;
      }
      // Lightning address
      if (input.includes('@')) {
        return {
          type: 'lightningAddress',
          address: input,
        } as InputType;
      }
      // LNURL
      if (input.toLowerCase().startsWith('lnurl')) {
        return {
          type: 'lnurlPay',
          data: { callback: 'https://example.com/lnurl', minSendable: 1000n, maxSendable: 1000000n },
        } as InputType;
      }
      throw new Error(`Unknown input type: ${input}`);
    }),

    // LNURL
    prepareLnurlPay: vi.fn().mockResolvedValue({
      amountMsat: 100000n,
      comment: '',
    } as PrepareLnurlPayResponse),

    lnurlPay: vi.fn().mockResolvedValue({
      payment: createMockPayment('send'),
    } as LnurlPayResponse),

    // Send payment
    prepareSendPayment: vi.fn().mockResolvedValue({
      amount: 1000n,
      fees: 1n,
    } as PrepareSendPaymentResponse),

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
      balanceSat: 10000n,
      pendingBalanceSat: 0n,
      sparkAddress: 'sp1testaddress123',
      bitcoinAddress: 'tb1qtest123',
    } as GetInfoResponse),

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
      { id: 'USD', name: 'US Dollar', symbol: '$' },
      { id: 'EUR', name: 'Euro', symbol: '\u20ac' },
    ] as FiatCurrency[]),

    listFiatRates: vi.fn().mockResolvedValue([
      { fiatId: 'USD', rate: 100000 },
      { fiatId: 'EUR', rate: 92000 },
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
