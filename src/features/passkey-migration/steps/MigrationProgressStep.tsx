import React from 'react';
import LoadingSpinner from '@/components/LoadingSpinner';
import { AlertTriangleIcon } from '@/components/Icons';

interface MigrationProgressStepProps {
  text: string;
}

/** In-flight spinner shared by every working phase, with a keep-open reminder. */
const MigrationProgressStep: React.FC<MigrationProgressStepProps> = ({ text }) => (
  <div className="flex flex-col items-center justify-center py-6">
    <LoadingSpinner text={text} />
    <div className="mt-3 flex items-center justify-center gap-2 text-xs text-amber-400/80">
      <AlertTriangleIcon size="xs" />
      <span>Keep this window open</span>
    </div>
  </div>
);

export default MigrationProgressStep;
