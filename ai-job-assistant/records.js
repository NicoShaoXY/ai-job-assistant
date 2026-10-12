import {STATUSES, STATUS_LABELS, listJobs, deleteJob, parseSalary, formatSeenAt} from "./job-store.js";
// 技能词表和匹配度打分共用一份，避免两处各写各的、改了一边忘另一边。
import {SKILL_DICT as KEYWORDS} from "./matcher.js";

// 中文分词在纯前端不好做，这里改成对着一份词表匹配——命中的都是真正想统计的词，
// 不会被「负责」「熟悉」这类高频虚词淹没。词表本体在 matcher.js。
const REQUIREMENTS = [
  {name: "本科及以上", re: /本科(?:及|以)以?上|本科以上|统招本科/},
  {name: "硕士及以上", re: /硕士(?:及|以)以?上|硕士以上|研究生学历/},
  {name: "名校优先", re: /名校|双一流|985|211/},
  {name: "3 年以上经验", re: /3\s*年以上|三年以上/},
  {name: "5 年以上经验", re: /5\s*年以上|五年以上/},
  {name: "有落地案例", re: /落地(?:经验|案例)|实际项目经验|上线经验/},
  {name: "论文/竞赛", re: /论文|顶会|ACL|NeurIPS|CVPR|竞赛|Kaggle/},
  {name: "接受出差", re: /出差|驻场/}
];

const dom = {
  content: document.querySelector("#content"),
  empty: document.querySelector("#emptyState"),
  funnel: document.querySelector("#funnel"),
  funnelNote: document.querySelector("#funnelNote"),
  salaryStats: document.querySelector("#salaryStats"),
  reqStats: document.querySelector("#reqStats"),
  keywordStats: document.querySelector("#keywordStats"),
  filterRow: document.querySelector("#filterRow"),
  jobList: document.querySelector("#jobList"),
  openAnalyze: document.querySelector("#openAnalyze"),
  analyzeModal: document.querySelector("#analyzeModal"),
  analyzeClose: document.querySelector("#analyzeClose"),
  analyzePrompt: document.querySelector("#analyzePrompt"),
  copyPrompt: document.querySelector("#copyPrompt"),
  exportCsv: document.querySelector("#exportCsv"),
  csvDesc: document.querySelector("#csvDesc")
};

let jobs = [];
let activeFilter = "all";

const reachedIndex = (job) => STATUSES.indexOf(job.status || "viewed");

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---- 漏斗：每一格是「至少走到这一步」的岗位数 ----

function renderFunnel() {
  const counts = STATUSES.map((_, index) => jobs.filter((job) => reachedIndex(job) >= index).length);
  dom.funnel.replaceChildren(...STATUSES.map((status, index) => {
    const step = el("div", "funnel-step");
    step.append(el("div", "num", String(counts[index])));
    step.append(el("div", "label", STATUS_LABELS[status]));
    if (index > 0 && counts[index - 1] > 0) {
      const rate = Math.round((counts[index] / counts[index - 1]) * 100);
      step.append(el("div", "rate", `${rate}% 转化`));
    }
    return step;
  }));
  dom.funnelNote.textContent = jobs.length < 20
    ? `样本只有 ${jobs.length} 个岗位，比例仅供参考，攒到几十条以上才有意义。`
    : `样本 ${jobs.length} 个岗位。`;
}

// ---- 统计条 ----

function renderStatList(node, rows) {
  if (!rows.length) {
    node.replaceChildren(el("p", "stat-empty", "还没有足够数据。"));
    return;
  }
  const max = Math.max(...rows.map((row) => row.value));
  node.replaceChildren(...rows.map((row) => {
    const line = el("div", "stat-row");
    line.append(el("div", "name", row.name));
    const bar = el("div", "bar");
    const fill = el("span");
    fill.style.width = `${Math.round((row.value / max) * 100)}%`;
    bar.append(fill);
    line.append(bar);
    line.append(el("div", "val", row.display || String(row.value)));
    return line;
  }));
}

