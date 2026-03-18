import React, { useState } from 'react';
import type { LnurlAuthRequestDetails, LnurlCallbackStatus } from '@breeztech/breez-sdk-spark';
import { FormError, PrimaryButton, SecondaryButton } from '../../../components/ui';
import { KeyIcon, ShieldCheckIcon, SpinnerIcon } from '../../../components/Icons';
import { logger, LogCategory } from '../../../services/logger';
import { formatError } from '../../../utils/formatError';

interface LnurlAuthWorkflowProps {
  parsed: LnurlAuthRequestDetails;
  onBack: () => void;
  onRun: (runner: () => Promise<void>) => Promise<void>;
  onAuth: (requestData: LnurlAuthRequestDetails) => Promise<LnurlCallbackStatus>;
}

const LnurlAuthWorkflow: React.FC<LnurlAuthWorkflowProps> = ({ parsed, onBack, onRun, onAuth }) => {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Get action display text
  const getActionText = (): string => {
    switch (parsed.action) {
      case 'register':
        return 'Register';
      case 'login':
        return 'Log in';
      case 'link':
        return 'Link account';
      case 'auth':
        return 'Authenticate';
      default:
        return 'Authenticate';
    }
  };

  const handleAuth = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await onRun(async () => {
        const result = await onAuth(parsed);
        if (result.type === 'errorStatus') {
          throw new Error(result.errorDetails.reason);
        }
      });
    } catch (err) {
      logger.error(LogCategory.SDK, 'LNURL Auth failed', { error: formatError(err) });
      setError(`Authentication failed: ${formatError(err)}`);
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Domain info */}
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-spark-primary/20 rounded-2xl flex items-center justify-center">
          <KeyIcon size="xl" className="text-spark-primary" />
        </div>
        <p className="text-spark-text-primary font-medium text-lg">{parsed.domain}</p>
        <p className="text-spark-text-secondary text-sm mt-1">wants you to {getActionText().toLowerCase()}</p>
      </div>

      {/* Action description */}
      <div className="bg-spark-dark/50 border border-spark-border rounded-xl p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-spark-electric/20 rounded-lg flex items-center justify-center flex-shrink-0">
            <ShieldCheckIcon className="text-spark-electric" />
          </div>
          <div>
            <p className="text-spark-text-primary font-medium">{getActionText()}</p>
            <p className="text-spark-text-muted text-sm">
              Glow will sign a message to prove your identity without sharing any personal information.
            </p>
          </div>
        </div>
      </div>

      <FormError error={error} />

      {/* Action buttons */}
      <div className="flex gap-3 pt-2">
        <SecondaryButton onClick={onBack} disabled={isLoading} className="flex-1">
          Cancel
        </SecondaryButton>
        <PrimaryButton onClick={handleAuth} disabled={isLoading} className="flex-1">
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <SpinnerIcon />
              Authenticating...
            </span>
          ) : getActionText()}
        </PrimaryButton>
      </div>
    </div>
  );
};

export default LnurlAuthWorkflow;
