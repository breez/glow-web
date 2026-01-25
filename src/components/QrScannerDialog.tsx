import React, { useEffect, useCallback } from 'react';
import { BottomSheetContainer } from './ui';
import { useQrScanner } from '../hooks/useQrScanner';

interface QrScannerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (data: string) => void;
}

const QrScannerDialog: React.FC<QrScannerDialogProps> = ({ isOpen, onClose, onScan }) => {
  const handleScan = useCallback((data: string) => {
    onScan(data);
    onClose();
  }, [onScan, onClose]);

  const {
    videoRef,
    error,
    isScanning,
    isInitializing,
    hasMultipleCameras,
    startScanning,
    stopScanning,
    toggleCamera,
    clearError,
    facingMode,
  } = useQrScanner({ onScan: handleScan });

  useEffect(() => {
    if (isOpen) {
      // Wait for the transition to complete (300ms) plus a buffer
      const timer = setTimeout(() => {
        console.log('Checking video element after transition:', videoRef.current);
        if (videoRef.current) {
          startScanning();
        } else {
          console.error('Video element still null after transition');
        }
      }, 400); // 300ms transition + 100ms buffer

      return () => {
        clearTimeout(timer);
        stopScanning();
      };
    } else {
      stopScanning();
    }
  }, [isOpen, facingMode, startScanning, stopScanning, videoRef]);

  const handleClose = () => {
    stopScanning();
    clearError();
    onClose();
  };

  return (
    <BottomSheetContainer isOpen={isOpen} onClose={handleClose} fullHeight maxWidth="full">
      <div className="h-full w-full bg-black flex flex-col">
        {/* Full screen video */}
        <div className="flex-1 relative">
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            playsInline
            muted
          />

          {/* Scan overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-64 h-64 relative">
              {/* Corner brackets */}
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-spark-primary rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-spark-primary rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-spark-primary rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-spark-primary rounded-br-lg" />
              {/* Scanning line animation */}
              {isScanning && (
                <div className="absolute left-2 right-2 h-0.5 bg-spark-primary animate-scan-line" />
              )}
            </div>
          </div>

          {/* Camera toggle button */}
          {hasMultipleCameras && (
            <button
              onClick={toggleCamera}
              className="absolute top-4 right-4 p-3 rounded-full bg-black/50 hover:bg-black/70 text-white backdrop-blur-sm transition-colors z-20 border border-white/10"
              aria-label="Switch camera"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}

          {isInitializing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70">
              <div className="text-center text-white p-4">
                <div className="animate-spin rounded-full h-10 w-10 border-2 border-spark-primary border-t-transparent mx-auto mb-3"></div>
                <p className="text-sm text-spark-text-secondary">Initializing camera...</p>
              </div>
            </div>
          )}

          {!isScanning && !isInitializing && error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80">
              <div className="text-center text-white p-6 max-w-xs">
                <div className="w-16 h-16 rounded-full bg-spark-error/20 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-spark-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <p className="text-sm mb-2 font-medium">Camera not available</p>
                <p className="text-xs text-spark-text-muted">{error}</p>
              </div>
            </div>
          )}
        </div>

        {/* Bottom controls */}
        <div className="bg-black/90 backdrop-blur-sm safe-area-bottom">
          <div className="p-6">
            <p className="text-spark-text-secondary text-sm text-center mb-4">
              Point camera at QR code
            </p>
            <button
              onClick={handleClose}
              className="w-full py-3 border border-spark-border text-spark-text-primary rounded-xl font-medium hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </BottomSheetContainer>
  );
};

export default QrScannerDialog;
