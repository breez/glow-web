import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST, OPTIONS } from '../../api/translation-feedback';

// A browser Request drops `origin` (a forbidden header), so the handler gets a stand-in.
const req = (body: unknown, origin = 'capacitor://localhost') =>
  ({ headers: new Headers({ origin }), json: async () => body }) as unknown as Request;
const good = { language: 'de', keys: ['common:send.title'], text: 'Hallo <!channel>', suggestion: 'Hi' };

describe('translation feedback endpoint', () => {
  beforeEach(() => {
    process.env.TRANSLATION_FEEDBACK_SLACK_WEBHOOK_URL = 'https://hooks.example/test';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('ok')),
    );
  });

  it('forwards valid feedback with Slack markup escaped', async () => {
    const res = await POST(req(good));
    expect(res.status).toBe(204);
    const sent = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(sent.text).toContain('&lt;!channel&gt;');
    expect(sent.text).not.toContain('<!channel>');
    expect(sent.text).not.toContain('Context:');
  });

  it('adds the optional context when present', async () => {
    await POST(req({ ...good, context: 'Button on the send screen' }));
    const sent = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(sent.text).toContain('Context: Button on the send screen');
  });

  it('refuses unknown origins and incomplete feedback', async () => {
    expect((await POST(req(good, 'https://evil.example'))).status).toBe(403);
    expect((await POST(req({ ...good, suggestion: '' }))).status).toBe(400);
  });

  it('refuses made-up keys and languages', async () => {
    expect((await POST(req({ ...good, keys: ['<script>alert(1)</script>'] }))).status).toBe(400);
    expect((await POST(req({ ...good, keys: ['common:a'] }))).status).toBe(400);
    expect((await POST(req({ ...good, language: 'xx' }))).status).toBe(400);
    expect((await POST(req({ ...good, language: 'en' }))).status).toBe(400);
  });

  it('answers the preflight for an allowed origin', () => {
    const res = OPTIONS(req({}));
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
  });
});
