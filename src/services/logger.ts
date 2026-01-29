/**
 * Unified logging service for Glow wallet.
 *
 * Features:
 * - Single unified log stream for app and SDK logs
 * - Log levels: DEBUG, INFO, WARN, ERROR
 * - Categorized logging for filtering
 * - In-memory ring buffer for export/debugging
 * - Automatic sensitive data redaction
 * - Security event helpers (OWASP compliant)
 * - Console output controlled by settings (disabled in production by default)
 * - Persistent encrypted storage across sessions (up to 10 sessions)
 */

import { isConsoleLoggingEnabled } from './settings';
import {
  isStorageAvailable,
  startSession,
  saveSessionLogs,
  endSession as endStorageSession,
} from './logStorage';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  context?: Record<string, unknown>;
}

/** Log categories for filtering and organization */
export const LogCategory = {
  AUTH: 'auth',
  PAYMENT: 'payment',
  SDK: 'sdk',
  SDK_INTERNAL: 'sdk-internal', // For raw SDK logs
  UI: 'ui',
  NETWORK: 'network',
  SESSION: 'session',
  VALIDATION: 'validation',
} as const;

export type LogCategoryType = (typeof LogCategory)[keyof typeof LogCategory];

/** Maximum log entries to keep in memory */
const MAX_LOG_ENTRIES = 100000;

/** Interval for persisting logs to storage (ms) */
const PERSIST_INTERVAL = 5000;

/** In-memory unified log buffer */
const logBuffer: LogEntry[] = [];

/** Flag to track if session has been initialized */
let sessionInitialized = false;

/** Timer for periodic persistence */
let persistTimer: ReturnType<typeof setInterval> | null = null;

/** Keys that should never be logged */
const SENSITIVE_KEYS = [
  'mnemonic',
  'seed',
  'privateKey',
  'password',
  'passphrase',
  'secret',
  'token',
  'apiKey',
  'paymentHash',
  'preimage',
  'bolt11',
  'invoice',
];

/** Sanitize context object by redacting sensitive values */
function sanitizeContext(ctx?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!ctx) return undefined;

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(ctx)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = SENSITIVE_KEYS.some((k) => lowerKey.includes(k.toLowerCase()));

    if (isSensitive) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeContext(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/** Core logging function */
function log(
  level: LogLevel,
  category: string,
  message: string,
  context?: Record<string, unknown>
): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    context: sanitizeContext(context),
  };

  // Add to buffer (ring buffer behavior)
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer.shift();
  }

  // Console output (respects settings - disabled in production by default)
  if (isConsoleLoggingEnabled()) {
    const formatted = `[${entry.timestamp}] ${entry.level} [${entry.category}] ${entry.message}`;

    switch (level) {
      case 'ERROR':
        console.error(formatted, context ? sanitizeContext(context) : '');
        break;
      case 'WARN':
        console.warn(formatted, context ? sanitizeContext(context) : '');
        break;
      case 'DEBUG':
        console.debug(formatted, context ? sanitizeContext(context) : '');
        break;
      default:
        console.log(formatted, context ? sanitizeContext(context) : '');
    }
  }
}

/**
 * Log an SDK internal message (from Breez SDK's logger).
 * This writes to the same unified log buffer.
 */
export function logSdkMessage(level: string, message: string): void {
  // Map SDK log levels to our log levels
  let logLevel: LogLevel;
  switch (level.toUpperCase()) {
    case 'ERROR':
      logLevel = 'ERROR';
      break;
    case 'WARN':
    case 'WARNING':
      logLevel = 'WARN';
      break;
    case 'DEBUG':
    case 'TRACE':
      logLevel = 'DEBUG';
      break;
    default:
      logLevel = 'INFO';
  }

  log(logLevel, LogCategory.SDK_INTERNAL, message);
}

