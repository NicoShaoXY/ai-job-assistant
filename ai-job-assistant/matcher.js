// 简历 × JD 匹配度：规则层本地计算。
//
// 为什么不交给模型打分：模型每次采样分数会飘，同一个简历配同一个 JD 可能今天 78 明天 62，
// 用户就没法拿分数横向比较岗位了。规则层打分可复现、零成本、离线可用；
// 模型只负责解释「为什么是这个分」和「该怎么补」，不参与打分。
//
// 三个维度：
//   硬性要求命中率  40 分 —— JD 写死的门槛（学历/年限/名校/落地案例等），简历里有没有对应证据
//   技能重合度      40 分 —— JD 提到的技能词，简历覆盖了多少
//   薪资匹配度      20 分 —— 岗位挂出区间与期望薪资的重叠情况
// 薪资解析不出来时该维度整项剔除，用剩余权重归一化，不按 0 分算——不然「面议」的岗位会平白吃亏。
//
// 一个重要措辞：硬性要求「未命中」不等于「不满足」。简历里没写不等于没有，
// 所以对外一律叫「差距项」并标注需人工确认，不叫「不满足项」。

// 技能词表。records.js 的关键词统计也用这一份，避免两处词表各写各的。
export const SKILL_DICT = [
  // 大模型 / AI
  "Agent", "LangChain", "LangGraph", "RAG", "MCP", "Prompt", "Function Call", "Workflow",
  "多模态", "微调", "SFT", "LoRA", "强化学习", "RLHF", "向量数据库", "知识库", "知识图谱",
  "大模型", "LLM", "NLP", "CV", "推荐系统", "机器学习", "深度学习", "PyTorch", "TensorFlow",
  "Transformer", "vLLM", "推理加速", "Embedding", "Rerank", "AIGC", "数字人", "语音识别",
  // 语言 / 框架
  "Python", "Java", "Go", "C++", "JavaScript", "TypeScript", "React", "Vue", "Node",
  "SpringBoot", "Spring Cloud", "Django", "Flask", "FastAPI", "Golang", "Rust", "小程序",
  // 数据 / 中间件
  "MySQL", "Redis", "Kafka", "Elasticsearch", "MongoDB", "PostgreSQL", "ClickHouse",
  "Spark", "Flink", "Hadoop", "Hive", "SQL", "数据仓库", "数据中台", "数据治理",
  // 架构 / 运维
  "Docker", "Kubernetes", "K8s", "微服务", "高并发", "分布式", "CI/CD", "DevOps",
  "AWS", "阿里云", "腾讯云", "华为云", "私有化部署", "信创", "国产化",
  // 业务 / 通用
  "数据分析", "项目管理", "ToB", "ToC", "SaaS", "增长", "用户研究", "商业化"
];

// JD 里写死的门槛。jd 命中说明这条是要求，evidence 命中说明简历里有对应证据。
const HARD_RULES = [
  {
    key: "degree_bachelor",
    label: "本科及以上",
    jd: /本科(?:及|以)以?上|本科以上|统招本科|全日制本科|本科学历/,
    evidence: /本科|学士|硕士|研究生|博士|Bachelor|Master|PhD/i
  },
  {
    key: "degree_master",
    label: "硕士及以上",
    jd: /硕士(?:及|以)以?上|硕士以上|研究生学历|研究生及以上/,
    evidence: /硕士|研究生|博士|Master|PhD/i
  },
  {
    key: "school_tier",
    label: "名校 / 双一流优先",
    jd: /名校|双一流|985|211|重点院校|QS\s*\d+/,
    evidence: /985|211|双一流|清华|北京大学|北大|复旦|上海交大|浙江大学|南京大学|中国科学技术大学|哈尔滨工业大学|武汉大学|华中科技|中山大学|同济|东南大学|西安交大|QS/
  },
  {
    key: "exp_3",
    label: "3 年以上经验",
    jd: /[3三]\s*年(?:及)?以上|三年以上/,
    evidence: /[3-9]\s*年|三年|四年|五年|六年|七年|八年|九年|十年/
  },
  {
    key: "exp_5",
    label: "5 年以上经验",
    jd: /[5五]\s*年(?:及)?以上|五年以上/,
    evidence: /[5-9]\s*年|五年|六年|七年|八年|九年|十年/
  },
  {
    key: "shipping",
    label: "有落地 / 上线案例",
    jd: /落地(?:经验|案例|项目)|实际项目经验|上线经验|生产环境|规模化/,
    evidence: /上线|落地|投产|生产环境|已发布|已商用|规模化|交付/
  },
  {
    key: "paper",
    label: "论文 / 竞赛 / 专利",
    jd: /论文|顶会|ACL|NeurIPS|CVPR|ICML|ICLR|竞赛|Kaggle|专利/,
    evidence: /论文|ACL|NeurIPS|CVPR|ICML|ICLR|竞赛|Kaggle|专利|软著/
  },
  {
    key: "onsite",
    label: "接受出差 / 驻场",
    jd: /出差|驻场|外派|现场支持/,
    evidence: /出差|驻场|外派|可接受|能接受|适应/
  },
  {
    key: "team_lead",
    label: "带团队 / 管理经验",
    jd: /带团队|团队管理|管理经验|带领|Team Lead|技术负责人/,
    evidence: /带团队|团队管理|团队负责人|管理\s*\d+\s*人|Team Lead|主管|负责人/
  }
];

