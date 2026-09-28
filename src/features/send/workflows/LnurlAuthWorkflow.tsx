import React, { Fragment, useLayoutEffect, useRef, useState } from 'react';
import type { LnurlAuthRequestDetails, LnurlCallbackStatus } from '@breeztech/breez-sdk-spark';
import { FormError, PrimaryButton, SecondaryButton } from '../../../components/ui';
import { SpinnerIcon } from '../../../components/Icons';
import { useSheetBack } from '../../../components/ui/sheets/BottomSheetCardContext';
import { logger, LogCategory } from '../../../services/logger';
import { formatError } from '../../../utils/formatError';
import { openExternalUrl } from '../../../utils/externalLink';
import ResultStep from '../steps/ResultStep';
import i18n from 'i18next';

interface LnurlAuthWorkflowProps {
  parsed: LnurlAuthRequestDetails;
  onBack: () => void;
  onAuth: (requestData: LnurlAuthRequestDetails) => Promise<LnurlCallbackStatus>;
  /** Closes the sheet: after a login, or to decline one. */
  onClose: () => void;
}

/**
 * LUD-04 actions. Each sentence is its own key rather than a verb glued to a
 * domain: "Could not" + "log in to" + domain has a word order only English
 * agrees with, and nothing here would let a translator move the domain.
 */
type AuthAction = 'register' | 'login' | 'link' | 'auth';
const copy = (kind: AuthAction, form: string, vars?: Record<string, unknown>): string =>
  i18n.t(`common:send.lnurlAuth.${form}_${kind}`, vars ?? {});

// A login code is single use, so a retry after a refusal needs a fresh one.
/** Resolved per call: the module loads before i18next has a language. */
const freshCode = (): string => i18n.t('send.lnurlAuth.freshCode');

const LUD_01_URL = 'https://github.com/lnurl/luds/blob/luds/01.md';

interface Failure {
  message: string;
  /** The site answered but hid its reply, which LUD-01's CORS rule forbids. */
  missingCors?: boolean;
}

/** Whether `url`'s host answers at all. The browser reports a CORS block and an
 *  unreachable host as the same network error, but a `no-cors` fetch resolves
 *  on any reply. Cross-origin isolation (the web build's COEP) blocks that
 *  opaque reply too, so there being online is the best signal left. */
async function hostAnswers(url: string): Promise<boolean> {
  if (!navigator.onLine) return false;
  if (globalThis.crossOriginIsolated) return true;
  try {
    await fetch(new URL(url).origin, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout?.(5000) });
    return true;
  } catch {
    return false;
  }
}

const DOMAIN_MAX_PX = 18;
// The size of the line under it, so the domain never reads smaller than that.
const DOMAIN_MIN_PX = 14;

/** Shrinks to fit one line, then wraps at the dots once it hits the minimum.
 *  Never cut short: the tail is the part a user checks. */
const DomainName: React.FC<{ domain: string }> = ({ domain }) => {
  const ref = useRef<HTMLParagraphElement>(null);
  const [size, setSize] = useState(DOMAIN_MAX_PX);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      // Measured on a canvas, not the element: Chrome still breaks at <wbr>
      // under `nowrap`, so the element can't be held to one line to measure.
      const context = document.createElement('canvas').getContext('2d');
      const available = el.clientWidth;
      if (!context || !available) return;
      const { fontWeight, fontFamily } = getComputedStyle(el);
      context.font = `${fontWeight} ${DOMAIN_MAX_PX}px ${fontFamily}`;
      const natural = context.measureText(domain).width;
      // Text width scales with font size; a px of slack keeps a hair's
      // overshoot from wrapping.
      const fitted = Math.floor((DOMAIN_MAX_PX * available / (natural + 1)) * 4) / 4;
      setSize(Math.max(DOMAIN_MIN_PX, Math.min(DOMAIN_MAX_PX, fitted)));
    };
    fit();
    // The first pass can land before the web font, which is wider than the fallback.
    let live = true;
    void document.fonts?.ready.then(() => live && fit());
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [domain]);

  const labels = domain.split('.');
  return (
    <p
      ref={ref}
      style={{ fontSize: size }}
      className="text-spark-text-primary font-medium text-balance [overflow-wrap:anywhere]"
    >
      {labels.map((label, i) => (
        <Fragment key={i}>
          {label}
          {i < labels.length - 1 && <>.<wbr /></>}
        </Fragment>
      ))}
    </p>
  );
};

