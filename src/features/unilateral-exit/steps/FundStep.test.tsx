import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FundStep } from './FundStep';

const props = {
  address: 'bcrt1qfund',
  requiredSat: 5_898,
  fundedSat: 0,
  isFunded: false,
  hasPendingDeposit: false,
  isResuming: false,
  requiredFundingSat: null,
  isFeeBudgetFixed: false,
  error: null,
};

describe('FundStep', () => {
  it('names the amount a fresh exit needs', () => {
    render(<FundStep {...props} />);
    expect(screen.getAllByText(/5 898/).length).toBeGreaterThan(0);
  });

  it('reports a failed build, since the button that starts it is here', () => {
    render(<FundStep {...props} error="signing failed" />);
    expect(screen.getByText(/signing failed/)).toBeInTheDocument();
  });

  it('does not quote a fresh exit price to an exit already under way', () => {
    // Most of a resumed exit is already on-chain, so the quote's figure would
    // ask for money the remaining work does not need.
    render(<FundStep {...props} isResuming fundedSat={3_905} isFunded />);
    expect(screen.queryByText(/5 898/)).not.toBeInTheDocument();
    expect(screen.getByText(/already at this address/i)).toBeInTheDocument();
  });

  it('asks a resumed exit for the gap its build named, instead of the raw error', () => {
    render(
      <FundStep
        {...props}
        isResuming
        fundedSat={3_000}
        requiredFundingSat={5_000}
        error="Insufficient CPFP funding: need at least 5000 sats"
      />,
    );
    expect(screen.getByText('Add to exit fee')).toBeInTheDocument();
    expect(screen.getAllByText(/2 000/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Insufficient CPFP funding/)).not.toBeInTheDocument();
  });

  it('asks for a lower fee rate once the fee coins are fixed, since more money cannot help', () => {
    render(<FundStep {...props} isResuming fundedSat={3_000} requiredFundingSat={5_000} isFeeBudgetFixed />);
    expect(screen.getByText('This fee rate is too high')).toBeInTheDocument();
    expect(screen.queryByText('Add to exit fee')).not.toBeInTheDocument();
  });

  it('asks a fresh exit for the gap too, since its quote is only a lower bound', () => {
    render(<FundStep {...props} fundedSat={5_898} requiredFundingSat={6_100} error="Insufficient CPFP funding: need at least 6100 sats" />);
    expect(screen.getByText('Add to exit fee')).toBeInTheDocument();
    expect(screen.getAllByText(/202/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('unilateral-exit-funding-address')).toBeInTheDocument();
  });
});