/** Structured logger API */
export const logger = {
  // Core log methods
  debug: (category: string, message: string, context?: Record<string, unknown>) =>
    log('DEBUG', category, message, context),

  info: (category: string, message: string, context?: Record<string, unknown>) =>
    log('INFO', category, message, context),

  warn: (category: string, message: string, context?: Record<string, unknown>) =>
    log('WARN', category, message, context),

  error: (category: string, message: string, context?: Record<string, unknown>) =>
    log('ERROR', category, message, context),

  // Security event helpers (OWASP logging guidelines)
  authSuccess: (method: string) =>
    log('INFO', LogCategory.AUTH, `Authentication succeeded`, { method }),

  authFailure: (method: string, reason: string) =>
    log('WARN', LogCategory.AUTH, `Authentication failed`, { method, reason }),

  sessionStart: () => log('INFO', LogCategory.SESSION, 'Session started'),

  sessionEnd: (reason?: string) =>
    log('INFO', LogCategory.SESSION, 'Session ended', reason ? { reason } : undefined),

  validationFailure: (field: string, reason: string) =>
    log('WARN', LogCategory.VALIDATION, `Validation failed`, { field, reason }),

  paymentInitiated: (type: string) =>
    log('INFO', LogCategory.PAYMENT, `Payment initiated`, { type }),

  paymentCompleted: (type: string) =>
    log('INFO', LogCategory.PAYMENT, `Payment completed`, { type }),

  paymentFailed: (type: string, error: string) =>
    log('ERROR', LogCategory.PAYMENT, `Payment failed`, { type, error }),

  sdkInitialized: () => log('INFO', LogCategory.SDK, 'SDK initialized'),

  sdkError: (operation: string, error: string) =>
    log('ERROR', LogCategory.SDK, `SDK error`, { operation, error }),

  // Buffer access for debugging/export
  getLogs: (): LogEntry[] => [...logBuffer],

  getLogsAsString: (): string =>
    logBuffer
      .map((e) => {
        const ctx = e.context ? ` ${JSON.stringify(e.context)}` : '';
        return `[${e.timestamp}] ${e.level} [${e.category}] ${e.message}${ctx}`;
      })
      .join('\n'),

  getLogsByLevel: (level: LogLevel): LogEntry[] => logBuffer.filter((e) => e.level === level),

  getLogsByCategory: (category: string): LogEntry[] =>
    logBuffer.filter((e) => e.category === category),

  clear: () => {
    logBuffer.length = 0;
  },

  /** Export logs for bug reports */
  exportForBugReport: (): string => {
    const header = `Glow Wallet Log Export\nGenerated: ${new Date().toISOString()}\nEntries: ${logBuffer.length}\n${'='.repeat(50)}\n\n`;
    return header + logger.getLogsAsString();
  },

  /**
   * Initialize logging session and start periodic persistence.
   * Should be called once at app startup.
   */
  initSession: async (): Promise<void> => {
    if (sessionInitialized || !isStorageAvailable()) return;

    try {
      await startSession();
      sessionInitialized = true;

      // Start periodic persistence
      persistTimer = setInterval(async () => {
        await logger.persistLogs();
      }, PERSIST_INTERVAL);

      // Persist on page unload
      window.addEventListener('beforeunload', () => {
        logger.persistLogsSync();
      });

      // Persist on visibility change (app going to background)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          logger.persistLogsSync();
        }
      });
    } catch (e) {
      console.warn('Failed to initialize log session:', e);
    }
  },

  /**
   * Persist current logs to storage (async)
   */
  persistLogs: async (): Promise<void> => {
    if (!sessionInitialized || !isStorageAvailable()) return;

    try {
      const logs = logger.getLogsAsString();
      await saveSessionLogs(logs);
    } catch (e) {
      console.warn('Failed to persist logs:', e);
    }
  },

  /**
   * Persist logs synchronously (for beforeunload)
   * Uses navigator.sendBeacon pattern for reliability
   */
  persistLogsSync: (): void => {
    if (!sessionInitialized || !isStorageAvailable()) return;

    // Best effort - call async persist, it may or may not complete
    logger.persistLogs().catch(() => {
      // Ignore errors during sync persist
    });
  },

  /**
   * End current logging session
   */
  endSession: async (): Promise<void> => {
    if (!sessionInitialized) return;

    // Final persist
    await logger.persistLogs();

    // Stop periodic persistence
    if (persistTimer) {
      clearInterval(persistTimer);
      persistTimer = null;
    }

    try {
      await endStorageSession();
    } catch (e) {
      console.warn('Failed to end log session:', e);
    }

    sessionInitialized = false;
  },
};
