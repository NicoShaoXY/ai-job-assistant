// 记录页预览的演示数据。由 生成预览.py 拼在引擎代码之前，
// 因为 records.js 末尾会立刻调用 load()，而它依赖 chrome.storage。
// 这里用一份假数据顶替，其余渲染逻辑跑的都是真代码。

const JOBS = [
  {
    url: "https://www.zhipin.com/job_detail/aaa.html",
    title: "大模型应用工程师",
    company: "某某智能科技有限公司",
    salary: "30-45K·14薪",
    status: "replied",
    firstSeenAt: "2026-10-02T10:12:00.000Z",
    lastSeenAt: "2026-10-09T09:30:00.000Z",
    statusAt: {viewed: "2026-10-02T10:12:00.000Z", greeted: "2026-10-02T10:20:00.000Z", replied: "2026-10-05T14:00:00.000Z"},
    greetings: [{text: "看到您在招大模型方向，我做了 5 年算法，上家主要搞知识库问答，检索准确率从 62% 提到 81%，坑基本都在切片和重排上。这块你们现在是自研还是接现成的？", at: "2026-10-02T10:20:00.000Z"}],
    jdText: "岗位职责\n1. 负责大模型应用落地，基于 RAG 与 Agent 搭建企业知识库问答系统；\n2. 负责多模态能力的工程化接入，跟进 vLLM 推理加速与私有化部署。\n任职要求\n1. 本科及以上学历，硕士优先，985/211 院校优先；\n2. 5 年以上后端或算法工程经验，有生产环境上线案例；\n3. 熟悉 Python、Docker、Kubernetes，了解 LangChain、向量数据库。"
  },
  {
    url: "https://www.zhipin.com/job_detail/bbb.html",
    title: "AI 算法工程师",
    company: "另一家网络科技有限公司",
    salary: "25-40K",
    status: "greeted",
    firstSeenAt: "2026-10-03T15:40:00.000Z",
    lastSeenAt: "2026-10-08T11:05:00.000Z",
    statusAt: {viewed: "2026-10-03T15:40:00.000Z", greeted: "2026-10-03T15:50:00.000Z"},
    greetings: [{text: "看到要求里有多模态落地，我之前做过一个企业知识库问答，检索准确率从 62% 提到 81%。这块你们现在是自研还是接现成的？", at: "2026-10-03T15:50:00.000Z"}],
    jdText: "任职要求\n1. 硕士及以上学历，计算机相关专业；\n2. 熟悉 PyTorch、Transformer，有 NLP 或多模态项目经验；\n3. 有论文或竞赛经历者优先。\n岗位职责\n负责算法模型训练与调优，参与知识图谱建设。"
  },
  {
    url: "https://www.zhipin.com/job_detail/ccc.html",
    title: "数据平台开发工程师",
    company: "某数据科技有限公司",
    salary: "20-35K·13薪",
    status: "applied",
    firstSeenAt: "2026-09-28T09:00:00.000Z",
    lastSeenAt: "2026-10-07T16:20:00.000Z",
    statusAt: {viewed: "2026-09-28T09:00:00.000Z", greeted: "2026-09-28T09:15:00.000Z", replied: "2026-09-30T10:00:00.000Z", applied: "2026-10-01T09:30:00.000Z"},
    greetings: [],
    jdText: "岗位职责\n1. 负责数据仓库建设与 ETL 开发；\n2. 使用 Spark、Flink 处理大规模数据。\n任职要求\n1. 本科及以上学历，3 年以上经验；\n2. 熟悉 SQL、Hive、Kafka；\n3. 有数据治理经验优先。"
  },
  {
    url: "https://www.zhipin.com/job_detail/ddd.html",
    title: "后端开发工程师",
    company: "某某信息技术有限公司",
    salary: "18-30K",
    status: "viewed",
    firstSeenAt: "2026-10-06T20:10:00.000Z",
    lastSeenAt: "2026-10-06T20:10:00.000Z",
    statusAt: {viewed: "2026-10-06T20:10:00.000Z"},
    greetings: [],
    jdText: "任职要求\n1. 本科及以上学历，3 年以上 Java 开发经验；\n2. 熟悉 SpringBoot、MySQL、Redis；\n3. 有高并发、微服务经验优先。\n岗位职责\n负责核心业务系统开发与性能优化。"
  },
  {
    url: "https://www.zhipin.com/job_detail/eee.html",
    title: "机器学习工程师",
    company: "某智能科技有限公司",
    salary: "面议",
    status: "viewed",
    firstSeenAt: "2026-10-08T13:00:00.000Z",
    lastSeenAt: "2026-10-08T13:00:00.000Z",
    statusAt: {viewed: "2026-10-08T13:00:00.000Z"},
    greetings: [],
    jdText: "任职要求\n1. 硕士及以上学历，机器学习相关方向；\n2. 熟悉 Python、TensorFlow 或 PyTorch；\n3. 有推荐系统、强化学习经验优先；\n4. 能接受出差。"
  }
];

window.chrome = {
  storage: {
    local: {
      get: async () => Object.fromEntries(JOBS.map((job) => ["job:" + job.url, job])),
      set: async () => {},
      remove: async () => {}
    }
  }
};
