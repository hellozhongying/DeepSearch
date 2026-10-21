import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchQuery, handleRequest, normalizeSite, publicIp, validatePageUrl } from '../server.mjs';

function request(url, { headers = {}, method = 'GET' } = {}) {
  const response = {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, responseHeaders = {}) { this.status = status; this.headers = responseHeaders; },
    end(body = '') { this.body = body; },
  };
  return handleRequest(
    { url, method, headers: { host: 'localhost', ...headers } },
    response,
  ).then(() => ({
    status: response.status,
    body: response.body ? JSON.parse(response.body) : null,
  }));
}

async function withUpstream(handler, fn) {
  const priorKey = process.env.DEEPSEEK_API_KEY;
  const priorFetch = globalThis.fetch;
  let sent;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = async (url, options) => {
    sent = { url, body: JSON.parse(options.body), timeout: options.signal };
    return handler(sent);
  };
  try {
    return await fn(() => sent);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = priorKey;
  }
}

test('time ranges use China calendar date and clamp short months', () => {
  const now = new Date('2026-10-21T02:00:00Z');
  assert.equal(buildSearchQuery('新闻', 'all', now), '新闻');
  assert.equal(buildSearchQuery('新闻', 'week', now), '新闻 after:2026-10-14');
  assert.equal(buildSearchQuery('新闻', 'month', now), '新闻 after:2026-09-21');
  assert.equal(buildSearchQuery('新闻', 'year', now), '新闻 after:2025-10-21');
  assert.equal(buildSearchQuery('新闻', 'month', new Date('2026-03-31T04:00:00Z')), '新闻 after:2026-02-28');
  assert.equal(buildSearchQuery('新闻', 'week', new Date('2026-10-20T16:00:00Z')), '新闻 after:2026-10-14');
  assert.equal(buildSearchQuery('新闻', 'week', new Date('2026-10-20T15:59:59Z')), '新闻 after:2026-10-13');
  assert.equal(
    buildSearchQuery('新闻', 'custom', now, { after: '2026-01-01', before: '2026-06-01', lang: 'zh', site: 'news.cn' }),
    '新闻 site:news.cn lang:zh after:2026-01-01 before:2026-06-01',
  );
});

test('site, address, and localization helpers reject unsafe values', () => {
  assert.equal(normalizeSite('https://GitHub.com/foo'), 'github.com');
  assert.equal(normalizeSite('news.cn:443/path'), 'news.cn');
  assert.throws(() => normalizeSite('not a site'), /域名/);
  assert.equal(validatePageUrl('https://example.com/a'), '');
  assert.match(validatePageUrl('http://user:pass@example.com'), /密码/);
  assert.match(validatePageUrl('ftp://example.com'), /HTTP/);
  assert.equal(publicIp('8.8.8.8'), '8.8.8.8');
  assert.equal(publicIp('10.1.2.3'), '');
  assert.equal(publicIp('::ffff:8.8.8.8'), '');
  assert.equal(publicIp('2001:4860:4860::8888'), '2001:4860:4860::8888');
});

test('search and fetch proxy', async (t) => {
  await t.test('invalid filters are rejected before the upstream call', async () => {
    assert.equal((await request('/api/search?q=%E6%96%B0%E9%97%BB&range=bad')).status, 400);
    const tooLong = 'a'.repeat(112);
    const response = await request(`/api/search?q=${tooLong}&range=week`);
    assert.equal(response.status, 400);
    assert.match(response.body.error, /过长/);
    assert.equal((await request('/api/search?q=DeepSeek&lang=fr')).status, 400);
    assert.equal((await request('/api/search?q=DeepSeek&count=51')).status, 400);
    assert.equal((await request('/api/search?q=DeepSeek&range=custom')).status, 400);
    assert.equal((await request('/api/search?q=DeepSeek&range=custom&after=2026-06-01&before=2026-01-01')).status, 400);
    assert.equal((await request('/api/fetch?url=http://user:pass@example.com')).status, 400);
    assert.equal((await request('/api/search?q=DeepSeek', { method: 'POST' })).status, 405);
  });

  await t.test('filtered search passes operators, original question, and public IP', async () => {
    await withUpstream(
      () => ({ ok: true, json: async () => ({ results: [{ title: 'Example', url: 'https://example.com', content: 'hidden', authority: 4, summary: 'long' }] }) }),
      async (sent) => {
        const response = await request('/api/search?q=DeepSeek&range=week&lang=zh&site=https://GitHub.com/foo&count=20', {
          headers: { 'x-forwarded-for': '8.8.8.8, 10.1.2.3' },
        });
        const body = sent();
        assert.equal(response.status, 200);
        assert.equal(body.url, 'https://api.deepseek.com/v1/tools/search');
        assert.match(body.body.query, /^DeepSeek site:github.com lang:zh after:\d{4}-\d{2}-\d{2}$/);
        assert.equal(body.body.ori_question, 'DeepSeek');
        assert.equal(body.body.count, 20);
        assert.equal(body.body.need_content, false);
        assert.equal(body.body.localization, '8.8.8.8');
        assert.equal(response.body.results[0].authority, 4);
        assert.equal(response.body.results[0].summary, 'long');
        assert.equal(response.body.results[0].content, undefined);
      },
    );
  });

  await t.test('plain search omits optional operator fields and private IPs', async () => {
    await withUpstream(
      () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }),
      async (sent) => {
        const response = await request('/api/search?q=DeepSeek', {
          headers: { 'x-forwarded-for': '10.1.2.3, 8.8.8.8' },
        });
        const body = sent().body;
        assert.equal(response.status, 200);
        assert.equal(body.query, 'DeepSeek');
        assert.equal(body.count, 10);
        assert.equal(body.ori_question, undefined);
        assert.equal(body.localization, undefined);
        assert.deepEqual(response.body.results, []);
      },
    );
  });

  await t.test('fetch proxies a page and maps an empty upstream page', async () => {
    await withUpstream(
      () => ({ ok: false, status: 404, json: async () => ({ error: { message: 'missing' } }) }),
      async (sent) => {
        const response = await request('/api/fetch?url=https://example.com/article');
        assert.equal(sent().url, 'https://api.deepseek.com/v1/tools/fetch');
        assert.deepEqual(sent().body, { url: 'https://example.com/article' });
        assert.equal(response.status, 404);
        assert.match(response.body.error, /正文/);
      },
    );
  });
});
