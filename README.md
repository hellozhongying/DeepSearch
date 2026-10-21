# HQ Search

**想找个网页，不必先穿过一屏广告。**

HQ Search 是一个基于 [DeepSeek Search / Fetch API](https://api-docs.deepseek.com/zh-cn/guides/search/) 的轻量网页搜索项目。页面不插入广告，也不要求登录：输入关键词，直接看网页结果；需要细读时，可以在站内预览正文。

## 主要功能

- **网页搜索**：展示标题、来源、摘要和原网页链接，支持展开更长的摘要，并标出高权威性来源。
- **时间与语言筛选**：查看全部、近一周、近一月、近一年或自定义日期范围的结果；可限定中文或英文。筛选状态会保存在 URL 中，便于分享。
- **搜索语法**：直接在搜索框使用 `site:`、`-site:`、引号精确匹配、排除词、`after:`、`before:` 和 `lang:`。页面中的“搜索语法”也提供可点击的示例。
- **结果翻页与正文预览**：每次最多取得 50 条结果，按每页 10 条浏览；点击“预览正文”可通过 Fetch API 阅读网页内容。

> 翻页只浏览本次取得的结果。DeepSeek Search API 当前没有提供继续获取下一批结果的分页参数。

## 本地运行

需要 **Node.js 20 或更新版本**、一个 DeepSeek API Key，以及可访问 DeepSeek API 的网络。本项目没有第三方运行依赖，无需 `npm install` 或构建。

```bash
git clone https://github.com/hellozhongying/DeepSearch.git
cd DeepSearch
DEEPSEEK_API_KEY=你的密钥 npm start
```

打开 <http://localhost:3000>。如需换端口，可运行 `PORT=3001 DEEPSEEK_API_KEY=你的密钥 npm start`。

API Key 只由 `server.mjs` 在服务端读取；浏览器调用本项目的 `/api/search` 和 `/api/fetch`，不会拿到密钥。部署到公共网络前，请为接口增加访问限速，避免产生无法预期的调用费用。

## 搜索示例

```text
DeepSeek site:github.com
"开源搜索" -广告
人工智能 after:2026-01-01 lang:zh
```

## 开发与测试

`public/` 存放页面、样式和交互代码；`server.mjs` 提供静态文件与 API 代理；`query.mjs` 处理筛选和搜索语法。运行 `npm test` 可检查日期边界、参数校验与 API 请求逻辑。贡献约定见 [AGENTS.md](AGENTS.md)。
