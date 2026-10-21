import { languages, parseDay, ranges } from '/query.mjs';

const form = document.querySelector('#search-template').content.firstElementChild.cloneNode(true);
const input = form.querySelector('input');
const clearButton = form.querySelector('.clear-button');
const homeSearch = document.querySelector('#home-search');
const headerSearch = document.querySelector('#header-search');
const resultsPage = document.querySelector('#results-page');
const resultsList = document.querySelector('#results-list');
const resultsMeta = document.querySelector('#results-meta');
const pager = document.querySelector('#pager');
const status = document.querySelector('#status');
const filterStatus = document.querySelector('#filter-status');
const langFilter = document.querySelector('#lang-filter');
const dateFilter = document.querySelector('#date-filter');
const afterFilter = document.querySelector('#after-filter');
const beforeFilter = document.querySelector('#before-filter');
const clearFilters = document.querySelector('#clear-filters');
const tabs = [...document.querySelectorAll('.time-tabs a')];
const syntaxDialog = document.querySelector('#syntax-dialog');
const syntaxStatus = document.querySelector('#syntax-status');
const previewDialog = document.querySelector('#preview-dialog');
const previewTitle = document.querySelector('#preview-title');
const previewOpen = document.querySelector('#preview-open');
const previewStatus = document.querySelector('#preview-status');
const previewBody = document.querySelector('#preview-body');

const PAGE_SIZE = 10;
const RESULT_LIMIT = 50;
const qColors = ['#ea4335', '#fbbc05', '#4285f4', '#34a853'];
const searchColors = ['#4285f4', '#ea4335', '#fbbc05', '#34a853', '#4285f4', '#ea4335'];
const emptyState = { query: '', range: 'all', lang: '', after: '', before: '', page: 1 };
const rangeNames = { week: '近一周', month: '近一月', year: '近一年' };
const langNames = { zh: '中文', en: 'English' };
let state = { ...emptyState };
let resultItems = [];
let loadedKey = '';
let activeRequest;
let previewRequest;

homeSearch.append(form);

function textElement(tag, className, value) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value ?? '';
  return element;
}

function appendHighlighted(parent, text, query) {
  const source = text ?? '';
  const needle = query.trim();
  if (!needle) {
    parent.append(source);
    return;
  }
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, 'gi');
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > last) parent.append(source.slice(last, match.index));
    const mark = document.createElement('em');
    mark.textContent = match[0];
    parent.append(mark);
    last = match.index + match[0].length;
  }
  if (last < source.length) parent.append(source.slice(last));
}

