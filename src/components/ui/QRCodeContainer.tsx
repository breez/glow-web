import React from 'react';
import { QRCode } from 'react-qr-code';

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

/** Holds a QR's place while its value loads: the same frame and card, with a sweep where the code goes. */
export const QrPlaceholder: React.FC<QrFrameProps> = ({ size = 200, className = '', cardClassName = '' }) => (
  <div className={`relative ${className}`} aria-hidden="true">
    <Corners />
    <div className={`qr-container relative overflow-hidden ${cardClassName}`}>
      <div className="relative" style={{ width: size, height: size }}>
        {['top-0 left-0', 'top-0 right-0', 'bottom-0 left-0'].map((corner) => (
          <div key={corner} className={`absolute ${corner} w-[21%] h-[21%] rounded-lg border-[6px] border-spark-border/15`} />
        ))}
      </div>
      <div
        className="absolute inset-0 animate-[shimmer_2s_linear_infinite] motion-reduce:animate-none"
        style={{
          backgroundImage: 'linear-gradient(110deg, transparent 35%, color-mix(in srgb, var(--spark-primary) 22%, transparent) 50%, transparent 65%)',
          backgroundSize: '200% 100%',
        }}
      />
    </div>
  </div>
);

export default QRCodeContainer;