function renderSalary() {
  const parsed = jobs.map((job) => parseSalary(job.salary)).filter(Boolean);
  if (!parsed.length) {
    renderStatList(dom.salaryStats, []);
    return;
  }
  const buckets = [
    {name: "10K 以下", test: (s) => s.max < 10},
    {name: "10-20K", test: (s) => s.max >= 10 && s.max < 20},
    {name: "20-30K", test: (s) => s.max >= 20 && s.max < 30},
    {name: "30-40K", test: (s) => s.max >= 30 && s.max < 40},
    {name: "40K 以上", test: (s) => s.max >= 40}
  ];
  const rows = buckets
    .map((bucket) => ({name: bucket.name, value: parsed.filter(bucket.test).length}))
    .filter((row) => row.value > 0);

  const avgMin = parsed.reduce((sum, s) => sum + s.min, 0) / parsed.length;
  const avgMax = parsed.reduce((sum, s) => sum + s.max, 0) / parsed.length;
  renderStatList(dom.salaryStats, rows);
  dom.salaryStats.append(
    el("p", "sample-note",
       `已解析 ${parsed.length} / ${jobs.length} 条，平均区间 ${avgMin.toFixed(1)}-${avgMax.toFixed(1)}K（面议等无法解析的已跳过）`)
  );
}

