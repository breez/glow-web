import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { PrepareUnilateralExitResponse } from '@breeztech/breez-sdk-spark';
import { QuoteStep } from './QuoteStep';
import { canContinueFromQuote, type QuoteFields } from '../hooks/useUnilateralExitFlow';
import { quoteFigures } from '../quote';

const quote = (over: Partial<PrepareUnilateralExitResponse> = {}): PrepareUnilateralExitResponse => ({
  leaves: [{ leafId: 'leaf-1', value: 100_000 }],
  recoverableValueSat: 100_000,
  totalFeeSat: 4_000,
  cpfpFeeSat: 3_800,
  fanoutFeeSat: 0,
  sweepFeeSat: 200,
  singleUtxoFundingSat: 6_000,
  perBranchFunding: [],
  feeRateSatPerVbyte: 2,
  destination: 'bc1qdest',
  exitChainState: {
    confirmedNodes: [],
    refunds: [],
    stoppedLeafIds: [],
    unverifiedNodeIds: [],
    unverifiableConfirmedNodeIds: [],
  },
  ...over,
});

/** A balance leaf and a co-signed one: the recover-funds API marks the second. */
const withRecoverable = (cooperativeFeeSats = 0): PrepareUnilateralExitResponse => {
  const leaves = [
    { leafId: 'leaf-1', value: 100_000 },
    { leafId: 'cosigned-1', value: 48_200, method: 'cooperative' },
  ];
  return { ...quote({ leaves, recoverableValueSat: 148_200 }), cooperativeFeeSats } as PrepareUnilateralExitResponse;
};

const fields = (
  q: PrepareUnilateralExitResponse = quote(),
  { walletBalanceSat = 100_000, error = null }: { walletBalanceSat?: number; error?: string | null } = {},
): QuoteFields => ({ quote: q, figures: quoteFigures(q, { walletBalanceSat }), isQuoting: false, error });

const renderStep = (...args: Parameters<typeof fields>) => render(<QuoteStep {...fields(...args)} />);

describe('QuoteStep', () => {
  it('shows the one fee that comes off the balance, so the shortfall is not a surprise', () => {
    renderStep();
    expect(screen.getByText('Balance')).toBeInTheDocument();
    expect(screen.getByText('Sweep fee')).toBeInTheDocument();
    // The label already says it is a cost, so the figure is a plain amount.
    const row = screen.getByText('Sweep fee').parentElement as HTMLElement;
    expect(within(row).getByText(/200/)).toBeInTheDocument();
  });

  it('says what the exit fee pays for, and that it does not come back', () => {
    renderStep();
    expect(screen.getByText('Exit fee')).toBeInTheDocument();
    expect(screen.getByText(/mining fees required to move the Spark tree/)).toBeInTheDocument();
  });

  it('estimates what arrives as the balance less the sweep fee, funding excluded', () => {
    renderStep();
    expect(screen.getByText(/You.ll receive/)).toBeInTheDocument();
    expect(screen.getByText(/99 800/)).toBeInTheDocument();
  });

  it('says how much Bitcoin the user has to supply', () => {
    renderStep();
    const row = screen.getByText('Exit fee').parentElement as HTMLElement;
    expect(within(row).getByText(/6 000/)).toBeInTheDocument();
  });

  it('asks for no exit fee when the quote needs no funding', () => {
    renderStep(quote({ singleUtxoFundingSat: 0, cpfpFeeSat: 0, totalFeeSat: 200 }));
    expect(screen.queryByText('Exit fee')).not.toBeInTheDocument();
    expect(screen.queryByText(/mining fees required to move the Spark tree/)).not.toBeInTheDocument();
    expect(screen.getByText(/99 800/)).toBeInTheDocument();
  });

  it('lets a worthwhile exit continue', () => {
    expect(canContinueFromQuote(fields())).toBe(true);
  });

  it('will not let an exit start when the fees would eat it', () => {
    const tooDear = quote({ recoverableValueSat: 1_000, totalFeeSat: 4_000 });
    renderStep(tooDear);
    expect(screen.getByText('Nothing is worth exiting right now')).toBeInTheDocument();
    expect(canContinueFromQuote(fields(tooDear))).toBe(false);
  });

  it('distinguishes having no leaves at all from the fees being too high', () => {
    renderStep(quote({ leaves: [], recoverableValueSat: 0 }));
    expect(screen.getByText('Nothing here to exit')).toBeInTheDocument();
    expect(screen.queryByText('Nothing is worth exiting right now')).not.toBeInTheDocument();
    expect(screen.queryByText('Change fee rate')).not.toBeInTheDocument();
  });

  it('names the balance being left behind as dust', () => {
    renderStep(quote(), { walletBalanceSat: 102_500 });
    expect(screen.getByText('Some of your balance stays behind')).toBeInTheDocument();
    expect(screen.getByText(/2 500/)).toBeInTheDocument();
  });

  it('gives recoverable funds their own row, so Balance stays the balance', () => {
    renderStep(withRecoverable());
    expect(within(screen.getByText('Balance').parentElement as HTMLElement).getByText(/100 000/)).toBeInTheDocument();
    expect(within(screen.getByText('Recoverable Funds').parentElement as HTMLElement).getByText(/48 200/)).toBeInTheDocument();
  });

  it('calls the fee a network fee once co-signed recoveries add theirs to the sweep', () => {
    renderStep(withRecoverable(2_900));
    expect(screen.queryByText('Sweep fee')).not.toBeInTheDocument();
    expect(within(screen.getByText('Network fee').parentElement as HTMLElement).getByText(/3 100/)).toBeInTheDocument();
  });

  it('reports a quote that failed outright', () => {
    renderStep(quote(), { error: 'operators unreachable' });
    expect(screen.getByText('Could not quote the exit')).toBeInTheDocument();
  });
});
