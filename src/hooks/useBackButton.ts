import { useEffect } from 'react';
import { pushBackButtonHandler, BackButtonHandler } from '../utils/backButton';

/**
 * React hook that registers a back-button handler while `active` is
 * true. When `active` flips false, the handler is removed from the
 * stack. Use this in every component that opens a dismissable layer
 * (bottom sheets, drawers, confirm dialogs, side menus):
 *
 *     useBackButton(() => onClose?.(), isOpen);
 *
 * The `handler` doesn't need to return anything — returning `void`
 * counts as "handled" for back-button purposes, which is what you
 * want for a close callback. Return `false` explicitly if you want
 * to pass through to the next handler in the stack.
 */
export function useBackButton(handler: BackButtonHandler, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return pushBackButtonHandler(handler);
    // We deliberately depend on `handler` by reference: modal
    // components usually memoise their onClose callbacks, and if they
    // don't, re-registering across renders is still correct (the
    // disposer removes the old one by reference before the new one
    // is pushed).
  }, [handler, active]);
}
