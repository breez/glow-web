/** Where the migration modal was opened from. */
export type MigrationEntry = 'banner' | 'login';

/** Outcome reported back to the caller when the modal closes. */
export type MigrationOutcome =
  /** No old passkey found / user skipped. Caller may proceed with a fresh shared passkey. */
  | 'proceed'
  /** Migration ran (App has taken over) OR the user cancelled. Caller does nothing. */
  | 'handled';

/** Internal phase state machine for the migration flow. */
export type MigrationPhase =
  | 'explain'
  | 'probe'              // login only: list labels on LEGACY (captures labels)
  | 'enumerate-labels'   // banner only: list labels on LEGACY (one prompt)
  | 'confirm-labels'     // show list + count, user confirms
  | 'check-deposits-all' // per label: derive seed, connect, sync, list unclaimed deposits
  | 'blocked-deposits'   // one or more labels have unclaimed deposits
  | 'derive-new-passkey' // create the shared passkey (one-time)
  | 'sweep-label'        // per-label loop: connect both, save label, sweep, LN address, contacts
  | 'switch'             // adopt the primary (last/active) new SDK
  | 'done'               // success screen; user clicks Done to close + land on wallet
  | 'error';
