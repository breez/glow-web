import React from 'react';
import { Capacitor } from '@capacitor/core';
import { AlertCard } from './AlertCard';
import { openExternalUrl } from '../utils/externalLink';

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

export const WebSecurityNotice: React.FC = () =>
  isWeb ? (
    <AlertCard variant="warning" title="Security Notice">
      <p className="text-spark-text-secondary text-sm">
        Harmful browser extensions, or anyone with access to this device, could take your funds, and stolen funds can't be recovered. Use Glow on the web with caution, and use the Glow app for a secure environment.
      </p>
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
    </AlertCard>
  ) : null;
