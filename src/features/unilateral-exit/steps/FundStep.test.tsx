import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FundStep, FundingStatus, PendingExitStep } from './FundStep';
import { coin, pendingExit } from '../testFixtures';

// The backup rows under Advanced read the connected wallet.
vi.mock('@/contexts/WalletContext', () => ({
  useWallet: () => ({ exportUnilateralExitState: async () => ({ exitState: '{}' }) }),
}));

const props = {
  address: 'bcrt1qfund',
  isFunded: false,
  topUp: null,
  feeRate: 42,
  currentFeeRate: 24,
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

  it('reports a build that failed for a reason more money cannot fix', () => {
    render(<FundStep {...props} error="signing failed" />);
    expect(screen.getByText(/signing failed/)).toBeInTheDocument();
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
        nothingToExit={false}
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
    expect(screen.getByText('Exit fee received')).toBeInTheDocument();
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
        nothingToExit={false}
        isStarting={false}
        startError="chain service unreachable"
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('Could not start the exit')).toBeInTheDocument();
  });

  it('sends the user back for a lower rate when nothing is worth exiting any more', () => {
    step({ coins: [coin(5_898)], nothingToExit: true });
    expect(screen.getByText('Nothing is worth exiting right now')).toBeInTheDocument();
    expect(screen.queryByTestId('unilateral-exit-funding-address')).not.toBeInTheDocument();
  });

  it('keeps cancelling under Advanced, out of the way of paying', () => {
    const onCancel = vi.fn();
    step({ onCancel });
    expect(screen.queryByTestId('unilateral-exit-cancel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.click(screen.getByTestId('unilateral-exit-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});
