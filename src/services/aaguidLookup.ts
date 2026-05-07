/**
 * Lookup against the AAGUID database vendored from
 * https://github.com/passkeydeveloper/passkey-authenticator-aaguids.
 *
 * The map is keyed by canonical UUID (8-4-4-4-12 hex); Glow stores
 * AAGUIDs as base64 to match our credential-ID format, so we convert at
 * the boundary. AAGUID is self-reported and unverified: use for display,
 * never for trust decisions.
 */
import aaguidData from '../data/aaguids/aaguid.json';

type RawEntry = { name: string; icon_dark?: string; icon_light?: string };
const data = aaguidData as unknown as Record<string, RawEntry>;

export interface AaguidProvider {
  name: string;
  iconLight: string | null;
  iconDark: string | null;
}

function base64ToUuid(b64: string): string | null {
  try {
    const binary = atob(b64);
    if (binary.length !== 16) return null;
    const hex: string[] = [];
    for (let i = 0; i < 16; i++) {
      hex.push(binary.charCodeAt(i).toString(16).padStart(2, '0'));
    }
    return (
      hex.slice(0, 4).join('')
      + '-' + hex.slice(4, 6).join('')
      + '-' + hex.slice(6, 8).join('')
      + '-' + hex.slice(8, 10).join('')
      + '-' + hex.slice(10, 16).join('')
    );
  } catch {
    return null;
  }
}

/** Resolve a base64-encoded AAGUID to its provider entry, or null. */
export function lookupAaguid(aaguidBase64: string): AaguidProvider | null {
  const uuid = base64ToUuid(aaguidBase64);
  if (!uuid) return null;
  const entry = data[uuid];
  if (!entry) return null;
  return {
    name: entry.name,
    iconLight: entry.icon_light ?? null,
    iconDark: entry.icon_dark ?? null,
  };
}
