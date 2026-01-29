import React from 'react';

const ProcessingStep: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      {/* Animated Glow logo */}
      <div className="relative mb-8">
        {/* Pulsing glow rings */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="absolute w-28 h-28 rounded-full bg-spark-primary/15 animate-ping" style={{ animationDuration: '2s' }} />
          <div className="absolute w-24 h-24 rounded-full bg-spark-primary/20 animate-ping" style={{ animationDuration: '2s', animationDelay: '0.5s' }} />
        </div>
        
        {/* Logo container with spinning ring */}
        <div className="relative w-24 h-24 flex items-center justify-center">
          {/* Spinning ring */}
          <span className="absolute inset-0 w-full h-full animate-spin" style={{ animationDuration: '3s' }}>
            <svg className="w-full h-full" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="46"
                fill="none"
                stroke="url(#processing-gradient)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="80 200"
              />
              <defs>
                <linearGradient id="processing-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#d4a574" />
                  <stop offset="100%" stopColor="#d4a574" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </span>
          
          {/* Glow logo */}
          <img
            src="/assets/Glow_Logo.png"
            alt="Processing"
            className="w-14 h-14 object-contain animate-pulse drop-shadow-[0_0_15px_rgba(212,165,116,0.4)]"
            style={{ animationDuration: '2s' }}
          />
        </div>
      </div>

      {/* Text */}
      <h3 className="font-display text-xl font-semibold text-spark-text-primary mb-2">
        Sending
      </h3>
      <p className="text-spark-text-secondary text-sm text-center max-w-xs">
        Processing your payment...
      </p>

      {/* Animated dots in brand color */}
      <div className="flex gap-1.5 mt-6">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-spark-primary"
            style={{
              animation: 'bounce 1s ease-in-out infinite',
              animationDelay: `${i * 0.15}s`
            }}
          />
        ))}
      </div>
    </div>
  );
};

export default ProcessingStep;
