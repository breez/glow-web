import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { HttpResponse } from '@capacitor/core';
import { logger, LogCategory } from './logger';

// Hostnames whose responses are broken under the default WebView fetch on
// Capacitor — typically COEP require-corp blocking a response that lacks
// Cross-Origin-Resource-Policy, or a CORS policy that rejects the
// `capacitor://localhost` / `https://localhost` origin. Requests to these
// hosts are routed via CapacitorHttp.request() (native URLSession /
// OkHttp), which is not subject to browser-level CORS/COEP.
//
// Do NOT add Spark-operator hosts here — those speak gRPC-Web with a
// binary `application/grpc-web+proto` body, and CapacitorHttp's
// string/base64 round-trip mangles the framing (observed: "invalid varint"
// on every protobuf decode). Browser fetch handles those correctly.
const NATIVE_HTTP_HOSTS = new Set<string>([
  'api.lightspark.com',
]);

// Response headers describing the wire-level transport of the ORIGINAL
// response. CapacitorHttp has already decoded / dechunked the body for
// us, so re-propagating these headers confuses the Response consumer —
// notably reqwest in WASM, which will stall waiting on a
// Content-Length worth of bytes or try to re-decompress a body that was
// gunzipped on the native side. Drop them before handing the
// synthesized Response back.
//
// Also strip hop-by-hop headers (RFC 7230) and the OkHttp Android
// extension's debug headers (X-Android-*) — these describe the
// native-side HTTP transaction and have no business on the
// WebView-visible Response.
const STRIPPED_RESPONSE_HEADERS = new Set<string>([
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'upgrade',
]);

function shouldStripHeader(name: string): boolean {
  const lower = name.toLowerCase();
  if (STRIPPED_RESPONSE_HEADERS.has(lower)) return true;
  if (lower.startsWith('x-android-')) return true;
  return false;
}

// HTTP status-line reason phrases. reqwest-wasm doesn't explicitly
// require a non-empty statusText, but real network Responses always
// have one and we want the synthesized Response to look as close to
// the wire as possible.
const STATUS_TEXT: Record<number, string> = {
  200: 'OK', 201: 'Created', 204: 'No Content',
  301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
  404: 'Not Found', 409: 'Conflict', 422: 'Unprocessable Entity',
  500: 'Internal Server Error', 502: 'Bad Gateway',
  503: 'Service Unavailable', 504: 'Gateway Timeout',
};

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function shouldRoute(url: string): boolean {
  try {
    return NATIVE_HTTP_HOSTS.has(new URL(url).host);
  } catch {
    return false;
  }
}

function collectHeaders(source: HeadersInit | Headers | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!source) return out;
  if (source instanceof Headers) {
    source.forEach((value, key) => {
      out[key] = value;
    });
  } else if (Array.isArray(source)) {
    for (const [key, value] of source) out[key] = value;
  } else {
    for (const [key, value] of Object.entries(source)) out[key] = value;
  }
  return out;
}

function filterResponseHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (shouldStripHeader(key)) continue;
    out[key] = value;
  }
  // Synthesized Responses returned from a JS-patched fetch are subject
  // to the browser's Fetch-algorithm CORS filtering when the original
  // Request had mode: 'cors' on a cross-origin URL. Without an ACAO
  // header the Response can end up as type: 'opaque' with an
  // inaccessible body. Add wildcard ACAO as belt-and-braces — safe
  // because we've already handled the actual network call via native
  // HTTP, which isn't subject to browser CORS.
  out['access-control-allow-origin'] = '*';
  out['access-control-expose-headers'] = '*';
  return out;
}

async function extractBody(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<string | undefined> {
  const body = init?.body;
  if (body != null) {
    if (typeof body === 'string') return body;
    if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
    if (ArrayBuffer.isView(body)) {
      return new TextDecoder().decode(
        new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
      );
    }
    throw new Error(
      `nativeHttpRouter: unsupported request body type ${Object.prototype.toString.call(body)}`,
    );
  }
  if (input instanceof Request) {
    try {
      return await input.clone().text();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function routedFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<Response> {
  const request = input instanceof Request ? input : undefined;
  const url = getRequestUrl(input);
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

  const headers = collectHeaders(request?.headers);
  Object.assign(headers, collectHeaders(init?.headers));

  const data =
    method === 'GET' || method === 'HEAD'
      ? undefined
      : await extractBody(input, init);

  // responseType: 'text' is advisory — CapacitorHttp still auto-parses
  // application/json responses into an object, so the body coercion
  // below normalizes both cases back into bytes.
  const response: HttpResponse = await CapacitorHttp.request({
    url,
    method,
    headers,
    data,
    responseType: 'text',
  });

  const bodyText =
    typeof response.data === 'string'
      ? response.data
      : response.data == null
        ? ''
        : JSON.stringify(response.data);
  // Return bytes, not a string, so the Response consumer can do binary
  // reads (.arrayBuffer() / .body.getReader()) without re-encoding.
  // reqwest-wasm reads the body as a byte stream and a DOMString-backed
  // Response has occasionally been observed to stall the read on
  // Android WebView.
  const bodyBytes = new TextEncoder().encode(bodyText);

  const synthesized = new Response(bodyBytes, {
    status: response.status,
    statusText: STATUS_TEXT[response.status] ?? '',
    headers: filterResponseHeaders(response.headers ?? {}),
  });

  // `new Response(...)` creates a Response with `url = ''` and
  // `type = 'default'`. Some HTTP clients (reqwest-wasm included)
  // treat an empty url / non-basic type as a signal that the Response
  // isn't usable and quietly drop it, so the caller's await never
  // settles. Shadow the prototype getters with own-properties that
  // report the real URL and a basic type.
  try {
    Object.defineProperty(synthesized, 'url', {
      value: url,
      writable: false,
      enumerable: true,
      configurable: true,
    });
  } catch {
    /* If defineProperty fails (older WebView?), the empty url may
       still work — best-effort patch, not a hard requirement. */
  }

  return synthesized;
}

let installed = false;

export function installNativeHttpRouter(): void {
  if (installed) return;
  if (!Capacitor.isNativePlatform()) return;

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async function (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    let url: string;
    try {
      url = getRequestUrl(input);
    } catch {
      return originalFetch(input, init);
    }

    if (!shouldRoute(url)) {
      return originalFetch(input, init);
    }

    try {
      return await routedFetch(input, init);
    } catch (err) {
      logger.error(LogCategory.SDK, 'Native HTTP router failed', {
        url,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };

  installed = true;
  logger.info(LogCategory.SDK, 'Native HTTP router installed', {
    hosts: Array.from(NATIVE_HTTP_HOSTS),
  });
}
