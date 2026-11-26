// Forwards a translation feedback to Slack so the webhook URL stays out of the app bundle.
import enCommon from '../src/locales/en/common.json';
import enCritical from '../src/locales/en/critical.json';
import shipping from '../src/locales/shipping.json';

// Anyone can POST here, so only a shipping language and keys that exist in the English bundles get through.
const LANGUAGES = new Set((shipping as string[]).filter((l) => l !== 'en'));
const KEYS = new Set<string>();
const collect = (ns: string, node: unknown, path: string[] = []) => {
  if (typeof node === 'string') KEYS.add(`${ns}:${path.join('.')}`.replace(/_(zero|one|two|few|many|other)$/, ''));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) collect(ns, v, [...path, k]);
};
collect('common', enCommon);
collect('critical', enCritical);
const ALLOWED_ORIGINS = new Set([
  'https://glow-app.co',
  'https://breez-glow-staging.vercel.app',
  'capacitor://localhost',
  'https://localhost',
  'http://localhost',
]);

// ponytail: per-instance counter, a shared store if abuse shows up
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
let windowStart = 0;
let count = 0;

const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const escapeSlack = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function cors(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { Vary: 'Origin' };
  const allowed = origin && (ALLOWED_ORIGINS.has(origin) || /^http:\/\/localhost:\d+$/.test(origin));
  if (allowed) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return headers;
}

export function OPTIONS(request: Request): Response {
  return new Response(null, { status: 204, headers: cors(request.headers.get('origin')) });
}

export async function POST(request: Request): Promise<Response> {
  const headers = cors(request.headers.get('origin'));
  if (!headers['Access-Control-Allow-Origin']) return new Response('Forbidden', { status: 403, headers });

  const hook = process.env.TRANSLATION_FEEDBACK_SLACK_WEBHOOK_URL;
  if (!hook) return new Response('Not configured', { status: 503, headers });

  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    count = 0;
  }
  if (++count > MAX_PER_WINDOW) return new Response('Too many submissions', { status: 429, headers });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response('Bad request', { status: 400, headers });
  }
  const language = clip(body.language, 20);
  const text = clip(body.text, 500);
  const suggestion = clip(body.suggestion, 1000);
  const context = clip(body.context, 1000);
  const keys = Array.isArray(body.keys)
    ? body.keys
        .slice(0, 10)
        .map((k) => clip(k, 120))
        .filter(Boolean)
    : [];
  if (!LANGUAGES.has(language) || !text || !suggestion || keys.length === 0 || !keys.every((k) => KEYS.has(k.replace(/_(zero|one|two|few|many|other)$/, ''))))
    return new Response('Bad request', { status: 400, headers });

  const message = [
    `*Translation feedback (${escapeSlack(language)})*`,
    `Keys: ${keys.map((k) => `\`${escapeSlack(k)}\``).join(', ')}`,
    `Shown text: ${escapeSlack(text)}`,
    `Suggested wording: ${escapeSlack(suggestion)}`,
    ...(context ? [`Context: ${escapeSlack(context)}`] : []),
  ].join('\n');

  try {
    const res = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message, unfurl_links: false, unfurl_media: false }),
    });
    return new Response(null, { status: res.ok ? 204 : 502, headers });
  } catch {
    return new Response(null, { status: 502, headers });
  }
}
