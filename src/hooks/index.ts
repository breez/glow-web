// Custom hooks for the Glow wallet app
// These hooks encapsulate common patterns to reduce boilerplate and improve maintainability

export { useAsyncState, useAsyncAction } from './useAsyncState';
export type { AsyncState, UseAsyncStateReturn } from './useAsyncState';

export { useDialogState } from './useDialogState';
export type { UseDialogStateOptions, UseDialogStateReturn } from './useDialogState';

export { useAnimatedNumber } from './useAnimatedNumber';
