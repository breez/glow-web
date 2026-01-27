import React from 'react';
import type { SendPaymentMethod } from '@breeztech/breez-sdk-spark';
import ConfirmStep from '../steps/ConfirmStep';

interface SparkWorkflowProps {
  method: Extract<SendPaymentMethod, { type: 'sparkAddress' }>;
  amountSats: bigint;
  onBack: () => void;
  onSend: (options?: Record<string, unknown>) => Promise<void>;
}

const SparkWorkflow: React.FC<SparkWorkflowProps> = ({ method, amountSats, onSend }) => {
  // Currently no fee exposed for spark address
  const feesSat: number | null = method.type === 'sparkAddress' ? null : null;
  const handleSend = () => onSend();
  return <ConfirmStep amountSats={amountSats} feesSat={feesSat} error={null} isLoading={false} onConfirm={handleSend} />;
};

export default SparkWorkflow;
