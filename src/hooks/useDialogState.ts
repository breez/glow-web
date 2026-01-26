import { useState, useCallback } from 'react';

/**
 * Custom hook for managing multi-step dialog/workflow state.
 * Provides consistent step navigation, loading, and error handling.
 *
 * @example
 * const dialog = useDialogState(['input', 'confirm', 'processing', 'result']);
 *
 * // Navigation
 * dialog.goTo('confirm');
 * dialog.goBack();
 * dialog.reset();
 *
 * // State access
 * dialog.currentStep // 'input'
 * dialog.isLoading
 * dialog.error
 */

export interface UseDialogStateOptions<T extends string> {
  initialStep: T;
  steps: readonly T[];
}

export interface UseDialogStateReturn<T extends string> {
  currentStep: T;
  isLoading: boolean;
  error: string | null;
  stepIndex: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  goTo: (step: T) => void;
  goNext: () => void;
  goBack: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
  withLoading: <R>(fn: () => Promise<R>) => Promise<R | null>;
}

export function useDialogState<T extends string>(
  steps: readonly T[],
  initialStep?: T
): UseDialogStateReturn<T> {
  const firstStep = initialStep ?? steps[0];

  const [currentStep, setCurrentStep] = useState<T>(firstStep);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepIndex = steps.indexOf(currentStep);
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === steps.length - 1;

  const goTo = useCallback((step: T) => {
    setCurrentStep(step);
    setError(null);
  }, []);

  const goNext = useCallback(() => {
    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex < steps.length - 1) {
      setCurrentStep(steps[currentIndex + 1]);
      setError(null);
    }
  }, [currentStep, steps]);

  const goBack = useCallback(() => {
    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex > 0) {
      setCurrentStep(steps[currentIndex - 1]);
      setError(null);
    }
  }, [currentStep, steps]);

  const setLoadingState = useCallback((loading: boolean) => {
    setIsLoading(loading);
  }, []);

  const setErrorState = useCallback((err: string | null) => {
    setError(err);
  }, []);

  const reset = useCallback(() => {
    setCurrentStep(firstStep);
    setIsLoading(false);
    setError(null);
  }, [firstStep]);

  const withLoading = useCallback(async <R>(fn: () => Promise<R>): Promise<R | null> => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await fn();
      setIsLoading(false);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred';
      setError(errorMessage);
      setIsLoading(false);
      return null;
    }
  }, []);

  return {
    currentStep,
    isLoading,
    error,
    stepIndex,
    isFirstStep,
    isLastStep,
    goTo,
    goNext,
    goBack,
    setLoading: setLoadingState,
    setError: setErrorState,
    reset,
    withLoading,
  };
}

export default useDialogState;