// ASCII 词要加边界，否则 "Go" 会命中 "Google"、"Java" 会命中 "JavaScript"。
// 中文词不加边界，加了反而匹配不上。
function compileTerm(term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (/^[\x00-\x7F]+$/.test(term)) {
    return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "i");
  }
  return new RegExp(escaped, "i");
}

const TERM_MATCHERS = SKILL_DICT.map((term) => ({term, re: compileTerm(term)}));

export function detectSkills(text) {
  const source = String(text || "");
  if (!source) return [];
  return TERM_MATCHERS.filter(({re}) => re.test(source)).map(({term}) => term);
}

// 从 JD 里找年龄相关表述。求职风险里年龄门槛是硬信号，单独拎出来展示。
export function extractAge(jdText) {
  const text = String(jdText || "");
  if (!text) return null;
  const noLimit = text.match(/年龄\s*(?:不限|无限制|无要求|不设限)|不限\s*年龄/);
  if (noLimit) return {limited: false, text: noLimit[0]};
  const range = text.match(/(\d{2})\s*[-~至到]\s*(\d{2})\s*(?:周岁|岁)/);
  if (range) return {limited: true, text: range[0]};
  const under = text.match(/(\d{2})\s*(?:周岁|岁)\s*(?:以下|以内|之下)/);
  if (under) return {limited: true, text: under[0]};
  const colon = text.match(/年龄\s*[:：]\s*(\d{2})\s*(?:周岁|岁)?\s*(?:以下|以内)?/);
  if (colon) return {limited: true, text: colon[0]};
  return null;
}

// 期望薪资是用户手填的，格式五花八门：「20k-25k」「20-25K」「2万-2.5万」「25k」。
// 注意区间写法里第一个数后面常跟着单位（35k-40k），单位要允许出现在连接符之前，
// 否则会退化成单值解析，把「35k-40k」读成 35-35。
function parseExpected(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const wanRange = text.match(/(\d+(?:\.\d+)?)\s*万?\s*[-~到至]\s*(\d+(?:\.\d+)?)\s*万/);
  if (wanRange) return {min: Number(wanRange[1]) * 10, max: Number(wanRange[2]) * 10};

  const range = text.match(/(\d+(?:\.\d+)?)\s*[KkＫ千]?\s*[-~到至]\s*(\d+(?:\.\d+)?)/);
  if (range) return {min: Number(range[1]), max: Number(range[2])};

  const wanSingle = text.match(/(\d+(?:\.\d+)?)\s*万/);
  if (wanSingle) {
    const value = Number(wanSingle[1]) * 10;
    return {min: value, max: value};
  }

  const single = text.match(/(\d+(?:\.\d+)?)/);
  if (single) {
    const value = Number(single[1]);
    return {min: value, max: value};
  }
  return null;
}

// 岗位薪资同样在 job-store.js 有一份解析，但那份只认「20-30K·13薪」这种标准写法。
// 这里为了匹配度计算需要拿到数值，单独做一份更宽松的，不改动原函数以免影响记录页统计。
function parseJobSalary(raw) {
  const text = String(raw || "");
  if (!text || /面议|待定|详见/.test(text)) return null;
  const range = text.match(/(\d+(?:\.\d+)?)\s*[-~到至]\s*(\d+(?:\.\d+)?)\s*[KkＫ千]?/);
  if (range) return {min: Number(range[1]), max: Number(range[2])};
  const single = text.match(/(\d+(?:\.\d+)?)\s*[KkＫ千]/);
  if (single) {
    const value = Number(single[1]);
    return {min: value, max: value};
  }
  return null;
}

// 期望区间与岗位区间的匹配程度。
// 三种情况要分开处理，不能一律按重叠比例算：
//   期望下限高于岗位上限 —— 岗位给不起，这是真实不匹配，记 0
//   期望上限低于岗位下限 —— 岗位完全给得起，记满分（原先按重叠算会误判成 0）
//   区间有交叉 —— 按重叠占期望区间的比例
function salaryOverlap(expected, job) {
  if (!expected || !job) return null;
  if (expected.min > job.max) return 0;
  if (expected.max < job.min) return 1;
  const width = Math.max(expected.max - expected.min, 0.001);
  const overlap = Math.min(expected.max, job.max) - Math.max(expected.min, job.min);
  return Math.min(Math.max(overlap / width, 0), 1);
}

