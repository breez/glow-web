import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { PrepareUnilateralExitResponse } from '@breeztech/breez-sdk-spark';
import { RecoverReviewStep } from './RecoverReviewStep';
import { quoteFigures } from '../quote';
import { prepared } from '../testFixtures';

const cosignedLeaves = [
  { leafId: 'c-1', value: 30_000, method: 'cooperative' },
  { leafId: 'c-2', value: 18_200, method: 'cooperative' },
];
const strandedLeaves = [{ leafId: 's-1', value: 120_000, method: 'unilateral' }];

/** A quote with the fields the recover-funds API adds to today's. */
const withApi = (
  over: Partial<PrepareUnilateralExitResponse>,
  api: { cooperativeFeeSats?: number; skipped?: { valueSats: number; reason: { type: string } }[] } = {},
): PrepareUnilateralExitResponse => ({ ...prepared(over), skipped: [], ...api });

const cosigned = (skipped: { valueSats: number; reason: { type: string } }[] = []) =>
  withApi(
    { leaves: cosignedLeaves, recoverableValueSat: 48_200, sweepFeeSat: 0, cpfpFeeSat: 0, singleUtxoFundingSat: 0, totalFeeSat: 2_900 },
    { cooperativeFeeSats: 2_900, skipped },
  );

const stranded = withApi({
  leaves: strandedLeaves,
  recoverableValueSat: 120_000,
  sweepFeeSat: 1_100,
  cpfpFeeSat: 13_000,
  singleUtxoFundingSat: 14_350,
  totalFeeSat: 15_450,
});

const renderReview = (quote: PrepareUnilateralExitResponse, error: string | null = null) =>
  render(<RecoverReviewStep figures={quoteFigures(quote)} destination="bc1qdest" error={error} />);

const amountIn = (label: string) => screen.getByText(label).parentElement as HTMLElement;

describe('RecoverReviewStep', () => {
  it('sends co-signed funds for an exact amount, with no exit fee to pay', () => {
    renderReview(cosigned());
    expect(screen.getByText(/45 300/)).not.toHaveTextContent('~');
    expect(screen.queryByText('Exit fee')).not.toBeInTheDocument();
    expect(screen.queryByText(/pay the exit fee/)).not.toBeInTheDocument();
  });

  it('asks for the exit fee from another wallet when stranded funds need it', () => {
    renderReview(stranded);
    expect(within(amountIn('Exit fee')).getByText(/14 350/)).toBeInTheDocument();
    expect(screen.getByText(/To start the recovery you need to pay the exit fee/)).toBeInTheDocument();
  });

  it('splits a mixed quote into what goes now and what waits on the exit fee', () => {
    renderReview(
      withApi(
        {
          leaves: [...strandedLeaves, ...cosignedLeaves],
          recoverableValueSat: 168_200,
          sweepFeeSat: 1_100,
          singleUtxoFundingSat: 14_350,
          totalFeeSat: 18_350,
        },
        { cooperativeFeeSats: 2_900 },
      ),
    );
    expect(screen.getByText(/goes to this address now/)).toHaveTextContent('45 300');
    expect(screen.getByText(/needs the exit fee from another wallet/)).toHaveTextContent('118 900');
  });

  it('says how much stays behind and never why, whatever the reason', () => {
    renderReview(cosigned([{ valueSats: 350, reason: { type: 'aReasonAddedLater' } }]));
    expect(screen.getByText('Some funds stay behind')).toBeInTheDocument();
    expect(screen.getByText(/is left out of this recovery/)).toHaveTextContent('350');
    expect(screen.queryByText(/fee|small|found/i, { selector: 'p' })).not.toBeInTheDocument();
  });

  it('gives no reason when the quote moves nothing, since the SDK may have skipped it for any', () => {
    renderReview(withApi({ leaves: [], recoverableValueSat: 0, totalFeeSat: 0 }, { skipped: [{ valueSats: 350, reason: { type: 'fundsNotFound' } }] }));
    expect(screen.getByText('Nothing can be recovered right now')).toBeInTheDocument();
    expect(screen.queryByText(/cost more to move/)).not.toBeInTheDocument();
  });

  it('blames the fees only when they eat what the quote moves', () => {
    renderReview(withApi({ recoverableValueSat: 1_000, totalFeeSat: 4_000 }));
    expect(screen.getByText('Nothing is worth recovering right now')).toBeInTheDocument();
    expect(screen.getByText(/cost more to move on-chain than they are worth/)).toBeInTheDocument();
  });

  it('shows why the recovery did not start under the review it started from', () => {
    renderReview(cosigned(), 'Please try again.');
    expect(screen.getByText('Could not recover the funds')).toBeInTheDocument();
    expect(screen.getByText(/45 300/)).toBeInTheDocument();
  });
});
