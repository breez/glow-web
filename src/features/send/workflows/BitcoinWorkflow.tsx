import React, { useState } from 'react';
import type { SendPaymentMethod, ConversionEstimate } from '@breeztech/breez-sdk-spark';
import type { PaymentStep } from '../../../types/domain';
import { PrimaryButton } from '../../../components/ui';
import { useSheetBack } from '../../../components/ui/sheets/BottomSheetCardContext';
import { FeeRateSelector, type FeeSpeed } from '../../../components/FeeRateSelector';
import ConfirmStep from '../steps/ConfirmStep';
import { SatAmount } from '../../../components/SatAmount';
import { getSendDestination } from '../utils';

interface BitcoinWorkflowProps {
  method: Extract<SendPaymentMethod, { type: 'bitcoinAddress' }>;
  amountSats: bigint;
  feesIncluded?: boolean;
  conversionEstimate?: ConversionEstimate | null;
  balanceSats?: number;
  tokenBalance?: bigint;
  onBack: () => void;
  onSend: (options: { type: 'bitcoinAddress'; confirmationSpeed: 'fast' | 'medium' | 'slow' }) => Promise<void>;
}

const BitcoinWorkflow: React.FC<BitcoinWorkflowProps> = ({ method, amountSats, feesIncluded, conversionEstimate, balanceSats, tokenBalance, onBack, onSend }) => {
  const [step, setStep] = useState<PaymentStep>('fee');
  // Fee selection happens here; processing/result are handled by parent
  const [selectedFeeRate, setSelectedFeeRate] = useState<FeeSpeed | null>(null);
  // The confirm step's ConfirmStep lends its own.
  useSheetBack(step === 'fee' ? onBack : undefined);

  const handleSend = async () => {
    if (!selectedFeeRate) return;
    await onSend({ type: 'bitcoinAddress', confirmationSpeed: selectedFeeRate });
  };

  // Compute fees from prepared response and selected rate
  const fq = method.feeQuote;
  const feeFor = (speed: FeeSpeed) => {
    const quote = speed === 'fast' ? fq.speedFast : speed === 'medium' ? fq.speedMedium : fq.speedSlow;
    return quote.l1BroadcastFeeSat + quote.userFeeSat;
  };
  const feesSat = selectedFeeRate ? feeFor(selectedFeeRate) : null;

  return (
    <>
      {/* Fee selection */}
      {step === 'fee' && (
        <>
          <div className="mb-4">
            <FeeRateSelector
              selected={selectedFeeRate}
              onSelect={setSelectedFeeRate}
              detail={speed => <SatAmount sats={feeFor(speed)} />}
            />
          </div>
          <PrimaryButton
            onClick={() => setStep('confirm')}
            className="w-full"
            disabled={!selectedFeeRate}
          >
            Continue
          </PrimaryButton>
        </>
      )}

      {/* Confirm */}
      {step === 'confirm' && (
        <ConfirmStep amountSats={amountSats} feesSat={feesSat} feesIncluded={feesIncluded} conversionEstimate={conversionEstimate} balanceSats={balanceSats} tokenBalance={tokenBalance} destination={getSendDestination(method)} error={null} isLoading={false} onBack={onBack} onConfirm={handleSend} />
      )}
    </>
  );
};

export default BitcoinWorkflow;
