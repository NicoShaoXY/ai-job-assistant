import {GREETING_SYSTEM_PROMPT, HR_REPLY_SYSTEM_PROMPT, HUMANIZE_SYSTEM_PROMPT, buildGreetingSystemPrompt} from "./prompts.js";
import {extractResumeText} from "./resume-parser.js";
import {STATUSES, STATUS_LABELS, recordJobView, recordGreeting, setJobStatus, formatSeenAt} from "./job-store.js";
import {initInsight} from "./insight.js";

// 只支持 DeepSeek，地址写死不开放配置：少一个填错就报错的地方，
// host_permissions 也能只留这一个域名。
const API_BASE = "https://api.deepseek.com/v1";
const SETTINGS_KEYS = ["currentSalary", "expectedSalary", "greetingPrompt", "styleSamples", "humanizeEnabled", "apiModel", "apiKey", "searchKey"];
const RESUME_KEYS = ["resume", "resumeFileName"];

const dom = {
  pageStatus: document.querySelector("#pageStatus"),
  refreshJd: document.querySelector("#refreshJd"),
  settingsToggle: document.querySelector("#settingsToggle"),
  openRecords: document.querySelector("#openRecords"),
  settingsModal: document.querySelector("#settingsModal"),
  settingsClose: document.querySelector("#settingsClose"),
  jobModal: document.querySelector("#jobModal"),
  jobConfirm: document.querySelector("#jobConfirm"),
  jobDismiss: document.querySelector("#jobDismiss"),
  tabs: [...document.querySelectorAll(".tab")],
  panels: {
    greeting: document.querySelector("#panel-greeting"),
    reply: document.querySelector("#panel-reply")
  },
  jdInput: document.querySelector("#jdInput"),
  hrInput: document.querySelector("#hrInput"),
  jdCount: document.querySelector("#jdCount"),
  hrCount: document.querySelector("#hrCount"),
  generateGreeting: document.querySelector("#generateGreeting"),
  generateReply: document.querySelector("#generateReply"),
  jobRecord: document.querySelector("#jobRecord"),
  recordSeen: document.querySelector("#recordSeen"),
  recordCompany: document.querySelector("#recordCompany"),
  statusRow: document.querySelector("#statusRow"),
  resultLabel: document.querySelector("#resultLabel"),
  resultSection: document.querySelector("#resultSection"),
  resultText: document.querySelector("#resultText"),
  copyResult: document.querySelector("#copyResult"),
  status: document.querySelector("#status"),
  resumeFile: document.querySelector("#resumeFile"),
  resumeUploadBtn: document.querySelector("#resumeUploadBtn"),
  resumeFileName: document.querySelector("#resumeFileName"),
  resumeEmpty: document.querySelector("#resumeEmpty"),
  resumeChip: document.querySelector("#resumeChip"),
  resumeHint: document.querySelector("#resumeHint"),
  resumeClear: document.querySelector("#resumeClear"),
  currentSalary: document.querySelector("#currentSalary"),
  expectedSalary: document.querySelector("#expectedSalary"),
  greetingPrompt: document.querySelector("#greetingPrompt"),
  resetGreetingPrompt: document.querySelector("#resetGreetingPrompt"),
  styleSamples: document.querySelector("#styleSamples"),
  humanizeEnabled: document.querySelector("#humanizeEnabled"),
  regenResult: document.querySelector("#regenResult"),
  apiModel: document.querySelector("#apiModel"),
  apiKey: document.querySelector("#apiKey"),
  searchKey: document.querySelector("#searchKey"),
  saveSettings: document.querySelector("#saveSettings"),
  settingsStatus: document.querySelector("#settingsStatus"),
  profileStatus: document.querySelector("#profileStatus")
};

// 上一次自动读取到的岗位信息。JD 正文进输入框，岗位名/薪资/公司留在这里，
// 生成时一并拼进 prompt——JD 正文里通常没有薪资，谈薪应答需要它。
let jdMeta = null;
// 已经读过或用户明确说「暂不」的岗位页，不再重复弹窗
// 当前面板里这条 JD 对应的岗位记录
let currentJob = null;
let lastJobUrl = "";
let dismissedJobUrl = "";

