/**
 * Structured logging service for Glow wallet.
 *
 * Features:
 * - Log levels: DEBUG, INFO, WARN, ERROR
 * - Categorized logging for filtering
 * - In-memory ring buffer for export/debugging
 * - Automatic sensitive data redaction
 * - Security event helpers (OWASP compliant)
 */

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
  UI: 'ui',
  NETWORK: 'network',
  SESSION: 'session',
  VALIDATION: 'validation',
} as const;

export type LogCategoryType = (typeof LogCategory)[keyof typeof LogCategory];

/** Maximum log entries to keep in memory */
const MAX_LOG_ENTRIES = 1000;

/** In-memory log buffer */
const logBuffer: LogEntry[] = [];

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

  // Console output
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
};
