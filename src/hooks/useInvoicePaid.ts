import { useEffect, useRef } from 'react';
import { useSdkEvents } from '../contexts/WalletContext';

/**
 * Fire `onPaid` when a `paymentSucceeded` event arrives for the given
 * Lightning invoice (bolt11). Pass `null`/`undefined` to pause listening.
 *
 * Uses the app-wide SDK event bus, so no SDK-level listener is created.
 */
export function useInvoicePaid(
  bolt11: string | null | undefined,
  onPaid: () => void,
): void {
  const subscribe = useSdkEvents();
  const onPaidRef = useRef(onPaid);

  useEffect(() => {
    onPaidRef.current = onPaid;
  }, [onPaid]);

  useEffect(() => {
    if (!bolt11) return;
    const target = bolt11.toLowerCase();

    return subscribe((event) => {
      if (event.type !== 'paymentSucceeded') return;
      const details = event.payment.details;
      if (!details || details.type !== 'lightning') return;
      if (details.invoice.toLowerCase() === target) {
        onPaidRef.current();
      }
    });
  }, [bolt11, subscribe]);
}
