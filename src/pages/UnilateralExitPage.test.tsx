import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { waitForSheetOpen } from '@/test/utils/waitForSheetOpen';
import type { FeeRates } from '@/services/chain';
import type { UnilateralExitFlow } from '@/features/unilateral-exit/hooks/useUnilateralExitFlow';
import { quoteFigures } from '@/features/unilateral-exit/quote';
import { prepared } from '@/features/unilateral-exit/testFixtures';

// The page is the switch under test; the flow behind it is stubbed per step.
const flow = vi.hoisted(() => ({ current: null as unknown as UnilateralExitFlow }));
vi.mock('@/features/unilateral-exit/hooks/useUnilateralExitFlow', async () => ({
  ...(await vi.importActual('@/features/unilateral-exit/hooks/useUnilateralExitFlow')),
  useUnilateralExitFlow: () => flow.current,
}));

// The scanner pulls in a wasm barcode reader the test env cannot resolve.
vi.mock('@/components/QrScannerDialog', () => ({ default: () => null }));

import UnilateralExitPage from './UnilateralExitPage';

const feeFlow = (feeRates: FeeRates | null) =>
  ({
    phase: 'fee',
    engine: { plan: null, pending: null, archive: [] },
    canGoBack: true,
    back: vi.fn(),
    fee: { feeRates, feeChoice: 'medium', effectiveFeeRate: feeRates?.medium ?? 0, onSelect: vi.fn() },
    submitFee: vi.fn(),
    goTo: vi.fn(),
  }) as unknown as UnilateralExitFlow;

async function renderAt(fee: FeeRates | null) {
  flow.current = feeFlow(fee);
  render(<UnilateralExitPage network="regtest" onBack={vi.fn()} onFinished={vi.fn()} />);
  await waitForSheetOpen();
}

describe('the fee step while its rates load', () => {
  it('leaves the action bar empty rather than holding a dead button', async () => {
    await renderAt(null);
    expect(screen.getByText('Reading current fee rates...')).toBeInTheDocument();
    expect(screen.queryByTestId('unilateral-exit-get-quote')).not.toBeInTheDocument();
  });

  it('offers the quote once there is a rate to quote at', async () => {
    await renderAt({ slow: 2, medium: 5, fast: 10 });
    expect(screen.getByTestId('unilateral-exit-get-quote')).toBeEnabled();
  });
});

const quoteFlow = (singleUtxoFundingSat: number) => {
  const quote = prepared({ singleUtxoFundingSat });
  return {
    phase: 'quote',
    engine: { plan: null, pending: null, archive: [] },
    canGoBack: true,
    back: vi.fn(),
    quote: { quote, figures: quoteFigures(quote), isQuoting: false, error: null },
    startError: null,
    continueFromQuote: vi.fn(),
    goTo: vi.fn(),
  } as unknown as UnilateralExitFlow;
};

describe('the quote step', () => {
  it('names the tap that starts the exit when the quote needs no funding', async () => {
    flow.current = quoteFlow(0);
    render(<UnilateralExitPage network="regtest" onBack={vi.fn()} onFinished={vi.fn()} />);
    await waitForSheetOpen();
    const cta = screen.getByTestId('unilateral-exit-quote-continue');
    expect(cta).toHaveTextContent('Exit Spark');
    fireEvent.click(cta);
    expect(flow.current.continueFromQuote).toHaveBeenCalled();
  });

  it('only continues, to the phrase and the fee, when the quote needs funding', async () => {
    flow.current = quoteFlow(3_000);
    render(<UnilateralExitPage network="regtest" onBack={vi.fn()} onFinished={vi.fn()} />);
    await waitForSheetOpen();
    expect(screen.getByTestId('unilateral-exit-quote-continue')).toHaveTextContent('Continue');
  });
});
