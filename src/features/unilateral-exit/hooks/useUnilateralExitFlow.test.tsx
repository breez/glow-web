import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PrepareUnilateralExitResponse } from '@breeztech/breez-sdk-spark';
import { checked, prepared, sdk } from '../testFixtures';

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
vi.mock('../engine', async () => ({
  ...(await vi.importActual('../engine')),
  setPendingExit: vi.fn(),
  setUnilateralExitPlan: vi.fn(),
}));

import { useUnilateralExitFlow } from './useUnilateralExitFlow';
import { setPendingExit, setUnilateralExitPlan } from '../engine';
import { readWalletMnemonic } from '../funding';

/** Opens the flow on a quote at the medium rate. */
async function quoted(quote: PrepareUnilateralExitResponse) {
  const unilateralExit = vi.fn(async () => checked([{ txid: 'sweep', kind: 'sweep' }]));
  wallet.current = sdk({ prepareUnilateralExit: async () => quote, unilateralExit });
  const { result } = renderHook(() => useUnilateralExitFlow('regtest'));
  act(() => result.current.goTo('fee'));
  await waitFor(() => expect(result.current.fee.feeRates).not.toBeNull());
  await act(() => result.current.submitFee());
  return { result, unilateralExit };
}

describe('continuing from the quote', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds a quote that needs no funding at once: no phrase, no inputs, no signer', async () => {
    const { result, unilateralExit } = await quoted(prepared({ singleUtxoFundingSat: 0, cpfpFeeSat: 0 }));
    await act(async () => result.current.continueFromQuote());

    await waitFor(() => expect(setUnilateralExitPlan).toHaveBeenCalled());
    expect(unilateralExit).toHaveBeenCalledWith(expect.objectContaining({ fundingInputs: [] }), undefined);
    expect(readWalletMnemonic).not.toHaveBeenCalled();
    expect(setPendingExit).not.toHaveBeenCalled();
  });

  it('takes a quote that needs funding to the phrase, and builds nothing yet', async () => {
    const { result, unilateralExit } = await quoted(prepared({ singleUtxoFundingSat: 3_000 }));
    act(() => result.current.continueFromQuote());

    expect(result.current.phase).toBe('unlock');
    expect(unilateralExit).not.toHaveBeenCalled();
  });
});
