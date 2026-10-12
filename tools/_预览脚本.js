// 预览页的演示数据与交互。由 生成预览.py 拼到引擎代码之后，不参与扩展打包。

const $ = (s) => document.querySelector(s);

const JD = `岗位职责
1. 负责大模型应用落地，基于 RAG 与 Agent 搭建企业知识库问答系统；
2. 负责多模态能力的工程化接入，跟进 vLLM 推理加速与私有化部署；
3. 与产品、算法团队协作，推动模型能力在业务侧落地。
任职要求
1. 本科及以上学历，硕士优先，985/211 院校优先；
2. 5 年以上后端或算法工程经验，有生产环境上线案例；
3. 熟悉 Python、Docker、Kubernetes，了解 LangChain、向量数据库；
4. 年龄 35 岁以下，能接受短期出差。`;

const RESUME = `李某，硕士，浙江大学计算机科学与技术。
2018.07 - 2023.09 某互联网公司 算法工程师（5 年）
主导企业知识库问答项目，基于 RAG 架构，检索准确率从 62% 提升到 81%，已上线生产环境，服务 3 万+ 员工。
负责模型服务化，使用 PyTorch 与 Docker 部署推理服务。
技术栈：Python、PyTorch、LangChain、Docker、MySQL、Redis、Elasticsearch。`;

const meta = {title: "大模型应用工程师", company: "某某智能科技有限公司", salary: "30-45K·14薪"};
const match = scoreMatch({jdText: JD, resumeText: RESUME, salary: meta.salary, expectedSalary: "35k-40k"});

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const ps = $("#pageStatus");
ps.className = "page-status ok";
ps.textContent = "已读取「" + meta.title + "」";

$("#jdInput").value = JD;
$("#jdCount").textContent = JD.trim().length.toLocaleString("zh-CN") + " 字";

$("#jobRecord").hidden = false;
$("#recordSeen").textContent = "今天首次查看";
$("#recordCompany").textContent = meta.company + " · " + meta.salary;
$("#statusRow").replaceChildren(...["查看过", "已打招呼", "HR 已回复", "已投简历"].map((t, i) => {
  const b = el("button", "status-step" + (i === 0 ? " current" : ""), t);
  b.type = "button";
  return b;
}));

$("#jobInsight").hidden = false;
$("#matchScore").textContent = String(match.total);
$("#matchGauge").style.setProperty("--pct", String(Math.min(match.total, 100)));
$("#matchGauge").className = "match-gauge " + (match.total >= 70 ? "" : match.total >= 45 ? "low" : "poor");

$("#matchDims").replaceChildren(...match.dims.map((d) => {
  const row = el("div", "match-dim");
  row.append(el("span", "name", d.label));
  const bar = el("div", "bar");
  const fill = el("span");
  fill.style.width = Math.max(0, Math.min(d.percent, 100)) + "%";
  if (d.percent < 50) fill.style.background = "var(--warn)";
  bar.append(fill);
  row.append(bar);
  row.append(el("span", "val", d.score + "/" + d.weight));
  return row;
}));

const notes = [];
if (match.age) notes.push("JD 年龄表述：" + match.age.text + (match.age.limited ? "（构成明确限制）" : "（未设限）"));
notes.push("岗位：" + meta.title);
$("#matchNote").textContent = notes.join("　");

const gaps = $("#matchGaps");
gaps.hidden = false;
gaps.open = true;
$("#gapCount").textContent = String(match.gaps.length);
$("#gapList").replaceChildren(...match.gaps.map((g) => {
  const item = el("div", "gap-item");
  item.append(el("b", "", "[" + g.type + "] " + g.text));
  item.append(el("span", "gap-hint", g.hint));
  return item;
}));

$("#resultSection").hidden = false;
$("#resultLabel").textContent = "生成结果";
$("#resultText").textContent = "看到您在招大模型方向，我做了 5 年算法，上家主要搞知识库问答，检索准确率从 62% 提到 81%，踩的坑基本都在切片和重排上。这块你们现在是自研还是接现成的？";

$("#resumeUploadBtn").hidden = true;
$("#resumeHint").hidden = true;
$("#resumeEmpty").hidden = true;
$("#resumeChip").hidden = false;
$("#resumeClear").hidden = false;
$("#resumeFileName").textContent = "我的简历.pdf";
$("#currentSalary").value = "28k";
$("#expectedSalary").value = "35k-40k";

$("#disclaimerText").textContent = DISCLAIMER_FULL;
$("#greetingPrompt").value = GREETING_SYSTEM_PROMPT;
$("#styleSamples").value = "在的，这个岗位还招吗\n好的，我这边时间都可以，您看哪天方便\n简历发您了，您看下";
$("#humanizeEnabled").checked = true;
$("#searchKey").value = "sk-demo-bocha-key";

function renderSources() {
  const company = $("#backcheckCompany").value.trim();
  $("#sourceList").replaceChildren(...buildSourceLinks(company).map((s) => {
    const item = el("div", "source-item");
    const a = document.createElement("a");
    a.href = s.url; a.target = "_blank"; a.rel = "noreferrer"; a.textContent = s.name;
    item.append(a);
    item.append(el("p", "source-what", s.what));
    item.append(el("p", "source-tip", s.tip));
    return item;
  }));
}

function wire(openId, modalId, closeIds, onOpen) {
  $(openId).addEventListener("click", () => {
    if (onOpen) onOpen();
    $(modalId).hidden = false;
  });
  closeIds.forEach((id) => $(id).addEventListener("click", () => { $(modalId).hidden = true; }));
  $(modalId).addEventListener("click", (e) => { if (e.target.dataset.close) $(modalId).hidden = true; });
}

wire("#openBackcheck", "#backcheckModal", ["#backcheckClose"], () => {
  $("#backcheckCompany").value = meta.company;
  renderSources();
});
$("#backcheckCompany").addEventListener("change", renderSources);
wire("#openDisclaimer", "#disclaimerModal", ["#disclaimerClose", "#disclaimerOk"]);
wire("#settingsToggle", "#settingsModal", ["#settingsClose"]);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  ["#settingsModal", "#backcheckModal", "#disclaimerModal"].forEach((id) => { $(id).hidden = true; });
});
