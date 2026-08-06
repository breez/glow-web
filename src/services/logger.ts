/**
 * Unified logging service for Glow.
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

import { wordlists } from 'bip39';
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
  PERF: 'perf', // Timing breadcrumbs (e.g. wallet-create critical path)
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

const REDACTED = '[REDACTED]';

/** Secret shapes that must never reach the buffer whatever field they
 *  arrive in. Key-name matching alone misses SDK log lines and error
 *  strings, which are free-form text with the secret inline. */
const SECRET_PATTERNS = [
  /\b(?:lnbcrt|lntbs|lnbc|lntb|lnsb)[0-9a-z]{40,}/gi, // bolt11
  /\blnurl1[0-9a-z]{20,}/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // jwt
  /\b(?:xprv|tprv|yprv|zprv|uprv|vprv)[1-9A-HJ-NP-Za-km-z]{50,}/g, // extended privkey
];

/** 32 bytes of hex and up: a preimage, a txid, and a payment hash are all
 *  this shape, so the value alone cannot say which it is. */
const HEX_BLOB = /\b[0-9a-fA-F]{64,}\b/g;

/** What decides it is the line's own wording. Blanking every hex blob
 *  costs more than it buys: the SDK reports claim, deposit, and exit
 *  failures as text with the txid inline, and those are the failures we
 *  are usually asked to explain. So hex goes only when the line says it
 *  is carrying secret material. */
const SECRET_LABEL = /preimage|mnemonic|\bseed\b|entropy|passphrase|private[_ ]?key|secret/i;

const BIP39_WORDS = new Set(wordlists.english);

/** Shortest phrase BIP39 defines. */
const MNEMONIC_MIN_WORDS = 12;

/**
 * Redact runs of 12+ whitespace-separated wordlist words. Every word is
 * checked, so prose has to be a valid phrase to match: scanning for runs
 * rather than regex-matching a shape is what keeps a phrase quoted
 * mid-sentence from hiding inside a longer, non-matching run.
 */
function redactMnemonics(text: string): string {
  const spans: Array<[number, number]> = [];
  let start = -1;
  let end = -1;
  let words = 0;

  for (const match of text.matchAll(/[a-z]+/g)) {
    const at = match.index ?? 0;
    const isWord = BIP39_WORDS.has(match[0]);
    // Anything but whitespace between two words breaks the phrase.
    const joined = words > 0 && /^\s+$/.test(text.slice(end, at));

    if (isWord && (words === 0 || joined)) {
      if (words === 0) start = at;
      words++;
    } else {
      if (words >= MNEMONIC_MIN_WORDS) spans.push([start, end]);
      words = isWord ? 1 : 0;
      start = at;
    }
    end = at + match[0].length;
  }
  if (words >= MNEMONIC_MIN_WORDS) spans.push([start, end]);

  // Back to front so the earlier spans keep their offsets.
  return spans.reduceRight((out, [from, to]) => out.slice(0, from) + REDACTED + out.slice(to), text);
}

/** Redact secret-shaped values inside a free-form string. */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, REDACTED);
  if (SECRET_LABEL.test(out)) out = out.replace(HEX_BLOB, REDACTED);
  return redactMnemonics(out);
}

/**
 * Blank values under a sensitive key name, scrub every remaining string
 * for secret-shaped content. Arrays and dates keep their shape: this
 * also runs over the SDK database export, where a mangled row is a
 * broken export.
 */
export function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') return scrubSecrets(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value instanceof Date) return value;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => {
        const lowerKey = key.toLowerCase();
        if (SENSITIVE_KEYS.some((k) => lowerKey.includes(k.toLowerCase()))) return [key, REDACTED];
        return [key, redactDeep(v)];
      }),
    );
  }
  return value;
}

/** Sanitize context object by redacting sensitive values */
function sanitizeContext(ctx?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!ctx) return undefined;
  return redactDeep(ctx) as Record<string, unknown>;
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
    // SDK lines and error strings carry their secrets inline, so the
    // message needs the value scrubber too, not just the context.
    message: scrubSecrets(message),
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

  /**
   * Time an awaited step, emitting `<label>.begin` then `<label>.end`
   * (with elapsed `ms`) under the PERF category. Used to profile the
   * wallet-creation critical path; SDK_INTERNAL breadcrumbs (routed via
   * `initLogging`) interleave between begin/end, so a slow step's
   * internal cause is visible in Share Logs. On throw, emits
   * `<label>.error` with the elapsed time and rethrows.
   */
  time: async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = performance.now();
    log('INFO', LogCategory.PERF, `${label}.begin`);
    try {
      const result = await fn();
      log('INFO', LogCategory.PERF, `${label}.end`, { ms: Math.round(performance.now() - t0) });
      return result;
    } catch (e) {
      log('WARN', LogCategory.PERF, `${label}.error`, { ms: Math.round(performance.now() - t0) });
      throw e;
    }
  },

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
    const header = `Glow Log Export\nGenerated: ${new Date().toISOString()}\nEntries: ${logBuffer.length}\n${'='.repeat(50)}\n\n`;
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