function highlightQuery(query) {
  return query
    .replace(/(?:^|\s)[+-]?(?:site|lang|after|before):(?:"[^"]+"|\S+)/gi, ' ')
    .replace(/"/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchParams(next) {
  const params = new URLSearchParams();
  params.set('q', next.query);
  if (next.range !== 'all') params.set('range', next.range);
  if (next.lang) params.set('lang', next.lang);
  if (next.range === 'custom') {
    if (next.after) params.set('after', next.after);
    if (next.before) params.set('before', next.before);
  }
  if (next.page > 1) params.set('page', String(next.page));
  return params;
}

function requestParams(next) {
  const params = searchParams(next);
  params.delete('page');
  params.set('count', String(RESULT_LIMIT));
  return params;
}

function filterKey(next) {
  return [next.query, next.range, next.lang, next.after, next.before].join('\0');
}

function parsePage(value) {
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) return 1;
  return page;
}

function pageCount() {
  return Math.max(1, Math.ceil(resultItems.length / PAGE_SIZE));
}

function pageUrl(next) {
  const params = searchParams(next);
  const query = params.toString();
  return query ? `/?${query}` : '/';
}

function sameState(left, right) {
  return left.query === right.query
    && left.range === right.range
    && left.lang === right.lang
    && left.after === right.after
    && left.before === right.before
    && left.page === right.page;
}

function syncClearButton() {
  clearButton.hidden = !input.value;
}

function syncControls() {
  langFilter.value = languages.includes(state.lang) ? state.lang : '';
  afterFilter.value = parseDay(state.after) || '';
  beforeFilter.value = parseDay(state.before) || '';
  dateFilter.hidden = state.range !== 'custom';
  clearFilters.hidden = state.range === 'all' && !state.lang;
  for (const tab of tabs) {
    const selected = tab.dataset.range === state.range;
    const target = { ...state, range: tab.dataset.range, page: 1 };
    tab.href = tab.dataset.range === 'custom' && !state.after && !state.before ? '#' : pageUrl(target);
    if (selected) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

function describeResults(total) {
  const start = (state.page - 1) * PAGE_SIZE + 1;
  const end = Math.min(state.page * PAGE_SIZE, total);
  const bits = [total > PAGE_SIZE ? `第 ${start}–${end} 条，共 ${total} 条` : `显示 ${total} 条结果`];
  if (rangeNames[state.range]) bits.push(rangeNames[state.range]);
  if (state.range === 'custom') {
    if (state.after) bits.push(`${state.after} 之后`);
    if (state.before) bits.push(`${state.before} 之前`);
  }
  if (langNames[state.lang]) bits.push(langNames[state.lang]);
  return bits.join(' · ');
}

function usableResult(result) {
  if (!result?.url) return false;
  try {
    const url = new URL(result.url);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function renderResult(result) {
  if (!usableResult(result)) return false;
  const url = new URL(result.url);

  const item = textElement('article', 'result');
  const source = textElement('div', 'result-source');
  if (result.site_icon) {
    try {
      const iconUrl = new URL(result.site_icon);
      if (['http:', 'https:'].includes(iconUrl.protocol)) {
        const icon = document.createElement('img');
        icon.className = 'result-icon';
        icon.src = iconUrl.href;
        icon.alt = '';
        icon.loading = 'lazy';
        icon.referrerPolicy = 'no-referrer';
        source.append(icon);
      }
    } catch { /* Icon is optional. */ }
  }
  const sourceText = textElement('div', 'result-source-text');
  const sourceLine = textElement('div', 'result-source-line');
  sourceLine.append(textElement('div', 'result-source-name', result.site_name || url.hostname));
  if (Number(result.authority) >= 3) sourceLine.append(textElement('span', 'result-badge', '权威来源'));
  sourceText.append(sourceLine);
  sourceText.append(textElement('div', 'result-host', url.hostname));
  source.append(sourceText);

  const title = textElement('a', 'result-title', result.title || url.href);
  title.href = url.href;
  title.target = '_blank';
  title.rel = 'noopener noreferrer';

  const snippet = textElement('p', 'result-snippet');
  if (result.date) {
    const date = new Date(result.date);
    if (!Number.isNaN(date.valueOf())) {
      snippet.append(textElement('span', 'result-date', `${date.toLocaleDateString('zh-CN')} — `));
    }
  }
  const brief = result.snippet || '';
  const detail = result.summary || '';
  const snippetText = document.createElement('span');
  appendHighlighted(snippetText, brief || detail, highlightQuery(state.query));
  snippet.append(snippetText);

  const actions = textElement('div', 'result-actions');
  if (brief && detail && detail.trim() !== brief.trim() && detail.length > brief.length + 20) {
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.textContent = '展开摘要';
    let expanded = false;
    expand.addEventListener('click', () => {
      expanded = !expanded;
      expand.textContent = expanded ? '收起摘要' : '展开摘要';
      snippetText.replaceChildren();
      appendHighlighted(snippetText, expanded ? detail : brief, highlightQuery(state.query));
    });
    actions.append(expand);
  }
  const preview = document.createElement('button');
  preview.type = 'button';
  preview.textContent = '预览正文';
  preview.addEventListener('click', () => openPreview(url.href, result.title || url.hostname));
  actions.append(preview);

  item.append(source, title, snippet, actions);
  resultsList.append(item);
  return true;
}

function unescapeMarkdown(text) {
  return text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');
}

function prepareMarkdown(markdown) {
  // Fetch sometimes returns CommonMark backslash escapes for every punctuation
  // mark, including heading markers. Restore them outside fenced code.
  let inCode = false;
  return String(markdown || '').replace(/\r\n/g, '\n').split('\n').map(line => {
    if (/^\s{0,3}(?:```|~~~)/.test(line)) {
      inCode = !inCode;
      return line;
    }
    return inCode ? line : unescapeMarkdown(line);
  }).join('\n');
}

function isBlock(line) {
  return /^\s{0,3}#{1,6}\s+/.test(line)
    || /^\s{0,3}```/.test(line)
    || /^\s*>\s?/.test(line)
    || /^\s*[-*]\s+/.test(line)
    || /^\s*\d+[.)]\s+/.test(line)
    || line.trim() === '---'
    || line.trim() === '***';
}

function appendLink(parent, href, label) {
  let url;
  try { url = new URL(href); } catch { parent.append(label); return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') { parent.append(label); return; }
  const link = document.createElement('a');
  link.href = url.href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = label;
  parent.append(link);
}

function appendInline(parent, text) {
  const pattern = /!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|<(https?:\/\/[^>\s]+)>|`([^`\n]+)`|\*\*([^*\n]+)\*\*|(https?:\/\/[^\s<]+)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parent.append(text.slice(last, match.index));
    if (match[0].startsWith('!')) {
      if (match[1]) parent.append(match[1]);
    } else if (match[3] && match[4]) {
      appendLink(parent, match[4], match[3]);
    } else if (match[5]) {
      appendLink(parent, match[5], match[5]);
    } else if (match[6]) {
      const code = document.createElement('code');
      code.textContent = match[6];
      parent.append(code);
    } else if (match[7]) {
      const strong = document.createElement('strong');
      strong.textContent = match[7];
      parent.append(strong);
    } else if (match[8]) {
      const trimmed = match[8].replace(/[),.;:!?]+$/, '');
      const rest = match[8].slice(trimmed.length);
      appendLink(parent, trimmed, trimmed);
      if (rest) parent.append(rest);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parent.append(text.slice(last));
}

function renderMarkdown(container, markdown) {
  container.replaceChildren();
  const lines = prepareMarkdown(markdown).split('\n');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith('```')) {
      const source = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) {
        source.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = source.join('\n');
      pre.append(code);
      container.append(pre);
      continue;
    }
    if (/^\s{0,3}#{1,6}\s+/.test(line)) {
      const level = line.match(/^\s{0,3}(#+)/)[1].length;
      const heading = document.createElement(level === 1 ? 'h3' : 'h4');
      appendInline(heading, line.replace(/^\s{0,3}#{1,6}\s+/, ''));
      container.append(heading);
      index += 1;
      continue;
    }
    if (line.trim() === '---' || line.trim() === '***') {
      container.append(document.createElement('hr'));
      index += 1;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote = document.createElement('blockquote');
      const text = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        text.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      const paragraph = document.createElement('p');
      appendInline(paragraph, text.join(' '));
      quote.append(paragraph);
      container.append(quote);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      index = appendList(container, lines, index, 'ul', /^\s*[-*]\s+/);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      index = appendList(container, lines, index, 'ol', /^\s*\d+[.)]\s+/);
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const text = [];
    while (index < lines.length && lines[index].trim() && !isBlock(lines[index])) {
      text.push(lines[index].trim());
      index += 1;
    }
    const paragraph = document.createElement('p');
    appendInline(paragraph, text.join(' '));
    container.append(paragraph);
  }
}

function appendList(container, lines, index, tag, pattern) {
  const list = document.createElement(tag);
  while (index < lines.length && pattern.test(lines[index])) {
    const item = document.createElement('li');
    appendInline(item, lines[index].replace(pattern, ''));
    list.append(item);
    index += 1;
  }
  container.append(list);
  return index;
}

function pagerLetter(text, color) {
  const letter = document.createElement('span');
  letter.textContent = text;
  letter.style.color = color;
  return letter;
}

function pagerLink(page, className, label) {
  const link = document.createElement('a');
  link.className = className;
  link.href = pageUrl({ ...state, page });
  link.textContent = label;
  if (className === 'pager-chevron') link.setAttribute('aria-label', page < state.page ? '上一页' : '下一页');
  link.addEventListener('click', event => {
    event.preventDefault();
    goToPage(page);
  });
  return link;
}

function renderPager() {
  const pages = pageCount();
  pager.replaceChildren();
  pager.hidden = pages <= 1 || !resultItems.length;
  if (pager.hidden) return;

  const logo = document.createElement('div');
  logo.className = 'pager-logo';
  if (state.page > 1) logo.append(pagerLink(state.page - 1, 'pager-chevron', '<'));
  const mark = pagerLetter('H', '#4285f4');
  mark.className = 'pager-h';
  logo.append(mark);

  const columns = document.createElement('div');
  columns.className = 'pager-columns';
  for (let page = 1; page <= pages; page += 1) {
    const column = document.createElement('div');
    column.className = 'pager-column';
    const letter = pagerLetter('q', qColors[(page - 1) % qColors.length]);
    letter.className = 'pager-q';
    if (page === state.page) {
      letter.classList.add('is-current');
    } else {
      letter.tabIndex = 0;
      letter.setAttribute('role', 'link');
      letter.addEventListener('click', () => goToPage(page));
      letter.addEventListener('keydown', event => {
        if (event.key === 'Enter') goToPage(page);
      });
    }
    const number = page === state.page ? document.createElement('span') : document.createElement('a');
    number.className = 'pager-num';
    number.textContent = String(page);
    if (page === state.page) {
      number.classList.add('is-current');
      number.setAttribute('aria-current', 'page');
    } else {
      number.href = pageUrl({ ...state, page });
      number.addEventListener('click', event => {
        event.preventDefault();
        goToPage(page);
      });
    }
    column.append(letter, number);
    columns.append(column);
  }
  logo.append(columns);

  const tail = document.createElement('div');
  tail.className = 'pager-tail';
  const word = document.createElement('div');
  word.className = 'pager-word';
  [...'Search'].forEach((char, index) => word.append(pagerLetter(char, searchColors[index])));
  tail.append(word);
  if (state.page < pages) tail.append(pagerLink(state.page + 1, 'pager-label', '下一页'));
  logo.append(tail);
  if (state.page < pages) logo.append(pagerLink(state.page + 1, 'pager-chevron', '>'));
  pager.append(logo);
}

function renderResults({ scroll = false } = {}) {
  const pages = pageCount();
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * PAGE_SIZE;
  resultsList.replaceChildren();
  for (const result of resultItems.slice(start, start + PAGE_SIZE)) renderResult(result);
  status.textContent = resultItems.length ? '' : '找不到相关结果。请尝试其他关键词，或放宽时间和语言筛选。';
  resultsMeta.textContent = resultItems.length ? describeResults(resultItems.length) : '';
  renderPager();
  if (scroll) window.scrollTo(0, 0);
}

function goToPage(page) {
  if (page === state.page || page < 1 || page > pageCount()) return;
  navigate({ page });
}

async function fetchResults() {
  activeRequest?.abort();
  if (previewDialog.open) previewDialog.close();
  const controller = new AbortController();
  activeRequest = controller;
  resultItems = [];
  loadedKey = '';
  pager.hidden = true;
  resultsList.replaceChildren();
  resultsMeta.textContent = '';
  status.textContent = '正在搜索…';
  resultsList.setAttribute('aria-busy', 'true');

  try {
    const response = await fetch(`/api/search?${requestParams(state)}`, { signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (activeRequest !== controller) return;
    if (!response.ok) throw new Error(data.error || '搜索失败，请稍后再试。');
    const results = Array.isArray(data.results) ? data.results : [];
    resultItems = results.filter(usableResult);
    loadedKey = filterKey(state);
    const pages = pageCount();
    if (state.page > pages) {
      state.page = pages;
      history.replaceState({}, '', pageUrl(state));
    }
    renderResults();
  } catch (error) {
    if (activeRequest !== controller || error.name === 'AbortError') return;
    status.textContent = error.message || '搜索失败，请稍后再试。';
    resultsMeta.textContent = '';
    pager.hidden = true;
  } finally {
    if (activeRequest === controller) resultsList.setAttribute('aria-busy', 'false');
  }
}

function showHome() {
  activeRequest?.abort();
  previewRequest?.abort();
  if (previewDialog.open) previewDialog.close();
  state = { ...emptyState };
  resultItems = [];
  loadedKey = '';
  pager.hidden = true;
  document.body.classList.remove('has-results');
  resultsPage.hidden = true;
  homeSearch.append(form);
  input.value = '';
  syncClearButton();
  filterStatus.textContent = '';
  status.textContent = '';
  document.title = 'HQ Search';
}

function showShell() {
  headerSearch.append(form);
  input.value = state.query;
  syncClearButton();
  document.body.classList.add('has-results');
  resultsPage.hidden = false;
  document.title = `${state.query} - HQ Search`;
  syncControls();
}

function rejectFilters(next, message) {
  activeRequest?.abort();
  state = {
    query: next.query,
    range: ranges.includes(next.range) ? next.range : 'all',
    lang: languages.includes(next.lang) ? next.lang : '',
    after: parseDay(next.after) || '',
    before: parseDay(next.before) || '',
    page: 1,
  };
  resultItems = [];
  loadedKey = '';
  showShell();
  filterStatus.textContent = message;
  status.textContent = '';
  resultsList.replaceChildren();
  resultsMeta.textContent = '';
  pager.hidden = true;
  if (next.range === 'custom') dateFilter.hidden = false;
}

function navigate(changes, { push = true, fresh = false, force = false } = {}) {
  const next = { ...(fresh ? emptyState : state), ...changes };
  next.query = String(next.query || '').trim();
  if (!ranges.includes(next.range)) next.range = 'all';
  if (next.lang && !languages.includes(next.lang)) next.lang = '';
  if (!next.query) {
    if (push) history.pushState({}, '', '/');
    showHome();
    return;
  }

  if (next.range === 'custom') {
    const after = parseDay(next.after);
    const before = parseDay(next.before);
    if (after == null || before == null) {
      rejectFilters(next, '日期无效。');
      return;
    }
    if (after && before && after > before) {
      rejectFilters({ ...next, after, before }, '开始日期不能晚于结束日期。');
      return;
    }
    if (!after && !before) {
      rejectFilters(next, '请选择开始或结束日期。');
      return;
    }
    next.after = after;
    next.before = before;
  }

  if (!Number.isInteger(next.page) || next.page < 1) next.page = 1;
  const sameFilters = loadedKey === filterKey(next) && resultItems.length > 0;
  const unchanged = sameState(state, next) && document.body.classList.contains('has-results');
  if (push) {
    const target = pageUrl(next);
    if (target !== `${location.pathname}${location.search}`) history.pushState({}, '', target);
  }
  if (!force && unchanged) return;
  if (!force && sameFilters && document.body.classList.contains('has-results')) {
    state = { ...next };
    showShell();
    filterStatus.textContent = '';
    renderResults({ scroll: true });
    return;
  }
  state = { ...next };
  showShell();
  filterStatus.textContent = '';
  fetchResults();
}

function readLocation() {
  const params = new URLSearchParams(location.search);
  const lang = params.get('lang') || '';
  const range = params.get('range') || 'all';
  return {
    query: params.get('q') || '',
    range: ranges.includes(range) ? range : 'all',
    lang: !lang || languages.includes(lang) ? lang : '',
    after: params.get('after') || '',
    before: params.get('before') || '',
    page: parsePage(params.get('page')),
  };
}

function applyDates() {
  const after = afterFilter.value;
  const before = beforeFilter.value;
  if (after && before && after > before) {
    filterStatus.textContent = '开始日期不能晚于结束日期。';
    return;
  }
  if (!after && !before) {
    filterStatus.textContent = '请选择开始或结束日期。';
    return;
  }
  filterStatus.textContent = '';
  navigate({ range: 'custom', after, before, page: 1 });
}

function openSyntax() {
  syntaxStatus.textContent = '';
  if (!syntaxDialog.open) syntaxDialog.showModal();
}

function insertSyntax(value) {
  const current = input.value.trim();
  const next = current ? `${current} ${value}` : value;
  if ([...next].length > 128) {
    syntaxStatus.textContent = '加上这条语法后会超过 128 个字符。';
    return;
  }
  syntaxStatus.textContent = '';
  input.value = next;
  syncClearButton();
  syntaxDialog.close();
  input.focus();
}

async function openPreview(url, title) {
  previewRequest?.abort();
  const controller = new AbortController();
  previewRequest = controller;
  previewTitle.textContent = title || '预览正文';
  previewOpen.href = url;
  previewStatus.textContent = '正在读取网页…';
  previewBody.replaceChildren();
  if (!previewDialog.open) previewDialog.showModal();

  try {
    const response = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`, { signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (previewRequest !== controller) return;
    if (!response.ok) throw new Error(data.error || '暂时无法预览该网页。');
    if (data.title) previewTitle.textContent = data.title;
    const content = String(data.content || '');
    if (!content.trim()) {
      previewStatus.textContent = '该网页没有可提取的正文。';
      return;
    }
    previewStatus.textContent = '';
    const limit = 100000;
    renderMarkdown(previewBody, content.length > limit ? content.slice(0, limit) : content);
    if (content.length > limit) previewBody.append(textElement('p', 'preview-note', '正文过长，只显示前一部分。'));
  } catch (error) {
    if (previewRequest !== controller || error.name === 'AbortError') return;
    previewStatus.textContent = error.message || '暂时无法预览该网页。';
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  if (!input.value.trim()) return;
  if (!document.body.classList.contains('has-results')) {
    navigate({ query: input.value }, { fresh: true, force: true });
    return;
  }
  const changes = { query: input.value, lang: langFilter.value, page: 1 };
  if (!dateFilter.hidden) {
    changes.range = 'custom';
    changes.after = afterFilter.value;
    changes.before = beforeFilter.value;
  }
  navigate(changes, { force: true });
});
input.addEventListener('input', syncClearButton);
clearButton.addEventListener('click', () => {
  input.value = '';
  syncClearButton();
  input.focus();
});
langFilter.addEventListener('change', () => navigate({ lang: langFilter.value, page: 1 }));
afterFilter.addEventListener('change', applyDates);
beforeFilter.addEventListener('change', applyDates);
clearFilters.addEventListener('click', () => {
  dateFilter.hidden = true;
  navigate({ range: 'all', lang: '', after: '', before: '', page: 1 });
});
for (const tab of tabs) {
  tab.addEventListener('click', event => {
    event.preventDefault();
    if (tab.dataset.range === 'custom') {
      dateFilter.hidden = false;
      for (const item of tabs) {
        if (item === tab) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
      }
      if (afterFilter.value || beforeFilter.value) applyDates();
      else filterStatus.textContent = '请选择开始或结束日期。';
      return;
    }
    // 只打开日期栏、还没选定日期时，state.range 仍是上一个范围。此时再点「全部」等
    // 标签，range 可能没变，必须先收回日期栏，否则标签会停在「自定义」。
    if (state.range !== 'custom' && !dateFilter.hidden) {
      filterStatus.textContent = '';
      syncControls();
    }
    if (tab.dataset.range !== state.range) navigate({ range: tab.dataset.range, page: 1 });
  });
}
document.querySelector('#home-syntax').addEventListener('click', openSyntax);
document.querySelector('#syntax-button').addEventListener('click', openSyntax);
for (const button of document.querySelectorAll('.syntax-example')) {
  button.addEventListener('click', () => insertSyntax(button.dataset.insert || ''));
}
document.querySelector('#preview-close').addEventListener('click', () => previewDialog.close());
previewDialog.addEventListener('close', () => previewRequest?.abort());
for (const dialog of [syntaxDialog, previewDialog]) {
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
}
window.addEventListener('keydown', event => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (resultsPage.hidden || syntaxDialog.open || previewDialog.open) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
  const nextPage = event.key === 'ArrowRight' ? state.page + 1 : state.page - 1;
  if (nextPage < 1 || nextPage > pageCount()) return;
  event.preventDefault();
  goToPage(nextPage);
});
window.addEventListener('popstate', () => navigate(readLocation(), { push: false }));
navigate(readLocation(), { push: false });
