// 职责一：让点击工具栏图标 / 快捷键打开侧边栏，而不是弹出会自动关闭的 popup。
// 侧边栏打开后由用户自己点关闭按钮收起，不会因为点击页面其他地方就消失。
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true}).catch((error) => {
    console.error("设置侧边栏行为失败", error);
  });
});

// 职责二：发现当前标签页换到了另一个职位详情页时，通知侧边栏弹窗询问。
// 这里只看 URL —— 不注入脚本、不读页面内容、不发任何网络请求。
// 真正的读取依然只发生在用户点「读取 JD」之后，红线是「什么时候读」，不是「知不知道换页了」。
function isBossDetailUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return (url.hostname === "zhipin.com" || url.hostname.endsWith(".zhipin.com")) && url.pathname.startsWith("/job_detail/");
  } catch {
    return false;
  }
}

function notifyJobPage(url) {
  if (!isBossDetailUrl(url)) return;
  // 侧边栏没打开时没有接收方，忽略即可
  chrome.runtime.sendMessage({type: "job-page-changed", url}).catch(() => {});
}

// SPA 内部跳转也会带 changeInfo.url，整页加载同样覆盖
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!changeInfo.url || !tab?.active) return;
  notifyJobPage(changeInfo.url);
});

// 切到另一个已经开着的职位标签页
chrome.tabs.onActivated.addListener(async ({tabId}) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab?.url) notifyJobPage(tab.url);
});
