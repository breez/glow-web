import React, { useMemo, useState } from 'react';
import type { LnurlPayRequestDetails, PrepareLnurlPayRequest, PrepareLnurlPayResponse } from '@breeztech/breez-sdk-spark';
import type { PaymentStep } from '../../../types/domain';
import { FormError, PrimaryButton, SecondaryButton } from '../../../components/ui';
import ConfirmStep from '../steps/ConfirmStep';
import { logger, LogCategory } from '@/services/logger';
import { SpinnerIcon } from '@/components/Icons';
import {
  TOKEN_QUICK_AMOUNTS,
  formatQuickAmount,
} from '../../../utils/tokenFormatting';
import CurrencySwitcher from '../../../components/ui/CurrencySwitcher';
import { useAmountInput } from '../../../hooks/useAmountInput';
import { useBalanceValidation } from '../hooks/useBalanceValidation';
import { useHasPendingConversion } from '../../../contexts/WalletContext';

interface LnurlWorkflowProps {
  parsed: LnurlPayRequestDetails;
  recipientLabel?: string;
  balanceSats?: number;
  tokenBalance?: bigint;
  onBack: () => void;
  onRun: (runner: () => Promise<void>, hasConversion?: boolean) => Promise<void>;
  onPrepare: (args: PrepareLnurlPayRequest) => Promise<PrepareLnurlPayResponse>;
  onPay: (prepareResponse: PrepareLnurlPayResponse) => Promise<void>;
}

