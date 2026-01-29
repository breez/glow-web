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
import { logger, LogCategory, logSdkMessage } from './logger';
import { getAllSessions, isStorageAvailable } from './logStorage';
import JSZip from 'jszip';

/**
 * WebLogger that writes SDK logs to the unified logger.
 * This ensures all logs (app + SDK) are in a single stream.
 */
class WebLogger {
  log = (logEntry: LogEntry) => {
    // Write to unified logger (which handles console output and persistence)
    logSdkMessage(logEntry.level, logEntry.line);
  };
}

// Private SDK instance - not exposed outside this module
let sdk: BreezSdk | null = null;
let sdkLogger: WebLogger | null = null;

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

// Logs accessors (unified log stream - app and SDK logs are combined)
export const getSdkLogs = (): string => {
  // SDK logs are now in the unified buffer, filter by category
  return logger.getLogsByCategory(LogCategory.SDK_INTERNAL)
    .map((e) => `[${e.timestamp}] ${e.level} ${e.message}`)
    .join('\n');
};

/** Get unified logs for current session as string */
export const getAllLogs = (): string => {
  return logger.getLogsAsString();
};

/**
 * Get all logs from all sessions as a zip file.
 * Returns a Blob containing the zip file.
 * Files are named with Unix timestamp prefix for chronological ordering.
 */
export const getAllLogsAsZip = async (): Promise<Blob> => {
  const zip = new JSZip();
  const now = new Date();
  const nowTimestamp = Math.floor(now.getTime() / 1000);

  // Add current session logs (unified stream)
  const currentSessionHeader = [
    `Glow Wallet Log Export`,
    `Session: Current`,
    `Generated: ${now.toISOString()}`,
    '='.repeat(60),
    '',
  ].join('\n');
  zip.file(`${nowTimestamp}_glow_current.txt`, currentSessionHeader + '\n' + getAllLogs());

  // Add historical sessions if storage is available
  if (isStorageAvailable()) {
    try {
      const sessions = await getAllSessions();

      for (const session of sessions) {
        // Use Unix timestamp for chronological sorting
        const sessionTimestamp = Math.floor(new Date(session.startedAt).getTime() / 1000);
        const filename = `${sessionTimestamp}_glow_session.txt`;

        // Create session info header
        const sessionHeader = [
          `Glow Wallet Log Export`,
          `Session ID: ${session.id}`,
          `Started: ${session.startedAt}`,
          session.endedAt ? `Ended: ${session.endedAt}` : 'Status: Active',
          '='.repeat(60),
          '',
        ].join('\n');

        // Add unified logs for this session
        zip.file(filename, sessionHeader + '\n' + (session.logs || '(no logs)'));
      }
    } catch (e) {
      // If we can't get historical sessions, just include current
      console.warn('Failed to retrieve historical sessions:', e);
    }
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
};

/**
 * Check if Web Share API is available and supports file sharing
 */
export const canShareFiles = (): boolean => {
  return typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function';
};

/**
 * Share or download logs using the best available method.
 * Uses Web Share API on mobile, falls back to download on desktop.
 */
export const shareOrDownloadLogs = async (): Promise<void> => {
  const blob = await getAllLogsAsZip();
  const timestamp = Math.floor(Date.now() / 1000);
  const filename = `${timestamp}_glow_logs.zip`;

  // Try Web Share API first (better mobile experience)
  if (canShareFiles()) {
    const file = new File([blob], filename, { type: 'application/zip' });

    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'Glow Wallet Logs',
        });
        return;
      } catch (e) {
        // User cancelled or share failed, fall through to download
        if ((e as Error).name === 'AbortError') {
          return; // User cancelled, don't fall back to download
        }
      }
    }
  }

  // Fall back to download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
  // Logs (unified log stream)
  getSdkLogs,
  getAppLogs: () => logger.getLogsAsString(),
  getAllLogs,
  getAllLogsAsZip,
  canShareFiles,
  shareOrDownloadLogs,

  // Session management
  initLogSession: () => logger.initSession(),
  endLogSession: () => logger.endSession(),
};
