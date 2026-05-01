import React, { useEffect, useCallback, useRef, useState } from 'react';
import QrScanner from 'qr-scanner';
import { BottomSheetContainer, FloatingIconButton } from './ui';
import { useQrScanner } from '../hooks/useQrScanner';
import { logger, LogCategory } from '@/services/logger';
import { CameraFlipIcon, ImageIcon, AlertTriangleIcon } from './Icons';
import { useLatest } from '../hooks/useLatest';

interface QrScannerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (data: string) => void;
}

const QrScannerDialog: React.FC<QrScannerDialogProps> = ({ isOpen, onClose, onScan }) => {
  // Status / nav bar tints are handled by the shared BottomSheetContainer
  // since this dialog is mounted with fullHeight — isFullScreen is true
  // for the whole open lifetime, so both bars get the spark-surface push.

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [galleryError, setGalleryError] = useState<string | null>(null);

  const handleScan = useCallback((data: string) => {
    onScan(data);
    onClose();
  }, [onScan, onClose]);

  const handleGalleryPick = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setGalleryError(null);
    try {
      const result = await QrScanner.scanImage(file);
      onScan(result);
      onClose();
    } catch {
      setGalleryError('No QR code found in image');
      setTimeout(() => setGalleryError(null), 3000);
    }
    // Reset so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [onScan, onClose]);

  const {
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
  } = useQrScanner({ onScan: handleScan });

  // Use refs to avoid effect re-running when callbacks change
  const startScanningRef = useLatest(startScanning);
  const stopScanningRef = useLatest(stopScanning);

  useEffect(() => {
    // Capture the stop callback at effect start so cleanup invokes the
    // function that was current when the effect began, not whatever
    // happens to be in the ref at unmount time.
    const stop = stopScanningRef.current;
    if (isOpen) {
      // Wait for the transition to complete (300ms) plus a buffer
      const timer = setTimeout(() => {
        logger.debug(LogCategory.UI, 'Checking video element after transition', {
          videoReady: Boolean(videoRef.current),
        });
        if (videoRef.current) {
          startScanningRef.current();
        } else {
          logger.error(LogCategory.UI, 'Video element still null after transition');
        }
      }, 400); // 300ms transition + 100ms buffer

      return () => {
        clearTimeout(timer);
        stop();
      };
    } else {
      stop();
    }
  }, [isOpen, videoRef, startScanningRef, stopScanningRef]);

  const handleClose = () => {
    stopScanning();
    clearError();
    onClose();
  };

  return (
    <BottomSheetContainer isOpen={isOpen} onClose={handleClose} fullHeight maxWidth="full">
      {/* Respect the notch / home indicator safe areas. Without this
          the camera feed extends under the Dynamic Island on iOS and
          the gallery / camera-flip buttons can land behind the
          system-bar or home indicator cutouts. */}
      <div
        className="h-full w-full bg-spark-surface flex flex-col"
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* Camera area: the video feed is constrained to a square
            aspect ratio and centered, with the surrounding space
            filled by the parent's bg-spark-surface. Without this,
            object-cover on a tall portrait <video> element heavily
            crops the camera feed on the sides and the preview looks
            vertically stretched. */}
        <div className="flex-1 relative flex items-center justify-center overflow-hidden">
          {/* Square video container — w-full on portrait phones gives a
              fullwidth square centered vertically; max-h-full guards
              against landscape overflow. */}
          <div className="relative aspect-square w-full max-h-full">
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              playsInline
              muted
              autoPlay
              // A 1x1 opaque spark-surface (#151520) SVG poster.
              // Without a poster, the Android WebView renders a
              // default "play button" glyph on a paused / unsourced
              // video, which then gets flipped by the scaleX(-1)
              // transform during front-camera switch — visually it
              // looks like a bug. A poster replaces the default
              // placeholder with a solid spark-surface fill, so the
              // mirror transform has nothing to flip.
              poster="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%23151520'/%3E%3C/svg%3E"
              // The user-facing ("selfie") camera renders un-mirrored
              // by default on the Honor WebView, which feels inverted
              // to users accustomed to the selfie mirror convention.
              // Flip horizontally in CSS when the active camera is
              // the front one; the QR decoder runs off the raw frame
              // before this transform so recognition is unaffected.
              //
              // backgroundColor fills the video element itself while
              // no camera frame has rendered yet.
              style={{
                backgroundColor: '#151520',
                transform: facingMode === 'user' ? 'scaleX(-1)' : undefined,
              }}
            />

            {/* Scan overlay — pinned to the square video container so the
                corner brackets always align with the visible camera feed. */}
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

            {isInitializing && (
              <div className="absolute inset-0 flex items-center justify-center bg-spark-surface/70">
                <div className="text-center text-white p-4">
                  <div className="animate-spin rounded-full h-10 w-10 border-2 border-spark-primary border-t-transparent mx-auto mb-3"></div>
                  <p className="text-sm text-spark-text-secondary">Initializing camera...</p>
                </div>
              </div>
            )}

            {!isScanning && !isInitializing && error && (
              <div className="absolute inset-0 flex items-center justify-center bg-spark-surface/80">
                <div className="text-center text-white p-6 max-w-xs">
                  <div className="w-16 h-16 rounded-full bg-spark-error/20 flex items-center justify-center mx-auto mb-4">
                    <AlertTriangleIcon size="xl" className="text-spark-error" />
                  </div>
                  <p className="text-sm mb-2 font-medium">Camera not available</p>
                  <p className="text-xs text-spark-text-muted">{error}</p>
                </div>
              </div>
            )}
          </div>

          {/* Camera toggle (top left of the viewport, outside the square
              video so buttons are reachable regardless of portrait/landscape). */}
          {hasMultipleCameras && (
            <FloatingIconButton
              onClick={toggleCamera}
              className="absolute top-4 left-4 z-20"
              aria-label="Switch camera"
              icon={
                <CameraFlipIcon />
              }
            />
          )}

          {/* Gallery picker button (top right of the viewport). */}
          <FloatingIconButton
            onClick={() => fileInputRef.current?.click()}
            className="absolute top-4 right-4 z-20"
            aria-label="Pick image from gallery"
            icon={
              <ImageIcon />
            }
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleGalleryPick}
          />

          {/* Gallery error toast */}
          {galleryError && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-spark-error/90 text-white text-sm px-4 py-2 rounded-lg backdrop-blur-sm z-30">
              {galleryError}
            </div>
          )}
        </div>

        {/* Bottom controls — match the rest of the app's bottom chrome
            (spark-surface/80 backdrop-blur-md, same as .bottom-bar) so
            the scanner blends with the wallet footer visually. */}
        <div className="bg-spark-surface/80 backdrop-blur-md">
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
