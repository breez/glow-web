import React from 'react';
import QRCode from 'react-qr-code';

/**
 * QR Code display component with decorative corners.
 * Separated from barrel file to enable lazy loading of react-qr-code library.
 */
export const QRCodeContainer: React.FC<{
  value: string;
  size?: number;
  className?: string;
}> = ({ value, size = 200, className = "" }) => (
  <div className={`relative ${className}`}>
    {/* Decorative corners */}
    <div className="absolute -inset-3 pointer-events-none">
      <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-spark-primary/50 rounded-tl-lg" />
      <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-spark-primary/50 rounded-tr-lg" />
      <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-spark-primary/50 rounded-bl-lg" />
      <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-spark-primary/50 rounded-br-lg" />
    </div>
    <div className="qr-container">
      <QRCode value={value} size={size} />
    </div>
  </div>
);

export default QRCodeContainer;
