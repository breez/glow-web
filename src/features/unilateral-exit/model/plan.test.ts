import { awaitsUpdate, planFromExitResponse } from './plan';
import { checked, plan } from '../testFixtures';
import { describe, expect, it } from 'vitest';

const meta = {
  network: 'mainnet',
  destination: 'bc1qdest',
  feeRateSatPerVbyte: 3,
  fundingAddressIndex: 0,
  quotedSweepFeeSat: 200,
};

describe('planFromExitResponse', () => {
  it('keeps the sdk response whole, for the check to read back', () => {
    const exit = checked([{ txid: 'node-1' }], {
      fundingInputs: [{ type: 'p2wpkh', txid: 'fund', vout: 0, valueSats: 50_000, pubkey: '02ab' }],
    });
    const built = planFromExitResponse(exit, meta);
    expect(built.exit).toBe(exit);
    expect(built).toMatchObject({ ...meta, status: { type: 'running' }, refusals: {} });
  });
});

describe('awaitsUpdate', () => {
  it('asks for the tap on a diverged exit only when its rebuild needs the passkey or failed', () => {
    expect(awaitsUpdate(plan([], { status: { type: 'needsUpdate', why: 'signIn' } }))).toBe(true);
    expect(awaitsUpdate(plan([], { status: { type: 'needsUpdate', why: 'rebuildFailed' } }))).toBe(true);
  });

  it('leaves a diverged exit Glow rebuilds by itself alone', () => {
    expect(awaitsUpdate(plan([], { status: { type: 'rebuilding' } }))).toBe(false);
  });

  it('asks for the tap on a running exit that has to sign over a step it could not read', () => {
    expect(awaitsUpdate(plan([], { status: { type: 'needsUpdate', why: 'signIn', cause: 'unverified' } }))).toBe(true);
  });

  it('leaves a running exit alone', () => {
    expect(awaitsUpdate(plan([]))).toBe(false);
  });

  it('asks nothing of a finished exit', () => {
    expect(awaitsUpdate(plan([], { status: { type: 'done' } }))).toBe(false);
  });
});
