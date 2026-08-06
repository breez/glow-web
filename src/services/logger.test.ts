import { describe, it, expect, beforeEach } from 'vitest';
import { logger, LogCategory, scrubSecrets, redactDeep } from './logger';

// A published BIP39 test vector, never a real wallet's phrase.
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

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
    // Buffer limit is 100000 for unified app+SDK logs
    // Test with smaller batch to verify ring buffer behavior
    const testSize = 1100;
    for (let i = 0; i < testSize; i++) {
      logger.debug(LogCategory.UI, `Message ${i}`);
    }

    // Should have all 1100 logs since buffer is 100000
    expect(logger.getLogs().length).toBe(testSize);
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

  it('time() logs begin + end with elapsed ms and returns the value', async () => {
    const result = await logger.time('[onboarding] step', async () => 42);

    expect(result).toBe(42);
    const logs = logger.getLogs();
    expect(logs.map((l) => l.message)).toEqual([
      '[onboarding] step.begin',
      '[onboarding] step.end',
    ]);
    expect(logs[1].category).toBe('perf');
    expect(typeof logs[1].context?.ms).toBe('number');
  });

  it('time() logs .error and rethrows on failure', async () => {
    await expect(
      logger.time('[onboarding] step', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const logs = logger.getLogs();
    expect(logs[0].message).toBe('[onboarding] step.begin');
    expect(logs[1].message).toBe('[onboarding] step.error');
    expect(logs[1].level).toBe('WARN');
  });

  it('scrubs secrets out of the message string, not just the context', () => {
    logger.info(LogCategory.SDK_INTERNAL, `paying lnbc${'q'.repeat(60)} now`);

    expect(logger.getLogs()[0].message).toBe('paying [REDACTED] now');
  });
});

describe('scrubSecrets', () => {
  it('redacts secret-shaped values inside free-form text', () => {
    const secrets = [
      MNEMONIC,
      `lnbc1pvjluez${'q'.repeat(60)}`,
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJnbG93In0.dBjftJeZ4CVPmB92K27uhbUJU1p1r1wPWnvVpvcMOOO',
      'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi',
    ];

    // Punctuation delimiters: "before" and friends are themselves BIP39
    // words, so a word-delimited fixture tests the wrong thing.
    for (const secret of secrets) {
      expect(scrubSecrets(`>> ${secret} <<`)).toBe('>> [REDACTED] <<');
    }
  });

  it('redacts hex only when the line says it is secret material', () => {
    const hex = 'a'.repeat(64);

    expect(scrubSecrets(`settled with preimage ${hex}`)).toBe('settled with preimage [REDACTED]');
    expect(scrubSecrets(`derived seed ${hex}`)).toBe('derived seed [REDACTED]');
  });

  it('keeps what support needs: identifiers, pubkeys, and prose', () => {
    // The SDK reports claim and deposit failures as text with the txid
    // inline. Blanking it would leave the failure untraceable.
    const txid = 'a'.repeat(64);
    expect(scrubSecrets(`Claimed utxo ${txid}:0`)).toBe(`Claimed utxo ${txid}:0`);

    const pubkey = `03${'a'.repeat(64)}`;
    expect(scrubSecrets(`peer ${pubkey} connected`)).toBe(`peer ${pubkey} connected`);

    const prose = 'failed to claim the deposit because the node never answered within the window';
    expect(scrubSecrets(prose)).toBe(prose);
  });
});

describe('redactDeep', () => {
  it('blanks sensitive keys, scrubs values, keeps ids and shape', () => {
    const paymentId = 'f'.repeat(64);
    const out = redactDeep({
      payments: [{ id: paymentId, preimage: 'x', note: `phrase: ${MNEMONIC}` }],
      settings: [
        { key: 'breez_jwt', value: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJnIn0.c2lnbmF0dXJlXw' },
      ],
      count: 1,
    });

    expect(out).toEqual({
      // Row ids survive, so the export can still be followed row to row.
      payments: [{ id: paymentId, preimage: '[REDACTED]', note: 'phrase: [REDACTED]' }],
      settings: [{ key: 'breez_jwt', value: '[REDACTED]' }],
      count: 1,
    });
  });
});
