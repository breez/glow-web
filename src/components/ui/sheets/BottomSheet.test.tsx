import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { waitForSheetOpen } from '@/test/utils/waitForSheetOpen';
import { BottomSheetContainer, BottomSheetCard } from './BottomSheet';
import { useSheetBack, useSheetOwnsScroll } from './BottomSheetCardContext';
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

const ScrollingStep = () => {
  useSheetOwnsScroll();
  return <span>list</span>;
};

const OwnedScrollSheet = () => {
  const [scrolls, setScrolls] = useState(true);
  return (
    <BottomSheetContainer isOpen onClose={() => {}}>
      <BottomSheetCard>
        <button onClick={() => setScrolls(false)}>leave</button>
        {scrolls && <ScrollingStep />}
      </BottomSheetCard>
    </BottomSheetContainer>
  );
};

const scrollerTouchAction = () =>
  document.querySelector<HTMLElement>('.react-modal-sheet-content-scroller')?.style
    .touchAction;

describe('useSheetOwnsScroll', () => {
  it('lifts the sheet drag off the content while a step scrolls itself', async () => {
    render(<OwnedScrollSheet />);
    await waitForSheetOpen();

    // pan-y, not the library's pan-down: touch-action intersects down the
    // ancestor chain, so pan-down would leave an inner list unscrollable.
    expect(scrollerTouchAction()).toBe('pan-y');

    fireEvent.click(screen.getByRole('button', { name: 'leave' }));
    await waitFor(() => expect(scrollerTouchAction()).toBe('pan-down'));
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
