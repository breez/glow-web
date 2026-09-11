import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ResultStep from './ResultStep';

const renderAuthFailure = (error: string) =>
  render(<ResultStep result="failure" operationType="auth" error={error} onClose={vi.fn()} />);

describe('ResultStep auth failure', () => {
  it("doesn't call the login failed when Glow couldn't read the reply", () => {
    renderAuthFailure('Operation failed: Network error: Request error: error sending request : JsValue(TypeError: Failed to fetch');
    expect(screen.getByText('Authentication Not Confirmed')).toBeInTheDocument();
    expect(screen.queryByText('Authentication Failed')).not.toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
  });

  it('keeps the failure and its reason when the service reports an error', () => {
    renderAuthFailure('Operation failed: Invalid signature');
    expect(screen.getByText('Authentication Failed')).toBeInTheDocument();
    expect(screen.getByText(/Invalid signature/)).toBeInTheDocument();
  });
});
