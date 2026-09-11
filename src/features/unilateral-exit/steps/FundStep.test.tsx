import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FundStep, FundingStatus } from './FundStep';

const props = {
  address: 'bcrt1qfund',
  requiredSat: 5_898,
  isFunded: false,
  hasPendingDeposit: false,
  isResuming: false,
  topUp: null,
  isFeeBudgetFixed: false,
  feeRate: 2,
  currentFeeRate: null,
  quotedAt: null,
  error: null,
  isPaying: false,
  onTopUp: () => {},
};
const resumed = { ...props, isResuming: true, feeRate: 42, currentFeeRate: 24 };
const topUp = { neededSat: 7_856, sentSat: 3_000, stillToSendSat: 4_856 };

describe('FundStep', () => {
  it('names the amount a fresh exit needs', () => {
    render(<FundStep {...props} />);
    expect(screen.getAllByText(/5 898/).length).toBeGreaterThan(0);
  });

  it('reports a failed build, since the button that starts it is here', () => {
    render(<FundStep {...props} error="signing failed" />);
    expect(screen.getByText(/signing failed/)).toBeInTheDocument();
  });

  it('asks a resumed exit for nothing before its build has tried what it holds', () => {
    render(<FundStep {...resumed} />);
    expect(screen.queryByTestId('unilateral-exit-funding-address')).not.toBeInTheDocument();
    expect(screen.queryByText(/5 898/)).not.toBeInTheDocument();
  });

  it('shows what continuing now costs before anywhere to pay, since waiting is free', () => {
    const onTopUp = vi.fn();
    render(
      <FundStep
        {...resumed}
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
    render(<FundStep {...resumed} topUp={topUp} isPaying />);
    expect(screen.getByText('Send to Continue Exit')).toBeInTheDocument();
    expect(screen.getAllByText(/4 856/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('unilateral-exit-funding-address')).toBeInTheDocument();
  });

  it('turns into the receipt once the address holds enough', () => {
    render(<FundStep {...resumed} topUp={{ ...topUp, sentSat: 7_856, stillToSendSat: 0 }} isFunded />);
    expect(screen.getByText('Exit fee received')).toBeInTheDocument();
    expect(screen.queryByTestId('unilateral-exit-funding-address')).not.toBeInTheDocument();
    expect(screen.queryByText('Still to send')).not.toBeInTheDocument();
  });

  it('points to a lower rate once the fee coins are fixed, since more money cannot help', () => {
    render(<FundStep {...resumed} topUp={topUp} isFeeBudgetFixed />);
    expect(screen.getByText(/sending more cannot raise it/)).toBeInTheDocument();
    expect(screen.queryByTestId('unilateral-exit-funding-address')).not.toBeInTheDocument();
  });

  it('asks a fresh exit for the gap too, since its quote is only a lower bound', () => {
    render(<FundStep {...props} topUp={{ neededSat: 6_236, sentSat: 5_898, stillToSendSat: 338 }} />);
    expect(screen.getByText('Send to Exit Spark')).toBeInTheDocument();
    expect(screen.getByText('The exit needs more')).toBeInTheDocument();
    expect(screen.queryByText(/fees went up/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/338/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('unilateral-exit-funding-address')).toBeInTheDocument();
  });
});

describe('FundingStatus', () => {
  it('says how old the quote is while it waits', () => {
    render(<FundingStatus {...resumed} quotedAt={Date.now() - 90_000} />);
    expect(screen.getByTestId('unilateral-exit-funding-status')).toHaveTextContent('Watching the address · quoted 1m ago');
  });

  it("does not call the exit's own unconfirmed transactions a deposit", () => {
    render(<FundingStatus {...resumed} hasPendingDeposit />);
    expect(screen.getByTestId('unilateral-exit-funding-status')).toHaveTextContent('Watching the address');
  });

});
