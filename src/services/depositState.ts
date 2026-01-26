// Service to manage rejected deposits state
// Stores which deposits have been rejected by the user

const REJECTED_DEPOSITS_KEY = 'rejected_deposits_v1';

export interface RejectedDeposit {
  txid: string;
  vout: number;
  rejectedAt: number; // timestamp
}

// In-memory cache for rejected deposits (js-cache-storage optimization)
let cachedDeposits: RejectedDeposit[] | null = null;

/**
 * Get the list of all rejected deposits
 */
export function getRejectedDeposits(): RejectedDeposit[] {
  if (cachedDeposits !== null) {
    return cachedDeposits;
  }
  try {
    const raw = localStorage.getItem(REJECTED_DEPOSITS_KEY);
    if (!raw) {
      cachedDeposits = [];
      return cachedDeposits;
    }
    const parsed = JSON.parse(raw);
    cachedDeposits = Array.isArray(parsed) ? parsed : [];
    return cachedDeposits;
  } catch {
    cachedDeposits = [];
    return cachedDeposits;
  }
}

/**
 * Check if a specific deposit has been rejected
 */
export function isDepositRejected(txid: string, vout: number): boolean {
  const rejected = getRejectedDeposits();
  return rejected.some(d => d.txid === txid && d.vout === vout);
}

/**
 * Mark a deposit as rejected
 */
export function rejectDeposit(txid: string, vout: number): void {
  const rejected = getRejectedDeposits();

  // Avoid duplicates
  if (rejected.some(d => d.txid === txid && d.vout === vout)) {
    return;
  }

  rejected.push({
    txid,
    vout,
    rejectedAt: Date.now(),
  });

  localStorage.setItem(REJECTED_DEPOSITS_KEY, JSON.stringify(rejected));
  cachedDeposits = rejected; // Update cache
}

/**
 * Remove a deposit from the rejected list (e.g., after successful refund or claim)
 */
export function removeRejectedDeposit(txid: string, vout: number): void {
  const rejected = getRejectedDeposits();
  const filtered = rejected.filter(d => !(d.txid === txid && d.vout === vout));
  localStorage.setItem(REJECTED_DEPOSITS_KEY, JSON.stringify(filtered));
  cachedDeposits = filtered; // Update cache
}

/**
 * Clear all rejected deposits (useful for testing or after wallet reset)
 */
export function clearAllRejectedDeposits(): void {
  localStorage.removeItem(REJECTED_DEPOSITS_KEY);
  cachedDeposits = null; // Clear cache
}
