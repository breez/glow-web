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

const renderReview = (
  quote: PrepareRecoverFundsResponse,
  error: string | null = null,
  { underWay = false, paused = false }: { underWay?: boolean; paused?: boolean } = {},
) =>
  render(
    <RecoverReviewStep figures={quoteFigures(quote)} destination="bc1qdest" error={error} underWay={underWay} paused={paused} />,
  );

const empty = (skipped: SkippedLeaf[] = []) => prepared({ leaves: [], recoverableValueSats: 0, totalFeeSats: 0, skipped });
const skip = (type: 'feeExceedsValue' | 'fundsNotFound' | 'unverified'): SkippedLeaf => ({ leafId: type, valueSats: 350, reason: { type } });
const unrecoverable: SkippedLeaf = { leafId: 'gone', valueSats: 350, reason: { type: 'notRecoverable', message: 'spent' } };
const tooDear = prepared({ recoverableValueSats: 1_000, totalFeeSats: 4_000 });

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

  describe('a fresh recovery whose quote moves nothing', () => {
    it('says the funds were already recovered when the quote skipped nothing either', () => {
      renderReview(empty());
      expect(screen.getByText('Nothing left to recover')).toBeInTheDocument();
      expect(screen.getByText('These funds were already recovered.')).toBeInTheDocument();
      expect(screen.queryByText('Try again later.')).not.toBeInTheDocument();
    });

    it.each([
      ['Glow could not check', [unrecoverable, skip('feeExceedsValue'), skip('unverified')]],
      ['Glow could not find', [unrecoverable, skip('feeExceedsValue'), skip('fundsNotFound')]],
    ])('asks to try later when any leaf is one %s, whatever else was skipped', (_, skipped) => {
      renderReview(empty(skipped));
      expect(screen.getByText('Nothing can be recovered right now')).toBeInTheDocument();
      expect(screen.getByText('Try again later.')).toBeInTheDocument();
    });

    it('says nothing is worth recovering when the fee is why, over any unrecoverable leaf', () => {
      renderReview(empty([unrecoverable, skip('feeExceedsValue')]));
      expect(screen.getByText('Nothing is worth recovering right now')).toBeInTheDocument();
      expect(screen.getByText(/At today's fee rates these funds would cost more/)).toBeInTheDocument();
    });

    it('says the funds cannot be recovered when that is the reason for every leaf', () => {
      renderReview(empty([unrecoverable]));
      expect(screen.getByText('Nothing left to recover')).toBeInTheDocument();
      expect(screen.getByText("These funds can't be recovered.")).toBeInTheDocument();
      expect(screen.queryByText('Try again later.')).not.toBeInTheDocument();
    });
  });

  describe('a recovery under way, or a fee being raised, whose quote moves nothing', () => {
    it('says there is nothing to rebuild, which Glow carries on by itself, whatever was skipped', () => {
      renderReview(empty([skip('unverified')]), null, { underWay: true });
      expect(screen.getByText('Nothing to rebuild right now')).toBeInTheDocument();
      expect(screen.getByText('Glow keeps your recovery moving on its own.')).toBeInTheDocument();
      expect(screen.queryByText('Nothing can be recovered right now')).not.toBeInTheDocument();
    });

    it('points a paused recovery at its update, since it will not move by itself', () => {
      renderReview(empty(), null, { underWay: true, paused: true });
      expect(screen.getByText('Nothing to rebuild right now')).toBeInTheDocument();
      expect(screen.getByText('Please update your recovery to continue.')).toBeInTheDocument();
      expect(screen.queryByText(/on its own/)).not.toBeInTheDocument();
      expect(screen.queryByText('These funds were already recovered.')).not.toBeInTheDocument();
    });
  });

  it('blames the fees only when they eat what the quote moves', () => {
    renderReview(tooDear);
    expect(screen.getByText('Nothing is worth recovering right now')).toBeInTheDocument();
    expect(
      screen.getByText(
        "At today's fee rates these funds would cost more to move on-chain than they are worth. Try again once the network is cheaper.",
      ),
    ).toBeInTheDocument();
  });

  it('points a rebuild the fees would eat at a lower rate, since a cheaper network does not help it', () => {
    renderReview(tooDear, null, { underWay: true });
    expect(screen.getByText('Nothing is worth recovering right now')).toBeInTheDocument();
    expect(
      screen.getByText(
        'At this fee rate these funds would cost more to move on-chain than they are worth. Try a lower fee rate, or wait for the network to get cheaper.',
      ),
    ).toBeInTheDocument();
  });

  it('asks for no start under way, where the build first spends what the fee address holds', () => {
    renderReview(stranded, null, { underWay: true });
    expect(within(amountIn('Exit fee')).getByText(/14 350/)).toBeInTheDocument();
    expect(screen.queryByText(/To start the recovery/)).not.toBeInTheDocument();
  });

  it('shows why the recovery did not start under the review it started from', () => {
    renderReview(cosigned(), 'Please try again.');
    expect(screen.getByText('Could not recover the funds')).toBeInTheDocument();
    expect(screen.getByText(/45 300/)).toBeInTheDocument();
  });

  it('says a recovery under way or a fee raise could not continue, with the way out the body names', () => {
    renderReview(cosigned(), 'Please try again or choose a different fee.', { underWay: true });
    expect(screen.getByText('Could not continue the recovery')).toBeInTheDocument();
    expect(screen.getByText('Please try again or choose a different fee.')).toBeInTheDocument();
    expect(screen.queryByText('Could not recover the funds')).not.toBeInTheDocument();
  });
});
