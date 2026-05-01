import { useState } from 'react';

export interface PlatformInfo {
    isPWA: boolean;
    isIOS: boolean;
    isAndroid: boolean;
    isStandalone: boolean;
}

function detectPlatform(): PlatformInfo {
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(userAgent);
    const isAndroid = /android/.test(userAgent);

    // window.navigator.standalone is iOS-specific
    const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    return { isPWA: isStandalone, isIOS, isAndroid, isStandalone };
}

/**
 * Hook to detect platform and PWA status. The result is read once at first
 * render — it never changes for the lifetime of the page.
 */
export const usePlatform = (): PlatformInfo => {
    const [platform] = useState<PlatformInfo>(detectPlatform);
    return platform;
};
