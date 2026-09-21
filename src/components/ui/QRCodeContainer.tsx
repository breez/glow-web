import React from 'react';
import { QRCode } from 'react-qr-code';
import LoadingSpinner from '../LoadingSpinner';

const Corners: React.FC = () => (
  <div className="absolute -inset-3 pointer-events-none">
    <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-spark-primary/50 rounded-tl-lg" />
    <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-spark-primary/50 rounded-tr-lg" />
    <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-spark-primary/50 rounded-bl-lg" />
    <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-spark-primary/50 rounded-br-lg" />
  </div>
);

interface QrFrameProps {
  size?: number;
  className?: string;
  /** Applied to the white card alone, so it can move inside the fixed corners. */
  cardClassName?: string;
}

/**
 * QR Code display component with decorative corners.
 * Separated from barrel file to enable lazy loading of react-qr-code library.
 */
export const QRCodeContainer: React.FC<QrFrameProps & { value: string }> = ({ value, size = 200, className = '', cardClassName = '' }) => (
  <div className={`relative ${className}`}>
    <Corners />
    <div className={`qr-container ${cardClassName}`}>
      <QRCode value={value} size={size} />
    </div>
  </div>
);

/**
 * Holds a QR's place while its value loads: the frame's corners stay put and a
 * spinner sits where the code goes. No white card behind it — an empty one
 * reads as a code that failed to draw, where a spinner on the sheet reads as
 * what it is. Keeps the card's footprint so nothing shifts when the code lands.
 */
export const QrPlaceholder: React.FC<QrFrameProps> = ({ size = 200, className = '', cardClassName = '' }) => (
  <div className={`relative ${className}`} aria-hidden="true">
    <Corners />
    <div className={`qr-placeholder ${cardClassName}`}>
      <div className="flex items-center justify-center" style={{ width: size, height: size }}>
        <LoadingSpinner />
      </div>
    </div>
  </div>
);

export default QRCodeContainer;
