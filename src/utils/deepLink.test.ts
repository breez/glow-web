import { describe, expect, it } from 'vitest';
import { toPaymentInput } from './deepLink';

const BOLT11 = 'lnbc1u1p3xyzqwpp5abcdefg';
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

describe('toPaymentInput', () => {
  it('hands lightning: and bitcoin: links to the parser with the scheme intact', () => {
    expect(toPaymentInput(`lightning:${BOLT11}`)).toBe(`lightning:${BOLT11}`);
    expect(toPaymentInput(`bitcoin:${ADDRESS}?amount=0.001`)).toBe(`bitcoin:${ADDRESS}?amount=0.001`);
  });

  it('collapses the :// authority form the parser cannot strip', () => {
    expect(toPaymentInput(`lightning://${BOLT11}`)).toBe(`lightning:${BOLT11}`);
    expect(toPaymentInput(`LIGHTNING://${BOLT11}`)).toBe(`lightning:${BOLT11}`);
    expect(toPaymentInput(`bitcoin://${ADDRESS}`)).toBe(`bitcoin:${ADDRESS}`);
  });

  it('leaves the LUD-17 schemes alone, since the parser takes both forms', () => {
    expect(toPaymentInput('lnurlp://domain.com/pay?s=1')).toBe('lnurlp://domain.com/pay?s=1');
    expect(toPaymentInput('lnurlw:domain.com/withdraw')).toBe('lnurlw:domain.com/withdraw');
    expect(toPaymentInput('keyauth://domain.com/auth?k1=ab')).toBe('keyauth://domain.com/auth?k1=ab');
  });

  it('strips our own glow: scheme, which means nothing to the parser', () => {
    expect(toPaymentInput(`glow:${BOLT11}`)).toBe(BOLT11);
    expect(toPaymentInput(`glow://${BOLT11}`)).toBe(BOLT11);
    expect(toPaymentInput(`GLOW://${BOLT11}`)).toBe(BOLT11);
    expect(toPaymentInput('glow://user@domain.com')).toBe('user@domain.com');
  });

  it('returns null when there is no payload to act on', () => {
    expect(toPaymentInput('glow:')).toBeNull();
    expect(toPaymentInput('glow://')).toBeNull();
    expect(toPaymentInput('   ')).toBeNull();
  });

  it('passes through bare input and trims surrounding whitespace', () => {
    expect(toPaymentInput(`  ${BOLT11}\n`)).toBe(BOLT11);
  });
});
