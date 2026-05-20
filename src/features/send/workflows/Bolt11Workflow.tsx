import React from 'react';
import type { SendPaymentMethod, ConversionEstimate } from '@breeztech/breez-sdk-spark';
import ConfirmStep from '../steps/ConfirmStep';

interface Bolt11WorkflowProps {
  method: Extract<SendPaymentMethod, { type: 'bolt11Invoice' }>;
  amountSats: bigint;
  feesIncluded?: boolean;
  conversionEstimate?: ConversionEstimate | null;
  balanceSats?: number;
  tokenBalance?: bigint;
  onBack: () => void;
  onSend: (options: { type: 'bolt11Invoice'; preferSpark: boolean }) => Promise<void>;
}

const Bolt11Workflow: React.FC<Bolt11WorkflowProps> = ({ method, amountSats, feesIncluded, conversionEstimate, balanceSats, tokenBalance, onBack, onSend }) => {
  const handleSend = () => {
    const preferSpark = method.sparkTransferFeeSats != null;
    return onSend({ type: 'bolt11Invoice', preferSpark });
  };

  // Compute display fees from prepared response
  let feesSat: number | null = null;
  if (method.sparkTransferFeeSats != null) {
    feesSat = method.sparkTransferFeeSats;
  } else if (method.lightningFeeSats != null) {
    feesSat = method.lightningFeeSats;
  }

  return <ConfirmStep amountSats={amountSats} feesSat={feesSat} feesIncluded={feesIncluded} conversionEstimate={conversionEstimate} balanceSats={balanceSats} tokenBalance={tokenBalance} error={null} isLoading={false} onBack={onBack} onConfirm={handleSend} />;
};

export default Bolt11Workflow;