export function scoreMatch({jdText, resumeText, salary, expectedSalary}) {
  const jd = String(jdText || "");
  const resume = String(resumeText || "");
  const result = {
    usable: Boolean(jd && resume),
    total: 0,
    dims: [],
    hits: [],
    gaps: [],
    age: extractAge(jd),
    jdSkills: [],
    resumeSkills: [],
    missingSkills: [],
    note: ""
  };
  if (!result.usable) {
    result.note = !jd ? "还没有 JD。" : "还没有上传简历。";
    return result;
  }

  // 维度一：硬性要求
  const required = HARD_RULES.filter((rule) => rule.jd.test(jd));
  const reqHits = required.filter((rule) => rule.evidence.test(resume));
  const reqMiss = required.filter((rule) => !rule.evidence.test(resume));

  // 维度二：技能重合
  result.jdSkills = detectSkills(jd);
  result.resumeSkills = detectSkills(resume);
  const resumeSkillSet = new Set(result.resumeSkills);
  const skillHits = result.jdSkills.filter((term) => resumeSkillSet.has(term));
  result.missingSkills = result.jdSkills.filter((term) => !resumeSkillSet.has(term));

  // 维度三：薪资
  const expected = parseExpected(expectedSalary);
  const job = parseJobSalary(salary);
  const overlap = salaryOverlap(expected, job);

  const dims = [];
  if (required.length) {
    dims.push({
      key: "hard",
      label: "硬性要求",
      weight: 40,
      score: (reqHits.length / required.length) * 40,
      detail: `${reqHits.length} / ${required.length} 项命中`
    });
  }
  if (result.jdSkills.length) {
    dims.push({
      key: "skill",
      label: "技能重合",
      weight: 40,
      score: (skillHits.length / result.jdSkills.length) * 40,
      detail: `${skillHits.length} / ${result.jdSkills.length} 个词命中`
    });
  }
  if (overlap !== null) {
    dims.push({
      key: "salary",
      label: "薪资匹配",
      weight: 20,
      score: overlap * 20,
      detail: `岗位 ${job.min}-${job.max}K，期望 ${expected.min}-${expected.max}K`
    });
  }

  const totalWeight = dims.reduce((sum, dim) => sum + dim.weight, 0);
  if (totalWeight > 0) {
    const raw = dims.reduce((sum, dim) => sum + dim.score, 0);
    result.total = Math.round((raw / totalWeight) * 100);
  }
  result.dims = dims.map((dim) => ({
    ...dim,
    score: Math.round(dim.score),
    percent: totalWeight ? Math.round((dim.score / dim.weight) * 100) : 0
  }));

  result.hits = [
    ...reqHits.map((rule) => ({type: "硬性要求", text: rule.label})),
    ...skillHits.slice(0, 12).map((term) => ({type: "技能", text: term}))
  ];
  result.gaps = [
    ...reqMiss.map((rule) => ({
      type: "硬性要求",
      text: rule.label,
      hint: "简历里没找到对应证据，确认是真没有还是没写出来"
    })),
    ...result.missingSkills.map((term) => ({
      type: "技能",
      text: term,
      hint: "JD 提到但简历未覆盖，若实际做过建议补进简历"
    }))
  ];

  if (required.length === 0) {
    result.note = "JD 里没有识别到明确的硬性门槛，分数主要由技能重合决定。";
  }
  if (overlap === null) {
    result.note = [result.note, "薪资无法解析（可能写的是面议），薪资维度未计入。"]
      .filter(Boolean)
      .join(" ");
  }
  return result;
}

// 给模型的匹配度明细。模型只解释不改分，所以这里必须把分数和判定一起给它。
export function formatMatchForModel(match, {title, company}) {
  const lines = [
    `岗位：${title || "未提供"}${company ? `（${company}）` : ""}`,
    `规则层总分：${match.total} / 100`,
    "",
    "分项：",
    ...match.dims.map((dim) => `- ${dim.label}：${dim.score} / ${dim.weight}（${dim.detail}）`)
  ];
  if (match.hits.length) {
    lines.push("", "命中项：", ...match.hits.map((item) => `- [${item.type}] ${item.text}`));
  }
  if (match.gaps.length) {
    lines.push("", "差距项：", ...match.gaps.map((item) => `- [${item.type}] ${item.text}`));
  }
  if (match.age) {
    lines.push("", `年龄相关表述：${match.age.text}${match.age.limited ? "（构成明确限制）" : "（未设限）"}`);
  }
  return lines.join("\n");
}