const LnurlWorkflow: React.FC<LnurlWorkflowProps> = ({ parsed, recipientLabel, balanceSats, tokenBalance, onBack, onRun, onPrepare, onPay }) => {
  const input = useAmountInput({ balanceSats, tokenBalance });
  const {
    amountInput: amount,
    setAmount,
    setAmountInput,
    isTokenMode,
    setIsTokenMode,
    toggleDenomination,
    isStableBalanceActive,
    tokenIdentifier,
    tokenSymbol,
    config,
    tokenBalanceDisplay,
    formatSatsAsTokenDisplay,
    tokenSendAllBelowThreshold,
  } = input;

  const balance = useBalanceValidation(isTokenMode, setIsTokenMode, balanceSats, tokenBalance);
  const hasPendingConversion = useHasPendingConversion();

  const [step, setStep] = useState<PaymentStep>('amount');
  const [feesIncluded, setFeesIncluded] = useState(false);
  const [comment, setComment] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [prepareResponse, setPrepareResponse] = useState<PrepareLnurlPayResponse | null>(null);

  // derive constraints
  const minSats = useMemo(() => {
    const msat = parsed.minSendable ?? 0;
    return Math.ceil(msat / 1000);
  }, [parsed]);
  const maxSats = useMemo(() => {
    const msat = parsed.maxSendable ?? 0;
    return Math.max(1, Math.floor(msat / 1000));
  }, [parsed]);
  const commentMaxLen = parsed.commentAllowed ?? 0;
  const commentAllowed = commentMaxLen > 0;
  const sendAllAmount = useMemo(() => {
    if (balanceSats !== undefined && balanceSats > 0) return Math.min(balanceSats, maxSats);
    return null;
  }, [balanceSats, maxSats]);

  const hasTokenBalance = tokenBalance !== undefined && tokenBalance > 0n;

  // BTC balance expressed in the token (fiat) display unit, capped at maxSats
  // (LNURL upper bound) and gated by minSats. Uses the hook helper for
  // conversion + sub-threshold handling.
  const sendAllBtcInTokenDisplay = useMemo(() => {
    if (balanceSats === undefined || balanceSats <= 0) return null;
    const cappedSats = Math.min(balanceSats, maxSats);
    if (cappedSats < minSats) return null;
    return formatSatsAsTokenDisplay(cappedSats);
  }, [balanceSats, maxSats, minSats, formatSatsAsTokenDisplay]);

  const isSendAllToken = isTokenMode && hasTokenBalance && amount === tokenBalanceDisplay && feesIncluded;
  const isSendAllBtcInTokenMode = isTokenMode
    && !hasTokenBalance
    && sendAllBtcInTokenDisplay !== null
    && amount === sendAllBtcInTokenDisplay
    && feesIncluded;

  const description = useMemo(() => {
    const metadataArr = JSON.parse(parsed.metadataStr);
    for (let i = 0; i < metadataArr.length; i++) {
      if (metadataArr[i][0] === "text/plain") {
        return metadataArr[i][1];
      }
    }
    return parsed.url;
  }, [parsed]);

  const handleToggleDenomination = () => {
    toggleDenomination();
    setFeesIncluded(false);
  };

  // setError is only called in onAmountNext, so step changes don't
  // need a clearing effect; the confirm-back handler clears inline.
  const onAmountNext = async () => {
    if (commentAllowed && commentMaxLen && comment.length > commentMaxLen) {
      setError(`Comment must be at most ${commentMaxLen} characters`);
      return;
    }

    // Token send-all bypasses validation — amount goes directly as tokenBalance to the SDK
    if (isSendAllToken && tokenIdentifier && tokenBalance) {
      setIsLoading(true);
      setError(null);
      try {
        const resp = await onPrepare({
          amount: tokenBalance,
          comment: comment ? comment : undefined,
          payRequest: parsed,
          feePolicy: feesIncluded ? 'feesIncluded' : undefined,
          tokenIdentifier,
          conversionOptions: {
            conversionType: { type: 'toBitcoin', fromTokenIdentifier: tokenIdentifier },
          },
        });
        setPrepareResponse(resp);
        setStep('confirm');
      } catch (err) {
        logger.error(LogCategory.PAYMENT, 'Failed to prepare LNURL Pay', {
          error: err instanceof Error ? err.message : String(err),
        });
        setError(`Failed to prepare LNURL Pay: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // BTC send-all displayed in token mode — use the raw sats balance (capped
    // at maxSats) to avoid losing precision through fiat→sats round-tripping.
    if (isSendAllBtcInTokenMode && balanceSats !== undefined) {
      const cappedSats = Math.min(balanceSats, maxSats);
      setIsLoading(true);
      setError(null);
      try {
        const resp = await onPrepare({
          amount: BigInt(cappedSats),
          comment: comment ? comment : undefined,
          payRequest: parsed,
          feePolicy: 'feesIncluded',
        });
        setPrepareResponse(resp);
        setStep('confirm');
      } catch (err) {
        logger.error(LogCategory.PAYMENT, 'Failed to prepare LNURL Pay', {
          error: err instanceof Error ? err.message : String(err),
        });
        setError(`Failed to prepare LNURL Pay: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Validate input and balance
    const validationError = balance.validateAmount(amount, feesIncluded);
    if (validationError) {
      setError(validationError);
      return;
    }

    // Safe to parse — validateAmount already confirmed the input is valid
    const sats = balance.parseInputToSats(amount)!;

    // LNURL range constraints (sats mode only — token mode is validated by the SDK)
    if (!isTokenMode) {
      if (minSats && sats < minSats) {
        setError(`Amount must be at least ₿${minSats.toLocaleString()}`);
        return;
      }
      if (maxSats && sats > maxSats) {
        setError(`Amount must be at most ₿${maxSats.toLocaleString()}`);
        return;
      }
    }

    setIsLoading(true);
    setError(null);
    try {
      const resp = await onPrepare({
        amount: BigInt(sats),
        comment: comment ? comment : undefined,
        payRequest: parsed,
        feePolicy: feesIncluded ? 'feesIncluded' : undefined,
      });
      setPrepareResponse(resp);
      setStep('confirm');
    } catch (err) {
      logger.error(LogCategory.PAYMENT, 'Failed to prepare LNURL Pay', {
        error: err instanceof Error ? err.message : String(err),
      });
      setError(`Failed to prepare LNURL Pay: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const onConfirm = async () => {
    if (!prepareResponse) return;
    await onRun(() => onPay(prepareResponse), !!prepareResponse.conversionEstimate);
  };

  const feesSat: number | null = useMemo(() => {
    return prepareResponse?.feeSats ?? null;
  }, [prepareResponse]);

  // Extract conversion estimate from prepare response if available
  const conversionEstimate = useMemo(() => {
    if (!prepareResponse?.conversionEstimate) return null;
    return prepareResponse.conversionEstimate;
  }, [prepareResponse]);

  if (step === 'confirm' && prepareResponse) {
    const confirmAmountSats = isSendAllToken
      ? BigInt(prepareResponse.amountSats)
      : BigInt(balance.parseInputToSats(amount) || 0);
    return (
      <ConfirmStep amountSats={confirmAmountSats} feesSat={feesSat} feesIncluded={feesIncluded} conversionEstimate={conversionEstimate} balanceSats={balanceSats} tokenBalance={tokenBalance} error={error} isLoading={isLoading} onBack={() => { setPrepareResponse(null); setError(null); setStep('amount'); }} onConfirm={onConfirm} />
    );
  }

  const validAmount = isTokenMode
    ? amount !== '' && parseFloat(amount) > 0
    : amount !== '' && parseInt(amount) > 0;
  const amountNum = isTokenMode ? parseFloat(amount) || 0 : parseInt(amount) || 0;
  const isSendAllSats = !isStableBalanceActive && sendAllAmount !== null && amountNum === sendAllAmount && feesIncluded;
  const isSendAll = isSendAllSats || isSendAllToken || isSendAllBtcInTokenMode;

  // Inline balance error — surface "Amount exceeds available balance" as the
  // user types instead of waiting for Continue. Computed inline (not via
  // useMemo) because we're past the early-return for the confirm step and
  // can't add a Hook here without violating rules-of-hooks.
  const inlineBalanceError = amountNum > 0 && !isSendAll && balance.exceedsBalance(amountNum)
    ? 'Amount exceeds available balance'
    : null;

  // amount + optional comment form
  return (
    <div className="space-y-5">
      {/* Description */}
      <div className="text-center">
        <p className="text-spark-text-primary font-medium">{recipientLabel ?? description}</p>
      </div>

      {/* Amount input */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-spark-text-primary">
            Amount
          </label>
          {!isTokenMode && (
            <span className="text-xs text-spark-text-secondary">
              {minSats.toLocaleString('en-US').replace(/,/g, ' ')} – {maxSats.toLocaleString('en-US').replace(/,/g, ' ')}
            </span>
          )}
        </div>
        <div className="relative">
          <input
            type={isTokenMode ? 'text' : 'number'}
            inputMode={isTokenMode ? 'decimal' : 'numeric'}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setFeesIncluded(false);
            }}
            placeholder={isTokenMode && tokenSymbol
              ? `Enter amount in ${tokenSymbol}`
              : `Between ${minSats.toLocaleString('en-US').replace(/,/g, ' ')} and ${maxSats.toLocaleString('en-US').replace(/,/g, ' ')} sats`
            }
            className="w-full p-4 pr-16 bg-spark-dark border border-spark-border rounded-xl text-spark-text-primary placeholder-spark-text-muted focus:border-spark-electric focus:ring-2 focus:ring-spark-electric/20 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none read-only:cursor-not-allowed"
            disabled={isLoading}
            readOnly={isSendAll}
            min={isTokenMode ? undefined : minSats}
            max={isTokenMode ? undefined : maxSats}
          />
          {isStableBalanceActive && tokenSymbol && (
            <CurrencySwitcher
              isTokenMode={isTokenMode}
              tokenSymbol={tokenSymbol}
              onSwitch={handleToggleDenomination}
              disabled={isLoading}
            />
          )}
        </div>

        {/* Quick amount buttons */}
        <div className="flex gap-2 mt-3">
          {(isTokenMode ? TOKEN_QUICK_AMOUNTS : [1000, 10000, 100000].filter(v => v >= minSats && v <= maxSats)).map((quickAmount) => {
            const disabled = balance.exceedsBalance(quickAmount);
            const isSelected = amountNum === quickAmount && !isSendAll;
            return (
              <button
                key={quickAmount}
                onClick={() => { setAmountInput(String(quickAmount)); setFeesIncluded(false); }}
                disabled={disabled}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                  isSelected
                    ? 'bg-spark-primary text-white'
                    : disabled
                      ? 'opacity-40 cursor-not-allowed border border-spark-border text-spark-text-secondary'
                      : 'bg-transparent border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light'
                }`}
              >
                {formatQuickAmount(quickAmount, config, isTokenMode)}
              </button>
            );
          })}
          {(hasTokenBalance
            || sendAllBtcInTokenDisplay !== null
            || (sendAllAmount !== null && sendAllAmount >= minSats)) && (
            <button
              onClick={() => {
                if (!isTokenMode && sendAllAmount !== null) {
                  setAmountInput(String(sendAllAmount));
                } else if (hasTokenBalance && tokenBalanceDisplay) {
                  if (!isTokenMode) setIsTokenMode(true);
                  setAmountInput(tokenBalanceDisplay);
                } else if (sendAllBtcInTokenDisplay !== null) {
                  // In token mode without token balance — fill with BTC sats
                  // converted to fiat (capped at maxSats). Avoids dropping a
                  // raw sats integer into a fiat-denominated input.
                  setAmountInput(sendAllBtcInTokenDisplay);
                } else if (sendAllAmount !== null) {
                  setAmountInput(String(sendAllAmount));
                }
                setFeesIncluded(true);
              }}
              disabled={tokenSendAllBelowThreshold || hasPendingConversion}
              title={hasPendingConversion ? 'Balance is updating. Try again in a moment.' : undefined}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                tokenSendAllBelowThreshold || hasPendingConversion
                  ? 'opacity-40 cursor-not-allowed border border-spark-border text-spark-text-secondary'
                  : isSendAll
                    ? 'bg-spark-primary text-white'
                    : 'bg-transparent border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light'
              }`}
            >
              {hasPendingConversion ? (
                <span className="inline-flex items-center justify-center gap-1.5">
                  <SpinnerIcon size="xs" />
                  Send All
                </span>
              ) : 'Send All'}
            </button>
          )}
        </div>
      </div>

      {/* Optional comment */}
      {commentAllowed && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-spark-text-primary">Comment (optional)</label>
            <span className="text-xs text-spark-text-secondary">{comment.length}/{commentMaxLen}</span>
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a message..."
            className="w-full p-4 bg-spark-dark border border-spark-border rounded-xl text-spark-text-primary placeholder-spark-text-muted focus:border-spark-electric focus:ring-2 focus:ring-spark-electric/20 resize-none transition-all"
            rows={3}
            maxLength={commentMaxLen}
            disabled={isLoading}
          />
        </div>
      )}

      <FormError error={inlineBalanceError || error} />

      {/* Action buttons */}
      <div className="flex gap-3">
        <SecondaryButton onClick={onBack} disabled={isLoading} className="flex-1">
          Back
        </SecondaryButton>
        <PrimaryButton onClick={onAmountNext} disabled={isLoading || !validAmount || !!inlineBalanceError} className="flex-1">
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <SpinnerIcon />
              Processing...
            </span>
          ) : 'Continue'}
        </PrimaryButton>
      </div>
    </div>
  );
};

export default LnurlWorkflow;
