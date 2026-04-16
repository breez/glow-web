import { useEffect } from 'react';
import { pushStatusBarColor, type SystemBarTarget } from '../utils/statusBarManager';

/**
 * Request a system bar color for the lifetime of this component (or
 * for as long as `active` is true). Multiple components can request
 * colors simultaneously; the most recently activated entry wins via
 * the LIFO stack in statusBarManager.
 *
 * The `target` parameter controls whether the push applies to the
 * status bar, the nav bar, or both (default). Bottom sheets are the
 * main reason for the split — they push nav only while partially
 * expanded and status only once they cover the top of the screen.
 *
 * Use the `active` flag for drawers / dialogs that can open and close
 * without the component unmounting — pass isOpen as `active`.
 */
export function useStatusBarColor(
  color: string,
  active: boolean = true,
  target: SystemBarTarget = 'both',
): void {
  useEffect(() => {
    if (!active) return;
    return pushStatusBarColor(color, target);
  }, [color, active, target]);
}
