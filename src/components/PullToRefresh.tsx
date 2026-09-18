import React, { useEffect, useState, type RefObject } from 'react';
import { RefreshIcon, SpinnerIcon } from './Icons';
import { useLatest } from '../hooks/useLatest';

/** Pull distance, after the drag's resistance, that refreshes on release. */
export const PULL_TRIGGER_PX = 64;
const PULL_MAX_PX = 96;
/** Capped like the foreground resync: a refresh that never settles would hold
 *  the spinner and refuse every later pull. */
export const REFRESH_CAP_MS = 30_000;

/**
 * Pull down on `scrollerRef` to refresh. Only a drag that starts with the list
 * at its top counts, so scrolling back up never refreshes. The drag state lives
 * here rather than in the page, so a pull re-renders the indicator alone.
 */
const PullToRefresh: React.FC<{
  scrollerRef: RefObject<HTMLElement | null>;
  onRefresh: () => Promise<unknown>;
}> = ({ scrollerRef, onRefresh }) => {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const onRefreshRef = useLatest(onRefresh);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let startY: number | null = null;
    let distance = 0;
    let busy = false;
    let cap: ReturnType<typeof setTimeout> | undefined;

    const start = (e: TouchEvent) => {
      startY = !busy && el.scrollTop <= 0 ? e.touches[0].clientY : null;
      distance = 0;
    };
    const move = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) {
        startY = null;
        setPull(0);
        return;
      }
      // Holds the list still while pulling; iOS would rubber-band it instead.
      e.preventDefault();
      distance = Math.min(PULL_MAX_PX, dy / 2);
      setPull(distance);
    };
    const cancel = () => {
      startY = null;
      setPull(0);
    };
    const end = () => {
      if (startY === null) return;
      cancel();
      if (distance < PULL_TRIGGER_PX) return;
      busy = true;
      setRefreshing(true);
      const capped = new Promise<void>(resolve => { cap = setTimeout(resolve, REFRESH_CAP_MS); });
      void Promise.race([onRefreshRef.current(), capped])
        .catch(() => undefined)
        .finally(() => {
          clearTimeout(cap);
          busy = false;
          setRefreshing(false);
        });
    };

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', cancel);
    return () => {
      clearTimeout(cap);
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', cancel);
    };
  }, [scrollerRef, onRefreshRef]);

  if (!pull && !refreshing) return null;
  const ready = pull >= PULL_TRIGGER_PX;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center"
      style={{ transform: `translateY(${refreshing ? 16 : pull - 40}px)` }}
      role="status"
      aria-label={refreshing ? 'Refreshing' : ready ? 'Release to refresh' : 'Pull to refresh'}
    >
      <span className="w-10 h-10 rounded-full bg-spark-surface border border-spark-border flex items-center justify-center text-spark-primary">
        {refreshing ? (
          <SpinnerIcon size="md" />
        ) : (
          <span className="flex" style={{ transform: `rotate(${pull * 4}deg)`, opacity: Math.min(1, pull / PULL_TRIGGER_PX) }}>
            <RefreshIcon size="md" />
          </span>
        )}
      </span>
    </div>
  );
};

export default PullToRefresh;
