import { describe, it, expect, beforeEach } from 'vitest';
import { logger, LogCategory } from './logger';

describe('logger', () => {
  beforeEach(() => {
    logger.clear();
  });

  it('logs info messages to buffer', () => {
    logger.info(LogCategory.AUTH, 'Test message');

    const logs = logger.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe('INFO');
    expect(logs[0].category).toBe('auth');
    expect(logs[0].message).toBe('Test message');
  });

  it('logs with context', () => {
    logger.info(LogCategory.PAYMENT, 'Payment', { amount: 1000 });

    const logs = logger.getLogs();
    expect(logs[0].context).toEqual({ amount: 1000 });
  });

  it('redacts sensitive mnemonic data', () => {
    logger.info(LogCategory.AUTH, 'Login', { mnemonic: 'secret words here' });

    const logs = logger.getLogs();
    expect(logs[0].context?.mnemonic).toBe('[REDACTED]');
  });

  it('redacts sensitive password data', () => {
    logger.info(LogCategory.AUTH, 'Login', { password: 'mypassword' });

    const logs = logger.getLogs();
    expect(logs[0].context?.password).toBe('[REDACTED]');
  });

  it('redacts nested sensitive data', () => {
    logger.info(LogCategory.AUTH, 'Data', { user: { apiKey: 'secret123' } });

    const logs = logger.getLogs();
    expect((logs[0].context?.user as Record<string, unknown>)?.apiKey).toBe('[REDACTED]');
  });

  it('respects buffer limit', () => {
    for (let i = 0; i < 1100; i++) {
      logger.debug(LogCategory.UI, `Message ${i}`);
    }

    expect(logger.getLogs().length).toBe(1000);
  });

  it('logs auth success events', () => {
    logger.authSuccess('wallet');

    const logs = logger.getLogs();
    expect(logs[0].category).toBe('auth');
    expect(logs[0].message).toBe('Authentication succeeded');
    expect(logs[0].context).toEqual({ method: 'wallet' });
  });

  it('logs auth failure events', () => {
    logger.authFailure('wallet', 'invalid mnemonic');

    const logs = logger.getLogs();
    expect(logs[0].level).toBe('WARN');
    expect(logs[0].category).toBe('auth');
  });

  it('logs payment events', () => {
    logger.paymentInitiated('lightning');
    logger.paymentCompleted('lightning');

    const logs = logger.getLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0].message).toBe('Payment initiated');
    expect(logs[1].message).toBe('Payment completed');
  });

  it('filters logs by level', () => {
    logger.info(LogCategory.UI, 'Info');
    logger.error(LogCategory.UI, 'Error');
    logger.warn(LogCategory.UI, 'Warn');

    const errors = logger.getLogsByLevel('ERROR');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('Error');
  });

  it('filters logs by category', () => {
    logger.info(LogCategory.AUTH, 'Auth log');
    logger.info(LogCategory.PAYMENT, 'Payment log');

    const authLogs = logger.getLogsByCategory(LogCategory.AUTH);
    expect(authLogs).toHaveLength(1);
    expect(authLogs[0].message).toBe('Auth log');
  });

  it('exports logs as string', () => {
    logger.info(LogCategory.SDK, 'Test');

    const str = logger.getLogsAsString();
    expect(str).toContain('[sdk]');
    expect(str).toContain('Test');
  });

  it('clears the buffer', () => {
    logger.info(LogCategory.UI, 'Test');
    logger.clear();

    expect(logger.getLogs()).toHaveLength(0);
  });
});
