import * as breezSdk from '@breeztech/breez-sdk-spark';
import {
  BreezSdk,
  Config,
  GetInfoRequest,
  GetInfoResponse,
  ListPaymentsRequest,
  ListPaymentsResponse,
  Payment,
  SendPaymentRequest,
  SendPaymentResponse,
  ReceivePaymentRequest,
  ReceivePaymentResponse,
  PrepareSendPaymentRequest,
  PrepareSendPaymentResponse,
  SdkEvent,
  EventListener,
  LogEntry,
  initLogging,
  connect,
  PrepareLnurlPayResponse,
  PrepareLnurlPayRequest,
  LnurlPayRequest,
  LnurlPayResponse,
  DepositInfo,
  Fee,
  UserSettings,
  UpdateUserSettingsRequest,
  FiatCurrency,
  Rate,
} from '@breeztech/breez-sdk-spark';
import type { WalletAPI } from './WalletAPI';
import { logger, LogCategory } from './logger';

class WebLogger {
  log = (logEntry: LogEntry) => {
    const ts = new Date().toISOString();
    const formatted = `${ts} [${logEntry.level}]: ${logEntry.line}`;
    console.log(formatted);
    appendLog(formatted);
  }
}
// Private SDK instance - not exposed outside this module
let sdk: BreezSdk | null = null;
let sdkLogger: WebLogger | null = null;
// In-memory log buffer (ring buffer)
const MAX_LOG_LINES = 100000;
const sdkLogs: string[] = [];

function appendLog(line: string) {
  sdkLogs.push(line);
  if (sdkLogs.length > MAX_LOG_LINES) {
    sdkLogs.splice(0, sdkLogs.length - MAX_LOG_LINES);
  }
}

export const initWallet = async (mnemonic: string, config: Config): Promise<void> => {
  // If already connected, do nothing
  if (sdk) {
    logger.warn(LogCategory.SDK, 'initWallet called but SDK is already initialized; skipping');
    return;
  }

  try {
    if (!sdkLogger) {
      sdkLogger = new WebLogger();
      initLogging(sdkLogger);
    }
    sdk = await connect({ config, seed: { type: "mnemonic", mnemonic }, storageDir: "spark-wallet-example" });
    logger.sdkInitialized();
    logger.authSuccess('mnemonic');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    logger.sdkError('initWallet', errorMsg);
    logger.authFailure('mnemonic', errorMsg);
    throw error;
  }
};

// Remove getSdk() method

// Add specific methods for actions components need to perform
// Payment Operations
export const parseInput = async (input: string): Promise<breezSdk.InputType> => {
  if (!sdk) throw new Error('SDK not initialized');
  return await sdk.parse(input);
};

export const prepareLnurlPay = async (
  params: PrepareLnurlPayRequest
): Promise<PrepareLnurlPayResponse> => {
  if (!sdk) throw new Error('SDK not initialized');
  return await sdk.prepareLnurlPay(params);
};

export const lnurlPay = async (
  params: LnurlPayRequest
): Promise<LnurlPayResponse> => {
  if (!sdk) throw new Error('SDK not initialized');
  return await sdk.lnurlPay(params);
};

export const prepareSendPayment = async (
  params: PrepareSendPaymentRequest
): Promise<PrepareSendPaymentResponse> => {
  if (!sdk) throw new Error('SDK not initialized');
  return await sdk.prepareSendPayment(params);
};

export const sendPayment = async (
  params: SendPaymentRequest
): Promise<SendPaymentResponse> => {
  if (!sdk) throw new Error('SDK not initialized');
  return await sdk.sendPayment(params);
};

export const receivePayment = async (
  params: ReceivePaymentRequest
): Promise<ReceivePaymentResponse> => {
  if (!sdk) throw new Error('SDK not initialized');
  return await sdk.receivePayment(params);
};

export const unclaimedDeposits = async (): Promise<DepositInfo[]> => {
  if (!sdk) throw new Error('SDK not initialized');
  return (await sdk.listUnclaimedDeposits({})).deposits;
};

export const claimDeposit = async (txid: string, vout: number, maxFee: Fee): Promise<void> => {
  if (!sdk) throw new Error('SDK not initialized');
  await sdk.claimDeposit({ txid, vout, maxFee });
};

export const refundDeposit = async (txid: string, vout: number, destinationAddress: string, fee: Fee): Promise<void> => {
  if (!sdk) throw new Error('SDK not initialized');
  await sdk.refundDeposit({ txid, vout, destinationAddress, fee });
};

// User Settings
export const getUserSettings = async (): Promise<UserSettings> => {
  if (!sdk) throw new Error('SDK not initialized');
  return await sdk.getUserSettings();
};

export const setUserSettings = async (settings: UpdateUserSettingsRequest): Promise<void> => {
  if (!sdk) throw new Error('SDK not initialized');
  await sdk.updateUserSettings(settings);
};

// Fiat currencies
export const listFiatCurrencies = async (): Promise<FiatCurrency[]> => {
  if (!sdk) throw new Error('SDK not initialized');
  const response = await sdk.listFiatCurrencies();
  return response.currencies;
};

