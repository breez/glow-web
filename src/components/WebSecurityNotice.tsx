import React from 'react';
import { Capacitor } from '@capacitor/core';
import { AlertCard } from './AlertCard';
import { openExternalUrl } from '../utils/externalLink';
import { useTranslation } from 'react-i18next';

const STORE_BADGES = [
  {
    href: 'https://apps.apple.com/app/id6762465698',
    src: '/assets/app-store-badge.svg',
    alt: 'Download on the App Store',
  },
  {
    href: 'https://play.google.com/store/apps/details?id=technology.breez.glow',
    src: '/assets/google-play-badge.svg',
    alt: 'Get it on Google Play',
  },
];

// A web phrase wallet keeps its recovery phrase in localStorage. Native keeps
// it in the device-only vault, so this does not render there.
const isWeb = !Capacitor.isNativePlatform();

interface WebSecurityNoticeProps {
  /** Recommend a passkey instead of the Glow app. */
  recommendPasskey?: boolean;
}

export const WebSecurityNotice: React.FC<WebSecurityNoticeProps> = ({ recommendPasskey = false }) => {
  const { t } = useTranslation(['critical', 'common']);
  return isWeb ? (
    <AlertCard variant="warning" title={t('common:labels.securityNotice')}>
      <p className="text-spark-text-secondary text-sm">
        {recommendPasskey ? t('webNotice.preferPasskey') : t('webNotice.preferApp')}{' '}
        {t('webNotice.risk')}
      </p>
      {!recommendPasskey && (
        <div className="grid grid-cols-2 gap-2 mt-3">
          {STORE_BADGES.map(({ href, src, alt }) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.preventDefault();
                void openExternalUrl(href);
              }}
            >
              <img src={src} alt={alt} className="w-full h-auto" />
            </a>
          ))}
        </div>
      )}
    </AlertCard>
  ) : null;
};
