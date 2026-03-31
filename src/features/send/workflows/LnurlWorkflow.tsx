import React, { useEffect, useMemo, useState } from 'react';
import type { LnurlPayRequestDetails, PrepareLnurlPayRequest, PrepareLnurlPayResponse } from '@breeztech/breez-sdk-spark';
import type { PaymentStep } from '../../../types/domain';
import { FormError, PrimaryButton, SecondaryButton } from '../../../components/ui';
import ConfirmStep from '../steps/ConfirmStep';
import { logger, LogCategory } from '@/services/logger';
import { SpinnerIcon } from '@/components/Icons';
import { useStableBalance } from '../../../contexts/StableBalanceContext';
import { TOKEN_QUICK_AMOUNTS, sanitizeTokenInput, formatQuickAmount } from '../../../utils/tokenFormatting';
import CurrencySwitcher from '../../../components/ui/CurrencySwitcher';
import { useBalanceValidation } from '../hooks/useBalanceValidation';

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
  const stableBalance = useStableBalance();
  const hasTokenConfig = !!stableBalance.displayConfig;
  const [isTokenMode, setIsTokenMode] = useState(stableBalance.isActive && hasTokenConfig);
  const balance = useBalanceValidation(isTokenMode, setIsTokenMode, balanceSats, tokenBalance);

  const [step, setStep] = useState<PaymentStep>('amount');
  const [amount, setAmount] = useState<string>('');
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

  // Token send-all: format token balance as display string using BigInt math
  // (matches formatTokenAmount used by the balance header)
  const tokenBalanceDisplay = useMemo(() => {
    if (!tokenBalance || !stableBalance.displayConfig) return null;
    const { decimals, fractionSize } = stableBalance.displayConfig;
    const divisor = BigInt(10 ** decimals);
    const wholePart = tokenBalance / divisor;
    const fractionalPart = tokenBalance % divisor;
    const fractionalStr = fractionalPart.toString().padStart(decimals, '0').slice(0, fractionSize);
    return `${wholePart}.${fractionalStr}`;
  }, [tokenBalance, stableBalance.displayConfig]);

  const hasTokenBalance = tokenBalance !== undefined && tokenBalance > 0n;
  const isSendAllToken = isTokenMode && hasTokenBalance && amount === tokenBalanceDisplay && feesIncluded;
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
    balance.setIsTokenMode?.(!isTokenMode);
    setAmount('');
    setFeesIncluded(false);
  };

  useEffect(() => {
    setError(null);
  }, [step]);

  const onAmountNext = async () => {
    if (commentAllowed && commentMaxLen && comment.length > commentMaxLen) {
      setError(`Comment must be at most ${commentMaxLen} characters`);
      return;
    }

    // Token send-all bypasses validation — amount goes directly as tokenBalance to the SDK
    if (isSendAllToken && stableBalance.tokenIdentifier && tokenBalance) {
      setIsLoading(true);
      setError(null);
      try {
        const resp = await onPrepare({
          amount: tokenBalance,
          comment: comment ? comment : undefined,
          payRequest: parsed,
          feePolicy: feesIncluded ? 'feesIncluded' : undefined,
          tokenIdentifier: stableBalance.tokenIdentifier,
          conversionOptions: {
            conversionType: { type: 'toBitcoin', fromTokenIdentifier: stableBalance.tokenIdentifier },
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
      <ConfirmStep amountSats={confirmAmountSats} feesSat={feesSat} feesIncluded={feesIncluded} conversionEstimate={conversionEstimate} balanceSats={balanceSats} tokenBalance={tokenBalance} error={error} isLoading={isLoading} onBack={() => { setPrepareResponse(null); setStep('amount'); }} onConfirm={onConfirm} />
    );
  }

  const validAmount = isTokenMode
    ? amount !== '' && parseFloat(amount) > 0
    : amount !== '' && parseInt(amount) > 0;
  const amountNum = isTokenMode ? parseFloat(amount) || 0 : parseInt(amount) || 0;
  const isSendAllSats = !stableBalance.isActive && sendAllAmount !== null && amountNum === sendAllAmount && feesIncluded;
  const isSendAll = isSendAllSats || isSendAllToken;

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
              if (isTokenMode && balance.config) {
                const sanitized = sanitizeTokenInput(e.target.value, balance.config.fractionSize);
                if (sanitized !== null) {
                  setAmount(sanitized);
                  setFeesIncluded(false);
                }
              } else {
                setAmount(e.target.value);
                setFeesIncluded(false);
              }
            }}
            placeholder={isTokenMode && balance.config
              ? `Enter amount in ${balance.config.symbol}`
              : `Between ${minSats.toLocaleString('en-US').replace(/,/g, ' ')} and ${maxSats.toLocaleString('en-US').replace(/,/g, ' ')} sats`
            }
            className="w-full p-4 pr-16 bg-spark-dark border border-spark-border rounded-xl text-spark-text-primary placeholder-spark-text-muted focus:border-spark-electric focus:ring-2 focus:ring-spark-electric/20 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            disabled={isLoading}
            min={isTokenMode ? undefined : minSats}
            max={isTokenMode ? undefined : maxSats}
          />
          {hasTokenConfig && balance.config && (
            <CurrencySwitcher
              isTokenMode={isTokenMode}
              tokenSymbol={balance.config.symbol}
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
                onClick={() => { setAmount(String(quickAmount)); setFeesIncluded(false); }}
                disabled={disabled}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                  isSelected
                    ? 'bg-spark-primary text-white'
                    : disabled
                      ? 'opacity-40 cursor-not-allowed border border-spark-border text-spark-text-secondary'
                      : 'bg-transparent border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light'
                }`}
              >
                {formatQuickAmount(quickAmount, balance.config, isTokenMode)}
              </button>
            );
          })}
          {(hasTokenBalance || (!stableBalance.isActive && sendAllAmount !== null && sendAllAmount >= minSats)) && (
            <button
              onClick={() => {
                if (hasTokenBalance && tokenBalanceDisplay) {
                  if (!isTokenMode) setIsTokenMode(true);
                  setAmount(tokenBalanceDisplay);
                } else if (sendAllAmount !== null) {
                  setAmount(String(sendAllAmount));
                }
                setFeesIncluded(true);
              }}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                isSendAll
                  ? 'bg-spark-primary text-white'
                  : 'bg-transparent border border-spark-border text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light'
              }`}
            >
              Send All
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

      <FormError error={error} />

      {/* Action buttons */}
      <div className="flex gap-3">
        <SecondaryButton onClick={onBack} disabled={isLoading} className="flex-1">
          Back
        </SecondaryButton>
        <PrimaryButton onClick={onAmountNext} disabled={isLoading || !validAmount} className="flex-1">
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
