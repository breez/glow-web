import { useEffect, useRef } from 'react';
import { useSdkEvents } from '../contexts/WalletContext';

/** Fire `onReceived` when a payment delivered by the Orchestra order behind
 *  `quoteId` succeeds. Pass `null` to pause listening. */
export function useQuoteReceived(
  quoteId: string | null,
  onReceived: () => void,
): void {
  const subscribe = useSdkEvents();
  const onReceivedRef = useRef(onReceived);

  useEffect(() => {
    onReceivedRef.current = onReceived;
  }, [onReceived]);

  useEffect(() => {
    if (!quoteId) return;
    return subscribe((event) => {
      if (event.type !== 'paymentSucceeded') return;
      const details = event.payment.details;
      const info = details && 'conversionInfo' in details ? details.conversionInfo : undefined;
      if (info?.type === 'orchestra' && info.quoteId === quoteId) {
        onReceivedRef.current();
      }
    });
  }, [quoteId, subscribe]);
}
