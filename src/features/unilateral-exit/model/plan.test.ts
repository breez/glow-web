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
    expect(built).toMatchObject({ ...meta, phase: 'active', refusals: {} });
  });
});

describe('awaitsUpdate', () => {
  it('asks for the tap on a diverged exit only when its rebuild needs the passkey or failed', () => {
    expect(awaitsUpdate(plan([], { phase: 'redo', needsSignIn: true }))).toBe(true);
    expect(awaitsUpdate(plan([], { phase: 'redo', rebuildFailed: true }))).toBe(true);
  });

  it('leaves a diverged exit Glow rebuilds by itself alone', () => {
    expect(awaitsUpdate(plan([], { phase: 'redo' }))).toBe(false);
  });

  it('asks for the tap on a running exit that has to sign over a step it could not read', () => {
    expect(awaitsUpdate(plan([], { needsSignIn: true, redoCause: 'unverified' }))).toBe(true);
  });

  it('leaves a running exit alone, a converted one waiting to sign included', () => {
    expect(awaitsUpdate(plan([]))).toBe(false);
    expect(awaitsUpdate(plan([], { needsRebuild: true, needsSignIn: true }))).toBe(false);
    // A tap that found nothing to rebuild yet hands the step back to the engine.
    expect(awaitsUpdate(plan([], { redoCause: 'unverified' }))).toBe(false);
    // Left from a divergence the chain has since settled.
    expect(awaitsUpdate(plan([], { rebuildFailed: true }))).toBe(false);
  });

  it('asks nothing of a tap whose rebuild finished the exit, while it waits to be archived', () => {
    expect(awaitsUpdate(plan([], { phase: 'complete', needsSignIn: true, redoCause: 'unverified' }))).toBe(false);
  });
});
