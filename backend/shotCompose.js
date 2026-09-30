// 提示词 → 可插入的「衔接镜头」。
// 一次调用产出两样东西：本镜完整正文（含承接定帧与时间码），以及后一镜被改写后的【承接定帧】
// —— 因为插入会改变后一镜的前序，不修它就会出现"承接上一镜"指向错镜的问题。
import { extractJsonObject } from './jsonParse.js';

function cleanPart(value, maxLength) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, maxLength);
}

const COMPOSE_SYSTEM_PROMPT = `你是分镜衔接编排师。用户要往一部竖屏短剧的分镜里插入一个新镜头，你要输出这个新镜头的完整正文，并同步修正原本排在它后面那个镜头的承接段落。

【输出格式】只输出一个 JSON 对象，不要 Markdown、不要代码块、不要解释：
{
  "shotText": "新镜头的完整正文",
  "nextShotPatch": { "needPatch": true 或 false, "patch": "后一镜改写后的【承接定帧】整段（needPatch 为 false 时留空字符串）", "reason": "为什么需要/不需要改写，一句话" },
  "transition": { "type": "光线式转场 | 硬切 | 位置延续 | 其他（自行命名）", "note": "转场说明，一句话" }
}

【shotText 的格式】第一行：场景名 [内/外][日/夜]，随后依次：
【承接定帧】（仅当存在"前置镜头"时写；若新镜头就是全片第一个镜头，则改写在第一行下面写【衔接策略·全片开场】，不要编造承接）
【衔接策略·xxx】或【转场·xxx】
【场景与站位概览】…
【0-Xs】【景别 运镜】[场景：具体地点、光线、氛围] 角色站位与朝向、动作、神态变化、关键道具状态
[音效] 具体分层音效
（按需要继续切分，时间码必须从 0 开始、连续、不重叠、不断档，最后一段结束秒即本镜总时长）
【结尾帧锚定】本镜最后一刻的定格：人物姿态、朝向、在画面中的位置、道具状态

【硬性规则】
1. 【承接定帧】只能依据用户给出的"前置镜头收尾锚点"里已经存在的画面事实改写：人物、姿态、朝向、道具、位置必须逐项继承，一个细节都不许新增或替换。锚点里没有的东西不要写。
2. 判断新镜头与前置镜头的关系：
   - 同一时空的连贯延续 → 写【衔接策略·位置延续】，讲清沿用哪些位置与朝向。
   - 换了地点 / 换了时间 / 换了世界线，或属于倒叙、闪回、穿越 → 必须写【转场】，标明转场类型与新时间、新地点，并明确写出"不沿用上一镜的人物位置与光线"。
3. 只写"人物在做什么、怎么动、神情怎么变化"，绝不写五官长相、发型发色、身材体型、服装款式颜色（这些由人物参考图固定，写进分镜会和参考图打架）。人物一律使用用户给出的规范名。
4. 用户给的描述是创作意图，不是成稿；允许你补足可拍摄的站位、走位、运镜、景别与音效，但不得改变用户描述的剧情事实、人物关系和情绪方向。
5. 后一镜的 nextShotPatch：只有当后一镜原本的承接指向的是"前置镜头"、而现在它前面变成了新镜头时才需要改写（改成承接新镜头的【结尾帧锚定】）。若后一镜本来就是转场起点、或它自己不写承接，则 needPatch 为 false。
6. 不许输出 JSON 以外的任何字符。`;

export function buildComposeShotMessages({
  episodeTitle = '',
  prevAnchor = '',
  nextShotText = '',
  description = '',
  layoutHint = '',
  shotHeaderPrefix = '',
} = {}) {
  const title = cleanPart(episodeTitle, 120) || '未命名集';
  const anchor = cleanPart(prevAnchor, 3000);
  const nextText = cleanPart(nextShotText, 6000);
  const want = cleanPart(description, 8000);
  const layout = cleanPart(layoutHint, 2000);
  if (!want) throw new Error('请先填写要插入的镜头描述或提示词');

  const userParts = [
    `集标题：${title}`,
    shotHeaderPrefix ? `分镜正文首行固定写「${cleanPart(shotHeaderPrefix, 40)}」。` : '',
    anchor
      ? `【前置镜头的收尾锚点】\n${anchor}`
      : '【前置镜头】不存在——新镜头会成为全片第一个镜头，不要写承接定帧。',
    nextText
      ? `【原本排在后面的那个镜头的正文】\n${nextText}`
      : '【后一镜】不存在——插入位置在最后一镜之后，nextShotPatch 的 needPatch 必须为 false。',
    `【要插入的镜头（用户的描述/提示词）】\n${want}`,
    layout ? `【用户的分镜排版习惯，尽量贴近】\n${layout}` : '',
    '请输出规定的 JSON。',
  ].filter(Boolean);

  return [
    { role: 'system', content: COMPOSE_SYSTEM_PROMPT },
    { role: 'user', content: userParts.join('\n\n') },
  ];
}

// 解析并规范化模型返回；缺失必需字段时给出可读错误，不静默返回半成品。
export function parseComposeResponse(text) {
  const raw = extractJsonObject(text, { preferObject: true, invalidMessage: '模型没有返回可解析的 JSON，已放弃本次合成' });
  const shotText = String(raw?.shotText || '').trim();
  if (!shotText) throw new Error('模型返回的 shotText 为空，已放弃本次合成');
  const patch = raw?.nextShotPatch || {};
  return {
    shotText,
    nextShotPatch: {
      needPatch: patch.needPatch === true && Boolean(String(patch.patch || '').trim()),
      patch: String(patch.patch || '').trim(),
      reason: cleanPart(patch.reason, 300),
    },
    transition: {
      type: cleanPart(raw?.transition?.type, 60),
      note: cleanPart(raw?.transition?.note, 300),
    },
  };
}