const LnurlAuthWorkflow: React.FC<LnurlAuthWorkflowProps> = ({ parsed, onBack, onAuth, onClose }) => {
  const [failure, setFailure] = useState<Failure | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);
  useSheetBack(isLoading || done ? undefined : onBack);

  const kind: AuthAction =
    parsed.action === 'register' || parsed.action === 'login' || parsed.action === 'link'
      ? parsed.action
      : 'auth';
  const { domain } = parsed;

  const handleAuth = async () => {
    setIsLoading(true);
    setFailure(null);
    try {
      const result = await onAuth(parsed);
      if (result.type === 'ok') {
        setDone(true);
        return;
      }
      const reason = result.errorDetails.reason.trim().replace(/\.+$/, '');
      logger.warn(LogCategory.SDK, 'LNURL auth refused', { domain, reason });
      setFailure({ message: `${copy(kind, 'failedReason', { domain, reason })} ${freshCode()}` });
    } catch (err) {
      const error = formatError(err);
      logger.error(LogCategory.SDK, 'LNURL auth failed', { domain, error });
      // The SDK's "Network error" means Glow never read a reply. When the host
      // still answers, the reply was hidden by missing CORS headers and the
      // site may well have accepted the login (#415).
      if (!error.includes('Network error:')) {
        setFailure({ message: `${copy(kind, 'failed', { domain })} ${freshCode()}` });
      } else if (await hostAnswers(parsed.url)) {
        setFailure({
          message: copy(kind, 'unclear', { domain }),
          missingCors: true,
        });
      } else {
        setFailure({ message: i18n.t('send.lnurlAuth.unreachable', { domain }) });
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (done) {
    return (
      <ResultStep
        result="success"
        error={null}
        operationType="auth"
        description={`${domain} confirmed it's you.`}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="text-center">
        <DomainName domain={domain} />
        <p className="text-spark-text-secondary text-sm mt-1">{copy(kind, 'wants')}</p>
      </div>

      {failure && (
        <div className="space-y-2">
          <FormError error={failure.message} />
          {/* Indented to the error's text, so it reads as that error's detail line. */}
          {failure.missingCors && (
            <p className="ml-6 text-xs text-spark-text-muted [overflow-wrap:anywhere]">
              {domain} is missing a CORS header (
              <a
                href={LUD_01_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  void openExternalUrl(LUD_01_URL);
                }}
                className="whitespace-nowrap underline underline-offset-4 hover:text-spark-text-secondary transition-colors"
              >
                LUD-01
              </a>
              ).
            </p>
          )}
        </div>
      )}

      {/* The site may have taken the login already, and a retry with the same
          single-use code would only report it as used. */}
      {failure?.missingCors ? (
        <PrimaryButton onClick={onClose} className="w-full">
          Done
        </PrimaryButton>
      ) : (
        <div className="flex gap-3">
          <SecondaryButton onClick={onClose} disabled={isLoading} className="flex-1">
            Cancel
          </SecondaryButton>
          <PrimaryButton onClick={handleAuth} disabled={isLoading} className="flex-1">
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <SpinnerIcon size="md" />
                {i18n.t('send.processingEllipsis')}
              </span>
            ) : copy(kind, 'cta')}
          </PrimaryButton>
        </div>
      )}
    </div>
  );
};

export default LnurlAuthWorkflow;
