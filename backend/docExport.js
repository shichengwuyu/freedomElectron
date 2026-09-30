// 服务端导出：剧本/分镜 → TXT / DOCX / 多文件 ZIP
// 零运行时依赖：.docx 本质是 OOXML 的 zip 包，直接用内置 zip.js 的 buildZip 拼装；
// 多文件打包也复用 buildZip（内存生成，返回 Buffer）。
import { Buffer } from 'buffer';
import { buildZip } from './zip.js';
import { sanitizeFilename } from './storage.js';

const TXT_MIME = 'text/plain; charset=utf-8';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ZIP_MIME = 'application/zip';

// XML 转义
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// 把一段文本（含换行）转成 docx 的段落 XML。空行也保留为一个空段落。
function textToParagraphs(text, { heading = false } = {}) {
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  return lines
    .map((line) => {
      const runProps = heading ? '<w:rPr><w:b/><w:sz w:val="32"/></w:rPr>' : '<w:rPr><w:sz w:val="22"/></w:rPr>';
      const pPr = heading
        ? '<w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="120"/></w:pPr>'
        : '';
      if (!line) return `<w:p>${pPr}</w:p>`;
      return `<w:p>${pPr}<w:r>${runProps}<w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`;
    })
    .join('');
}

// 由若干 {title, content} 段落组装一个完整 docx 的 document.xml body
function buildDocumentXml(sections, { withPageBreaks = false } = {}) {
  const blocks = sections.map((sec, idx) => {
    const head = sec.title ? textToParagraphs(sec.title, { heading: true }) : '';
    const bodyXml = textToParagraphs(sec.content || '');
    const pageBreak =
      withPageBreaks && idx < sections.length - 1
        ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
        : '';
    return head + bodyXml + pageBreak;
  });
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body>' +
    blocks.join('') +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
    '</w:body></w:document>'
  );
}

// 拼装一个最小合法的 .docx（OOXML zip），返回 Buffer
function makeDocx(sections, { withPageBreaks = false } = {}) {
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';
  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';
  const documentXml = buildDocumentXml(sections, { withPageBreaks });

  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf-8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf-8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf-8') },
  ];
  return buildZip(entries);
}

function txtBuffer(text) {
  // 加 BOM，确保 Windows 记事本识别 UTF-8
  return Buffer.from('﻿' + String(text == null ? '' : text), 'utf-8');
}

function mergedText(items) {
  return items
    .map((it) => `${it.title}\n${'='.repeat(30)}\n\n${it.content || ''}`)
    .join('\n\n\n' + '='.repeat(30) + '\n\n\n');
}

// 通用导出：根据 format / merged 产出单文件或 ZIP
function buildExport(projectName, items, kindLabel, { format = 'txt', merged = false } = {}) {
  const base = sanitizeFilename(projectName, '项目');
  const ext = format === 'docx' ? 'docx' : 'txt';

  // 合并为单文件
  if (merged || items.length === 1) {
    if (format === 'docx') {
      return {
        buffer: makeDocx(items, { withPageBreaks: true }),
        filename: `${base}_${kindLabel}.docx`,
        mime: DOCX_MIME,
      };
    }
    return {
      buffer: txtBuffer(mergedText(items)),
      filename: `${base}_${kindLabel}.txt`,
      mime: TXT_MIME,
    };
  }

  // 多文件打包为 ZIP
  const used = new Set();
  const zipEntries = items.map((it, i) => {
    let fname = sanitizeFilename(it.title, `第${i + 1}集`);
    let candidate = `${fname}.${ext}`;
    if (used.has(candidate.toLowerCase())) candidate = `${fname}_${i + 1}.${ext}`;
    used.add(candidate.toLowerCase());
    const data =
      format === 'docx'
        ? makeDocx([it], { withPageBreaks: false })
        : txtBuffer(`${it.title}\n${'='.repeat(30)}\n\n${it.content || ''}`);
    return { name: candidate, data };
  });
  return {
    buffer: buildZip(zipEntries),
    filename: `${base}_${kindLabel}.zip`,
    mime: ZIP_MIME,
  };
}

export async function buildScriptExport(projectName, items, opts = {}) {
  return buildExport(projectName, items, '剧本', opts);
}

export async function buildStoryboardExport(projectName, items, opts = {}) {
  return buildExport(projectName, items, '分镜', opts);
}
