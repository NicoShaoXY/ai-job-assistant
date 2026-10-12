#!/usr/bin/env python3
"""生成 预览_v0.13.0.html —— 静态 UI 预览，用来在浏览器里直接看界面，不用加载扩展。

做法：把 sidepanel.html 的 body 原样取出（保证预览和真实界面不会走样），
内联 sidepanel.css + insight.css，再把 matcher.js / backcheck.js / legal.js / prompts.js
去掉 export 后拼进去当运行时，最后用一段 mock 脚本灌演示数据。

注意：新加的模块一定要补进 ENGINE 列表，否则 mock 脚本里引用到它的导出会直接抛错、
整个脚本中断，表现为「界面只渲染一半、弹窗点不开」。
"""

import re
import pathlib

BASE = pathlib.Path(__file__).parent.parent / "ai-job-assistant"
ENGINE = ["matcher.js", "backcheck.js", "search.js", "legal.js", "prompts.js"]
# 记录页需要另一套引擎：job-store 提供存储层，records.js 提供渲染
RECORDS_ENGINE = ["matcher.js", "job-store.js", "records.js"]


def strip_exports(path: pathlib.Path) -> str:
    """把 ES 模块改造成可直接内联的普通脚本。
    注意 import 也要去掉——只去 export 的话，内联脚本里会留下 import 语句，
    在 classic script 里是语法错误，整个预览会静默不渲染。"""
    text = path.read_text(encoding="utf-8")
    text = re.sub(r'^import\s+[^;]*?from\s+["\'][^"\']+["\'];?\s*$', "", text, flags=re.M)
    return re.sub(r"^export\s+", "", text, flags=re.M)


def main() -> None:
    src = (BASE / "sidepanel.html").read_text(encoding="utf-8")
    body = re.search(r"<body[^>]*>(.*)</body>", src, re.S).group(1)
    body = body.replace('<script src="vendor/jszip/jszip.min.js"></script>', "")
    body = body.replace('<script type="module" src="sidepanel.js"></script>', "")

    css = (BASE / "sidepanel.css").read_text(encoding="utf-8")
    engine = "\n\n".join(strip_exports(BASE / name) for name in ENGINE)
    mock = (pathlib.Path(__file__).parent / "_预览脚本.js").read_text(encoding="utf-8")

    banner = (
        '<div style="position:static;background:#1c1917;color:#fafaf7;'
        "font:12px/1.7 -apple-system,'PingFang SC',sans-serif;padding:9px 14px\">"
        "静态 UI 预览 · v0.13.0 · 界面元素与真实插件一致，数据为演示样例（不调用模型）。"
        "可点「立即背调该公司」看新的检索式背调弹窗，点右上角齿轮看设置，底部可看免责声明。"
        "</div>"
    )

    out = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<base href="./ai-job-assistant/" />
<title>AI 求职助手 v0.12.0 · UI 预览</title>
<style>
{css}
.preview-wrap {{ max-width: 560px; margin: 0 auto; }}
</style>
</head>
<body>
{banner}
<div class="preview-wrap">
{body}
</div>
<script>
{engine}

{mock}
</script>
</body>
</html>
"""

    here = pathlib.Path(__file__).parent
    target = here.parent / "预览_v0.13.0.html"
    target.write_text(out, encoding="utf-8")
    print(f"已生成 {target.name}（{len(out)} 字符）")

    build_records()


def build_records() -> None:
    """记录页预览。顺序很重要：mock 的 chrome 必须在引擎之前，
    因为 records.js 末尾会立刻调用 load()，那时它就要能读到 chrome.storage。"""
    here = pathlib.Path(__file__).parent
    src = (BASE / "records.html").read_text(encoding="utf-8")
    body = re.search(r"<body[^>]*>(.*)</body>", src, re.S).group(1)
    body = body.replace('<script type="module" src="records.js"></script>', "")

    css = "\n".join(
        (BASE / name).read_text(encoding="utf-8")
        for name in ("sidepanel.css", "records.css")
    )
    engine = "\n\n".join([
        strip_exports(BASE / "matcher.js"),
        "const KEYWORDS = SKILL_DICT;",
        strip_exports(BASE / "job-store.js"),
        strip_exports(BASE / "records.js"),
    ])
    mock = (here / "_预览脚本_记录页.js").read_text(encoding="utf-8")

    banner = (
        '<div style="position:static;background:#1c1917;color:#fafaf7;'
        "font:12px/1.7 -apple-system,'PingFang SC',sans-serif;padding:9px 14px\">"
        "岗位记录页 · 静态预览 · v0.13.0 · 数据为演示样例（不读取真实记录）。"
        "点任意一行可展开 JD 全文与打招呼语。"
        "</div>"
    )

    out = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<base href="./ai-job-assistant/" />
<title>岗位记录 · v0.13.0 预览</title>
<style>
{css}
</style>
</head>
<body class="records-body">
{banner}
{body}
<script>
{mock}

{engine}
</script>
</body>
</html>
"""

    target = here.parent / "预览_记录页_v0.13.0.html"
    target.write_text(out, encoding="utf-8")
    print(f"已生成 {target.name}（{len(out)} 字符）")


if __name__ == "__main__":
    main()
