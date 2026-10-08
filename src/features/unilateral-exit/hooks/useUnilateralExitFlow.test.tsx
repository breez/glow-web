import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PrepareUnilateralExitResponse } from '@breeztech/breez-sdk-spark';
import type { UnilateralExitPlan } from '../driver';
import { checked, plan, prepared, sdk } from '../testFixtures';

const wallet = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/contexts/WalletContext', () => ({
  useWallet: () => wallet.current,
  useWalletInfo: () => ({ identityPubkey: '02abc', balanceSats: 100_000 }),
}));
vi.mock('@/services/chain', () => ({
  createChainClient: () => ({ feeRates: async () => ({ slow: 1, medium: 2, fast: 3 }), addressUtxos: async () => [] }),
}));
vi.mock('@/services/appLock', () => ({ holdIdleLock: () => () => {} }));
vi.mock('../exitState', () => ({ loadExitState: async () => null, restoreExitState: async () => {} }));
vi.mock('../funding', async () => ({
  ...(await vi.importActual('../funding')),
  readWalletMnemonic: vi.fn(async () => 'never read'),
}));
// The exit the flow resumes, if any; the engine itself is not running here.
const saved = vi.hoisted(() => ({ plan: null as UnilateralExitPlan | null }));
vi.mock('./useUnilateralExitEngineLifecycle', () => ({
  useUnilateralExitEngineState: () => ({
    plan: saved.plan,
    pending: null,
    pendingCoins: [],
    nothingToExit: false,
    isStarting: false,
    startError: null,
    archive: [],
    recoveries: [],
    tipHeight: null,
    isAdvancing: false,
  }),
}));
vi.mock('../engine', async () => ({
  ...(await vi.importActual('../engine')),
  setPendingExit: vi.fn(),
  setUnilateralExitPlan: vi.fn(),
}));

import { useUnilateralExitFlow } from './useUnilateralExitFlow';
import { setPendingExit, setUnilateralExitPlan } from '../engine';
import { readWalletMnemonic } from '../funding';

const unfunded = () => prepared({ singleUtxoFundingSat: 0, cpfpFeeSat: 0 });

/** Opens the flow on a quote at the medium rate. */
async function quoted(
  quote: PrepareUnilateralExitResponse,
  unilateralExit = vi.fn(async () => checked([{ txid: 'sweep', kind: 'sweep' }])),
) {
  wallet.current = sdk({ prepareUnilateralExit: async () => quote, unilateralExit });
  const { result } = renderHook(() => useUnilateralExitFlow('regtest'));
  act(() => result.current.goTo('fee'));
  await waitFor(() => expect(result.current.fee.feeRates).not.toBeNull());
  await act(() => result.current.submitFee());
  return { result, unilateralExit };
}

describe('continuing from the quote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saved.plan = null;
  });

  it('builds a quote that needs no funding at once: no phrase, no inputs, no signer', async () => {
    const { result, unilateralExit } = await quoted(unfunded());
    await act(async () => result.current.continueFromQuote());

    await waitFor(() => expect(setUnilateralExitPlan).toHaveBeenCalled());
    expect(unilateralExit).toHaveBeenCalledWith(expect.objectContaining({ fundingInputs: [] }), undefined);
    expect(readWalletMnemonic).not.toHaveBeenCalled();
    expect(setPendingExit).not.toHaveBeenCalled();
    // Nothing was paid, so the finished exit lists no exit fee.
    const built = vi.mocked(setUnilateralExitPlan).mock.calls[0][1];
    expect(built.quotedExitFeeSat).toBeUndefined();
    expect(built.exitFeeAddress).toBeUndefined();
  });

  it('shows why that build failed on the quote it came from', async () => {
    const failing = vi.fn(async () => {
      throw new Error('operators unreachable');
    });
    const { result } = await quoted(unfunded(), failing);
    await act(async () => result.current.continueFromQuote());

    expect(result.current.phase).toBe('quote');
    expect(result.current.startError).toBe('operators unreachable');
    expect(setUnilateralExitPlan).not.toHaveBeenCalled();
  });

  it('continues an exit under way that needs no more funding, keeping what it was built with', async () => {
    saved.plan = plan([], {
      fundingAddressIndex: 2,
      mode: 'recover',
      exitStateSnapshot: 'frozen',
      quotedExitFeeSat: 14_350,
      exitFeeAddress: 'bcrt1qfee',
    });
    const { result } = await quoted(unfunded());
    await act(async () => result.current.continueFromQuote());

    await waitFor(() => expect(setUnilateralExitPlan).toHaveBeenCalled());
    expect(vi.mocked(setUnilateralExitPlan).mock.calls[0][1]).toMatchObject({
      fundingAddressIndex: 2,
      mode: 'recover',
      exitStateSnapshot: 'frozen',
      quotedExitFeeSat: 14_350,
      exitFeeAddress: 'bcrt1qfee',
    });
    expect(readWalletMnemonic).not.toHaveBeenCalled();
  });

  it('takes a quote that needs funding to the phrase, and builds nothing yet', async () => {
    const { result, unilateralExit } = await quoted(prepared({ singleUtxoFundingSat: 3_000 }));
    act(() => result.current.continueFromQuote());

    expect(result.current.phase).toBe('unlock');
    expect(unilateralExit).not.toHaveBeenCalled();
  });
});
