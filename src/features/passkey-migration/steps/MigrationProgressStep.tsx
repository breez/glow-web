import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import LoadingSpinner from '@/components/LoadingSpinner';
import { AlertTriangleIcon } from '@/components/Icons';

interface MigrationProgressStepProps {
  text: string;
}

/** In-flight spinner shared by every working phase, with a keep-open reminder. */
const MigrationProgressStep: React.FC<MigrationProgressStepProps> = ({ text }) => (
  <div className="flex flex-col items-center justify-center py-6">
    <LoadingSpinner />
    {/* Crossfade the label so a phase or sub-step change reads as forward progress, not a jump. */}
    <div className="mt-4 h-5 flex items-center justify-center overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.p
          key={text}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="font-display font-medium text-spark-text-primary text-sm"
        >
          {text}
        </motion.p>
      </AnimatePresence>
    </div>
    <div className="mt-3 flex items-center justify-center gap-2 text-xs text-spark-primary-light">
      <AlertTriangleIcon size="xs" className="text-spark-primary" />
      <span>Keep this window open</span>
    </div>
  </div>
);

export default MigrationProgressStep;
