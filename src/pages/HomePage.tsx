import React from 'react';

interface HomePageProps {
  onRestoreWallet: () => void;
  onCreateNewWallet: () => void;
}

const HomePage: React.FC<HomePageProps> = ({ onRestoreWallet, onCreateNewWallet }) => {
  return (
    <div className="h-[100dvh] flex flex-col relative overflow-hidden">
      {/* Atmospheric background elements */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Main glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-gradient-radial from-spark-violet/20 via-spark-violet/5 to-transparent blur-3xl" />
        {/* Secondary glow */}
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-gradient-radial from-spark-violet/15 to-transparent blur-3xl" />
        {/* Electric accent */}
        <div className="absolute top-1/3 left-0 w-[300px] h-[300px] bg-gradient-radial from-spark-electric/10 to-transparent blur-3xl" />
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 relative z-10">
        {/* Lightning bolt icon */}
        <div className="mb-8 relative">
          <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-spark-violet to-spark-violet/80 flex items-center justify-center shadow-glow-violet animate-float">
            <svg className="w-14 h-14 text-black" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z" />
            </svg>
          </div>
          {/* Glow ring */}
          <div className="absolute inset-0 rounded-3xl bg-spark-violet/30 blur-xl animate-glow-pulse" />
        </div>

        {/* Title */}
        <h1 className="font-display text-display-lg md:text-display-xl font-bold text-center mb-3">
          <span className="text-gradient-amber">Spark</span>{' '}
          <span className="text-white">Wallet</span>
        </h1>

        {/* Subtitle */}
        <p className="text-spark-text-secondary text-lg md:text-xl text-center max-w-md mb-2">
          Lightning-fast Bitcoin payments
        </p>
        <p className="text-spark-text-muted text-sm text-center mb-12">
          Powered by Breez SDK
        </p>

        {/* CTA Buttons */}
        <div className="w-full max-w-sm space-y-4">
          {/* Primary CTA */}
          <button
            onClick={onCreateNewWallet}
            className="button w-full py-4 text-base"
          >
            Create New Wallet
          </button>

          {/* Divider */}
          <div className="relative flex items-center gap-4 py-2">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-spark-border-light to-transparent" />
            <span className="text-spark-text-muted text-sm font-medium">or</span>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-spark-border-light to-transparent" />
          </div>

          {/* Secondary CTA */}
          <button
            onClick={onRestoreWallet}
            className="w-full py-4 border-2 border-spark-border-light text-spark-text-primary rounded-xl hover:border-spark-violet hover:text-spark-violet transition-all duration-300 font-display font-semibold tracking-wide"
          >
            Restore Existing Wallet
          </button>
        </div>

        {/* Features */}
        <div className="mt-16 grid grid-cols-3 gap-6 max-w-md w-full">
          <FeatureCard
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            }
            label="Instant"
          />
          <FeatureCard
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            }
            label="Secure"
          />
          <FeatureCard
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            label="Global"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="text-center pb-8 px-6">
        <p className="text-spark-text-muted text-xs">
          Self-custodial • Open Source • No KYC
        </p>
      </div>
    </div>
  );
};

interface FeatureCardProps {
  icon: React.ReactNode;
  label: string;
}

const FeatureCard: React.FC<FeatureCardProps> = ({ icon, label }) => (
  <div className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-spark-surface/50 border border-spark-border hover:border-spark-border-light transition-colors">
    <div className="text-spark-violet">
      {icon}
    </div>
    <span className="text-spark-text-secondary text-xs font-medium">{label}</span>
  </div>
);

export default HomePage;
