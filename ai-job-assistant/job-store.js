// 岗位浏览与投递记录。全部存在 chrome.storage.local，不上传任何地方。
// 一个岗位一个 key（job:<canonicalUrl>），避免每次写入都重写整张表。

const KEY_PREFIX = "job:";

// 漏斗顺序就是 BOSS 上的真实顺序：打完招呼、HR 要了才发简历
export const STATUSES = ["viewed", "greeted", "replied", "applied"];
export const STATUS_LABELS = {
  viewed: "查看过",
  greeted: "已打招呼",
  replied: "HR 已回复",
  applied: "已投简历"
};

const keyOf = (url) => KEY_PREFIX + url;

export async function getJob(url) {
  if (!url) return null;
  const stored = await chrome.storage.local.get(keyOf(url));
  return stored[keyOf(url)] || null;
}

async function save(record) {
  await chrome.storage.local.set({[keyOf(record.url)]: record});
  return record;
}

// 读取成功就落一条记录：漏斗的第一格「查看过」有数，之后才算得出转化
export async function recordJobView(data) {
  const url = String(data.pageUrl || "").split(/[?#]/)[0];
  if (!url) return null;
  const now = new Date().toISOString();
  const existing = await getJob(url);
  return save({
    url,
    title: data.title || existing?.title || "",
    salary: data.salary || existing?.salary || "",
    company: data.company || existing?.company || "",
    jdText: data.jdText || existing?.jdText || "",
    firstSeenAt: existing?.firstSeenAt || now,
    lastSeenAt: now,
    greetings: existing?.greetings || [],
    status: existing?.status || "viewed",
    statusAt: existing?.statusAt || {viewed: now}
  });
}

export async function recordGreeting(url, text) {
  const record = await getJob(url);
  if (!record) return null;
  const now = new Date().toISOString();
  record.greetings = [{text, at: now}, ...(record.greetings || [])].slice(0, 10);
  // 只往前推，不覆盖用户手动标过的更靠后的状态
  if (STATUSES.indexOf(record.status) < STATUSES.indexOf("greeted")) {
    record.status = "greeted";
    record.statusAt = {...record.statusAt, greeted: now};
  }
  return save(record);
}

export async function setJobStatus(url, status) {
  const record = await getJob(url);
  if (!record || !STATUSES.includes(status)) return null;
  record.status = status;
  record.statusAt = {...record.statusAt, [status]: new Date().toISOString()};
  return save(record);
}

export function formatSeenAt(iso) {
  if (!iso) return "";
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
  return `${then.getMonth() + 1} 月 ${then.getDate()} 日`;
}

export async function listJobs() {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(KEY_PREFIX))
    .map(([, value]) => value)
    .sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
}

export async function deleteJob(url) {
  await chrome.storage.local.remove(keyOf(url));
}

// "20-30K·13薪" → {min: 20, max: 30, months: 13}；面议、按天计薪等解析不出就返回 null
export function parseSalary(raw) {
  const text = String(raw || "");
  const range = text.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*[KkＫ千]/);
  if (!range) return null;
  const months = text.match(/(\d+)\s*薪/);
  return {
    min: Number(range[1]),
    max: Number(range[2]),
    months: months ? Number(months[1]) : 12
  };
}
