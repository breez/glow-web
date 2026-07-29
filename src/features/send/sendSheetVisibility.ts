/**
 * Whether the send sheet is currently on screen.
 *
 * The sheet is dismissible mid-payment (backdrop tap, hardware back), and
 * the SDK call keeps running after it closes. The success toast is
 * suppressed for sends because ResultStep normally reports the outcome,
 * so a user who walked away is told nothing, and an unreported SUCCESS is
 * the dangerous direction: the natural response is to send again.
 *
 * Module-level rather than context so the SDK event handler can read it
 * without a re-render coupling between the sheet and the app root. Same
 * shape as `utils/backButton.ts`.
 */

let sendSheetOpen = false;

export function setSendSheetOpen(open: boolean): void {
  sendSheetOpen = open;
}

export function isSendSheetOpen(): boolean {
  return sendSheetOpen;
}
