import React from 'react';
import type { SendPaymentMethod, SendPaymentOptions, ConversionEstimate } from '@breeztech/breez-sdk-spark';
import ConfirmStep from '../steps/ConfirmStep';

interface SparkWorkflowProps {
  method: Extract<SendPaymentMethod, { type: 'sparkAddress' }>;
  amountSats: bigint;
  feesIncluded?: boolean;
  conversionEstimate?: ConversionEstimate | null;
  balanceSats?: number;
  tokenBalance?: bigint;
  onBack: () => void;
  onSend: (options?: SendPaymentOptions) => Promise<void>;
}

const SparkWorkflow: React.FC<SparkWorkflowProps> = ({ method, amountSats, feesIncluded, conversionEstimate, balanceSats, tokenBalance, onBack, onSend }) => {
  // Currently no fee exposed for spark address
  const feesSat: number | null = method.type === 'sparkAddress' ? null : null;
  const handleSend = () => onSend();
  return <ConfirmStep amountSats={amountSats} feesSat={feesSat} feesIncluded={feesIncluded} conversionEstimate={conversionEstimate} balanceSats={balanceSats} tokenBalance={tokenBalance} error={null} isLoading={false} onBack={onBack} onConfirm={handleSend} />;
};

export default SparkWorkflow;
