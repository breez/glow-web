import React, { useState } from 'react';
import type { LnurlAuthRequestDetails, LnurlCallbackStatus } from '@breeztech/breez-sdk-spark';
import { FormError, PrimaryButton, SecondaryButton } from '../../../components/ui';

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
      console.error('LNURL Auth failed:', err);
      setError(`Authentication failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Domain info */}
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-spark-primary/20 rounded-2xl flex items-center justify-center">
          <svg className="w-8 h-8 text-spark-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
        </div>
        <p className="text-spark-text-primary font-medium text-lg">{parsed.domain}</p>
        <p className="text-spark-text-secondary text-sm mt-1">wants you to {getActionText().toLowerCase()}</p>
      </div>

      {/* Action description */}
      <div className="bg-spark-dark/50 border border-spark-border rounded-xl p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-spark-electric/20 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-spark-electric" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <p className="text-spark-text-primary font-medium">{getActionText()}</p>
            <p className="text-spark-text-muted text-sm">
              Your wallet will sign a message to prove your identity without sharing any personal information.
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
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Authenticating...
            </span>
          ) : getActionText()}
        </PrimaryButton>
      </div>
    </div>
  );
};

export default LnurlAuthWorkflow;
