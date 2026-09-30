const CONTINUATION_ONLY_RE = /^(?:继续|接着|往下|下一个|下一段|继续写|继续生成|请继续|接着来|go on|continue)[。！!，,\s]*$/i;
const EXPLICIT_SHORT_OUTPUT_RE = /(?:一句话|一段话|简要|简述|摘要|概括|总结|只(?:给|要)(?:结论|答案)|不超过\s*\d+\s*(?:字|词)|限制(?:在|为)?\s*\d+\s*(?:字|词))/i;
const STRUCTURED_DELIVERY_RE = /(?:改成|改编|转换|翻译|提取|拆分|逐项|逐条|全部|全文|整章|章节|剧本|分镜|镜头|清单|表格|每个|所有)/i;

function messageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content || '');
  return content.map((part) => part?.type === 'text' ? String(part.text || '') : '').join('\n');
}

function clipped(value, maxChars) {
  const text = String(value || '');
  if (text.length <= maxChars) return text;
  const headLength = Math.floor(maxChars * 0.62);
  const tailLength = maxChars - headLength;
  return `${text.slice(0, headLength)}\n\n【中间内容因核验上下文长度已省略】\n\n${text.slice(-tailLength)}`;
}

export function findCompletionRequest(messages = []) {
  const users = (Array.isArray(messages) ? messages : [])
    .filter((item) => item?.role === 'user')
    .map((item) => messageText(item.content).trim())
    .filter(Boolean);
  for (let index = users.length - 1; index >= 0; index -= 1) {
    if (!CONTINUATION_ONLY_RE.test(users[index])) return users[index];
  }
  return users.at(-1) || '';
}

export function shouldAuditChatCompletion({ fixedPrompt = '', userRequest = '', answer = '' } = {}) {
  const request = String(userRequest || '').trim();
  const output = String(answer || '').trim();
  if (!request || !output || request.length < 1200) return false;
  if (EXPLICIT_SHORT_OUTPUT_RE.test(request.slice(-800))) return false;
  const instructions = `${String(fixedPrompt || '').slice(0, 30000)}\n${request.slice(-1600)}`;
  return STRUCTURED_DELIVERY_RE.test(instructions) || request.length >= 6000;
}

export function isObviouslyIncompleteDelivery({ fixedPrompt = '', userRequest = '', answer = '' } = {}) {
  if (!shouldAuditChatCompletion({ fixedPrompt, userRequest, answer })) return false;
  const requestLength = String(userRequest || '').trim().length;
  const output = String(answer || '').trim();
  const minimumExpected = Math.min(1800, Math.max(700, Math.floor(requestLength * 0.12)));
  if (output.length < minimumExpected) return true;
  const storyboardHeaders = [...output.matchAll(/(?:^|\n)\s*分镜\s*\d+\s*[：:]/g)];
  return requestLength >= 3000 && storyboardHeaders.length === 1;
}

export function buildCompletionAuditMessages({ fixedPrompt = '', userRequest = '', answer = '' } = {}) {
  return [
    {
      role: 'system',
      content: `你是回答完成度核验器，只判断交付范围是否完整，不续写正文，也不评价文风。
判定规则：
1. complete=true 仅表示候选回答已经覆盖用户要求和固定规则中的全部交付项。
2. 对全文改编、逐项提取、剧本或分镜生成任务，必须确认候选回答已处理原文直到结尾；只给一个或少量条目、停在中间剧情、等待用户说“继续”，一律为 false。
3. 用户明确要求摘要、简短回答或限定字数时，短回答可以是完整的。
4. 固定规则中可能包含示例；示例不是本次待处理原文。
只输出一行 JSON，不要使用 Markdown：{"complete":true或false,"reason":"不超过80字的理由"}`,
    },
    {
      role: 'user',
      content: `【本对话固定规则】\n${clipped(fixedPrompt, 24000) || '无'}\n\n【用户本次完整请求】\n${clipped(userRequest, 48000)}\n\n【候选回答】\n${clipped(answer, 64000)}`,
    },
  ];
}

export function parseCompletionAudit(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (typeof parsed.complete === 'boolean') {
        return { complete: parsed.complete, reason: String(parsed.reason || '').trim().slice(0, 240) };
      }
    } catch { /* fall through to the conservative text parser */ }
  }
  if (/^complete\b/i.test(text) || /^完整(?:$|[：:])/i.test(text)) return { complete: true, reason: '' };
  if (/^incomplete\b/i.test(text) || /^未完整(?:$|[：:])/i.test(text)) return { complete: false, reason: text.slice(0, 240) };
  return { complete: null, reason: '' };
}

export function automaticContinuationPrompt(reason = '') {
  const detail = String(reason || '').trim();
  return `上一段尚未完成用户最初的完整请求。${detail ? `核验发现：${detail}\n` : ''}本次必须一次性输出全部剩余内容，直到原文结尾和全部交付项都完成；不得只输出下一个分镜、下一项或下一小段，不得等待用户再次回复“继续”。严格保持原有规格、结构、编号、数量和详细程度，只从上一段结束处无重复地接着输出。不要总结，不要缩写，也不要说明你正在续写。`;
}
