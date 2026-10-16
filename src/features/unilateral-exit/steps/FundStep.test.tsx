import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { FundStep, FundingStatus, PendingExitStep } from './FundStep';
import { coin, pendingExit } from '../testFixtures';

// The backup rows under Advanced read the connected wallet.
vi.mock('@/contexts/WalletContext', () => ({
  useWallet: () => ({
    exportUnilateralExitState: async () => ({ exitState: '{}' }),
    importUnilateralExitState: async () => ({ importedLeaves: 2, skippedForeignLeaves: 0, skippedConflictingLeaves: 0, skippedChains: 0 }),
  }),
}));

const props = {
  address: 'bcrt1qfund',
  isFunded: false,
  topUp: null,
  waitsForConfirmation: false,
  feeRate: 42,
  currentFeeRate: 24,
  networkFloorFeeRate: 30,
  quotedAt: null,
  error: null,
  isPaying: false,
  onTopUp: () => {},
};
const topUp = { neededSat: 7_856, sentSat: 3_000, stillToSendSat: 4_856 };

describe('FundStep', () => {
  it('asks for nothing before its build has tried what the exit holds', () => {
    render(<FundStep {...props} />);
    expect(screen.queryByTestId('unilateral-exit-funding-address')).not.toBeInTheDocument();
    expect(screen.getByText('Continue the exit at 42 sat/vB.')).toBeInTheDocument();
  });

  it('reports a build that failed for a reason more money cannot fix, its own words folded away', () => {
    render(<FundStep {...props} error="signing failed" />);
    expect(screen.getByText('Could not continue the exit')).toBeInTheDocument();
    expect(screen.getByText('Please try again.')).toBeInTheDocument();
    expect(screen.queryByText('signing failed')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('unilateral-exit-build-error')).getByText('Details'));
    expect(screen.getByTestId('unilateral-exit-build-error')).toHaveTextContent('signing failed');
  });

  it('shows what continuing now costs before anywhere to pay, since waiting is free', () => {
    const onTopUp = vi.fn();
    render(
      <FundStep
        {...props}
        topUp={topUp}
        onTopUp={onTopUp}
        error="Insufficient CPFP funding: need at least 5000 sats"
      />,
    );
    expect(screen.getByText('Exit fee at 42 sat/vB')).toBeInTheDocument();
    expect(screen.getByText("You've already sent").parentElement).toHaveTextContent('−');
    expect(screen.getByText('Network fees went up')).toBeInTheDocument();
    expect(screen.getByText(/continues on its own once fees drop/)).toHaveTextContent(/To continue now at 42 sat\/vB/);
    expect(screen.queryByTestId('unilateral-exit-funding-address')).not.toBeInTheDocument();
    expect(screen.queryByText(/Insufficient CPFP funding/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('unilateral-exit-top-up'));
    expect(onTopUp).toHaveBeenCalled();
  });

  it('does not blame the network for a rate the user picked', () => {
    // Exit built at 24, network still taking 24, the 42 is the user's own.
    render(<FundStep {...props} networkFloorFeeRate={24} topUp={topUp} />);

    expect(screen.getByText('More exit fee needed')).toBeInTheDocument();
    expect(screen.getByText('At 42 sat/vB, the exit needs more exit fee than its fee address holds.')).toBeInTheDocument();
    expect(screen.queryByText('Network fees went up')).toBeNull();
  });

  it('promises nothing about fees dropping where there is no network floor, as for a paused exit', () => {
    render(<FundStep {...props} networkFloorFeeRate={null} topUp={topUp} />);
    expect(screen.getByText('More exit fee needed')).toBeInTheDocument();
    expect(screen.queryByText(/continues on its own once fees drop/)).not.toBeInTheDocument();
  });

  describe('for a recovery', () => {
    it('asks for more exit fee in its own words', () => {
      render(<FundStep {...props} networkFloorFeeRate={24} topUp={topUp} noun="recovery" />);
      expect(screen.getByText('More exit fee needed')).toBeInTheDocument();
      expect(screen.getByText('At 42 sat/vB, the recovery needs more exit fee than its fee address holds.')).toBeInTheDocument();
    });

    it('says the recovery started at the lower rate when fees went up', () => {
      render(<FundStep {...props} topUp={topUp} noun="recovery" />);
      expect(screen.getByText(/^Your recovery started at 24 sat\/vB/)).toBeInTheDocument();
    });

    it('names the recovery before its build, where to pay, and when the build fails', () => {
      const { rerender } = render(<FundStep {...props} noun="recovery" />);
      expect(screen.getByText('Continue the recovery at 42 sat/vB.')).toBeInTheDocument();
      rerender(<FundStep {...props} topUp={topUp} isPaying noun="recovery" />);
      expect(screen.getByText('Send to Continue Recovery')).toBeInTheDocument();
      rerender(<FundStep {...props} error="signing failed" noun="recovery" />);
      expect(screen.getByText('Could not continue the recovery')).toBeInTheDocument();
    });
  });

  it('asks for the amount, with where to send it, once the user chooses to top up', () => {
    render(<FundStep {...props} topUp={topUp} isPaying />);
    expect(screen.getByText('Send to Continue Exit')).toBeInTheDocument();
    expect(screen.getAllByText(/4 856/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('unilateral-exit-funding-address')).toBeInTheDocument();
  });

  it('turns into the receipt once the address holds enough', () => {
    render(<FundStep {...props} topUp={{ ...topUp, sentSat: 7_856, stillToSendSat: 0 }} isFunded />);
    expect(screen.getByText('Exit fee received')).toBeInTheDocument();
    expect(screen.queryByTestId('unilateral-exit-funding-address')).not.toBeInTheDocument();
    expect(screen.queryByText('Still to send')).not.toBeInTheDocument();
    expect(screen.queryByTestId('unilateral-exit-pending-status')).not.toBeInTheDocument();
  });

  it('says why Continue Exit waits once the payment is on its way but not confirmed', () => {
    render(<FundStep {...props} topUp={{ ...topUp, sentSat: 7_856, stillToSendSat: 0 }} waitsForConfirmation />);
    expect(screen.getByText('Exit fee sent')).toBeInTheDocument();
    expect(screen.getByTestId('unilateral-exit-pending-status')).toHaveTextContent('Waiting for a confirmation');
  });
});

describe('FundingStatus', () => {
  it('says how old the quote is while it waits', () => {
    render(<FundingStatus quotedAt={Date.now() - 90_000} />);
    expect(screen.getByTestId('unilateral-exit-funding-status')).toHaveTextContent('Watching the address · quoted 1m ago');
  });
});

describe('PendingExitStep', () => {
  const step = (props: Partial<React.ComponentProps<typeof PendingExitStep>> = {}) =>
    render(
      <PendingExitStep
        pending={pendingExit()}
        coins={[]}
        nothingToExit={null}
        isStarting={false}
        startError={null}
        onCancel={() => {}}
        {...props}
      />,
    );

  it('asks for the quoted fee from another wallet', () => {
    step();
    expect(screen.getByText('Send from another wallet')).toBeInTheDocument();
    expect(screen.getAllByText(/5 898/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('unilateral-exit-funding-address')).toBeInTheDocument();
    expect(screen.getByTestId('unilateral-exit-pending-status')).toHaveTextContent('Waiting for your payment');
    expect(screen.queryByText(/You can close this/)).not.toBeInTheDocument();
  });

  it('asks only for the rest once part has arrived, with the second coin priced in', () => {
    step({ coins: [coin(3_000, false)] });
    // 68 vB at 2 sat/vB for the second coin.
    expect(screen.getAllByText(/3 034/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('unilateral-exit-pending-status')).toHaveTextContent('3 000 received');
  });

  it('stops asking once a payment covers the fee, before it confirms, so nobody pays twice', () => {
    step({ coins: [coin(5_898, false)] });
    expect(screen.getByText('Exit fee sent')).toBeInTheDocument();
    expect(screen.queryByTestId('unilateral-exit-funding-address')).not.toBeInTheDocument();
    expect(screen.getByTestId('unilateral-exit-pending-status')).toHaveTextContent('Waiting for a confirmation');
    expect(screen.getByText(/Come back to start the exit/)).toBeInTheDocument();
  });

  it('leaves starting to the button once the fee confirms', () => {
    step({ coins: [coin(5_898)] });
    expect(screen.getByText('Exit fee received')).toBeInTheDocument();
    expect(screen.queryByTestId('unilateral-exit-pending-status')).not.toBeInTheDocument();
  });

  it('shows the build while it runs, and why a start failed', () => {
    const { rerender } = step({ coins: [coin(5_898)], isStarting: true });
    expect(screen.getByText('Building and signing the exit...')).toBeInTheDocument();
    rerender(
      <PendingExitStep
        pending={pendingExit()}
        coins={[coin(5_898)]}
        nothingToExit={null}
        isStarting={false}
        startError="chain service unreachable"
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('Could not start the exit')).toBeInTheDocument();
  });

  it('sends the user back for a lower rate when nothing is worth exiting any more', () => {
    step({ coins: [coin(5_898)], nothingToExit: { reason: 'fees' } });
    expect(screen.getByText('Nothing is worth exiting right now')).toBeInTheDocument();
    expect(screen.queryByTestId('unilateral-exit-funding-address')).not.toBeInTheDocument();
  });

  describe('for a recovery', () => {
    it('names the recovery while it builds, while the fee confirms, and when the start fails', () => {
      const { rerender } = step({ coins: [coin(5_898)], isStarting: true, noun: 'recovery' });
      expect(screen.getByText('Building and signing the recovery...')).toBeInTheDocument();
      rerender(
        <PendingExitStep
          pending={pendingExit()}
          coins={[coin(5_898, false)]}
          nothingToExit={null}
          isStarting={false}
          startError={null}
          onCancel={() => {}}
          noun="recovery"
        />,
      );
      expect(screen.getByText('You can close this. Come back to start the recovery once the fee confirms.')).toBeInTheDocument();
      rerender(
        <PendingExitStep
          pending={pendingExit()}
          coins={[coin(5_898)]}
          nothingToExit={null}
          isStarting={false}
          startError="chain service unreachable"
          onCancel={() => {}}
          noun="recovery"
        />,
      );
      expect(screen.getByText('Could not start the recovery')).toBeInTheDocument();
    });

    it('says the funds, not the balance, are not worth recovering, and cancels the recovery', () => {
      step({ coins: [coin(5_898)], nothingToExit: { reason: 'fees' }, noun: 'recovery' });
      expect(screen.getByText('Nothing is worth recovering right now')).toBeInTheDocument();
      expect(
        screen.getByText(
          'At 2 sat/vB these funds would cost more to move on-chain than they are worth. Cancel the recovery under Advanced and start again at a lower rate. The fee you sent counts toward it.',
        ),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByText('Advanced'));
      expect(screen.getByTestId('unilateral-exit-cancel')).toHaveTextContent(/^Cancel recovery$/);
    });

    it('says a restore lets the recovery start', async () => {
      step({ noun: 'recovery' });
      fireEvent.click(screen.getByText('Advanced'));
      fireEvent.change(screen.getByTestId('unilateral-exit-backup-file'), {
        target: { files: [new File(['{"leaves":[]}'], 'exit-state.json')] },
      });
      await waitFor(() =>
        expect(screen.getByTestId('unilateral-exit-backup-result')).toHaveTextContent(/^Restored 2 leaves\. You can start the recovery\.$/),
      );
    });
  });

  it('keeps cancelling under Advanced, out of the way of paying', () => {
    const onCancel = vi.fn();
    step({ onCancel });
    expect(screen.queryByTestId('unilateral-exit-cancel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Advanced'));
    expect(screen.getByTestId('unilateral-exit-cancel')).toHaveTextContent(/^Cancel exit$/);
    fireEvent.click(screen.getByTestId('unilateral-exit-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});
