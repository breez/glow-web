import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { PrepareRecoverFundsResponse, RecoverFundsLeaf, SkippedLeaf } from '@breeztech/breez-sdk-spark';
import { RecoverReviewStep } from './RecoverReviewStep';
import { quoteFigures } from '../quote';
import { funding, prepared } from '../testFixtures';

const cosignedLeaves: RecoverFundsLeaf[] = [
  { leafId: 'c-1', valueSats: 30_000, method: 'cooperative' },
  { leafId: 'c-2', valueSats: 18_200, method: 'cooperative' },
];
const strandedLeaves: RecoverFundsLeaf[] = [{ leafId: 's-1', valueSats: 120_000, method: 'unilateral' }];

const cosigned = (skipped: SkippedLeaf[] = []) =>
  prepared({
    leaves: cosignedLeaves,
    recoverableValueSats: 48_200,
    sweepFeeSats: 0,
    cpfpFeeSats: 0,
    funding: undefined,
    totalFeeSats: 2_900,
    cooperativeFeeSats: 2_900,
    skipped,
  });

const stranded = prepared({
  leaves: strandedLeaves,
  recoverableValueSats: 120_000,
  sweepFeeSats: 1_100,
  cpfpFeeSats: 13_000,
  funding: funding(14_350),
  totalFeeSats: 15_450,
});

const renderReview = (quote: PrepareRecoverFundsResponse, error: string | null = null) =>
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
      prepared({
        leaves: [...strandedLeaves, ...cosignedLeaves],
        recoverableValueSats: 168_200,
        sweepFeeSats: 1_100,
        funding: funding(14_350),
        totalFeeSats: 18_350,
        cooperativeFeeSats: 2_900,
      }),
    );
    expect(screen.getByText(/goes to this address now/)).toHaveTextContent('45 300');
    expect(screen.getByText(/needs the exit fee from another wallet/)).toHaveTextContent('118 900');
  });

  it('says how much stays behind and never why, whatever the reason', () => {
    renderReview(cosigned([{ leafId: 'gone', valueSats: 350, reason: { type: 'notRecoverable', message: 'stopped' } }]));
    expect(screen.getByText('Some funds stay behind')).toBeInTheDocument();
    expect(screen.getByText(/is left out of this recovery/)).toHaveTextContent('350');
    expect(screen.queryByText(/fee|small|found/i, { selector: 'p' })).not.toBeInTheDocument();
  });

  it('gives no reason when the quote moves nothing, since the SDK may have skipped it for any', () => {
    renderReview(
      prepared({
        leaves: [],
        recoverableValueSats: 0,
        totalFeeSats: 0,
        skipped: [{ leafId: 'gone', valueSats: 350, reason: { type: 'fundsNotFound' } }],
      }),
    );
    expect(screen.getByText('Nothing can be recovered right now')).toBeInTheDocument();
    expect(screen.queryByText(/cost more to move/)).not.toBeInTheDocument();
  });

  it('blames the fees only when they eat what the quote moves', () => {
    renderReview(prepared({ recoverableValueSats: 1_000, totalFeeSats: 4_000 }));
    expect(screen.getByText('Nothing is worth recovering right now')).toBeInTheDocument();
    expect(screen.getByText(/cost more to move on-chain than they are worth/)).toBeInTheDocument();
  });

  it('shows why the recovery did not start under the review it started from', () => {
    renderReview(cosigned(), 'Please try again.');
    expect(screen.getByText('Could not recover the funds')).toBeInTheDocument();
    expect(screen.getByText(/45 300/)).toBeInTheDocument();
  });
});
