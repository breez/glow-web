import React from 'react';

/**
 * Centralized icon components for consistent rendering across the app.
 * Icons are defined as React components to enable tree-shaking and
 * avoid recreating JSX on every render.
 */

export interface IconProps {
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

const sizeClasses = {
  xs: 'w-3 h-3',
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
  xl: 'w-8 h-8',
};

// ============================================
// NAVIGATION ICONS
// ============================================

export const CloseIcon: React.FC<IconProps> = ({ className = '', size = 'md' }) => (
  <svg className={`${sizeClasses[size]} ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

export const BackIcon: React.FC<IconProps> = ({ className = '', size = 'md' }) => (
  <svg className={`${sizeClasses[size]} ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
  </svg>
);

export const ChevronRightIcon: React.FC<IconProps> = ({ className = '', size = 'md' }) => (
  <svg className={`${sizeClasses[size]} ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

// ============================================
// ACTION ICONS
// ============================================

export const CopyIcon: React.FC<IconProps> = ({ className = '', size = 'md' }) => (
  <svg className={`${sizeClasses[size]} ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

export const DownloadIcon: React.FC<IconProps> = ({ className = '', size = 'md' }) => (
  <svg className={`${sizeClasses[size]} ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
  </svg>
);

// ============================================
// STATUS ICONS
// ============================================

export const WarningIcon: React.FC<IconProps> = ({ className = '', size = 'md' }) => (
  <svg className={`${sizeClasses[size]} ${className}`} viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.72-1.36 3.485 0l6.518 11.6c.75 1.336-.213 3.001-1.742 3.001H3.48c-1.53 0-2.492-1.665-1.742-3.001l6.52-11.6zM11 13a1 1 0 10-2 0 1 1 0 002 0zm-1-2a1 1 0 01-1-1V7a1 1 0 112 0v3a1 1 0 01-1 1z" clipRule="evenodd" />
  </svg>
);

export const ErrorIcon: React.FC<IconProps> = ({ className = '', size = 'sm' }) => (
  <svg className={`${sizeClasses[size]} ${className}`} fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
  </svg>
);

export const CheckIcon: React.FC<IconProps> = ({ className = '', size = 'md' }) => (
  <svg className={`${sizeClasses[size]} ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

export const CheckCircleIcon: React.FC<IconProps> = ({ className = '', size = 'md' }) => (
  <svg className={`${sizeClasses[size]} ${className}`} fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
  </svg>
);

// ============================================
// SPINNER (Animated)
// ============================================

export const SpinnerIcon: React.FC<IconProps> = ({ className = '', size = 'md' }) => (
  <span className={`${sizeClasses[size]} animate-spin ${className}`}>
    <svg className="w-full h-full" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  </span>
);

// ============================================
// MISC ICONS
// ============================================

export const UploadIcon: React.FC<IconProps> = ({ className = '', size = 'md' }) => (
  <svg className={`${sizeClasses[size]} ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
  </svg>
);

export const EyeIcon: React.FC<IconProps> = ({ className = '', size = 'md' }) => (
  <svg className={`${sizeClasses[size]} ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);

export const FingerprintIcon: React.FC<IconProps> = ({ className = '', size = 'md' }) => (
  <svg className={`${sizeClasses[size]} ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
  </svg>
);

export const NostrKeyIcon: React.FC<IconProps> = ({ className = '', size = 'md' }) => (
  <svg className={`${sizeClasses[size]} ${className}`} viewBox="0 0 64 64" fill="currentColor">
    <path d="M27.651 7.768c-2.558-2.549-6.713-2.521-9.262.036L1.895 24.355c-2.55 2.558-2.517 6.64.04 9.19l27.043 27.042c2.558 2.548 6.705 2.527 9.255-.03l8.038-8.038c-2.345 2.344-4.274.658-6.56-1.618l-4.483-4.483c-3.404 1.347-7.382.677-10.14-2.075l-3.416-3.416a1.151 1.151 0 0 1-.36-.854c0-.162.031-.322.093-.472.063-.15.16-.276.275-.39l1.933-1.933-4.209-4.209c-.659-.658-.766-1.72-.177-2.437a1.776 1.776 0 0 1 2.633-.13l4.266 4.263 2.89-2.89-4.22-4.208c-.659-.658-.766-1.719-.172-2.441a1.78 1.78 0 0 1 2.634-.13l4.283 4.254 1.815-1.815c.114-.115.226-.218.375-.28a1.227 1.227 0 0 1 1.343.266l3.422 3.415c2.723 2.718 3.435 6.674 2.162 10.052l4.484 4.484c2.286 2.276 4.199 3.976 6.543 1.632l10.143-10.143c-2.438 2.438-4.44.56-6.85-1.847L27.65 7.768Z" fillOpacity="0.85" />
    <path d="m46.825 3.257-8.622 8.615L57.36 31.029c1.834 1.826 3.427 3.28 5.196 2.575 1.022-.407 1.724-1.516 1.332-2.545-9.166-24.053-9.17-24.053-10.386-26.682-1.216-2.63-4.636-3.187-6.677-1.12Z" />
  </svg>
);

export const PasskeyIcon: React.FC<IconProps> = ({ className = '', size = 'md' }) => (
  <svg className={`${sizeClasses[size]} ${className}`} viewBox="18 28 168 168" fill="currentColor">
    {/* Key — full shape (slightly lighter than person for depth separation) */}
    <path fillRule="evenodd" clipRule="evenodd" fillOpacity="0.9" d="M172.32,96.79c0,13.78-8.48,25.5-20.29,29.78l7.14,11.83l-10.57,13l10.57,12.71l-17.04,22.87l-12.01-12.82v-25.9v-22.56c-10.68-4.85-18.15-15.97-18.15-28.91c0-17.4,13.51-31.51,30.18-31.51C158.81,65.28,172.32,79.39,172.32,96.79z M142.14,101.61c4.02,0,7.28-3.4,7.28-7.6c0-4.2-3.26-7.61-7.28-7.61s-7.28,3.4-7.28,7.61C134.85,98.21,138.12,101.61,142.14,101.61z" />
    {/* Key — right half at full currentColor (paints over the 0.8 base) */}
    <path fillRule="evenodd" clipRule="evenodd" d="M172.41,96.88c0,13.62-8.25,25.23-19.83,29.67l6.58,11.84l-9.73,13l9.73,12.71l-17.03,23.05v-25.9v-32.77v-26.87c4.02,0,7.28-3.41,7.28-7.6c0-4.2-3.26-7.61-7.28-7.61V65.28C158.86,65.28,172.41,79.43,172.41,96.88z" />
    {/* Person body */}
    <path d="M120.24,131.43c-9.75-8-16.3-20.3-17.2-34.27H50.8c-10.96,0-19.84,9.01-19.84,20.13v25.17c0,5.56,4.44,10.07,9.92,10.07h69.44c5.48,0,9.92-4.51,9.92-10.07V131.43z" />
    {/* Person head */}
    <path d="M73.16,91.13c-2.42-0.46-4.82-0.89-7.11-1.86C57.4,85.64,52.36,78.95,50.73,69.5c-1.12-6.47-0.59-12.87,2.03-18.92c3.72-8.6,10.39-13.26,19.15-14.84c5.24-0.94,10.46-0.73,15.5,1.15c7.59,2.82,12.68,8.26,15.03,16.24c2.38,8.05,2.03,16.1-1.56,23.72c-3.72,7.96-10.21,12.23-18.42,13.9c-0.68,0.14-1.37,0.27-2.05,0.41C78,91.13,75.58,91.13,73.16,91.13z" />
  </svg>
);

export const CurrencyIcon: React.FC<IconProps> = ({ className = '', size = 'md' }) => (
  <svg className={`${sizeClasses[size]} ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);
