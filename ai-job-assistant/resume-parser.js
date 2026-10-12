// 简历文件解析：.txt/.md 直接读文本；.pdf 用 pdf.js 提取；.docx 用 JSZip 读 word/document.xml。
// 旧版 .doc（二进制格式）不支持，明确报错，不做猜测式解析——猜错了会产生看不出来的乱码简历。

import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdfjs/pdf.worker.min.mjs");

async function extractPdfText(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    cMapUrl: chrome.runtime.getURL("vendor/pdfjs/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: chrome.runtime.getURL("vendor/pdfjs/standard_fonts/")
  }).promise;

  const pageTexts = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map((item) => item.str).join(" "));
  }
  return pageTexts
    .join("\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function walkDocxNode(node, out) {
  for (const child of node.childNodes) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    if (child.localName === "t") {
      out.text += child.textContent;
    } else if (child.localName === "tab") {
      out.text += "\t";
    } else if (child.localName === "br" || child.localName === "cr") {
      out.text += "\n";
    } else {
      walkDocxNode(child, out);
    }
  }
}

async function extractDocxText(arrayBuffer) {
  if (typeof JSZip === "undefined") {
    throw new Error("JSZip 未加载，无法解析 .docx。");
  }
  const zip = await JSZip.loadAsync(arrayBuffer);
  const xmlFile = zip.file("word/document.xml");
  if (!xmlFile) {
    throw new Error("这不是一个有效的 .docx 文件（缺少 word/document.xml）。");
  }
  const xml = await xmlFile.async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const paragraphs = doc.getElementsByTagNameNS(ns, "p");

  const lines = [];
  for (const paragraph of paragraphs) {
    const out = {text: ""};
    walkDocxNode(paragraph, out);
    lines.push(out.text);
  }
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractResumeText(file) {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".txt") || lowerName.endsWith(".md")) {
    return (await file.text()).trim();
  }

  if (lowerName.endsWith(".pdf")) {
    const text = await extractPdfText(await file.arrayBuffer());
    if (!text) {
      throw new Error("没能从这个 PDF 里提取到文字，可能是扫描版图片 PDF。请转成 .txt 后重新上传。");
    }
    return text;
  }

  if (lowerName.endsWith(".docx")) {
    const text = await extractDocxText(await file.arrayBuffer());
    if (!text) {
      throw new Error("没能从这个 .docx 里提取到文字。");
    }
    return text;
  }

  if (lowerName.endsWith(".doc")) {
    throw new Error("不支持旧版 .doc 格式，请用 Word / WPS 另存为 .docx 后重新上传。");
  }

  throw new Error("只支持 .txt / .md / .pdf / .docx 文件。");
}
