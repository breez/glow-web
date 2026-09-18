import { describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PullToRefresh from './PullToRefresh';

function Harness({ onRefresh }: { onRefresh: () => Promise<unknown> }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} data-testid="list">
      <PullToRefresh scrollerRef={ref} onRefresh={onRefresh} />
    </div>
  );
}

const drag = (el: HTMLElement, fromY: number, toY: number) => {
  fireEvent.touchStart(el, { touches: [{ clientY: fromY }] });
  fireEvent.touchMove(el, { touches: [{ clientY: toY }] });
  fireEvent.touchEnd(el);
};

describe('PullToRefresh', () => {
  it('refreshes on a long pull from the top, not on a short one or a scroll back up', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<Harness onRefresh={onRefresh} />);
    const list = screen.getByTestId('list');

    drag(list, 300, 100);
    drag(list, 100, 150);
    expect(onRefresh).not.toHaveBeenCalled();

    drag(list, 100, 300);
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it('ignores a pull that starts with the list scrolled down', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<Harness onRefresh={onRefresh} />);
    const list = screen.getByTestId('list');
    Object.defineProperty(list, 'scrollTop', { value: 40, configurable: true });

    drag(list, 100, 300);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
