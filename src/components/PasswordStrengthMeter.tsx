import React from 'react';
import { type PasswordStrength, passwordStrength } from '../utils/password';

const colors: Record<PasswordStrength, string> = {
  weak: 'bg-spark-error',
  medium: 'bg-spark-warning',
  strong: 'bg-spark-success',
};

const widths: Record<PasswordStrength, string> = {
  weak: 'w-1/3',
  medium: 'w-2/3',
  strong: 'w-full',
};

const labels: Record<PasswordStrength, string> = {
  weak: 'Weak',
  medium: 'Medium',
  strong: 'Strong',
};

const PasswordStrengthMeter: React.FC<{ password: string }> = ({ password }) => {
  if (password.length === 0) return null;
  const level = passwordStrength(password);
  return (
    <div className="mt-2 space-y-1">
      <div className="h-1 w-full bg-spark-border rounded-full overflow-hidden">
        <div className={`h-full ${colors[level]} ${widths[level]} rounded-full transition-all duration-300`} />
      </div>
      <p className="text-xs text-spark-text-muted">{labels[level]}</p>
    </div>
  );
};

export default PasswordStrengthMeter;
