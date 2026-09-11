import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { waitForSheetOpen } from '@/test/utils/waitForSheetOpen';
import { BottomSheetContainer, BottomSheetCard } from './BottomSheet';
import { useSheetBack } from './BottomSheetCardContext';
import { DialogHeader } from '../index';

const Step = ({ label, onBack }: { label: string; onBack?: () => void }) => {
  useSheetBack(onBack);
  return <span>{label}</span>;
};

const ThreeStepSheet = () => {
  const [step, setStep] = useState(2);
  return (
    <BottomSheetContainer isOpen onClose={() => {}}>
      <BottomSheetCard>
        <DialogHeader title="Flow" onClose={() => {}} />
        {step === 0 && <Step label="step 0" />}
        {step === 1 && <Step label="step 1" onBack={() => setStep(0)} />}
        {step === 2 && <Step label="step 2" onBack={() => setStep(1)} />}
      </BottomSheetCard>
    </BottomSheetContainer>
  );
};

describe('useSheetBack', () => {
  it('hands the header back arrow from step to step', async () => {
    render(<ThreeStepSheet />);
    await waitForSheetOpen();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByText('step 1');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByText('step 0');
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });
});

// Behavior tests for gestures/keyboard live upstream in
// react-modal-sheet; these cover the adapter wiring only.
describe('BottomSheetContainer (react-modal-sheet adapter)', () => {
  it('renders sheet content when open', async () => {
    render(
      <BottomSheetContainer isOpen onClose={() => {}}>
        <BottomSheetCard>
          <span>sheet body</span>
        </BottomSheetCard>
      </BottomSheetContainer>,
    );
    expect(await screen.findByText('sheet body')).toBeInTheDocument();
    await waitForSheetOpen();
  });

  it('renders no content while closed', () => {
    render(
      <BottomSheetContainer isOpen={false} onClose={() => {}}>
        <BottomSheetCard>
          <span>hidden body</span>
        </BottomSheetCard>
      </BottomSheetContainer>,
    );
    expect(screen.queryByText('hidden body')).toBeNull();
  });
});
