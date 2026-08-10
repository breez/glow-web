import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { logger, LogCategory } from '@/services/logger';

/**
 * Payment deep links on native builds.
 *
 * The shell registers `lightning`, `bitcoin`, `lnurlp`, `lnurlw`, `keyauth`
 * and `glow` (glow-app: `ios/App/App/Info.plist` +
 * `android/app/src/main/AndroidManifest.xml`).
 * Whatever the OS hands over lands here, gets normalised into something the
 * SDK parser accepts, and is delivered to whoever is listening (in practice
 * WalletPage, which opens the send sheet with it).
 *
 * An installed PWA gets a narrower version of the same thing through the
 * manifest's `protocol_handlers`, which is limited to `bitcoin:` by the
 * safelist. See `consumeProtocolHandlerLaunch` below. In a plain browser tab
 * nothing is wired at all.
 */

type DeepLinkListener = (paymentInput: string) => void;

/**
 * Normalise an incoming deep link into an SDK-parseable payment input, or
 * null if there is no payload to act on.
 *
 * Only two rewrites are needed, both because of what the SDK parser does
 * and does not strip itself (spark-sdk `common/src/input/parser/mod.rs`):
 *
 *  - `glow:` is our own scheme and means nothing to the parser, so it comes
 *    off entirely and the remainder is parsed on its own.
 *  - The parser matches a literal `lightning:` / `bitcoin:` and nothing more,
 *    so a `lightning://` link would reach it as `//lnbc1...` and fail.
 *    Vendors do emit the authority form, so it is collapsed here.
 *
 * `lnurlp` / `lnurlw` / `keyauth` are deliberately left alone: the parser
 * already accepts both `scheme:` and `scheme://` for those three.
 */
export function toPaymentInput(url: string): string | null {
  const payload = url
    .trim()
    .replace(/^glow:(\/\/)?/i, '')
    .replace(/^lightning:\/\//i, 'lightning:')
    .replace(/^bitcoin:\/\//i, 'bitcoin:');
  return payload.length > 0 ? payload : null;
}

let pending: string | null = null;
let listener: DeepLinkListener | null = null;
let started = false;

function deliver(url: string): void {
  const paymentInput = toPaymentInput(url);
  if (!paymentInput) return;
  // A cold start can surface the same launch URL through both the listener
  // and getLaunchUrl below. Dropping a duplicate of what is already waiting
  // covers that without timers.
  // ponytail: single listener slot, WalletPage is the only consumer. Make it
  // a stack like backButton.ts if a second screen ever needs deep links.
  if (paymentInput === pending) return;
  logger.debug(LogCategory.UI, 'Deep link received');
  if (listener) listener(paymentInput);
  else pending = paymentInput;
}

/**
 * The query parameter an installed PWA is launched with when it handles a
 * registered protocol, per the `protocol_handlers` entry in manifest.json.
 */
const PROTOCOL_HANDLER_PARAM = 'pay';

/**
 * An installed PWA handles a protocol by being launched at a URL, not by
 * receiving an event, so the payload arrives as a query parameter. Consume it
 * and scrub it from the address bar, so a reload doesn't reopen the sheet on a
 * payment the person has already dealt with.
 *
 * Only `bitcoin:` can reach here. The manifest may only claim schemes on the
 * spec's safelist (which has `bitcoin` but not `lightning` or the LNURL ones)
 * or invented `web+` ones, which nothing in the world emits.
 */
function consumeProtocolHandlerLaunch(): void {
  const params = new URLSearchParams(window.location.search);
  const launched = params.get(PROTOCOL_HANDLER_PARAM);
  if (!launched) return;

  params.delete(PROTOCOL_HANDLER_PARAM);
  const query = params.toString();
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
  );
  deliver(launched);
}

/** Start listening for deep links. Safe to call more than once. */
export function startDeepLinks(): void {
  if (started) return;
  started = true;

  consumeProtocolHandlerLaunch();

  if (!Capacitor.isNativePlatform()) return;

  void App.addListener('appUrlOpen', ({ url }) => deliver(url));

  // The launch intent is consumed before any listener can attach, so a cold
  // start from a deep link never fires `appUrlOpen` for it on Android.
  void App.getLaunchUrl()
    .then((result) => {
      if (result?.url) deliver(result.url);
    })
    .catch(() => {
      /* no launch URL, or web: nothing to replay */
    });
}

/**
 * Subscribe to deep links. A link that arrived before the subscriber existed
 * (the cold-start case: the OS opens Glow, the SDK connects, and only then is
 * there a screen to show it on) is replayed immediately. Returns a disposer.
 */
export function onDeepLink(fn: DeepLinkListener): () => void {
  listener = fn;
  if (pending !== null) {
    const replayed = pending;
    pending = null;
    fn(replayed);
  }
  return () => {
    if (listener === fn) listener = null;
  };
}
