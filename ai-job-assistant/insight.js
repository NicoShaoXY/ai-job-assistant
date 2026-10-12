// 匹配度展示 + 背调流程。
//
// 为什么单独成模块：这两块的状态和 DOM 都闭环在自己手里，
// sidepanel.js 只需要在「读到 JD 之后」调一次 refresh()，其余（输入监听、
// 弹窗、模型调用、剪贴板）都在这里处理完，避免 sidepanel.js 继续膨胀。
//
// 背调的合规约束写在这里，改代码时别绕过去：
// 检索走的是搜索服务的开放接口（search.js），返回公开网页的标题与摘要，不是爬虫；
// 模型只负责归纳检索结果，不许凭空生成关于某公司的事实；
// 报告里每条结论都必须标出来源编号，用户能点回原文核对。

import {scoreMatch, formatMatchForModel} from "./matcher.js";
import {buildSourceLinks, buildChecklistText} from "./backcheck.js";
import {runBackcheckSearch, formatSearchResults, summarizeCoverage} from "./search.js";
import {MATCH_SYSTEM_PROMPT, BACKCHECK_SYSTEM_PROMPT} from "./prompts.js";
import {DISCLAIMER_FULL} from "./legal.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// 复制按钮统一走这里：成功和失败都给反馈，失败时降级为选中文本。
async function copyText(text, button, idleLabel) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "已复制";
    setTimeout(() => {
      button.textContent = idleLabel;
    }, 1500);
  } catch {
    button.textContent = "请手动复制";
    setTimeout(() => {
      button.textContent = idleLabel;
    }, 1800);
  }
}

