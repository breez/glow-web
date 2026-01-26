import { useState, useCallback, useRef } from 'react';

/**
 * Custom hook for managing async operations with loading and error states.
 * Eliminates boilerplate try/catch/finally patterns across the codebase.
 *
 * @example
 * const { isLoading, error, execute } = useAsyncState();
 *
 * const handleSubmit = () => execute(async () => {
 *   await api.submit(data);
 *   return result;
 * });
 */
export interface AsyncState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
}

export interface UseAsyncStateReturn<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  setData: (data: T | null) => void;
  setError: (error: string | null) => void;
  execute: (fn: () => Promise<T>) => Promise<T | null>;
  reset: () => void;
}

export function useAsyncState<T = void>(
  initialData: T | null = null
): UseAsyncStateReturn<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: initialData,
    isLoading: false,
    error: null,
  });

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);

  // Track current operation to prevent race conditions
  const operationIdRef = useRef(0);

  const setData = useCallback((data: T | null) => {
    if (isMountedRef.current) {
      setState(prev => ({ ...prev, data, error: null }));
    }
  }, []);

  const setError = useCallback((error: string | null) => {
    if (isMountedRef.current) {
      setState(prev => ({ ...prev, error, isLoading: false }));
    }
  }, []);

  const reset = useCallback(() => {
    if (isMountedRef.current) {
      setState({
        data: initialData,
        isLoading: false,
        error: null,
      });
    }
  }, [initialData]);

  const execute = useCallback(async (fn: () => Promise<T>): Promise<T | null> => {
    const currentOperationId = ++operationIdRef.current;

    if (isMountedRef.current) {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
    }

    try {
      const result = await fn();

      // Only update state if this is still the latest operation
      if (isMountedRef.current && currentOperationId === operationIdRef.current) {
        setState({
          data: result,
          isLoading: false,
          error: null,
        });
      }

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred';

      // Only update state if this is still the latest operation
      if (isMountedRef.current && currentOperationId === operationIdRef.current) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: errorMessage,
        }));
      }

      return null;
    }
  }, []);

  return {
    data: state.data,
    isLoading: state.isLoading,
    error: state.error,
    setData,
    setError,
    execute,
    reset,
  };
}

/**
 * Simplified version for operations that don't need to track data
 */
export function useAsyncAction() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async <T>(fn: () => Promise<T>): Promise<T | null> => {
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

  const reset = useCallback(() => {
    setIsLoading(false);
    setError(null);
  }, []);

  return { isLoading, error, setError, execute, reset };
}

export default useAsyncState;
