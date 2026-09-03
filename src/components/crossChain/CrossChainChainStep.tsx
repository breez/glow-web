import React, { useState } from 'react';
import type { CrossChainRoutePair } from '@breeztech/breez-sdk-spark';
import { PrimaryButton, SecondaryButton } from '../ui';
import CryptoIcon from '../CryptoIcon';
import { ChevronDownIcon, CopyFilledIcon, CheckIcon } from '../Icons';
import { crossChainCardClass } from '../../utils/crossChainRoutes';
import { formatChainName } from '../../utils/crossChainFormat';
import { copyToClipboard } from '../../utils/clipboard';
import { useSheetFullSnap } from '../ui/sheets/BottomSheetCardContext';

interface CrossChainChainStepProps {
  /** One representative route per chain group, in display order. */
  chains: CrossChainRoutePair[];
  /** Resolves a route to its chain group key (the value used for `pending`). */
  chainGroupKey: (route: CrossChainRoutePair) => string;
  /** Selected display asset, shown in the step label. */
  selectedAsset: string | null;
  /** Currently highlighted chain group key, or null. */
  pending: string | null;
  onPendingChange: (key: string) => void;
  onBack: () => void;
  onContinue: () => void;
  error?: string | null;
  /** Fill the parent's height (for a fixed-height container) instead of capping
   *  against the viewport. Keeps the receive sheet a constant height across steps. */
  fill?: boolean;
}

/** Network-selection step shared by the cross-chain send and receive workflows.
 *  Expand/copy state for the contract-address disclosure is local to the step. */
export const CrossChainChainStep: React.FC<CrossChainChainStepProps> = ({
  chains,
  chainGroupKey,
  selectedAsset,
  pending,
  onPendingChange,
  onBack,
  onContinue,
  error,
  fill = false,
}) => {
  const [expandedChain, setExpandedChain] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const isSheetFull = useSheetFullSnap();

  return (
    <div
      className={`flex flex-col ${fill ? 'flex-1 min-h-0' : ''}`}
      style={fill ? undefined : { maxHeight: isSheetFull ? '85dvh' : '60dvh' }}
    >
      {error && (
        <div className="mb-4 p-3 bg-spark-warn-surface border border-spark-warn-border rounded-xl text-sm text-spark-warn-text shrink-0">
          {error}
        </div>
      )}
      <label className="block text-sm font-medium text-spark-text-primary mb-2 shrink-0">
        Select Network for {selectedAsset}
      </label>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-none touch-pan-y space-y-2 pr-1">
        {chains.map(r => {
          const key = chainGroupKey(r);
          const isExpanded = expandedChain === key;
          const isCopied = copiedAddress === key;
          return (
            <div
              key={key}
              onClick={() => onPendingChange(key)}
              className={`${crossChainCardClass(pending === key)} cursor-pointer`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CryptoIcon chain={r.chain} size={32} />
                  <span className="font-display font-medium text-spark-text-primary">
                    {formatChainName(r.chain)}
                  </span>
                </div>
                {r.contractAddress && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setExpandedChain(isExpanded ? null : key); }}
                    className="p-1 text-spark-primary hover:text-spark-primary-light transition-colors"
                  >
                    <ChevronDownIcon size="sm" className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>
                )}
              </div>
              {isExpanded && r.contractAddress && (
                <div className="mt-2 bg-spark-surface border border-spark-border/50 rounded-lg p-2.5 flex items-center justify-between gap-2">
                  <code className="text-spark-text-secondary font-mono text-xs break-all">{r.contractAddress}</code>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void copyToClipboard(r.contractAddress!);
                      setCopiedAddress(key);
                      setTimeout(() => setCopiedAddress(null), 2000);
                    }}
                    className="shrink-0 p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    {isCopied
                      ? <CheckIcon size="sm" className="text-spark-success" />
                      : <CopyFilledIcon size="sm" className="text-spark-text-secondary" />
                    }
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-3 shrink-0 pt-2">
        <SecondaryButton onClick={onBack} className="flex-1">
          Back
        </SecondaryButton>
        <PrimaryButton onClick={onContinue} className="flex-1" disabled={!pending}>
          Continue
        </PrimaryButton>
      </div>
    </div>
  );
};

export default CrossChainChainStep;
