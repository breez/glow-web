import React from 'react';

interface LoadingSpinnerProps {
  text?: string;
  size?: 'small' | 'medium' | 'large';
  className?: string;
  subtext?: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  text = 'Loading...',
  subtext,
  size = 'large',
  className = ''
}) => {
  const sizeConfig = {
    small: { container: 'w-8 h-8', bolt: 'w-4 h-4', ring: 'w-8 h-8' },
    medium: { container: 'w-16 h-16', bolt: 'w-8 h-8', ring: 'w-16 h-16' },
    large: { container: 'w-24 h-24', bolt: 'w-12 h-12', ring: 'w-24 h-24' }
  };

  const config = sizeConfig[size];

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      {/* Spinner container */}
      <div className={`relative ${config.container}`}>
        {/* Outer glow */}
        <div className="absolute inset-0 rounded-full bg-spark-violet/20 blur-xl animate-pulse" />
        
        {/* Rotating ring */}
        <div className={`absolute inset-0 ${config.ring}`}>
          <svg className="w-full h-full animate-spin" viewBox="0 0 100 100">
            <defs>
              <linearGradient id="spinner-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#f7931a" stopOpacity="1" />
                <stop offset="50%" stopColor="#00d4ff" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#f7931a" stopOpacity="0" />
              </linearGradient>
            </defs>
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="url(#spinner-gradient)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="200"
              strokeDashoffset="50"
            />
          </svg>
        </div>

        {/* Inner ring (slower) */}
        <div className={`absolute inset-2`}>
          <svg className="w-full h-full animate-spin" style={{ animationDuration: '2s', animationDirection: 'reverse' }} viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke="rgba(139, 92, 246, 0.3)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="60 200"
            />
          </svg>
        </div>

        {/* Center lightning bolt */}
        <div className="absolute inset-0 flex items-center justify-center">
          <svg 
            className={`${config.bolt} text-spark-violet drop-shadow-lg`} 
            viewBox="0 0 24 24" 
            fill="currentColor"
            style={{
              filter: 'drop-shadow(0 0 10px rgba(247, 147, 26, 0.5))',
              animation: 'glow-pulse 1.5s ease-in-out infinite'
            }}
          >
            <path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z" />
          </svg>
        </div>

        {/* Spark particles */}
        <div className="absolute inset-0">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="absolute w-1.5 h-1.5 rounded-full bg-spark-violet"
              style={{
                top: '50%',
                left: '50%',
                transform: `rotate(${i * 90}deg) translateY(-${size === 'large' ? 40 : size === 'medium' ? 28 : 16}px)`,
                animation: `glow-pulse 1s ease-in-out infinite`,
                animationDelay: `${i * 0.25}s`,
                boxShadow: '0 0 6px rgba(247, 147, 26, 0.8)'
              }}
            />
          ))}
        </div>
      </div>

      {/* Text */}
      {text && (
        <p className="mt-6 font-display font-medium text-spark-text-primary">
          {text}
        </p>
      )}
      {subtext && (
        <p className="mt-1 text-spark-text-muted text-sm">
          {subtext}
        </p>
      )}
    </div>
  );
};

export default LoadingSpinner;
