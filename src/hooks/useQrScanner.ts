import { useCallback, useRef, useState } from 'react';
import QrScanner from 'qr-scanner';

export type FacingMode = 'environment' | 'user';

export interface UseQrScannerOptions {
  onScan: (data: string) => void;
  onError?: (error: string) => void;
}

export interface UseQrScannerReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  error: string | null;
  isScanning: boolean;
  isInitializing: boolean;
  facingMode: FacingMode;
  hasMultipleCameras: boolean;
  startScanning: () => Promise<void>;
  stopScanning: () => void;
  toggleCamera: () => void;
  clearError: () => void;
}

/**
 * Hook to manage QR code scanning with camera controls
 * Encapsulates all scanner state and logic for reusability
 */
export const useQrScanner = ({ onScan, onError }: UseQrScannerOptions): UseQrScannerReturn => {
  const videoRef = useRef<HTMLVideoElement>(null!);
  const qrScannerRef = useRef<QrScanner | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [facingMode, setFacingMode] = useState<FacingMode>('environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const stopScanning = useCallback(() => {
    if (qrScannerRef.current) {
      qrScannerRef.current.stop();
      qrScannerRef.current.destroy();
      qrScannerRef.current = null;
    }
    setIsScanning(false);
  }, []);

  const startScanning = useCallback(async () => {
    try {
      setError(null);
      setIsInitializing(true);
      setIsScanning(false);

      if (!videoRef.current) {
        const errorMsg = 'Video element not available';
        setError(errorMsg);
        onError?.(errorMsg);
        setIsInitializing(false);
        return;
      }

      // Check if camera is available
      const hasCamera = await QrScanner.hasCamera();
      if (!hasCamera) {
        const errorMsg = 'No camera found on this device';
        setError(errorMsg);
        onError?.(errorMsg);
        setIsInitializing(false);
        return;
      }

      qrScannerRef.current = new QrScanner(
        videoRef.current,
        (result) => {
          console.log('QR Code detected:', result.data);
          onScan(result.data);
          stopScanning();
        },
        {
          onDecodeError: (decodeError) => {
            // Ignore decode errors - they happen frequently while scanning
            console.debug('QR decode error:', decodeError);
          },
          highlightScanRegion: true,
          highlightCodeOutline: true,
          preferredCamera: facingMode,
          maxScansPerSecond: 5,
        }
      );

      await qrScannerRef.current.start();
      console.log('QR Scanner started successfully');
      setIsInitializing(false);
      setIsScanning(true);

      // Re-check cameras after permission is granted, since the initial
      // check may have returned stale results before the user allowed access
      try {
        const cameras = await QrScanner.listCameras(false);
        console.log('Cameras after permission:', cameras);
        const uniqueIds = new Set(cameras.map(c => c.id));
        setHasMultipleCameras(uniqueIds.size > 1);
      } catch (e) {
        console.warn('Failed to re-list cameras:', e);
      }
    } catch (err) {
      console.error('Failed to start QR scanner:', err);
      let errorMessage = 'Camera access denied or not available';

      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          errorMessage = 'Camera access denied. Please allow camera access and try again.';
        } else if (err.name === 'NotFoundError') {
          errorMessage = 'No camera found on this device';
        } else if (err.name === 'NotReadableError') {
          errorMessage = 'Camera is already in use by another application';
        } else if (err.name === 'OverconstrainedError') {
          errorMessage = 'Camera constraints not supported';
        }
      }

      setError(errorMessage);
      onError?.(errorMessage);
      setIsInitializing(false);
      setIsScanning(false);
    }
  }, [facingMode, onScan, onError, stopScanning]);

  const toggleCamera = useCallback(() => {
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
  }, []);

  return {
    videoRef,
    error,
    isScanning,
    isInitializing,
    facingMode,
    hasMultipleCameras,
    startScanning,
    stopScanning,
    toggleCamera,
    clearError,
  };
};
