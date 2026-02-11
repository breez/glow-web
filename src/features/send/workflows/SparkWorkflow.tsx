import React from 'react';
import type { SendPaymentMethod, SendPaymentOptions } from '@breeztech/breez-sdk-spark';
import ConfirmStep from '../steps/ConfirmStep';

interface SparkWorkflowProps {
  method: Extract<SendPaymentMethod, { type: 'sparkAddress' }>;
  amountSats: bigint;
  feesIncluded?: boolean;
  onBack: () => void;
  onSend: (options?: SendPaymentOptions) => Promise<void>;
}

const SparkWorkflow: React.FC<SparkWorkflowProps> = ({ method, amountSats, feesIncluded, onSend }) => {
  // Currently no fee exposed for spark address
  const feesSat: number | null = method.type === 'sparkAddress' ? null : null;
  const handleSend = () => onSend();
  return <ConfirmStep amountSats={amountSats} feesSat={feesSat} feesIncluded={feesIncluded} error={null} isLoading={false} onConfirm={handleSend} />;
};

export default SparkWorkflow;
