// 背调的「查询入口与判断标准」。
//
// 注意：背调的主路径已经改成自动检索（见 search.js），这个文件现在只保留两样东西：
//   ① 8 个官方查询入口 —— 没配搜索 API Key 时的兜底路径，用户可以照着手动查
//   ② 逐项判断标准 —— 什么算高危，给用户对照
//
// 也就是说这里的内容是兜底，不是主流程。主流程不需要用户动手。
//
// 保留兜底的原因：搜索 API 要额外配 Key，有人不愿意配；
// 而且检索结果本身也可能有遗漏，官方渠道永远是最准的。两条路并存。

// 官方与常用查询入口。带 search 参数的用「公司全称」直接拼，其余给官网由用户自行搜索。
export const OFFICIAL_SOURCES = [
  {
    key: "gsxt",
    name: "国家企业信用信息公示系统",
    base: "https://www.gsxt.gov.cn/index.html",
    what: "工商登记、经营异常名录、严重违法失信名单、行政处罚",
    tip: "官方权威源。搜公司全称，重点看「经营异常名录」和「严重违法失信名单」两个标签页。"
  },
  {
    key: "zhixing",
    name: "中国执行信息公开网",
    base: "http://zxgk.court.gov.cn/",
    what: "被执行人、失信被执行人、限制消费令",
    tip: "官方。进「失信被执行人」按公司全称查。有记录说明公司已被法院认定有能力履行而拒不履行。"
  },
  {
    key: "wenshu",
    name: "中国裁判文书网",
    base: "https://wenshu.court.gov.cn/",
    what: "劳动争议诉讼、追索劳动报酬、合同纠纷",
    tip: "搜公司全称，看案由含「劳动争议」「追索劳动报酬」的判决数量和年份分布——近两年集中出现要警惕。"
  },
  {
    key: "creditchina",
    name: "信用中国",
    base: "https://www.creditchina.gov.cn/",
    what: "行政处罚、红黑名单",
    tip: "官方。各地行政处罚记录会在这里归集，注意看处罚事由是否涉及用工、社保、消防。"
  },
  {
    key: "kanzhun",
    name: "看准网",
    base: "https://www.kanzhun.com/",
    what: "在职 / 离职员工评价、面试评价、薪资爆料",
    tip: "看评价优先看「离职员工」写的长评和带具体事例的，短评和清一色五星容易是刷的。"
  },
  {
    key: "tianyancha",
    name: "天眼查",
    base: "https://www.tianyancha.com/",
    search: (company) => `https://www.tianyancha.com/search?key=${encodeURIComponent(company)}`,
    what: "工商信息聚合、司法风险、社保缴纳人数",
    tip: "商业平台，可作线索但以官方为准。重点看「社保缴纳人数」的绝对值与近三年变化趋势。"
  },
  {
    key: "qcc",
    name: "企查查",
    base: "https://www.qcc.com/",
    search: (company) => `https://www.qcc.com/web/search?key=${encodeURIComponent(company)}`,
    what: "同上，用于交叉验证",
    tip: "与天眼查交叉比对。两者信息不一致时一律以官方渠道为准。"
  },
  {
    key: "12333",
    name: "人社部 12333 / 当地人社局",
    base: "https://www.12333.gov.cn/",
    what: "社保欠缴、劳动保障监察处罚、欠薪黑名单",
    tip: "社保和欠薪问题以当地人社部门公示为准，重大欠薪案件会进入「拖欠农民工工资失信联合惩戒名单」。"
  }
];

// 逐项核查标准。用户查的时候按这个对照，模型解读时也按这个判定。
export const RISK_ITEMS = [
  {
    key: "zhixing",
    label: "被执行人 / 失信被执行",
    source: "中国执行信息公开网",
    how: "按公司全称分别查「失信被执行人」和「被执行人」两个栏目",
    danger: "有失信记录说明公司已被法院认定有能力履行而拒不履行。这类公司欠薪、裁员不给赔偿的概率显著偏高。"
  },
  {
    key: "chufa",
    label: "行政处罚",
    source: "国家企业信用信息公示系统 / 信用中国",
    how: "看处罚事由、处罚金额、处罚年份",
    danger: "处罚事由涉及用工、社保、安全生产、消防的，说明内部合规意识薄弱，入职后可能被要求承担灰色操作。"
  },
  {
    key: "jingyingyichang",
    label: "经营异常 / 严重违法失信",
    source: "国家企业信用信息公示系统",
    how: "看「经营异常名录」和「严重违法失信名单」",
    danger: "列入经营异常常见原因是失联、未按时年报、公示信息造假，直接反映公司经营稳定性。"
  },
  {
    key: "zhongcai",
    label: "劳动仲裁 / 劳动争议诉讼",
    source: "中国裁判文书网",
    how: "统计案由为「劳动争议」「追索劳动报酬」的案件数量与年份",
    danger: "零散个案正常，近两年集中出现、且多为员工胜诉的，说明存在系统性用工问题。"
  },
  {
    key: "qianxin",
    label: "欠薪 / 拖欠薪资记录",
    source: "信用中国 / 当地人社局 / 裁判文书网",
    how: "搜「公司名 + 拖欠工资」「公司名 + 欠薪」",
    danger: "这是求职风险里最直接的一条，有公开欠薪记录的基本可以排除。"
  },
  {
    key: "shebao",
    label: "社保欠缴 / 参保人数异常",
    source: "天眼查 / 企查查 / 国家企业信用信息公示系统年报",
    how: "看年报里的社保参保人数，对比公司宣称的员工规模",
    danger: "参保人数远低于宣称规模，常见于大量用劳务派遣、试用期不上社保，或虚报团队规模。"
  }
];

export function buildSourceLinks(company) {
  const name = String(company || "").trim();
  return OFFICIAL_SOURCES.map((source) => ({
    key: source.key,
    name: source.name,
    url: name && source.search ? source.search(name) : source.base,
    what: source.what,
    tip: source.tip,
    // 带公司名参数的是「直接可查」，只给官网的需要用户自己搜一次
    direct: Boolean(name && source.search)
  }));
}

// 作业单文本。用户点「复制作业单」时可以拿走，照着一条条查。
export function buildChecklistText(company) {
  const name = String(company || "").trim() || "（公司全称）";
  const lines = [
    `【背调查询作业单】目标公司：${name}`,
    "",
    "一、查询顺序与入口"
  ];
  OFFICIAL_SOURCES.forEach((source, index) => {
    lines.push(`${index + 1}. ${source.name} —— ${source.what}`);
    lines.push(`   地址：${source.base}`);
    lines.push(`   要点：${source.tip}`);
  });
  lines.push("", "二、逐项判断标准");
  RISK_ITEMS.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.label}（查：${item.source}）`);
    lines.push(`   怎么查：${item.how}`);
    lines.push(`   为什么重要：${item.danger}`);
  });
  lines.push(
    "",
    "三、粘贴回插件",
    "把查到页面的正文复制下来（截图 OCR 也可以），粘贴到「你查到的材料」输入框，再点生成背调报告。",
    "材料里没有的东西，报告不会编——这是有意设计的。"
  );
  return lines.join("\n");
}
