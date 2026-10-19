import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AppErrorBoundary from './AppErrorBoundary';

const Throw = (): never => {
  throw new Error('boom');
};

describe('AppErrorBoundary', () => {
  afterEach(() => {
    document.getElementById('splash')?.remove();
    vi.restoreAllMocks();
  });

  it('removes the splash and names a crash during startup', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const splash = document.createElement('div');
    splash.id = 'splash';
    document.body.appendChild(splash);

    render(<AppErrorBoundary><Throw /></AppErrorBoundary>);

    expect(document.getElementById('splash')).toBeNull();
    expect(screen.getByText('Could not open Glow')).toBeTruthy();
  });

  it('names a crash after startup', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<AppErrorBoundary><Throw /></AppErrorBoundary>);

    expect(screen.getByText('Glow stopped working')).toBeTruthy();
  });
});