export function initInsight({callModel, getJobMeta, notify}) {
  const dom = {
    section: document.querySelector("#jobInsight"),
    score: document.querySelector("#matchScore"),
    gauge: document.querySelector("#matchGauge"),
    dims: document.querySelector("#matchDims"),
    note: document.querySelector("#matchNote"),
    gaps: document.querySelector("#matchGaps"),
    gapCount: document.querySelector("#gapCount"),
    gapList: document.querySelector("#gapList"),
    explainBtn: document.querySelector("#explainMatch"),
    openBackcheck: document.querySelector("#openBackcheck"),
    explainResult: document.querySelector("#matchExplainResult"),
    explainText: document.querySelector("#matchExplainText"),
    jdInput: document.querySelector("#jdInput"),
    modal: document.querySelector("#backcheckModal"),
    close: document.querySelector("#backcheckClose"),
    company: document.querySelector("#backcheckCompany"),
    sourceList: document.querySelector("#sourceList"),
    copyChecklist: document.querySelector("#copyChecklist"),
    materials: document.querySelector("#backcheckMaterials"),
    status: document.querySelector("#backcheckStatus"),
    run: document.querySelector("#runBackcheck"),
    result: document.querySelector("#backcheckResult"),
    text: document.querySelector("#backcheckText"),
    copy: document.querySelector("#copyBackcheck"),
    progress: document.querySelector("#searchProgress"),
    manualBlock: document.querySelector("#manualBlock"),
    toggleSources: document.querySelector("#toggleSources"),
    sourceRefs: document.querySelector("#sourceRefs"),
    openDisclaimer: document.querySelector("#openDisclaimer"),
    disclaimerModal: document.querySelector("#disclaimerModal"),
    disclaimerClose: document.querySelector("#disclaimerClose"),
    disclaimerOk: document.querySelector("#disclaimerOk"),
    disclaimerText: document.querySelector("#disclaimerText")
  };

  let lastMatch = null;
  let resumeCache = "";
  let expectedCache = "";

  async function loadProfile() {
    const stored = await chrome.storage.local.get(["resume", "expectedSalary"]);
    resumeCache = stored.resume || "";
    expectedCache = stored.expectedSalary || "";
  }

  // 只有输入框里仍是这次读到的那份 JD 时，岗位名/薪资/公司才算数。
  // 用户手动粘贴了别的岗位就不能再沿用上一次的岗位信息。
  function validMeta() {
    const meta = getJobMeta();
    if (!meta || !meta.sourceHead) return null;
    if (!dom.jdInput.value.includes(meta.sourceHead)) return null;
    return meta;
  }

  function renderMatch(match, meta) {
    if (!match.usable) {
      dom.score.textContent = "—";
      dom.gauge.className = "match-gauge";
      dom.gauge.style.setProperty("--pct", "0");
      dom.dims.replaceChildren();
      dom.note.textContent = match.note;
      dom.gaps.hidden = true;
      dom.explainBtn.disabled = true;
      return;
    }
    dom.explainBtn.disabled = false;

    // 环形仪表靠 --pct 驱动 conic-gradient，档位类只换颜色
    dom.score.textContent = String(match.total);
    dom.gauge.style.setProperty("--pct", String(Math.max(0, Math.min(match.total, 100))));
    const level = match.total >= 70 ? "" : match.total >= 45 ? "low" : "poor";
    dom.gauge.className = `match-gauge ${level}`.trim();

    dom.dims.replaceChildren(...match.dims.map((dim) => {
      const row = el("div", "match-dim");
      row.append(el("span", "name", dim.label));
      const bar = el("div", "bar");
      const fill = el("span");
      fill.style.width = `${Math.max(0, Math.min(dim.percent, 100))}%`;
      if (dim.percent < 50) fill.style.background = "var(--warn)";
      bar.append(fill);
      row.append(bar);
      row.append(el("span", "val", `${dim.score}/${dim.weight}`));
      return row;
    }));

    const notes = [];
    if (match.age) {
      notes.push(`JD 年龄表述：${match.age.text}${match.age.limited ? "（构成明确限制）" : "（未设限）"}`);
    }
    if (meta?.title) notes.push(`岗位：${meta.title}`);
    if (match.note) notes.push(match.note);
    dom.note.textContent = notes.join("　");

    dom.gaps.hidden = match.gaps.length === 0;
    dom.gapCount.textContent = String(match.gaps.length);
    dom.gapList.replaceChildren(...match.gaps.map((gap) => {
      const item = el("div", "gap-item");
      item.append(el("b", "", `[${gap.type}] ${gap.text}`));
      item.append(el("span", "gap-hint", gap.hint));
      return item;
    }));
  }

  async function refresh() {
    const jd = dom.jdInput.value.trim();
    if (!jd) {
      dom.section.hidden = true;
      lastMatch = null;
      return;
    }
    await loadProfile();
    const meta = validMeta();
    const match = scoreMatch({
      jdText: jd,
      resumeText: resumeCache,
      salary: meta?.salary || "",
      expectedSalary: expectedCache
    });
    lastMatch = match;
    dom.section.hidden = false;
    renderMatch(match, meta);
  }

  // ---- 匹配度 AI 解读：模型只解释规则层算出的分，不许改分 ----

  dom.explainBtn.addEventListener("click", async () => {
    if (!lastMatch?.usable) return;
    const meta = validMeta();
    dom.explainBtn.disabled = true;
    const idle = dom.explainBtn.textContent;
    dom.explainBtn.textContent = "解读中…";
    try {
      const userPrompt = [
        formatMatchForModel(lastMatch, {title: meta?.title, company: meta?.company}),
        "",
        "岗位 JD 原文：",
        dom.jdInput.value.trim(),
        "",
        "我的简历：",
        resumeCache
      ].join("\n");
      const result = await callModel(MATCH_SYSTEM_PROMPT, userPrompt, {temperature: 0.4});
      dom.explainText.textContent = result;
      dom.explainResult.hidden = false;
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      dom.explainBtn.disabled = false;
      dom.explainBtn.textContent = idle;
    }
  });

  // ---- 背调 ----

  function renderSources(company) {
    dom.sourceList.replaceChildren(...buildSourceLinks(company).map((source) => {
      const item = el("div", "source-item");
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = source.name;
      item.append(link);
      item.append(el("p", "source-what", source.what));
      item.append(el("p", "source-tip", source.tip));
      return item;
    }));
  }

  function renderRefs(refs) {
    dom.sourceRefs.replaceChildren(...refs.map((ref) => {
      const row = el("div", "ref-row");
      row.append(el("span", "ref-index", `[${ref.index}]`));
      const body = el("div", "ref-body");
      const link = document.createElement("a");
      link.href = ref.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = ref.title || ref.url;
      body.append(link);
      body.append(el("p", "ref-meta", [ref.dimension, ref.site || ref.url, ref.date].filter(Boolean).join(" · ")));
      row.append(body);
      return row;
    }));
  }

  function setProgress(text) {
    if (!text) {
      dom.progress.hidden = true;
      dom.progress.textContent = "";
      return;
    }
    dom.progress.hidden = false;
    dom.progress.textContent = text;
  }

  async function openBackcheckModal() {
    const meta = validMeta();
    // 公司名优先用用户上次确认过的（他可能改成了工商全称），其次用页面读到的
    const stored = await chrome.storage.local.get(["backcheckCompany", "searchKey"]);
    dom.company.value = stored.backcheckCompany || meta?.company || "";
    renderSources(dom.company.value.trim());
    setProgress("");
    dom.result.hidden = true;
    dom.sourceRefs.hidden = true;
    if (stored.searchKey) {
      dom.status.textContent = "";
      dom.status.className = "status";
      dom.manualBlock.open = false;
    } else {
      dom.status.textContent = "还没配搜索 API Key，背调跑不了。下面「手动查」里有 8 个官方入口和判断标准。";
      dom.status.className = "status warn";
      dom.manualBlock.open = true;
    }
    dom.modal.hidden = false;
    dom.company.focus();
    dom.company.select();
  }

  dom.openBackcheck.addEventListener("click", () => {
    openBackcheckModal().catch(() => {});
  });
  dom.close.addEventListener("click", () => {
    dom.modal.hidden = true;
  });
  dom.modal.addEventListener("click", (event) => {
    if (event.target.dataset.close) dom.modal.hidden = true;
  });
  dom.company.addEventListener("change", () => {
    const name = dom.company.value.trim();
    renderSources(name);
    // 记下来，下次打开这个弹窗直接用，不用重填
    chrome.storage.local.set({backcheckCompany: name}).catch(() => {});
  });

  dom.copyChecklist.addEventListener("click", () => {
    copyText(buildChecklistText(dom.company.value.trim()), dom.copyChecklist, "复制作业单");
  });

  dom.toggleSources.addEventListener("click", () => {
    dom.sourceRefs.hidden = !dom.sourceRefs.hidden;
    dom.toggleSources.textContent = dom.sourceRefs.hidden ? "来源清单" : "收起来源";
  });

  dom.run.addEventListener("click", async () => {
    const company = dom.company.value.trim();
    const materials = dom.materials.value.trim();
    if (!company) {
      notify("先填公司全称，检索要用它。", "error");
      return;
    }
    const stored = await chrome.storage.local.get(["searchKey"]);
    if (!stored.searchKey) {
      notify("还没填搜索 API Key，去右上角设置里补上；或者用下面的「手动查」。", "error");
      dom.manualBlock.open = true;
      return;
    }

    const meta = validMeta();
    dom.run.disabled = true;
    const idle = dom.run.textContent;
    dom.run.textContent = "背调中…";
    dom.status.textContent = "";
    dom.status.className = "status";
    dom.result.hidden = true;
    dom.sourceRefs.hidden = true;
    dom.toggleSources.textContent = "来源清单";

    try {
      // 第一步：插件自己按六个维度检索。这一步不依赖模型，也不需要用户动手。
      const search = await runBackcheckSearch(company, stored.searchKey, (done, total, label) => {
        setProgress(`正在检索 ${done}/${total}：${label}`);
      });
      setProgress("");

      // 第二步：把带编号的检索结果交给模型归纳。模型只做整理，不负责查。
      const {text, refs} = formatSearchResults(search);
      const jd = dom.jdInput.value.trim();
      const userPrompt = [
        `待评估公司：${company}`,
        meta?.title ? `应聘岗位：${meta.title}` : "",
        lastMatch?.age
          ? `JD 里的年龄相关原文：${lastMatch.age.text}${lastMatch.age.limited ? "（构成明确限制）" : "（未设限）"}`
          : "",
        jd ? `岗位 JD 原文：\n${jd.slice(0, 4000)}` : "",
        "",
        `检索覆盖情况：${summarizeCoverage(search)}`,
        "",
        "以下是本次检索到的全部结果（编号供引用）：",
        text,
        materials
          ? `\n使用者补充的材料（未见于检索结果，视为使用者自述，引用时需单独标注）：\n${materials}`
          : ""
      ]
        .filter(Boolean)
        .join("\n");

      const result = await callModel(BACKCHECK_SYSTEM_PROMPT, userPrompt, {temperature: 0.3});
      dom.text.textContent = result;
      dom.result.hidden = false;

      if (refs.length) {
        renderRefs(refs);
        dom.toggleSources.hidden = false;
      } else {
        dom.toggleSources.hidden = true;
      }
      dom.status.textContent = summarizeCoverage(search);
      dom.status.className = search.total ? "status" : "status warn";
    } catch (error) {
      setProgress("");
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      dom.run.disabled = false;
      dom.run.textContent = idle;
    }
  });

  dom.copy.addEventListener("click", () => {
    copyText(dom.text.textContent, dom.copy, "一键复制");
  });

  // ---- 免责声明 ----

  dom.disclaimerText.textContent = DISCLAIMER_FULL;
  dom.openDisclaimer.addEventListener("click", () => {
    dom.disclaimerModal.hidden = false;
  });
  [dom.disclaimerClose, dom.disclaimerOk].forEach((button) => {
    button.addEventListener("click", () => {
      dom.disclaimerModal.hidden = true;
    });
  });
  dom.disclaimerModal.addEventListener("click", (event) => {
    if (event.target.dataset.close) dom.disclaimerModal.hidden = true;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!dom.disclaimerModal.hidden) {
      dom.disclaimerModal.hidden = true;
      return;
    }
    if (!dom.modal.hidden) dom.modal.hidden = true;
  });

  // ---- 触发时机 ----
  // JD 手动改动后重算。scoreMatch 是纯本地计算，开销可忽略，防抖只为少刷 DOM。
  let debounce = null;
  dom.jdInput.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      refresh().catch(() => {});
    }, 500);
  });

  // 简历或期望薪资在「我的资料」里改完，匹配度要跟着更新，否则用户会以为没生效。
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.resume || changes.expectedSalary) {
      refresh().catch(() => {});
    }
  });

  return {refresh};
}