export const listFiatRates = async (): Promise<Rate[]> => {
  if (!sdk) throw new Error('SDK not initialized');
  const response = await sdk.listFiatRates();
  return response.rates;
};

// Logs accessors
export const getSdkLogs = (): string => {
  return sdkLogs.join('\n');
};
// Event handling
export const addEventListener = async (
  callback: (event: SdkEvent) => void
): Promise<string> => {
  if (!sdk) {
    throw new Error('SDK not initialized');
  }

  try {
    // Create event listener
    const listener: EventListener = {
      onEvent: callback,
    };

    // Add event listener to SDK and return its ID
    const listenerId = await sdk.addEventListener(listener);
    logger.debug(LogCategory.SDK, 'Event listener added', { listenerId });
    return listenerId;
  } catch (error) {
    logger.sdkError('addEventListener', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
};

// Remove event listener directly from the SDK
export const removeEventListener = async (listenerId: string): Promise<void> => {
  if (!sdk || !listenerId) {
    return;
  }

  try {
    await sdk.removeEventListener(listenerId);
    logger.debug(LogCategory.SDK, 'Event listener removed', { listenerId });
  } catch (error) {
    logger.sdkError('removeEventListener', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
};

export const getWalletInfo = async (): Promise<GetInfoResponse | null> => {
  if (!sdk) {
    return null;
  }

  try {
    const request: GetInfoRequest = {};
    return await sdk.getInfo(request);
  } catch (error) {
    logger.sdkError('getWalletInfo', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
};

export const getTransactions = async (): Promise<Payment[]> => {
  if (!sdk) {
    return [];
  }

  try {
    const request: ListPaymentsRequest = {
      offset: 0,
      limit: 100
    };
    const response: ListPaymentsResponse = await sdk.listPayments(request);
    return response.payments;
  } catch (error) {
    logger.sdkError('getTransactions', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
};

export const disconnect = async (): Promise<void> => {
  if (sdk) {
    try {
      // Disconnect SDK (this will clean up all listeners registered with it)
      await sdk.disconnect();
      sdk = null;
      logger.sessionEnd('disconnect');
    } catch (error) {
      logger.sdkError('disconnect', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }
};

export const connected = (): boolean => {
  return sdk !== null;
};

// Helper to save mnemonic to localStorage
export const saveMnemonic = (mnemonic: string): void => {
  localStorage.setItem('walletMnemonic', mnemonic);
};

// Helper to retrieve mnemonic from localStorage
export const getSavedMnemonic = (): string | null => {
  return localStorage.getItem('walletMnemonic');
};

// Helper to clear mnemonic from localStorage
export const clearMnemonic = (): void => {
  localStorage.removeItem('walletMnemonic');
};

// Lightning Address Operations
export const getLightningAddress = async (): Promise<breezSdk.LightningAddressInfo | null> => {
  if (!sdk) throw new Error('SDK not initialized');
  try {
    // Return the full structure as provided by the underlying SDK
    const result = await sdk.getLightningAddress();
    return result ?? null;
  } catch (error) {
    logger.sdkError('getLightningAddress', error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
};

export const checkLightningAddressAvailable = async (username: string): Promise<boolean> => {
  if (!sdk) throw new Error('SDK not initialized');
  try {
    return await sdk.checkLightningAddressAvailable({ username });
  } catch (error) {
    logger.sdkError('checkLightningAddressAvailable', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
};

export const registerLightningAddress = async (username: string, description: string): Promise<void> => {
  if (!sdk) throw new Error('SDK not initialized');
  try {
    await sdk.registerLightningAddress({ username, description });
    logger.info(LogCategory.SDK, 'Lightning address registered');
  } catch (error) {
    logger.sdkError('registerLightningAddress', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
};

export const deleteLightningAddress = async (): Promise<void> => {
  if (!sdk) throw new Error('SDK not initialized');
  try {
    await sdk.deleteLightningAddress();
    logger.info(LogCategory.SDK, 'Lightning address deleted');
  } catch (error) {
    logger.sdkError('deleteLightningAddress', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
};

// Aggregate API object implementing WalletAPI
export const walletApi: WalletAPI = {
  // Lifecycle
  initWallet,
  disconnect,
  connected,

  // Payments
  parseInput,
  prepareLnurlPay,
  lnurlPay,
  prepareSendPayment,
  sendPayment,
  receivePayment,
  unclaimedDeposits,
  claimDeposit,
  refundDeposit,

  // Data
  getWalletInfo,
  getTransactions,

  // Events
  addEventListener,
  removeEventListener,

  // Storage helpers
  saveMnemonic,
  getSavedMnemonic,
  clearMnemonic,

  // Lightning Address
  getLightningAddress,
  checkLightningAddressAvailable,
  registerLightningAddress,
  deleteLightningAddress,
  // User settings
  getUserSettings,
  setUserSettings,
  // Fiat currencies
  listFiatCurrencies,
  listFiatRates,
  // Logs
  getSdkLogs,
  getAppLogs: () => logger.getLogsAsString(),
};
