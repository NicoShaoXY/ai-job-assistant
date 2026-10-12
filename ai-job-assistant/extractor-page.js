(() => {
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const canonicalUrl = (() => {
    try {
      const url = new URL(location.href);
      return `${url.origin}${url.pathname}`;
    } catch {
      return location.href.split(/[?#]/)[0];
    }
  })();

  const pickText = (selectors) => {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const value = clean(node?.innerText || node?.textContent);
      if (value) return value;
    }
    return "";
  };

  const salary = pickText([".job-banner .salary", ".job-primary .salary", ".name .salary", "span.salary", "[class*='job-banner'] [class*='salary']"]);
  let title = pickText([".job-banner .name", ".job-primary .name", "h1.name", "h1"])
    .replace(/招聘中|最新/g, "")
    .trim();
  // 岗位名节点常把薪资一起吐出来，去重后单独给模型，避免同一段信息出现两次
  if (salary && title.includes(salary)) {
    title = clean(title.replace(salary, ""));
  }

  // 公司名。这一项比岗位名重要得多——背调要靠它去查权威数据源，
  // 所以给了五条兜底路径。BOSS 的公司名节点 class 换过好几轮，
  // 只靠选择器迟早会失手（失手的表现就是公司名为空，背调直接没法做）。
  const pickCompany = () => {
    const selectors = [
      ".sider-company .company-info .name",
      ".company-info .name",
      ".job-banner .company-name",
      ".company-card .name",
      ".job-detail-company .name",
      "[class*='company-info'] .name"
    ];
    for (const selector of selectors) {
      const value = pickText([selector]);
      if (value) return value;
    }

    // 路径兜底：BOSS 的公司主页固定是 /gongsi/xxx.html，比 class 名稳定得多
    const link = document.querySelector('a[href*="/gongsi/"]');
    const linkText = clean(link?.innerText || link?.textContent);
    if (linkText) return linkText;

    // 结构化数据兜底：部分页面带 JobPosting 的 JSON-LD
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(node.textContent || "");
        for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
          const name = clean(item?.hiringOrganization?.name);
          if (name) return name;
        }
      } catch {
        // 单个 JSON-LD 解析失败不影响其他兜底路径
      }
    }

    // 标题兜底。BOSS 的标题形如「岗位名_公司名_城市-BOSS直聘」，公司名一般在第二段
    const titleText = clean(document.title).replace(/\s*[-_｜|]\s*BOSS直聘.*$/i, "");
    const segments = titleText.split(/[_｜|]/).map(clean).filter(Boolean);
    if (segments.length >= 2 && segments[1].length >= 2) return segments[1];

    // 最后兜底：og:title
    return clean(document.querySelector('meta[property="og:title"]')?.content);
  };

  const company = pickCompany();

  const headingSelector = "h1,h2,h3,h4,h5,h6,dt,[role='heading']";
  const headings = [...document.querySelectorAll(headingSelector)];
  const startHeading = headings.find((node) => clean(node.innerText || node.textContent) === "职位描述");

  if (!startHeading) {
    return {
      ok: false,
      error: "没有找到语义标题“职位描述”；严格模式不会猜测正文区域。",
      pageUrl: canonicalUrl
    };
  }

  const allowedInnerHeadings = new Set(["岗位职责", "工作职责", "任职要求", "职位要求", "岗位要求", "工作内容", "加分项", "我们希望", "关于我们"]);
  const isHeading = (node) => {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    return /^H[1-6]$/.test(node.tagName || "") || node.tagName === "DT" || node.getAttribute?.("role") === "heading";
  };
  const isInteractiveText = (node) => {
    const parent = node.parentElement;
    if (!parent) return false;
    return Boolean(parent.closest?.("a,button,[role='button'],nav,svg,[class*='share'],[class*='report']"));
  };
  const isHiddenText = (node) => {
    const parent = node.parentElement;
    if (!parent) return false;
    return parent.hidden || parent.getAttribute?.("aria-hidden") === "true";
  };

  const parts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  walker.currentNode = startHeading;
  let node;
  while ((node = walker.nextNode())) {
    if (startHeading.contains?.(node)) continue;
    if (isHeading(node)) {
      const headingText = clean(node.innerText || node.textContent);
      if (allowedInnerHeadings.has(headingText)) {
        parts.push(headingText);
        continue;
      }
      break;
    }
    if (node.nodeType !== Node.TEXT_NODE || isInteractiveText(node) || isHiddenText(node)) continue;
    const value = clean(node.nodeValue);
    if (value) parts.push(value);
  }

  let jdText = clean(parts.join(" "));
  const firstNumber = jdText.search(/(?:^|\s)1[.、．]/);
  if (firstNumber >= 0 && firstNumber < 100) {
    const prefix = jdText.slice(0, firstNumber);
    if (!allowedInnerHeadings.has(prefix) && !/(岗位职责|工作职责|任职要求|职位要求|工作内容)/.test(prefix)) {
      jdText = clean(jdText.slice(firstNumber));
    }
  }

  if (jdText.length < 80 || /登录查看完整内容/.test(jdText)) {
    return {
      ok: false,
      error: "找到“职位描述”标题，但标题边界内没有不少于80字的完整正文。严格模式不会读取其他区域。",
      pageUrl: canonicalUrl
    };
  }

  return {
    ok: true,
    title,
    salary,
    company,
    jdText,
    charCount: jdText.length,
    strategy: "strict-heading-range",
    pageUrl: canonicalUrl,
    extractedAt: new Date().toISOString()
  };
})();
