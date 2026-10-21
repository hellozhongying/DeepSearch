import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  ranges,
  languages,
  parseDay,
  parseCount,
  normalizeSite,
  validatePageUrl,
  publicIp,
  buildSearchQuery,
} from './query.mjs';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(projectRoot, 'public');
const port = Number(process.env.PORT || 3000);
const rangeSet = new Set(ranges);
const languageSet = new Set(languages);
const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/query.mjs': ['../query.mjs', 'text/javascript; charset=utf-8'],
};

export { buildSearchQuery, normalizeSite, parseDay, publicIp, validatePageUrl };

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function localizationIp(request) {
  const forwarded = request.headers?.['x-forwarded-for'];
  const realIp = request.headers?.['x-real-ip'];
  const raw = (typeof forwarded === 'string' ? forwarded.split(',')[0] : '')
    || (typeof realIp === 'string' ? realIp : '')
    || request.socket?.remoteAddress
    || '';
  const ip = String(raw).trim().replace(/^::ffff:/, '');
  return publicIp(ip);
}

function upstreamFailure(status, kind) {
  const search = {
    400: [400, '搜索请求无效，请调整关键词或筛选条件。'],
    401: [401, '搜索服务的 API Key 无效。'],
    402: [402, '搜索服务账号余额不足。'],
    408: [504, '搜索服务响应超时，请稍后再试。'],
    429: [429, '搜索请求过于频繁，请稍后再试。'],
    504: [504, '搜索服务响应超时，请稍后再试。'],
  };
  const fetchErrors = {
    400: [400, '网页地址无效。'],
    401: [401, '搜索服务的 API Key 无效。'],
    402: [402, '搜索服务账号余额不足。'],
    403: [403, '该网页被安全策略拒绝，无法预览。'],
    404: [404, '未能获取该网页正文。'],
    408: [504, '抓取超时，请稍后再试。'],
    429: [429, '抓取请求过于频繁，请稍后再试。'],
    504: [504, '抓取超时，请稍后再试。'],
  };
  const mapped = (kind === 'fetch' ? fetchErrors : search)[status];
  if (mapped) return { status: mapped[0], error: mapped[1] };
  return {
    status: 502,
    error: kind === 'fetch' ? '暂时无法预览该网页，请稍后再试。' : '搜索服务暂时不可用，请稍后再试。',
  };
}

async function readJson(upstream) {
  try { return await upstream.json(); } catch { return {}; }
}

async function postTool(pathname, body, timeout) {
  return fetch(`https://api.deepseek.com${pathname}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
}

function toResult(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    title: typeof item.title === 'string' ? item.title : '',
    url: typeof item.url === 'string' ? item.url : '',
    snippet: typeof item.snippet === 'string' ? item.snippet : '',
    summary: typeof item.summary === 'string' ? item.summary : '',
    site_name: typeof item.site_name === 'string' ? item.site_name : null,
    site_icon: typeof item.site_icon === 'string' ? item.site_icon : null,
    date: typeof item.date === 'string' ? item.date : null,
    authority: Number.isInteger(item.authority) ? item.authority : -1,
  };
}

async function handleSearch(url, request, response) {
  const query = (url.searchParams.get('q') || '').trim();
  if (!query || [...query].length > 128) {
    sendJson(response, 400, { error: '请输入 1～128 个字符的搜索词。' });
    return;
  }

  const range = url.searchParams.get('range') || 'all';
  if (!rangeSet.has(range)) {
    sendJson(response, 400, { error: '无效的时间范围。' });
    return;
  }

  const lang = url.searchParams.get('lang') || '';
  if (lang && !languageSet.has(lang)) {
    sendJson(response, 400, { error: '不支持的语言筛选。' });
    return;
  }

  let site = '';
  try {
    site = normalizeSite(url.searchParams.get('site') || '');
  } catch (error) {
    sendJson(response, 400, { error: error.message });
    return;
  }

  let after = '';
  let before = '';
  if (range === 'custom') {
    after = parseDay(url.searchParams.get('after'));
    before = parseDay(url.searchParams.get('before'));
    if (after == null) {
      sendJson(response, 400, { error: '开始日期无效。' });
      return;
    }
    if (before == null) {
      sendJson(response, 400, { error: '结束日期无效。' });
      return;
    }
  }

  const count = parseCount(url.searchParams.get('count'));
  if (count == null) {
    sendJson(response, 400, { error: '结果条数需要在 1～50 之间。' });
    return;
  }

  let searchQuery;
  try {
    searchQuery = buildSearchQuery(query, range, new Date(), { lang, site, after, before });
  } catch (error) {
    sendJson(response, 400, { error: error.message });
    return;
  }
  if ([...searchQuery].length > 128) {
    sendJson(response, 400, { error: '筛选后搜索词过长，请缩短关键词或减少筛选条件。' });
    return;
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    sendJson(response, 503, { error: '服务器尚未配置 DEEPSEEK_API_KEY。' });
    return;
  }

  const body = { query: searchQuery, count, need_content: false };
  if (searchQuery !== query) body.ori_question = query;
  const ip = localizationIp(request);
  if (ip) body.localization = ip;

  try {
    const upstream = await postTool('/v1/tools/search', body, 15000);
    const payload = await readJson(upstream);
    if (!upstream.ok) {
      const failure = upstreamFailure(upstream.status, 'search');
      sendJson(response, failure.status, { error: failure.error });
      return;
    }
    const results = Array.isArray(payload.results) ? payload.results.map(toResult).filter(Boolean) : [];
    sendJson(response, 200, { results });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    sendJson(response, timedOut ? 504 : 502, {
      error: timedOut ? '搜索服务响应超时，请稍后再试。' : '搜索服务连接失败，请稍后再试。',
    });
  }
}

async function handleFetch(url, response) {
  const pageUrl = (url.searchParams.get('url') || '').trim();
  const invalid = validatePageUrl(pageUrl);
  if (invalid) {
    sendJson(response, 400, { error: invalid });
    return;
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    sendJson(response, 503, { error: '服务器尚未配置 DEEPSEEK_API_KEY。' });
    return;
  }

  try {
    const upstream = await postTool('/v1/tools/fetch', { url: pageUrl }, 20000);
    const payload = await readJson(upstream);
    if (!upstream.ok) {
      const failure = upstreamFailure(upstream.status, 'fetch');
      sendJson(response, failure.status, { error: failure.error });
      return;
    }
    sendJson(response, 200, {
      title: typeof payload.title === 'string' ? payload.title : '',
      content: typeof payload.content === 'string' ? payload.content : '',
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    sendJson(response, timedOut ? 504 : 502, {
      error: timedOut ? '抓取超时，请稍后再试。' : '抓取网页失败，请稍后再试。',
    });
  }
}

export async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (url.pathname === '/api/search' || url.pathname === '/api/fetch') {
    if (request.method !== 'GET') {
      response.writeHead(405, { allow: 'GET' });
      response.end();
      return;
    }
    if (url.pathname === '/api/search') await handleSearch(url, request, response);
    else await handleFetch(url, response);
    return;
  }

  const file = files[url.pathname];
  if (!file || request.method !== 'GET') {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  try {
    const content = await readFile(path.join(publicRoot, file[0]));
    response.writeHead(200, { 'content-type': file[1], 'cache-control': 'no-cache' });
    response.end(content);
  } catch {
    response.writeHead(500);
    response.end('Server error');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer(handleRequest).listen(port, () => console.log(`HQ Search: http://localhost:${port}`));
}
