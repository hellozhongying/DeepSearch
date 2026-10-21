// Shared by the Node server and the browser. Keep this file free of Node APIs.

export const ranges = ['all', 'week', 'month', 'year', 'custom'];
export const languages = ['zh', 'en'];

const rangeSet = new Set(ranges);

export function parseDay(value) {
  if (value == null || value === '') return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1970 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return value;
}

export function parseCount(value) {
  if (value == null || value === '') return 10;
  if (!/^\d{1,2}$/.test(String(value))) return null;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 50) return null;
  return count;
}

export function normalizeSite(value) {
  let site = String(value ?? '').trim();
  if (!site) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(site)) {
    let parsed;
    try { parsed = new URL(site); } catch { throw new Error('站点格式无效，请输入如 github.com 的域名。'); }
    site = parsed.hostname;
  } else if (/[^\x00-\x7F]/.test(site)) {
    try { site = new URL(`http://${site}`).hostname; } catch { throw new Error('站点格式无效，请输入如 github.com 的域名。'); }
  }
  site = site.replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  if (site.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(site)) {
    throw new Error('站点格式无效，请输入如 github.com 的域名。');
  }
  return site.toLowerCase();
}

export function validatePageUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || [...raw].length > 8192) return '请输入有效的网页地址。';
  let url;
  try { url = new URL(raw); } catch { return '请输入有效的网页地址。'; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '只支持 HTTP 或 HTTPS 网页。';
  if (!url.hostname) return '网页地址缺少主机名。';
  if (url.username || url.password) return '网页地址不能包含用户名或密码。';
  return '';
}

export function publicIp(value) {
  const ip = String(value ?? '').trim();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    const parts = ip.split('.');
    if (parts.some(part => part.length > 1 && part.startsWith('0'))) return '';
    const numbers = parts.map(Number);
    if (numbers.some(number => number > 255)) return '';
    const [a, b] = numbers;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return '';
    if (a === 169 && b === 254) return '';
    if (a === 172 && b >= 16 && b <= 31) return '';
    if (a === 192 && b === 168) return '';
    if (a === 100 && b >= 64 && b <= 127) return '';
    return ip;
  }
  if (!isIPv6(ip)) return '';
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return '';
  if (/^(fe80:|fc|fd|ff)/.test(lower)) return '';
  return ip;
}

function isIPv6(ip) {
  if (!ip.includes(':') || ip.length > 45 || !/^[0-9a-f:]+$/i.test(ip)) return false;
  const halves = ip.split('::');
  if (halves.length > 2) return false;
  const groups = halves.map(part => (part === '' ? [] : part.split(':')));
  const count = groups[0].length + (groups[1]?.length || 0);
  if (halves.length === 1 && count !== 8) return false;
  if (halves.length === 2 && count >= 8) return false;
  return groups.flat().every(group => group.length >= 1 && group.length <= 4);
}

function cutoffDate(range, now) {
  // Use the calendar date in China so the selected range does not depend on
  // the server's deployment timezone.
  const chinaDate = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = chinaDate.getUTCFullYear();
  const month = chinaDate.getUTCMonth();
  const day = chinaDate.getUTCDate();
  let cutoff;
  if (range === 'week') {
    cutoff = new Date(Date.UTC(year, month, day - 7));
  } else {
    const targetFirstDay = new Date(Date.UTC(year - (range === 'year' ? 1 : 0), month - (range === 'month' ? 1 : 0), 1));
    const lastDay = new Date(Date.UTC(targetFirstDay.getUTCFullYear(), targetFirstDay.getUTCMonth() + 1, 0)).getUTCDate();
    cutoff = new Date(Date.UTC(targetFirstDay.getUTCFullYear(), targetFirstDay.getUTCMonth(), Math.min(day, lastDay)));
  }
  return cutoff.toISOString().slice(0, 10);
}

export function buildSearchQuery(query, range, now = new Date(), options = {}) {
  if (!rangeSet.has(range)) throw new Error('无效的时间范围。');
  const parts = [query];
  if (options.site) parts.push(`site:${options.site}`);
  if (options.lang) parts.push(`lang:${options.lang}`);
  if (range === 'custom') {
    if (!options.after && !options.before) throw new Error('请选择开始或结束日期。');
    if (options.after && options.before && options.after > options.before) throw new Error('开始日期不能晚于结束日期。');
    if (options.after) parts.push(`after:${options.after}`);
    if (options.before) parts.push(`before:${options.before}`);
  } else if (range !== 'all') {
    parts.push(`after:${cutoffDate(range, now)}`);
  }
  return parts.join(' ');
}
