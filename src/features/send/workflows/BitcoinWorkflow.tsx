import React, { useState } from 'react';
import type { SendPaymentMethod } from '@breeztech/breez-sdk-spark';
import type { PaymentStep } from '../../../types/domain';
import { PrimaryButton, StepPanelGroup, StepPanel } from '../../../components/ui';
import ConfirmStep from '../steps/ConfirmStep';

interface BitcoinWorkflowProps {
  method: Extract<SendPaymentMethod, { type: 'bitcoinAddress' }>;
  amountSats: bigint;
  onBack: () => void;
  onSend: (options: { type: 'bitcoinAddress'; confirmationSpeed: 'fast' | 'medium' | 'slow' }) => Promise<void>;
}

const BitcoinWorkflow: React.FC<BitcoinWorkflowProps> = ({ method, amountSats, onBack, onSend }) => {
  const [step, setStep] = useState<PaymentStep>('fee');
  // Fee selection happens here; processing/result are handled by parent
  const [selectedFeeRate, setSelectedFeeRate] = useState<'fast' | 'medium' | 'slow' | null>(null);

  const handleSend = async () => {
    if (!selectedFeeRate) return;
    await onSend({ type: 'bitcoinAddress', confirmationSpeed: selectedFeeRate });
  };

  // Compute fees from prepared response and selected rate
  const fq = method.feeQuote;
  let feesSat: number | null = null;
  if (selectedFeeRate) {
    const selected = selectedFeeRate === 'fast' ? fq.speedFast : selectedFeeRate === 'medium' ? fq.speedMedium : fq.speedSlow;
    feesSat = selected.l1BroadcastFeeSat + selected.userFeeSat;
  }

  return (
    <StepPanelGroup>
      {/* Fee selection */}
      <StepPanel isActive={step === 'fee'}>
        <div className="mb-4">
          <label className="block text-sm font-medium text-[rgb(var(--text-white))] mb-2">Select Fee Rate</label>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setSelectedFeeRate('slow')}
              disabled={false}
              className={`relative p-3 rounded-lg border text-sm font-medium transition-colors ${selectedFeeRate === 'slow'
                ? 'bg-[rgb(var(--primary-blue))] text-white border-[rgb(var(--primary-blue))] ring-2 ring-[rgb(var(--primary-blue))]'
                : 'bg-[rgb(var(--card-bg))] text-[rgb(var(--text-white))] border-[rgb(var(--card-border))] hover:border-[rgb(var(--primary-blue))]'
                }`}
            >
              {selectedFeeRate === 'slow' && (
                <svg className="absolute top-2 right-2 w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414l2.293 2.293 6.543-6.543a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
              <div>Slow</div>
              <div className="text-xs opacity-70">{fq.speedSlow.l1BroadcastFeeSat + fq.speedSlow.userFeeSat} sats</div>
            </button>
            <button
              onClick={() => setSelectedFeeRate('medium')}
              disabled={false}
              className={`relative p-3 rounded-lg border text-sm font-medium transition-colors ${selectedFeeRate === 'medium'
                ? 'bg-[rgb(var(--primary-blue))] text-white border-[rgb(var(--primary-blue))] ring-2 ring-[rgb(var(--primary-blue))]'
                : 'bg-[rgb(var(--card-bg))] text-[rgb(var(--text-white))] border-[rgb(var(--card-border))] hover:border-[rgb(var(--primary-blue))]'
                }`}
            >
              {selectedFeeRate === 'medium' && (
                <svg className="absolute top-2 right-2 w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414l2.293 2.293 6.543-6.543a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
              <div>Medium</div>
              <div className="text-xs opacity-70">{fq.speedMedium.l1BroadcastFeeSat + fq.speedMedium.userFeeSat} sats</div>
            </button>
            <button
              onClick={() => setSelectedFeeRate('fast')}
              disabled={false}
              className={`relative p-3 rounded-lg border text-sm font-medium transition-colors ${selectedFeeRate === 'fast'
                ? 'bg-[rgb(var(--primary-blue))] text-white border-[rgb(var(--primary-blue))] ring-2 ring-[rgb(var(--primary-blue))]'
                : 'bg-[rgb(var(--card-bg))] text-[rgb(var(--text-white))] border-[rgb(var(--card-border))] hover:border-[rgb(var(--primary-blue))]'
                }`}
            >
              {selectedFeeRate === 'fast' && (
                <svg className="absolute top-2 right-2 w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414l2.293 2.293 6.543-6.543a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
              <div>Fast</div>
              <div className="text-xs opacity-70">{fq.speedFast.l1BroadcastFeeSat + fq.speedFast.userFeeSat} sats</div>
            </button>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <PrimaryButton onClick={onBack} className="flex-1 bg-gray-600 hover:bg-gray-700 text-white p-3 rounded-lg" disabled={false}>
            Back
          </PrimaryButton>
          <PrimaryButton
            onClick={() => setStep('confirm')}
            className="flex-1"
            disabled={!selectedFeeRate}
          >
            Continue
          </PrimaryButton>
        </div>
      </StepPanel>
      {/* Confirm */}
      <StepPanel isActive={step === 'confirm'}>
        <ConfirmStep amountSats={amountSats} feesSat={feesSat} error={null} isLoading={false} onConfirm={handleSend} />
      </StepPanel>
    </StepPanelGroup>
  );
};

export default BitcoinWorkflow;
