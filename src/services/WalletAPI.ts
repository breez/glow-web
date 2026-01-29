import type {
  Config,
  GetInfoResponse,
  PrepareSendPaymentRequest,
  PrepareSendPaymentResponse,
  ReceivePaymentRequest,
  ReceivePaymentResponse,
  SendPaymentRequest,
  SendPaymentResponse,
  Payment,
  SdkEvent,
  InputType,
  LightningAddressInfo,
  PrepareLnurlPayRequest,
  PrepareLnurlPayResponse,
  LnurlPayRequest,
  LnurlPayResponse,
  DepositInfo,
  Fee,
  UserSettings,
  UpdateUserSettingsRequest,
  FiatCurrency,
  Rate,
} from '@breeztech/breez-sdk-spark';

export interface WalletAPI {
  // Lifecycle
  initWallet: (mnemonic: string, config: Config) => Promise<void>;
  disconnect: () => Promise<void>;
  connected: () => boolean;

  // Payments
  parseInput: (input: string) => Promise<InputType>;
  prepareLnurlPay: (params: PrepareLnurlPayRequest) => Promise<PrepareLnurlPayResponse>;
  lnurlPay: (params: LnurlPayRequest) => Promise<LnurlPayResponse>;
  prepareSendPayment: (params: PrepareSendPaymentRequest) => Promise<PrepareSendPaymentResponse>;
  sendPayment: (params: SendPaymentRequest) => Promise<SendPaymentResponse>;
  receivePayment: (params: ReceivePaymentRequest) => Promise<ReceivePaymentResponse>;
  unclaimedDeposits: () => Promise<DepositInfo[]>;
  claimDeposit: (txid: string, vout: number, maxFee: Fee) => Promise<void>;
  refundDeposit: (txid: string, vout: number, destinationAddress: string, fee: Fee) => Promise<void>;

  // Data
  getWalletInfo: () => Promise<GetInfoResponse | null>;
  getTransactions: () => Promise<Payment[]>;

  // Events
  addEventListener: (callback: (event: SdkEvent) => void) => Promise<string>;
  removeEventListener: (listenerId: string) => Promise<void>;

  // Storage helpers
  saveMnemonic: (mnemonic: string) => void;
  getSavedMnemonic: () => string | null;
  clearMnemonic: () => void;

  // Lightning Address
  getLightningAddress: () => Promise<LightningAddressInfo | null>;
  checkLightningAddressAvailable: (username: string) => Promise<boolean>;
  registerLightningAddress: (username: string, description: string) => Promise<void>;
  deleteLightningAddress: () => Promise<void>;

  // User settings
  getUserSettings: () => Promise<UserSettings>;
  setUserSettings: (settings: UpdateUserSettingsRequest) => Promise<void>;

  // Fiat currencies
  listFiatCurrencies: () => Promise<FiatCurrency[]>;
  listFiatRates: () => Promise<Rate[]>;

  // Logs
  getSdkLogs: () => string;
  getAppLogs: () => string;
  /** Get unified logs combining app and SDK logs */
  getAllLogs: () => string;
  /** Get all logs from all sessions as a zip file */
  getAllLogsAsZip: () => Promise<Blob>;
  /** Check if native file sharing is available */
  canShareFiles: () => boolean;
  /** Share or download logs (uses native share on mobile, download on desktop) */
  shareOrDownloadLogs: () => Promise<void>;

  // Session management
  /** Initialize log session with persistent storage */
  initLogSession: () => Promise<void>;
  /** End current log session */
  endLogSession: () => Promise<void>;
}