function setJdMeta(data) {
  jdMeta = data?.title || data?.salary || data?.company ? {
    title: data.title || "",
    salary: data.salary || "",
    company: data.company || "",
    sourceHead: (data.jdText || "").slice(0, 40)
  } : null;
}

// 只有输入框里仍然是这次读到的那份 JD 时，附带信息才成立；
// 用户手动粘贴了别的岗位就不能再带上一次的岗位名和薪资。
function jdMetaBlock() {
  if (!jdMeta || !jdMeta.sourceHead) return "";
  if (!dom.jdInput.value.includes(jdMeta.sourceHead)) return "";
  return [
    jdMeta.title ? `岗位名称：${jdMeta.title}` : "",
    jdMeta.salary ? `岗位挂出的薪资：${jdMeta.salary}` : "",
    jdMeta.company ? `公司：${jdMeta.company}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function bindCounter(input, node) {
  const render = () => {
    const n = input.value.trim().length;
    node.textContent = n ? `${n.toLocaleString("zh-CN")} 字` : "";
  };
  input.addEventListener("input", render);
  return render;
}

function setStatus(node, message, kind = "") {
  node.textContent = message;
  node.className = `status ${kind}`.trim();
}

function isBossDetailUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return (url.hostname === "zhipin.com" || url.hostname.endsWith(".zhipin.com")) && url.pathname.startsWith("/job_detail/");
  } catch {
    return false;
  }
}

function switchTab(name) {
  dom.tabs.forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  Object.entries(dom.panels).forEach(([key, panel]) => {
    panel.hidden = key !== name;
  });
}

dom.tabs.forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

const renderJdCount = bindCounter(dom.jdInput, dom.jdCount);
bindCounter(dom.hrInput, dom.hrCount);

// ---- 设置弹窗 ----

function openSettings() {
  dom.settingsModal.hidden = false;
  dom.settingsToggle.setAttribute("aria-expanded", "true");
  setStatus(dom.settingsStatus, "");
  dom.apiKey.focus();
}

function closeSettings() {
  dom.settingsModal.hidden = true;
  dom.settingsToggle.setAttribute("aria-expanded", "false");
}

dom.settingsToggle.addEventListener("click", () => {
  if (dom.settingsModal.hidden) openSettings();
  else closeSettings();
});

dom.settingsClose.addEventListener("click", closeSettings);

dom.openRecords.addEventListener("click", () => {
  chrome.tabs.create({url: chrome.runtime.getURL("records.html")});
});

dom.settingsModal.addEventListener("click", (event) => {
  if (event.target.dataset.close) closeSettings();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!dom.jobModal.hidden) closeJobPrompt();
  else if (!dom.settingsModal.hidden) closeSettings();
});

// ---- 换岗位提示：只由 background 的 URL 监听触发，不代表已经读过页面 ----

function closeJobPrompt() {
  dom.jobModal.hidden = true;
}

dom.jobDismiss.addEventListener("click", () => {
  dismissedJobUrl = lastJobUrl;
  closeJobPrompt();
});

dom.jobModal.addEventListener("click", (event) => {
  if (event.target.dataset.close) {
    dismissedJobUrl = lastJobUrl;
    closeJobPrompt();
  }
});

dom.jobConfirm.addEventListener("click", () => {
  closeJobPrompt();
  autoDetectAndReadJd();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "job-page-changed") return;
  const url = String(message.url || "").split(/[?#]/)[0];
  if (!url || url === lastJobUrl) return;
  lastJobUrl = url;
  if (url === dismissedJobUrl) return;
  dom.jobModal.hidden = false;
});

// ---- 简历：只上传，不展示内容、不支持粘贴 ----

function renderResume(hasResume, fileName) {
  // 传好了就把上传按钮和格式说明收起来，只留文件牌和「清除」——
  // 文件牌本身就是「上传成功」的状态，不需要再来一行提示
  dom.resumeUploadBtn.hidden = hasResume;
  dom.resumeHint.hidden = hasResume;
  dom.resumeEmpty.hidden = hasResume;
  dom.resumeChip.hidden = !hasResume;
  dom.resumeFileName.textContent = fileName || "已上传";
  dom.resumeClear.hidden = !hasResume;
}

dom.resumeUploadBtn.addEventListener("click", () => dom.resumeFile.click());

dom.resumeFile.addEventListener("change", async () => {
  const file = dom.resumeFile.files?.[0];
  if (!file) return;

  dom.resumeUploadBtn.disabled = true;
  const originalLabel = dom.resumeUploadBtn.textContent;
  dom.resumeUploadBtn.textContent = "解析中…";
  setStatus(dom.profileStatus, "");

  try {
    const text = await extractResumeText(file);
    if (!text) {
      setStatus(dom.profileStatus, "这个文件内容是空的。", "error");
      return;
    }
    await chrome.storage.local.set({resume: text, resumeFileName: file.name});
    renderResume(true, file.name);
    // 成功不提示：文件名已经显示在上传按钮旁边了，再来一行是重复信息
    setStatus(dom.profileStatus, "");
  } catch (error) {
    setStatus(dom.profileStatus, error instanceof Error ? error.message : String(error), "error");
  } finally {
    dom.resumeUploadBtn.disabled = false;
    dom.resumeUploadBtn.textContent = originalLabel;
    dom.resumeFile.value = "";
  }
});

dom.resumeClear.addEventListener("click", async () => {
  await chrome.storage.local.remove(RESUME_KEYS);
  renderResume(false, "");
  setStatus(dom.profileStatus, "");
});

// ---- 我的资料：薪资填完即存 ----

async function saveSalary() {
  await chrome.storage.local.set({
    currentSalary: dom.currentSalary.value.trim(),
    expectedSalary: dom.expectedSalary.value.trim()
  });
  setStatus(dom.profileStatus, "");
}

[dom.currentSalary, dom.expectedSalary].forEach((input) => {
  input.addEventListener("change", saveSalary);
});

// ---- 设置：加载与保存 ----

async function loadSettings() {
  const resumeStored = await chrome.storage.local.get(RESUME_KEYS);
  renderResume(Boolean(resumeStored.resume), resumeStored.resumeFileName || "");

  const settingsStored = await chrome.storage.local.get(SETTINGS_KEYS);
  dom.currentSalary.value = settingsStored.currentSalary || "";
  dom.expectedSalary.value = settingsStored.expectedSalary || "";
  dom.greetingPrompt.value = settingsStored.greetingPrompt || GREETING_SYSTEM_PROMPT;
  dom.styleSamples.value = settingsStored.styleSamples || "";
  // 默认开启。用户抱怨"太生硬"时，多一次润色是最直接的解法，代价只有几厘钱。
  dom.humanizeEnabled.checked = settingsStored.humanizeEnabled !== false;
  dom.apiModel.value = settingsStored.apiModel || "deepseek-chat";
  dom.apiKey.value = settingsStored.apiKey || "";
  dom.searchKey.value = settingsStored.searchKey || "";
}

dom.resetGreetingPrompt.addEventListener("click", () => {
  dom.greetingPrompt.value = GREETING_SYSTEM_PROMPT;
  setStatus(dom.settingsStatus, "已恢复默认提示词，点「保存设置」生效。");
});

dom.saveSettings.addEventListener("click", async () => {
  await chrome.storage.local.set({
    greetingPrompt: dom.greetingPrompt.value.trim() || GREETING_SYSTEM_PROMPT,
    styleSamples: dom.styleSamples.value.trim(),
    humanizeEnabled: dom.humanizeEnabled.checked,
    apiModel: dom.apiModel.value.trim(),
    apiKey: dom.apiKey.value.trim(),
    searchKey: dom.searchKey.value.trim()
  });
  setStatus(dom.settingsStatus, "已保存到本机。", "success");
  setTimeout(closeSettings, 700);
});

// ---- JD 读取：手动触发，侧边栏常驻时靠这个按钮换页 ----

async function autoDetectAndReadJd() {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab?.id || !isBossDetailUrl(tab.url || "")) {
    jdMeta = null;
    renderJobRecord(null);
    dom.pageStatus.className = "page-status";
    setStatus(dom.pageStatus, "非职位详情页，可手动粘贴 JD。");
    await insight.refresh();
    return;
  }
  dom.pageStatus.className = "page-status";
  setStatus(dom.pageStatus, "检测到职位详情页，正在读取…");
  try {
    const injection = await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      files: ["extractor-page.js"]
    });
    const data = injection?.[0]?.result;
    if (!data?.ok) {
      setStatus(dom.pageStatus, data?.error || "未能自动读取，可手动粘贴。", "warn");
      return;
    }
    lastJobUrl = String(data.pageUrl || "").split(/[?#]/)[0] || lastJobUrl;
    dismissedJobUrl = "";
    dom.jdInput.value = data.jdText;
    setJdMeta(data);
    renderJdCount();

    const record = await recordJobView(data);
    renderJobRecord(record);
    if (!showHistoryGreeting(record)) {
      dom.resultSection.hidden = true;
    }
    await insight.refresh();
    const label = data.title ? `已读取「${data.title}」` : "已自动读取当前 JD";
    setStatus(dom.pageStatus, label, "ok");
  } catch {
    setStatus(dom.pageStatus, "读取失败，可手动粘贴 JD。", "warn");
  }
}

dom.refreshJd.addEventListener("click", () => autoDetectAndReadJd());

// ---- 模型调用 ----

async function callModel(systemPrompt, userPrompt, options = {}) {
  const settings = await chrome.storage.local.get(["apiModel", "apiKey"]);
  if (!settings.apiKey) {
    throw new Error("请先在右上角设置里填好 DeepSeek API Key。");
  }
  const body = {
    model: settings.apiModel || "deepseek-chat",
    // 温度按任务分开给：写文案要打散模型最顺手的那套模板句式，所以偏高；
    // 谈薪和背调解读要稳，所以偏低。frequency_penalty 压重复用词，
    // 写打招呼语时开着能明显减少"每句一个模子"的感觉。
    temperature: typeof options.temperature === "number" ? options.temperature : 0.7,
    messages: [
      {role: "system", content: systemPrompt},
      {role: "user", content: userPrompt}
    ]
  };
  if (typeof options.frequencyPenalty === "number") {
    body.frequency_penalty = options.frequencyPenalty;
  }
  const response = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`模型接口返回 ${response.status}：${text.slice(0, 120) || "无详情"}`);
  }
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("模型没有返回内容，换个说法再试一次。");
  }
  return content;
}

// ---- 岗位记录 ----

function renderJobRecord(record) {
  currentJob = record;
  if (!record) {
    dom.jobRecord.hidden = true;
    return;
  }
  dom.jobRecord.hidden = false;

  // 公司名要显式露出来。之前只显示岗位名，用户根本没法确认公司有没有读到——
  // 而背调全靠公司名，读不到等于这个功能废掉。
  const company = record.company || "";
  const line = [company, record.salary].filter(Boolean).join(" · ");
  dom.recordCompany.textContent = line || "没读到公司名，背调时请手动填写";
  dom.recordCompany.classList.toggle("missing", !company);

  const seen = record.firstSeenAt === record.lastSeenAt
    ? `${formatSeenAt(record.firstSeenAt)}首次查看`
    : `${formatSeenAt(record.firstSeenAt)}首次查看 · 已看过多次`;
  dom.recordSeen.textContent = seen;

  const reached = STATUSES.indexOf(record.status);
  dom.statusRow.replaceChildren(...STATUSES.map((status, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "status-step";
    if (index < reached) button.classList.add("done");
    if (index === reached) button.classList.add("current");
    button.textContent = STATUS_LABELS[status];
    button.addEventListener("click", async () => {
      renderJobRecord(await setJobStatus(record.url, status));
    });
    return button;
  }));
}

// 切回打过招呼的岗位，直接把上一条填回结果区，不用重新生成
function showHistoryGreeting(record) {
  const last = record?.greetings?.[0];
  if (!last) return false;
  dom.resultLabel.textContent = `上次生成的打招呼语（${formatSeenAt(last.at)}）`;
  dom.resultText.textContent = last.text;
  dom.resultSection.hidden = false;
  dom.copyResult.textContent = "一键复制";
  return true;
}

function showResult(text) {
  dom.resultLabel.textContent = "生成结果";
  dom.resultText.textContent = text;
  dom.resultSection.hidden = false;
  dom.copyResult.textContent = "一键复制";
}

async function withLoading(button, task) {
  button.disabled = true;
  const original = button.textContent;
  button.textContent = "生成中…";
  try {
    await task();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

// 生成动作抽成独立函数，是为了让「换一版」能复用同一套输入，
// 不用把 JD、简历、HR 原话再取一遍。
let lastGenerate = null;

async function generateGreeting() {
  const jd = dom.jdInput.value.trim();
  if (!jd) {
    setStatus(dom.status, "请先粘贴或读取 JD。", "error");
    return;
  }
  const stored = await chrome.storage.local.get(["resume", "greetingPrompt", "styleSamples", "humanizeEnabled"]);
  if (!stored.resume) {
    setStatus(dom.status, "请先在下方「我的资料」上传一份简历，生成才会贴合你的经历。", "error");
    return;
  }
  setStatus(dom.status, "");
  const userPrompt = [jdMetaBlock(), `岗位 JD：\n${jd}`, `我的简历：\n${stored.resume}`]
    .filter(Boolean)
    .join("\n\n");
  // 用户自己改过提示词就用他的，但说话风格样例仍然拼上去
  const systemPrompt = buildGreetingSystemPrompt(stored.styleSamples, stored.greetingPrompt);
  let result = await callModel(systemPrompt, userPrompt, {temperature: 0.9, frequencyPenalty: 0.4});
  if (stored.humanizeEnabled) {
    result = await callModel(HUMANIZE_SYSTEM_PROMPT, result, {temperature: 0.95, frequencyPenalty: 0.3});
  }
  showResult(result);
  if (currentJob) {
    renderJobRecord(await recordGreeting(currentJob.url, result));
  }
  setStatus(dom.status, "生成完成。", "success");
}

async function generateReply() {
  const hrMessage = dom.hrInput.value.trim();
  if (!hrMessage) {
    setStatus(dom.status, "请先粘贴 HR 发来的话。", "error");
    return;
  }
  const stored = await chrome.storage.local.get(["resume", "currentSalary", "expectedSalary"]);
  setStatus(dom.status, "");
  const jd = dom.jdInput.value.trim();
  const userPrompt = [
    `HR 发来的话：${hrMessage}`,
    jdMetaBlock(),
    jd ? `这个岗位的 JD：\n${jd}` : "",
    `我目前薪资：${stored.currentSalary || "未填写"}`,
    `我期望薪资：${stored.expectedSalary || "未填写"}`,
    `我的简历：\n${stored.resume || "未上传"}`
  ]
    .filter(Boolean)
    .join("\n\n");
  // 谈薪这条要稳，温度压低；不加频次惩罚，避免把"区间""涨幅"这类必要措辞也压掉
  const result = await callModel(HR_REPLY_SYSTEM_PROMPT, userPrompt, {temperature: 0.6});
  showResult(result);
  setStatus(dom.status, "生成完成。", "success");
}

// 校验不通过时函数内部已经写过提示并正常返回，这里只兜住模型调用抛出的异常
async function runGenerate(button, task) {
  await withLoading(button, async () => {
    lastGenerate = task;
    try {
      await task();
    } catch (error) {
      setStatus(dom.status, error instanceof Error ? error.message : String(error), "error");
    }
  });
}

dom.generateGreeting.addEventListener("click", () => runGenerate(dom.generateGreeting, generateGreeting));
dom.generateReply.addEventListener("click", () => runGenerate(dom.generateReply, generateReply));

dom.regenResult.addEventListener("click", () => {
  if (lastGenerate) runGenerate(dom.regenResult, lastGenerate);
});

dom.copyResult.addEventListener("click", async () => {
  const text = dom.resultText.textContent;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    dom.copyResult.textContent = "已复制";
    setTimeout(() => {
      dom.copyResult.textContent = "一键复制";
    }, 1500);
  } catch {
    const range = document.createRange();
    range.selectNodeContents(dom.resultText);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    setStatus(dom.status, "自动复制失败，已选中文本，请按 ⌘C。", "error");
  }
});

// 匹配度与背调的 DOM、状态、弹窗都在 insight.js 里闭环。
// 这里只把三件事交出去：怎么调模型、当前岗位信息从哪取、错误提示往哪写。
const insight = initInsight({
  callModel,
  getJobMeta: () => jdMeta,
  notify: (message, kind) => setStatus(dom.status, message, kind)
});

(async function init() {
  await loadSettings();
  await autoDetectAndReadJd();
})();