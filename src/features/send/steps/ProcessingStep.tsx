import React from 'react';

const ProcessingStep: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      {/* Animated payment icon */}
      <div className="relative mb-8">
        {/* Outer glow */}
        <div className="absolute inset-0 w-24 h-24 rounded-full bg-spark-electric/20 blur-xl animate-pulse" />
        
        {/* Main circle */}
        <div className="relative w-24 h-24 rounded-full bg-spark-surface border-2 border-spark-electric flex items-center justify-center">
          {/* Spinning ring */}
          <span className="absolute inset-0 w-full h-full animate-spin" style={{ animationDuration: '2s' }}>
            <svg className="w-full h-full" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="46"
                fill="none"
                stroke="url(#processing-gradient)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray="100 200"
              />
              <defs>
                <linearGradient id="processing-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#00d4ff" />
                  <stop offset="100%" stopColor="#00d4ff" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </span>
          
          {/* Lightning bolt */}
          <svg 
            className="w-10 h-10 text-spark-electric" 
            viewBox="0 0 24 24" 
            fill="currentColor"
          >
            <path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z" />
          </svg>
        </div>
      </div>

      {/* Text */}
      <h3 className="font-display text-xl font-semibold text-spark-text-primary mb-2">
        Sending...
      </h3>
      <p className="text-spark-text-secondary text-sm text-center max-w-xs">
        Please wait while we process your transaction...
      </p>

      {/* Animated dots */}
      <div className="flex gap-1 mt-6">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-spark-electric"
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
