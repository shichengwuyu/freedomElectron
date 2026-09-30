function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function inline(text) {
  let value = escapeHtml(text);
  value = value.replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>');
  value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  value = value.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  value = value.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  value = value.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  value = value.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  value = value.replace(/\$([^$\n]+)\$/g, '<span class="chat-math-inline">$1</span>');
  return value;
}

function tableBlock(lines) {
  if (lines.length < 2 || !/^\s*\|?\s*:?-+/.test(lines[1])) return '';
  const rows = lines.map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
  const head = rows[0];
  const body = rows.slice(2);
  return `<div class="chat-table-wrap"><table><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function renderChatMarkdown(source = '') {
  const codeBlocks = [];
  let text = String(source || '').replace(/```([^\n]*)\n([\s\S]*?)```/g, (_, language, code) => {
    const index = codeBlocks.length;
    codeBlocks.push(`<div class="chat-code-block"><header><span>${escapeHtml(language.trim() || 'code')}</span><button type="button" class="chat-code-copy">复制代码</button></header><pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre></div>`);
    return `\n@@CHAT_CODE_${index}@@\n`;
  });
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const output = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const codeMatch = line.match(/^@@CHAT_CODE_(\d+)@@$/);
    if (codeMatch) { output.push(codeBlocks[Number(codeMatch[1])] || ''); i++; continue; }
    if (!line.trim()) { i++; continue; }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-+/.test(lines[i + 1])) {
      const block = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) block.push(lines[i++]);
      output.push(tableBlock(block)); continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { const level = heading[1].length; output.push(`<h${level}>${inline(heading[2])}</h${level}>`); i++; continue; }
    if (/^>\s?/.test(line)) {
      const block = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) block.push(lines[i++].replace(/^>\s?/, ''));
      output.push(`<blockquote>${block.map(inline).join('<br>')}</blockquote>`); continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) items.push(lines[i++].replace(/^[-*+]\s+/, ''));
      output.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`); continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) items.push(lines[i++].replace(/^\d+\.\s+/, ''));
      output.push(`<ol>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</ol>`); continue;
    }
    if (/^---+$/.test(line.trim())) { output.push('<hr>'); i++; continue; }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s+|^>\s?|^[-*+]\s+|^\d+\.\s+|^@@CHAT_CODE_/.test(lines[i])) paragraph.push(lines[i++]);
    output.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
  }
  return output.join('');
}