function renderRequirements() {
  const rows = REQUIREMENTS
    .map((item) => ({
      name: item.name,
      value: jobs.filter((job) => item.re.test(job.jdText || "")).length
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
  renderStatList(dom.reqStats, rows.map((row) => ({
    ...row,
    display: `${row.value} / ${jobs.length}`
  })));
}

function renderKeywords() {
  const hits = KEYWORDS
    .map((word) => {
      const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      return {word, count: jobs.filter((job) => re.test(job.jdText || "")).length};
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  if (!hits.length) {
    dom.keywordStats.replaceChildren(el("p", "stat-empty", "还没有足够数据。"));
    return;
  }
  dom.keywordStats.replaceChildren(...hits.map((item) => {
    const tag = el("span", "tag");
    tag.append(document.createTextNode(item.word));
    const count = document.createElement("b");
    count.textContent = String(item.count);
    tag.append(count);
    return tag;
  }));
}

// ---- 列表 ----

function renderFilters() {
  const options = [{key: "all", label: `全部 ${jobs.length}`}].concat(
    STATUSES.map((status) => ({
      key: status,
      label: `${STATUS_LABELS[status]} ${jobs.filter((job) => job.status === status).length}`
    }))
  );
  dom.filterRow.replaceChildren(...options.map((option) => {
    const chip = el("button", "filter-chip", option.label);
    chip.type = "button";
    if (option.key === activeFilter) chip.classList.add("active");
    chip.addEventListener("click", () => {
      activeFilter = option.key;
      renderFilters();
      renderList();
    });
    return chip;
  }));
}

function renderList() {
  const shown = activeFilter === "all" ? jobs : jobs.filter((job) => job.status === activeFilter);
  if (!shown.length) {
    dom.jobList.replaceChildren(el("p", "stat-empty", "这个状态下还没有岗位。"));
    return;
  }
  dom.jobList.replaceChildren(...shown.map((job) => {
    const row = el("div", "job-row");
    const main = el("div", "job-main");

    const name = el("div", "job-name");
    const link = document.createElement("a");
    link.href = job.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.className = "t";
    link.textContent = job.title || "（没读到岗位名）";
    name.append(link);
    name.append(el("div", "c", job.company || "—"));
    main.append(name);

    main.append(el("div", "job-salary", job.salary || "—"));
    const status = el("div", `job-status ${job.status}`, STATUS_LABELS[job.status] || "查看过");
    main.append(status);
    main.append(el("div", "job-time", formatSeenAt(job.lastSeenAt)));
    row.append(main);

    const detail = el("div", "job-detail");
    detail.hidden = true;
    const greeting = job.greetings?.[0];
    if (greeting) {
      detail.append(el("div", "detail-label", `打招呼语（${formatSeenAt(greeting.at)}）`));
      detail.append(el("div", "detail-text", greeting.text));
    }
    detail.append(el("div", "detail-label", "JD 正文"));
    detail.append(el("div", "detail-text", job.jdText || "（没有记录正文）"));
    const actions = el("div", "detail-actions");
    const remove = el("button", "pill-button danger", "删除这条记录");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      await deleteJob(job.url);
      await load();
    });
    actions.append(remove);
    detail.append(actions);
    row.append(detail);

    main.style.cursor = "pointer";
    main.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      detail.hidden = !detail.hidden;
    });
    return row;
  }));
}

// ---- AI 分析：插件只负责把数据和提示词准备好，分析交给用户自己选的 AI ----

const CSV_COLUMNS = [
  ["岗位名称", (job) => job.title],
  ["公司", (job) => job.company],
  ["薪资", (job) => job.salary],
  ["状态", (job) => STATUS_LABELS[job.status] || "查看过"],
  ["首次查看", (job) => (job.firstSeenAt || "").slice(0, 10)],
  ["最近查看", (job) => (job.lastSeenAt || "").slice(0, 10)],
  ["打招呼语", (job) => job.greetings?.[0]?.text || ""],
  ["JD正文", (job) => job.jdText]
];

function toCsv() {
  const escape = (value) => `"${String(value || "").replace(/"/g, '""')}"`;
  const header = CSV_COLUMNS.map(([name]) => escape(name)).join(",");
  const rows = jobs.map((job) => CSV_COLUMNS.map(([, pick]) => escape(pick(job))).join(","));
  // BOM：不加的话 Excel 打开中文是乱码
  return "\ufeff" + [header, ...rows].join("\r\n");
}

function buildPrompt() {
  const counts = STATUSES.map((_, index) => jobs.filter((job) => reachedIndex(job) >= index).length);
  const dates = jobs.map((job) => (job.firstSeenAt || "").slice(0, 10)).filter(Boolean).sort();
  const span = dates.length ? `${dates[0]} 到 ${dates[dates.length - 1]}` : "未知";

  return `我在用一个 Chrome 插件记录自己在 BOSS 直聘上看过的岗位，现在把记录导出成了 CSV，想请你帮我分析。

数据说明：
- 共 ${jobs.length} 个岗位，记录时间跨度 ${span}
- 这些都是我自己主动点开看过的岗位，不是平台推荐的全量岗位，所以它反映的是「我在找什么」，不是「市场上有什么」
- 投递漏斗：查看过 ${counts[0]} 个 → 已打招呼 ${counts[1]} 个 → HR 回复 ${counts[2]} 个 → 已投简历 ${counts[3]} 个

字段说明：
- 岗位名称 / 公司 / 薪资：从职位页面读到的原文，薪资形如「20-30K·13薪」，也可能是「面议」
- 状态：查看过 / 已打招呼 / HR 已回复 / 已投简历，是递进关系，后面的状态包含前面的
- 打招呼语：我用 AI 生成后发给 HR 的第一句话（没打过招呼的为空）
- JD正文：职位描述全文

请你回答这几个问题，每一条都要指出是从哪些具体岗位得出的，不要泛泛而谈：

1. 这些岗位反复要求的能力有哪些？按出现频次排序，并指出哪些是「几乎每家都要」的门槛项，哪些是「少数家才要」的加分项。
2. 薪资和要求之间有什么关系？给得高的那批岗位，比给得低的多要求了什么？
3. 我的打招呼语有没有共同的问题？对比「HR 回复了」和「石沉大海」的两组，措辞上有什么差别？如果样本太少不足以下结论，直接说样本不够，不要硬编。
4. 从我看过的岗位分布看，我的求职方向是聚焦的还是发散的？如果发散，是哪几个方向在互相拉扯？
5. 基于以上，给我三条具体的下一步建议——要能落到动作上，不要「提升核心竞争力」这种话。

注意：样本量不大时，请明确说明哪些结论置信度低，不要为了给结论而给结论。`;
}

function openAnalyze() {
  dom.csvDesc.textContent = `${jobs.length} 个岗位，包含岗位名、公司、薪资、状态、打招呼语和 JD 全文。`;
  dom.analyzePrompt.value = buildPrompt();
  dom.copyPrompt.textContent = "复制";
  dom.analyzeModal.hidden = false;
}

function closeAnalyze() {
  dom.analyzeModal.hidden = true;
}

dom.openAnalyze.addEventListener("click", openAnalyze);
dom.analyzeClose.addEventListener("click", closeAnalyze);
dom.analyzeModal.addEventListener("click", (event) => {
  if (event.target.dataset.close) closeAnalyze();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !dom.analyzeModal.hidden) closeAnalyze();
});

dom.exportCsv.addEventListener("click", () => {
  const blob = new Blob([toCsv()], {type: "text/csv;charset=utf-8"});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `岗位记录-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

dom.copyPrompt.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(dom.analyzePrompt.value);
    dom.copyPrompt.textContent = "已复制";
    setTimeout(() => {
      dom.copyPrompt.textContent = "复制";
    }, 1500);
  } catch {
    dom.analyzePrompt.select();
    dom.copyPrompt.textContent = "已选中，按 ⌘C";
  }
});

async function load() {
  jobs = await listJobs();
  const hasData = jobs.length > 0;
  dom.empty.hidden = hasData;
  dom.content.hidden = !hasData;
  if (!hasData) return;
  renderFunnel();
  renderSalary();
  renderRequirements();
  renderKeywords();
  renderFilters();
  renderList();
}

load();
