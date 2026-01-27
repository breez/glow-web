import { useState, useEffect } from 'react';

export interface PlatformInfo {
    isPWA: boolean;
    isIOS: boolean;
    isAndroid: boolean;
    isStandalone: boolean;
}

/**
 * Hook to detect platform and PWA status
 */
export const usePlatform = (): PlatformInfo => {
    const [platform, setPlatform] = useState<PlatformInfo>({
        isPWA: false,
        isIOS: false,
        isAndroid: false,
        isStandalone: false,
    });

    useEffect(() => {
        const userAgent = window.navigator.userAgent.toLowerCase();
        const isIOS = /iphone|ipad|ipod/.test(userAgent);
        const isAndroid = /android/.test(userAgent);

        // Check if running as standalone PWA
        // window.navigator.standalone is iOS-specific
        const isStandalone =
            window.matchMedia('(display-mode: standalone)').matches ||
            (window.navigator as unknown as { standalone?: boolean }).standalone === true;

        setPlatform({
            isPWA: isStandalone,
            isIOS,
            isAndroid,
            isStandalone,
        });
    }, []);

    return platform;
};
