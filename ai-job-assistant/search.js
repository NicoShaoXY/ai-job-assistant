// 背调的检索层。
//
// ── 为什么必须接搜索 API ────────────────────────────────
// DeepSeek 的 chat/completions 不联网，插件自己也没有企业数据源。
// 上一版把"查"这一步推回给用户（你查完粘给我），那是没解决问题。
// 接一个搜索服务才是真的"全网找"。
//
// ── 这为什么不是爬虫 ────────────────────────────────────
// 请求发往搜索服务的开放接口，返回的是公开网页的标题、摘要和链接，
// 不绕过任何站点的技术防护，不注册账号，不伪造身份，不批量抓取页面正文。
// 与"写爬虫去目标站点抓数据"是两件事。
//
// ── 关键设计：用 include 限定域名 ───────────────────────
// 泛搜"某某公司 欠薪"会混进大量同名无关公司，噪声极高。
// 博查支持 include 参数把检索限定在指定域名，所以每个维度都钉死在对应权威源上：
// 工商查 gsxt.gov.cn，被执行查 zxgk.court.gov.cn，裁判文书查 wenshu.court.gov.cn。
// 这比"让模型自己判断哪条可信"可靠得多。

export const PROVIDER = {
  key: "bocha",
  name: "博查",
  endpoint: "https://api.bocha.cn/v1/web-search",
  signup: "https://open.bochaai.com/",
  note: "按次计费，注册后有免费额度"
};

// 六个检索维度。每条查询都带引号强制短语匹配，减少同名干扰。
export const BACKCHECK_QUERIES = [
  {
    key: "registry",
    label: "工商登记与经营异常",
    query: (company) => `"${company}" 经营异常 行政处罚`,
    include: "gsxt.gov.cn,creditchina.gov.cn"
  },
  {
    key: "enforce",
    label: "被执行与失信",
    query: (company) => `"${company}" 被执行人 失信被执行人`,
    include: "zxgk.court.gov.cn,creditchina.gov.cn"
  },
  {
    key: "labor",
    label: "劳动争议与欠薪",
    query: (company) => `"${company}" 劳动争议 拖欠工资`,
    include: "wenshu.court.gov.cn,creditchina.gov.cn"
  },
  {
    key: "profile",
    label: "工商与社保概况",
    query: (company) => `"${company}" 参保人数 注册资本 社保`,
    include: "tianyancha.com,qcc.com"
  },
  {
    key: "review",
    label: "员工评价",
    query: (company) => `"${company}" 员工评价 值得去吗`,
    include: "kanzhun.com,maimai.cn"
  },
  {
    key: "general",
    label: "综合风险",
    query: (company) => `"${company}" 欠薪 裁员 诉讼 风险`
  }
];

// 请求体按博查 Web Search API 的规格构造，字段含义见官方文档。
export function buildSearchRequest(query, {count = 8, include = ""} = {}) {
  const body = {
    query: String(query || ""),
    // 背调要的是历史记录，不能只看最近。官方也推荐 noLimit，指定范围容易搜不到东西。
    freshness: "noLimit",
    summary: true,
    count: Math.min(Math.max(Number(count) || 8, 1), 50)
  };
  if (include) body.include = include;
  return body;
}

// 解析响应。博查的返回结构与 Bing Search API 兼容，正文在 data.webPages.value。
// 注意：code 非 200 时 data 可能是 null，要先判。
export function parseSearchResponse(payload) {
  const code = payload?.code;
  if (typeof code === "number" && code !== 200) {
    throw new Error(payload?.msg || `搜索服务返回 ${code}`);
  }
  const values = payload?.data?.webPages?.value;
  if (!Array.isArray(values)) return [];
  return values
    .map((item) => ({
      title: String(item?.name || "").trim(),
      url: String(item?.url || "").trim(),
      // summary 是开了 summary:true 才有的长摘要，比 snippet 信息量大
      snippet: String(item?.summary || item?.snippet || "").replace(/\s+/g, " ").trim(),
      site: String(item?.siteName || "").trim(),
      date: String(item?.datePublished || "").slice(0, 10)
    }))
    .filter((item) => item.url || item.title);
}

export async function searchOnce(apiKey, query, options) {
  const response = await fetch(PROVIDER.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(buildSearchRequest(query, options))
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`搜索服务返回 ${response.status}：${text.slice(0, 120) || "无详情"}`);
  }
  return parseSearchResponse(await response.json());
}

// 按维度依次检索，跨维度按 URL 去重。
// 单个维度失败不中断整体，但要把失败如实记录下来——不能让模型把"没搜到"当成"没有问题"。
export async function runBackcheckSearch(company, apiKey, onProgress) {
  const name = String(company || "").trim();
  if (!name) throw new Error("先填公司全称，检索要用它。");
  if (!apiKey) throw new Error("还没填搜索服务的 API Key，去右上角设置里补上。");

  const groups = [];
  const seen = new Set();

  for (let index = 0; index < BACKCHECK_QUERIES.length; index += 1) {
    const dimension = BACKCHECK_QUERIES[index];
    if (onProgress) onProgress(index + 1, BACKCHECK_QUERIES.length, dimension.label);
    const query = dimension.query(name);
    let results = [];
    try {
      results = await searchOnce(apiKey, query, {count: 8, include: dimension.include});
    } catch (error) {
      groups.push({
        label: dimension.label,
        query,
        error: error instanceof Error ? error.message : String(error),
        results: []
      });
      continue;
    }
    const fresh = results.filter((item) => {
      const key = item.url || item.title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    groups.push({label: dimension.label, query, results: fresh});
  }

  const total = groups.reduce((sum, group) => sum + group.results.length, 0);
  return {company: name, groups, total};
}

// 把检索结果拼成给模型的材料，同时产出带编号的来源清单。
// 编号是刻意的：提示词要求模型每条结论都标 [n]，报告里每个判断都能回溯到具体网页。
export function formatSearchResults(search) {
  const lines = [];
  const refs = [];
  let index = 0;

  for (const group of search.groups) {
    lines.push(`\n【${group.label}】`);
    if (group.error) {
      lines.push(`  该维度检索失败（${group.error}），不代表没有问题，只代表没查成。`);
      continue;
    }
    if (!group.results.length) {
      lines.push("  没有检索到结果。");
      continue;
    }
    for (const item of group.results) {
      index += 1;
      refs.push({index, dimension: group.label, ...item});
      lines.push(`  [${index}] ${item.title}`);
      lines.push(`      来源：${item.site || item.url}${item.date ? ` · ${item.date}` : ""}`);
      lines.push(`      链接：${item.url}`);
      if (item.snippet) lines.push(`      摘要：${item.snippet.slice(0, 400)}`);
    }
  }

  return {text: lines.join("\n"), refs};
}

// 检索统计，放在报告头部，让用户一眼看出覆盖了多少、有没有维度落空。
export function summarizeCoverage(search) {
  const done = search.groups.filter((group) => !group.error).length;
  const failed = search.groups.filter((group) => group.error);
  const empty = search.groups.filter((group) => !group.error && !group.results.length);
  const parts = [`${done}/${search.groups.length} 个维度检索完成，共 ${search.total} 条结果`];
  if (empty.length) parts.push(`无结果的维度：${empty.map((g) => g.label).join("、")}`);
  if (failed.length) parts.push(`检索失败的维度：${failed.map((g) => g.label).join("、")}`);
  return parts.join("；");
}
