import {
  channelLabel,
  modeLabel,
  wordTargetLabel,
} from './novelStorage.js';
import { extractJsonObject as extractJsonObjectShared } from './jsonParse.js';

export const CHAPTER_TARGET_WORDS = '2200-3000字';

function cleanText(value, max = 20000) {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max)}\n...（已截断）` : text;
}

export function extractJsonObject(text) {
  return extractJsonObjectShared(text, {
    emptyMessage: '模型没有返回内容',
    invalidMessage: '模型返回的不是合法 JSON',
  });
}

function marketStudyRules(draft = {}) {
  const digest = cleanText(draft.marketContext?.promptDigest, 10000);
  return digest
    ? `\n\n【已确认的市场拆书规律】\n${digest}\n只能使用抽象规律，不得复刻参考作品的标题、专名、人物组合、具体情节或原句。原创设定与本书人物逻辑优先。`
    : '';
}

// ---------- 平台小说写作总纲：所有正文类调用共用 ----------
function baseHongguoRules(draft = {}) {
  if (draft.writingPurpose === 'adaptation') {
    return `你是顶级视听化原创小说作者。作品首先必须是一部好小说，同时从源头具备影视/动画开发价值。
硬性铁律：
1. 场景驱动：每章由清晰的场景目标、阻力与可见结果推进，重要转折必须能被表演和拍摄。
2. 行动外化：少用大段解释性内心独白，用动作选择、对白潜台词、关系变化和环境反馈表达人物。
3. 视觉资产：持续经营具有辨识度的角色造型、场景、道具、能力效果与动作母题，避免只有概念没有画面。
4. 制作连续性：人物、时间、空间、道具归属与伤势必须连续；换场和时间跳跃要有可剪辑的过渡。
5. 戏剧节拍：每章至少有一次关系变化、信息反转或行动后果；章尾留下新的行动压力，而不只靠旁白卖关子。
6. 角色可演：核心人物都有欲望、策略、秘密和行为习惯；对手必须主动施压，不能只是剧情障碍。
7. 小说可读性：保持细节、氛围和文学节奏，不把正文写成分镜表或剧本说明。${marketStudyRules(draft)}`;
  }
  return `你是顶级红果短剧前置小说稿作者，写出来的小说要能直接改编成爆款短剧。
硬性铁律：
1. 开头黄金三章：第1-3章必须完成"强钩子入场→冲突升级→第一个爽点/情绪爆点兑现"，任何一章都不许慢热铺垫。
2. 节奏红线：每一章至少一个冲突、反转或强情绪点；每3-5章兑现一个小爽点；不注水、不写无信息量的过场，但也不许赶戏跳步——重要转折必须写足过程和情绪。
3. 逻辑铁链：人物每个重要行动都要有动机；因果链、时间顺序、空间移动必须成立；换地点、换时间、换视角必须给过渡，严禁空间断层。
4. 章章咬合：每章第一段必须承接上一章末尾的动作、台词或情绪，像同一卷胶片连续放映；每章结尾必须留下钩子，严禁平收。
5. 伏笔纪律：埋下的伏笔必须记住并按计划回收，严禁烂尾、虎头蛇尾、因果断裂；不许临时开无法回收的新坑。
6. 情绪感染力：好小说必须有感染力——爽要爽到位，虐要虐到心口，愤怒、憋屈、扬眉吐气都要让读者共情；用具体的动作、台词、细节传递情绪，不要空喊。
7. 画面感语言：多写动作和对话，少写大段心理独白和景物描写，方便后续拆分镜，但保持小说的文学可读性。${marketStudyRules(draft)}`;
}

function creationBriefText(draft = {}) {
  const brief = draft.creationBrief;
  if (!brief) return '无';
  return cleanText(JSON.stringify(brief, null, 2), 6000);
}

function skillInstructions(skillContext) {
  const text = cleanText(skillContext, 30000);
  return text ? `\n\n${text}` : '';
}

// ---------- 第一步：爆款包装（标题/简介/卖点/封面提示词） ----------
export function buildMetadataMessages(draft, skillContext = '') {
  return [
    {
      role: 'system',
      content: `你是红果/番茄爆款小说包装编辑兼电影海报设计师。只输出严格 JSON，不要 Markdown，不要解释。

标题要求：
1. 先生成 12 个差异明显的标题候选，再推荐其中一个；覆盖事件冲突、身份反差、关系悬念和作品独有意象。
2. 一眼能读出题材或情绪承诺，但每个标题必须包含本书独有事实，禁止只替换人名套榜单句式。
3. 禁止“逆光时刻、命运齿轮、长夜尽头、涅槃归来、王者归来”等没有情节支撑的 AI 空壳词。
4. 长标题必须像自然人会说的话；短标题必须来自故事内部的关键意象，不能故作文艺。

简介要求：80-160字，讲清主角身份、开局困境、核心冲突、关键反转和追看理由，句句带信息，不写口号。

封面提示词要求（coverPrompt）：用中文写一段完整的竖版小说成品封面生图提示词——包含主角形象、核心场景、情绪氛围、色调光影、构图和书名艺术字排版，风格为"精致国风/现代都市网文封面插画，电影感光效，细节丰富"。coverPrompt 必须明确要求画面直接出现与 title 字段完全一致的完整中文书名，用与题材匹配的高质感中文艺术字/书法字作为主视觉，不得漏字、错字或乱码；不要水印和 logo。`,
    },
    {
      role: 'user',
      content: `请为这部小说生成爆款包装。

频道：${channelLabel(draft.channel)}
创作用途：${draft.writingPurpose === 'adaptation' ? '视听化原创（标题与简介要突出可视化高概念，不套用低质网文长标题）' : '连载向创作（突出追读承诺与读者期待）'}
题材：${draft.genre || '由你根据故事想法判断最合适的热门题材'}
篇幅：${modeLabel(draft.mode)} · 目标${wordTargetLabel(draft.wordTargetWan)}
故事想法：
${cleanText(draft.idea, 8000)}

世界观：${cleanText(draft.worldSetting, 3000) || '无'}
主角：${cleanText(draft.protagonist, 3000) || '无'}
创作简报：
${creationBriefText(draft)}

用户指定开头：${cleanText(draft.opening, 2000) || '无'}
用户指定结局：${cleanText(draft.ending, 2000) || '无'}
补充要求：${cleanText(draft.requirement, 4000) || '无'}
${skillInstructions(skillContext)}

JSON 格式：
{
  "title": "推荐标题",
  "intro": "推荐简介",
  "titles": [{"id":"t1","title":"候选标题","strategy":"策略","reason":"适配原因"}],
  "intros": [{"id":"i1","text":"候选简介","strategy":"策略","reason":"读者承诺"}],
  "sellingPoints": ["卖点1", "卖点2", "卖点3"],
  "genre": "最终题材（用户已指定则沿用，未指定则由你判断）",
  "coverPrompt": "竖版封面生图提示词"
}`,
    },
  ];
}

// ---------- 第二步：故事蓝图（替代用户手写大纲：只锚定开头、结尾和骨架） ----------
export function buildBlueprintMessages(draft, skillContext = '') {
  const wan = draft.wordTargetWan;
  const actGuide = wan <= 10
    ? '3幕'
    : wan <= 50
      ? '4-5幕'
      : wan <= 100
        ? '5-6幕'
        : '6-8幕';
  return [
    {
      role: 'system',
      content: `${baseHongguoRules(draft)}

你现在生成整部小说的「故事蓝图」——这是全书的骨架和记忆锚点，后续每一章都靠它保证不跑偏、不烂尾。只输出严格 JSON，不要 Markdown，不要解释。
蓝图不是逐章大纲：只锚定开局、结局、幕结构、人物弧光和伏笔总计划，具体章节会随写作滚动规划。
结局锚点必须具体到"最终对决对象、胜负方式、情感归宿、主题落点"，全书所有伏笔最终都要汇向它。`,
    },
    {
      role: 'user',
      content: `请为这部小说生成故事蓝图。

【作品信息】
标题：${draft.title || '未命名'}
简介：${draft.intro || '无'}
频道：${channelLabel(draft.channel)}
创作用途：${draft.writingPurpose === 'adaptation' ? '视听化原创' : '连载向创作'}
题材：${draft.genre || '由你判断'}
篇幅：${modeLabel(draft.mode)} · 目标${wordTargetLabel(wan)} · 计划约${draft.chaptersTotal}章（每章${CHAPTER_TARGET_WORDS}）
故事想法：
${cleanText(draft.idea, 8000)}

世界观：${cleanText(draft.worldSetting, 3000) || '无'}
主角：${cleanText(draft.protagonist, 3000) || '无'}
创作简报：
${creationBriefText(draft)}

用户指定开头：${cleanText(draft.opening, 3000) || '无（由你设计最抓人的开局）'}
用户指定结局：${cleanText(draft.ending, 3000) || '无（由你设计最有回收感的结局）'}
补充要求：${cleanText(draft.requirement, 4000) || '无'}
${skillInstructions(skillContext)}

JSON 格式：
{
  "premise": "一句话高概念",
  "openingAnchor": "开局锚点：第1章开场画面、主角处境、第一冲突（若用户指定了开头必须遵循）",
  "endingAnchor": "结局锚点：最终对决/真相/情感归宿/主题落点（若用户指定了结局必须遵循）",
  "goldenChapters": [
    { "order": 1, "goal": "第1章要完成的钩子与冲突" },
    { "order": 2, "goal": "第2章的冲突升级与反转" },
    { "order": 3, "goal": "第3章兑现的第一个爽点/情绪爆点" }
  ],
  "mainCharacters": [
    { "name": "姓名", "role": "身份/阵营/功能", "desire": "欲望", "secret": "秘密或弱点", "arc": "从什么变成什么" }
  ],
  "worldRules": ["世界观/势力/规则/金手指设定，每条一句话"],
  "acts": [
    { "index": 1, "title": "幕名", "goal": "本幕推进什么", "climax": "幕末高潮事件", "startShare": 0, "endShare": 20 }
  ],
  "foreshadowPlan": [
    { "id": "f1", "content": "伏笔内容", "plantAct": 1, "payoffAct": 3, "payoff": "如何回收" }
  ],
  "emotionCurve": "全书情绪曲线：哪里压抑、哪里爆发、哪里最痛、哪里最爽",
  "pacingNotes": "针对本书的节奏提醒：哪些阶段容易拖沓、如何保持红果短剧节奏"
}

结构要求：
- acts 按${actGuide}规划，startShare/endShare 为全书进度百分比，首尾衔接覆盖 0-100。
- foreshadowPlan 给 ${wan <= 20 ? '4-6' : wan <= 80 ? '6-10' : '8-14'} 条主线伏笔，长线短线搭配，每条都写清回收方式。
- mainCharacters 给 ${wan <= 20 ? '3-5' : '5-8'} 个核心人物，反派也要有欲望和弧光。`,
    },
  ];
}

// ---------- 滚动卷规划：一次规划 VOLUME_SIZE 章的章节卡 ----------
export function buildVolumePlanMessages({ draft, volumeIndex, startOrder, endOrder, prevVolumeSummary, rollingSummary, openLedger, characterStates, skillContext = '' }) {
  const total = draft.chaptersTotal;
  const startShare = Math.round(((startOrder - 1) / total) * 100);
  const endShare = Math.round((endOrder / total) * 100);
  return [
    {
      role: 'system',
      content: `${baseHongguoRules(draft)}

你现在做滚动章节规划：只规划当前一卷的章节卡，让剧情严格贴合故事蓝图的幕结构，同时接住前文留下的所有钩子和伏笔。只输出严格 JSON，不要解释。`,
    },
    {
      role: 'user',
      content: `请规划第${volumeIndex}卷（第${startOrder}-${endOrder}章，全书共约${total}章，本卷覆盖全书进度 ${startShare}%-${endShare}%）。

【故事蓝图】
${blueprintBrief(draft.blueprint)}

【全书进度记忆】
${cleanText(rollingSummary, 9000) || '（全书尚未开始，本卷从第1章开始）'}

【上一卷收束状态】
${cleanText(prevVolumeSummary, 3000) || '无'}

【未回收伏笔账本】
${ledgerBrief(openLedger) || '暂无未回收伏笔'}

【人物当前状态】
${characterStatesBrief(characterStates) || '以蓝图人设为准'}

补充要求：${cleanText(draft.requirement, 3000) || '无'}
${skillInstructions(skillContext)}

JSON 格式：
{
  "volumeTitle": "本卷卷名",
  "volumeGoal": "本卷要完成的剧情推进与情绪任务",
  "chapters": [
    {
      "order": ${startOrder},
      "title": "章节标题（不带序号）",
      "summary": "本章剧情推进，2-3句，信息密度要高",
      "hook": "本章开头如何承接上一章并立刻抓人",
      "endingHook": "本章结尾悬念",
      "plant": ["本章埋设的伏笔（可为空数组）"],
      "resolve": ["本章回收的伏笔ID或内容（可为空数组）"]
    }
  ]
}

规划要求：
- 必须给出第${startOrder}到第${endOrder}章共${endOrder - startOrder + 1}张章节卡，order 连续。
- 对照全书进度定位当前所处的幕，本卷末章（第${endOrder}章）要落在一个阶段性高潮或大反转上。
- 到期的伏笔安排在本卷回收（写进对应章节的 resolve）；新伏笔按蓝图 foreshadowPlan 埋设（写进 plant）。
${startOrder === 1 ? `- 第1-3章严格执行蓝图的黄金三章计划。` : `- 第${startOrder}章必须接住上一卷末尾留下的钩子。`}
${endOrder >= total ? `- 本卷是最终卷：最后一章必须兑现结局锚点，回收全部未回收伏笔，首尾呼应，情绪推到最高点收束，严禁烂尾。` : ''}`,
    },
  ];
}

// ---------- 单章正文 ----------
export function buildChapterDraftMessages({ draft, chapter, volume, previousChapterTail, previousContinuity, rollingSummary, openLedger, characterStates, chapterIntent = null, contextPlan = null, architecture = null, skillContext = '', variantInstruction = '' }) {
  const total = draft.chaptersTotal;
  const isGoldenOpening = chapter.order <= 3;
  const isFinale = chapter.order >= total;
  const goldenGoal = isGoldenOpening
    ? (draft.blueprint?.goldenChapters || []).find((g) => Number(g.order) === chapter.order)?.goal || ''
    : '';
  return [
    {
      role: 'system',
      content: `${baseHongguoRules(draft)}

你现在写第${chapter.order}章正文，目标${CHAPTER_TARGET_WORDS}。只输出正文本身，不要输出章节标题、分析、说明或 Markdown。`,
    },
    {
      role: 'user',
      content: `【作品】《${draft.title}》 ${channelLabel(draft.channel)} · ${draft.genre} · 全书约${total}章，当前第${chapter.order}章（进度${Math.round((chapter.order / total) * 100)}%）
简介：${cleanText(draft.intro, 400)}

【故事蓝图】
${blueprintBrief(draft.blueprint)}

【全书进度记忆】
${cleanText(rollingSummary, 9000) || '（这是全书开篇）'}

【本卷任务】${volume ? `第${volume.index}卷《${volume.title}》：${volume.goal}` : '按蓝图推进'}

【本章章节卡】
标题：${chapter.title}
剧情：${chapter.summary || '按蓝图与前文自然推进'}
开头钩子：${chapter.hook || '承接上一章末尾，立刻进入冲突'}
结尾悬念：${chapter.endingHook || '留下下一章必须翻开的钩子'}
本章埋伏笔：${chapter.plant?.length ? chapter.plant.join('；') : '无'}
本章回收伏笔：${chapter.resolve?.length ? chapter.resolve.join('；') : '无'}

【章节意图书】
${chapterIntent ? cleanText(JSON.stringify(chapterIntent, null, 2), 6000) : '以章节卡为准'}

【上下文精选】
${contextPlan ? cleanText(JSON.stringify(contextPlan, null, 2), 8000) : '以全书记忆为准'}

【场景架构】
${architecture ? cleanText(JSON.stringify(architecture, null, 2), 8000) : '按章节卡自然拆分场景'}

【上一章末尾原文】
${previousChapterTail ? cleanText(previousChapterTail, 2200) : '（这是第一章，没有上一章）'}

【上一章连续性状态】
${previousContinuity ? cleanText(JSON.stringify(previousContinuity, null, 2), 2500) : '无'}

【未回收伏笔账本】
${ledgerBrief(openLedger) || '暂无'}

【人物当前状态】
${characterStatesBrief(characterStates) || '以蓝图人设为准'}

补充要求：${cleanText(draft.requirement, 3000) || '无'}
${variantInstruction ? `\n【本候选稿侧重点】\n${cleanText(variantInstruction, 1200)}` : ''}
${skillInstructions(skillContext)}

写作要求：
- 正文${CHAPTER_TARGET_WORDS}，一气呵成。
${chapter.order === 1
    ? '- 黄金第一章：第一句就要进入危机、反常或冲突现场，10秒内让读者放不下；本章内主角、核心冲突、第一情绪点全部亮相。'
    : '- 第一段必须无缝承接【上一章末尾原文】的动作、台词或情绪，像同一场戏继续拍，严禁另起炉灶或复述前情。'}
${isGoldenOpening && goldenGoal ? `- 黄金三章任务：${goldenGoal}` : ''}
${isFinale
    ? '- 最终章：兑现结局锚点，回收账本里所有未回收伏笔，与第一章形成首尾呼应，情绪推到全书最高点后干净收束，结尾不再留新悬念。'
    : '- 结尾停在本章悬念的最高点，让读者必须翻开下一章。'}
- 人物行动要有动机，空间时间要连续，对白要带人物性格和情绪张力。
- 埋设/回收伏笔要融进剧情，不许生硬点题。`,
    },
  ];
}

export function buildChapterIntentMessages({ draft, chapter, previousChapterTail, previousContinuity, rollingSummary, openLedger, skillContext = '' }) {
  return [
    {
      role: 'system',
      content: `你是小说执行主编。把全书规划和章节卡转成可执行的章节意图书。只输出严格 JSON，不要 Markdown。用户明确要求、已确认事实和上一章硬衔接优先级最高。`,
    },
    {
      role: 'user',
      content: `作品：《${draft.title}》第${chapter.order}章《${chapter.title}》
章节卡：${cleanText(JSON.stringify({ summary: chapter.summary, hook: chapter.hook, endingHook: chapter.endingHook, plant: chapter.plant, resolve: chapter.resolve }), 5000)}
故事蓝图：${blueprintBrief(draft.blueprint)}
前文概要：${cleanText(rollingSummary, 8000) || '无'}
上一章尾段：${cleanText(previousChapterTail, 2200) || '无'}
上一章状态：${cleanText(JSON.stringify(previousContinuity || {}), 2500)}
伏笔账本：${ledgerBrief(openLedger) || '无'}
${skillInstructions(skillContext)}

输出：
{"coreGoal":"本章唯一核心目标","mustKeep":["必须发生"],"mustAvoid":["禁止发生"],"emotionGoal":"读者章末情绪","continuityBridge":"如何承接上一章","hookPayoff":[{"id":"伏笔ID或内容","action":"advance|resolve","evidence":"具体推进方式"}]}`,
    },
  ];
}

export function buildChapterContextMessages({ draft, chapter, chapterIntent, rollingSummary, openLedger, characterStates, previousContinuity, skillContext = '' }) {
  return [
    {
      role: 'system',
      content: '你是小说上下文构造师。只挑选本章真正需要的事实、伏笔和规则，识别冲突并压缩上下文。只输出严格 JSON，不要 Markdown。不得创造原始资料里不存在的既定事实。',
    },
    {
      role: 'user',
      content: `作品：《${draft.title}》第${chapter.order}章
章节意图：${cleanText(JSON.stringify(chapterIntent), 7000)}
前文概要：${cleanText(rollingSummary, 10000) || '无'}
人物状态：${characterStatesBrief(characterStates) || '无'}
上一章状态：${cleanText(JSON.stringify(previousContinuity || {}), 3000)}
伏笔账本：${ledgerBrief(openLedger) || '无'}
世界规则：${cleanText(JSON.stringify(draft.blueprint?.worldRules || []), 4000)}
${skillInstructions(skillContext)}

输出：
{"snippets":[{"type":"character|plot|hook|world|continuity","id":"可为空","content":"压缩事实"}],"rules":["本章硬规则"],"conflicts":[{"description":"潜在矛盾","resolution":"规避方法"}],"hookPlan":[{"id":"伏笔ID或内容","action":"advance|resolve","reason":"原因"}]}`,
    },
  ];
}

export function buildChapterArchitectureMessages({ draft, chapter, chapterIntent, contextPlan, previousChapterTail, skillContext = '' }) {
  return [
    {
      role: 'system',
      content: `你是网文章节结构师。把章节意图拆成可直接写作的场景 beats。只输出严格 JSON，不要 Markdown。场景1必须承接上一章，所有 mustKeep 和伏笔计划必须落到具体场景。`,
    },
    {
      role: 'user',
      content: `作品：《${draft.title}》第${chapter.order}章《${chapter.title}》
章节意图：${cleanText(JSON.stringify(chapterIntent), 7000)}
上下文精选：${cleanText(JSON.stringify(contextPlan), 9000)}
上一章尾段：${cleanText(previousChapterTail, 2200) || '无'}
目标字数：${CHAPTER_TARGET_WORDS}
${skillInstructions(skillContext)}

输出：
{"openingBridge":"开篇承接方式","scenes":[{"index":1,"name":"场景名","targetWords":700,"location":"地点","characters":["人物"],"conflict":"核心冲突","beats":["动作节拍"],"emotion":"情绪变化","hookHandling":["伏笔推进或回收"]}],"endingBeat":"章尾落点","coverage":{"mustKeep":["已覆盖项"],"hooks":["已覆盖项"]}}`,
    },
  ];
}

export function buildChapterNormalizeMessages({ draft, chapter, content, targetMin = 2200, targetMax = 3000, skillContext = '' }) {
  return [
    {
      role: 'system',
      content: '你是连载小说文字编辑。只调整篇幅和明显模板化表达，不改变剧情事实、人物行动、线索、时间顺序和章尾结果。只输出完整正文，不要标题、Markdown 或说明。',
    },
    {
      role: 'user',
      content: `作品：《${draft.title}》第${chapter.order}章《${chapter.title}》
当前字数：${String(content || '').replace(/\s/g, '').length}
目标区间：${targetMin}-${targetMax}字
${skillInstructions(skillContext)}

正文：
${cleanText(content, 40000)}`,
    },
  ];
}

export function buildChapterAuditMessages({ draft, chapter, content, contextPlan, previousChapterTail, previousContinuity, skillContext = '' }) {
  return [
    {
      role: 'system',
      content: `你是小说质量审计师。检查相邻章节连续性、人物状态、资源、伏笔、人设、世界规则、时间线和 mustKeep。只输出严格 JSON，不要 Markdown。相邻章节无解释跳场、关键因果缺失或资源凭空出现必须标 critical。`,
    },
    {
      role: 'user',
      content: `作品：《${draft.title}》第${chapter.order}章《${chapter.title}》
章节卡：${cleanText(JSON.stringify({ title: chapter.title, summary: chapter.summary, hook: chapter.hook, endingHook: chapter.endingHook, plant: chapter.plant, resolve: chapter.resolve }), 5000)}
上下文：${cleanText(JSON.stringify(contextPlan), 9000)}
上一章尾段：${cleanText(previousChapterTail, 2200) || '无'}
上一章状态：${cleanText(JSON.stringify(previousContinuity || {}), 3000)}
世界规则：${cleanText(JSON.stringify(draft.blueprint?.worldRules || []), 4000)}
${skillInstructions(skillContext)}

待审正文：
${cleanText(content, 40000)}

输出：
{"passed":true,"score":100,"violations":[{"category":"continuity|character|resource|hook|world|timeline|must_keep|style","severity":"critical|warning|info","location":"位置","description":"问题","suggestedFix":"最小修改建议"}],"summary":"审计结论"}`,
    },
  ];
}

export function buildNovelRadarMessages({ draft, currentChapter, skillContext = '' }) {
  return [
    {
      role: 'system',
      content: '你是长篇小说编辑监工。评估全书阶段性节奏、伏笔积压、人物缺席、情绪重复和主线偏移。只输出严格 JSON，不要 Markdown。',
    },
    {
      role: 'user',
      content: `作品：《${draft.title}》已写到第${currentChapter}章
故事蓝图：${blueprintBrief(draft.blueprint)}
前文概要：${cleanText(draft.rollingSummary, 12000)}
人物状态：${characterStatesBrief(draft.characterStates)}
伏笔账本：${ledgerBrief(draft.ledger)}
${skillInstructions(skillContext)}

输出：
{"chapter":${currentChapter},"score":100,"risks":[{"type":"plot|hook|character|emotion|pacing","severity":"warning|critical","description":"风险","suggestion":"下一阶段建议"}],"summary":"阶段健康度"}`,
    },
  ];
}

export function buildMultiWriterReviewMessages({ draft, chapter, candidates = [], skillContext = '' }) {
  const candidateText = candidates.map((candidate, index) => `【候选稿 ${index + 1}】\n${cleanText(candidate, 14000)}`).join('\n\n');
  return [
    {
      role: 'system',
      content: `你是小说总编与终审。现在有多名写手为同一章提交候选稿。你要分别评分，并在不破坏既定事实、章节卡、人物连续性和伏笔计划的前提下，选择最佳主稿、吸收其他稿件的有效部分，合并成一篇完整正文。

只输出严格 JSON，不要 Markdown，不要解释。评分为 0-100 整数。

JSON 格式：
{
  "scores": [
    {"variant": 1, "structure": 0, "character": 0, "prose": 0, "market": 0, "total": 0, "note": "主要优缺点"}
  ],
  "selectedVariant": 1,
  "mergeStrategy": "如何取舍各稿",
  "mergedContent": "合并后的完整章节正文"
}

mergedContent 必须是 ${CHAPTER_TARGET_WORDS} 的可发布正文，不要章节标题、候选编号、评语或说明。`,
    },
    {
      role: 'user',
      content: `作品：《${draft.title}》第${chapter.order}章《${chapter.title}》
本章任务：${chapter.summary || '按蓝图与前文推进'}
开头钩子：${chapter.hook || '承接上一章'}
结尾悬念：${chapter.endingHook || '留下下一章钩子'}
必须埋设：${chapter.plant?.length ? chapter.plant.join('；') : '无'}
必须回收：${chapter.resolve?.length ? chapter.resolve.join('；') : '无'}
${skillInstructions(skillContext)}

${candidateText}`,
    },
  ];
}

// ---------- 质检修正 ----------
export function buildQualityRepairMessages({ draft, chapter, content, previousChapterTail, previousContinuity, auditReport = null, skillContext = '' }) {
  return [
    {
      role: 'system',
      content: `你是红果短剧小说稿的主编级质检编辑。请直接输出修正后的最终正文，不要输出质检报告、解释或 Markdown。

逐项质检并就地修正：
1. 开头是否承接上一章末尾动作/台词/情绪（第1章则是否10秒抓人）——不合格就重写开头。
2. 节奏是否过慢（注水、重复、无信息量段落一律删）或过快（关键转折缺过程缺情绪就补足）。
3. 人物动机、因果链、时间顺序、空间移动是否成立——修补一切逻辑漏洞与断层。
4. 是否与前文连续性状态矛盾（人物位置、伤势、持有物、已知信息）。
5. 情绪是否到位：爽点虐点要写足，不许平淡带过。
6. 结尾是否停在悬念高点（最终章则是否干净收束）。
7. 长度是否在${CHAPTER_TARGET_WORDS}区间，偏差过大要增删。`,
    },
    {
      role: 'user',
      content: `作品：《${draft.title}》第${chapter.order}章《${chapter.title}》
本章任务：${chapter.summary || '按前文推进'}
本章应埋伏笔：${chapter.plant?.length ? chapter.plant.join('；') : '无'}
本章应回收伏笔：${chapter.resolve?.length ? chapter.resolve.join('；') : '无'}

上一章末尾原文：
${previousChapterTail ? cleanText(previousChapterTail, 2000) : '（第一章）'}

上一章连续性状态：
${previousContinuity ? cleanText(JSON.stringify(previousContinuity, null, 2), 2500) : '无'}
${auditReport ? `\n审计报告：\n${cleanText(JSON.stringify(auditReport, null, 2), 7000)}` : ''}
${skillInstructions(skillContext)}

待质检正文：
${cleanText(content, 40000)}

只输出修正后的最终正文。`,
    },
  ];
}

// ---------- 场记：连续性 + 记忆更新（一次调用全提取） ----------
export function buildContinuityMessages({ draft, chapter, content, openLedger, skillContext = '' }) {
  return [
    {
      role: 'system',
      content: '你是长篇小说的连续性场记兼资料员。只输出严格 JSON，不要解释。你的记录会成为下一章写作的记忆，必须准确、具体。',
    },
    {
      role: 'user',
      content: `请从本章正文中提取连续性状态和记忆更新。

作品：《${draft.title}》第${chapter.order}章《${chapter.title}》

当前未回收伏笔账本：
${ledgerBrief(openLedger) || '暂无'}
${skillInstructions(skillContext)}

正文：
${cleanText(content, 30000)}

JSON 格式：
{
  "digest": "本章剧情一句话摘要（60字内，写清谁做了什么、局势变成什么）",
  "tailAction": "结尾最后一个明确动作",
  "tailDialogue": "结尾最后一句关键台词，没有则为空",
  "emotion": "结尾情绪",
  "location": "结尾地点与在场人物",
  "unresolvedHook": "下一章必须承接的悬念或危机",
  "newForeshadow": [
    { "content": "本章新埋下的伏笔", "dueHint": "预计何时回收（如：第3卷/大结局前）" }
  ],
  "resolvedForeshadow": ["本章已回收的伏笔ID（对照账本，如 f1；没有则空数组）"],
  "characterStates": [
    { "name": "人物名", "status": "生死/伤势/身份变化", "location": "所在位置", "goal": "当前目标", "note": "关键持有物或新知晓的信息" }
  ]
}

characterStates 只列本章状态发生变化的人物。newForeshadow 只记真正的伏笔，不要把普通剧情当伏笔。`,
    },
  ];
}

export function buildPartialRewriteMessages({ draft, chapter, selectedText, instruction, mode, skillContext = '' }) {
  const modeRules = {
    polish: '优化语言、节奏和画面感，保持原意与篇幅基本不变。',
    expand: '补足动作、情绪、对白和因果过程，扩写到原文约1.5-2倍。',
    condense: '删除重复和注水，压缩到原文约60%-75%，保留所有关键信息。',
    conflict: '增强人物对抗、情绪张力和戏剧冲突，但不得改变既定事实。',
    dialogue: '强化对白的人物口吻、潜台词与交锋，减少解释性叙述。',
    custom: cleanText(instruction, 2000) || '按用户要求改写。',
  };
  return [
    {
      role: 'system',
      content: `${baseHongguoRules(draft)}

你是小说精修编辑，只改写用户选中的片段。只输出替换后的片段正文，不要解释、标题、引号或 Markdown。不得擅自改变人物姓名、既定设定、时间地点和前后剧情事实。`,
    },
    {
      role: 'user',
      content: `作品：《${draft.title}》第${chapter.order}章《${chapter.title}》
本章任务：${cleanText(chapter.summary, 1200) || '按章节卡推进'}
改写方式：${modeRules[mode] || modeRules.custom}
补充要求：${cleanText(instruction, 2000) || '无'}
${skillInstructions(skillContext)}

待改写片段：
${cleanText(selectedText, 12000)}

只输出可直接替换原片段的正文。`,
    },
  ];
}

// ---------- 提示词组装辅助 ----------
export function blueprintBrief(blueprint) {
  if (!blueprint) return '（尚无蓝图，按题材常规套路推进）';
  const parts = [];
  if (blueprint.premise) parts.push(`高概念：${blueprint.premise}`);
  if (blueprint.openingAnchor) parts.push(`开局锚点：${blueprint.openingAnchor}`);
  if (blueprint.endingAnchor) parts.push(`结局锚点（全书必须汇向它）：${blueprint.endingAnchor}`);
  const characters = (blueprint.mainCharacters || [])
    .map((c) => `- ${c.name}（${c.role}）欲望：${c.desire}；秘密：${c.secret}；弧光：${c.arc}`)
    .join('\n');
  if (characters) parts.push(`核心人物：\n${characters}`);
  const rules = (blueprint.worldRules || []).map((r) => `- ${r}`).join('\n');
  if (rules) parts.push(`世界观规则：\n${rules}`);
  const acts = (blueprint.acts || [])
    .map((a) => `第${a.index}幕《${a.title}》(${a.startShare}%-${a.endShare}%)：${a.goal}；幕末高潮：${a.climax}`)
    .join('\n');
  if (acts) parts.push(`幕结构：\n${acts}`);
  if (blueprint.emotionCurve) parts.push(`情绪曲线：${blueprint.emotionCurve}`);
  if (blueprint.pacingNotes) parts.push(`节奏提醒：${blueprint.pacingNotes}`);
  return cleanText(parts.join('\n'), 6500);
}

export function ledgerBrief(entries = []) {
  return (entries || [])
    .filter((e) => e && e.content)
    .map((e) => `- [${e.id}] ${e.content}（埋于第${e.plantedChapter || '?'}章${e.dueChapter ? `，应在第${e.dueChapter}章前回收` : ''}）`)
    .join('\n');
}

export function characterStatesBrief(states = []) {
  return (states || [])
    .filter((s) => s && s.name)
    .map((s) => `- ${s.name}：${[s.status, s.location && `在${s.location}`, s.goal && `目标：${s.goal}`, s.note].filter(Boolean).join('；')}`)
    .join('\n');
}

// ---------- 市场拆书与标题简介实验室 ----------
export function buildNovelMarketStudyMessages({ draft, items = [], sampleText = '', instruction = '' }) {
  const references = items.map((item) => ({
    source: item.source,
    rank: item.rank,
    title: item.title,
    intro: cleanText(item.intro, 1600),
    tags: item.tags,
    wordCount: item.wordCount,
    episodeCount: item.episodeCount,
    metric: item.metric,
  }));
  return [
    {
      role: 'system',
      content: `你是小说市场研究主编。任务是从公开榜单元数据、简介和用户合法提供的样本文本中提炼可迁移规律，不是仿写器。

必须遵守：
1. 分析标题结构、读者承诺、冲突类型、简介开场、信息释放、人物驱动力和平台差异。
2. 不得建议复制具体书名、角色、情节组合、句子或独特设定；必须列出 doNotCopy。
3. 区分短期榜单噪声与可持续规律，明确哪些套路已经拥挤、哪些仍有差异化空间。
4. promptDigest 必须是可直接注入原创写作的抽象规则，不含任何参考作品专名或连续原句。
5. 只输出严格 JSON，不要 Markdown。`,
    },
    {
      role: 'user',
      content: `【当前原创作品】
题材：${draft.genre || '未定'}
梗概：${cleanText(draft.idea, 4000) || '未定'}
主角：${cleanText(draft.protagonist, 2000) || '未定'}
创作用途：${draft.writingPurpose === 'adaptation' ? '视听化原创' : '连载向创作'}
目标平台：${(draft.targetPlatforms || []).join('、') || '未指定'}

【公开市场样本】
${JSON.stringify(references, null, 2)}

【用户提供的拆书样本】
${cleanText(sampleText, 30000) || '无，仅做榜单轻拆'}

【额外要求】
${cleanText(instruction, 2000) || '无'}

JSON 格式：
{
  "summary":"市场结论",
  "marketSignals":[{"signal":"规律","evidence":"跨样本依据","durability":"short|medium|long"}],
  "titlePatterns":{"effective":["有效结构"],"tired":["拥挤套路"],"antiAiRules":["去 AI 腔规则"]},
  "introPatterns":{"effective":["有效写法"],"avoid":["应避免写法"]},
  "openingPatterns":["开篇规律"],
  "structureRules":["结构与节奏规律"],
  "opportunities":["适合当前原创作品的差异化机会"],
  "risks":["当前构思风险"],
  "doNotCopy":["禁止复刻项"],
  "promptDigest":"不含专名和原句的原创写作注入规则"
}`,
    },
  ];
}

export function buildNovelPackagingCandidateMessages(draft, marketDigest = '') {
  return [
    {
      role: 'system',
      content: `你是番茄小说与红果短剧的资深包装编辑。先做大量候选，不要急着选一个。

标题要求：
- 生成 12 个标题，至少覆盖：事件冲突型、身份反差型、关系悬念型、意象短标题型四种策略。
- 标题必须让目标读者迅速知道冲突或情绪承诺，同时保留一个具体新鲜点。
- 禁止无内容支撑的“逆光时刻、命运齿轮、长夜尽头、涅槃归来、王者归来”等 AI 常用空壳词。
- 禁止只替换人名的榜单标题仿写，禁止复制参考标题连续表达。
- 长标题要像自然人说话，短标题要有作品内部的独特意象，不能故作文艺。

简介要求：
- 生成 4 版，每版 90-180 字，分别使用场景入场、困境入场、身份反转、关系撕裂策略。
- 前两句必须出现人物、处境和异常变化；结尾给出具体追看问题，不喊口号。
- 只输出严格 JSON。`,
    },
    {
      role: 'user',
      content: `【作品资料】
${JSON.stringify({
  genre: draft.genre,
  idea: draft.idea,
  worldSetting: draft.worldSetting,
  protagonist: draft.protagonist,
  writingPurpose: draft.writingPurpose,
  targetPlatforms: draft.targetPlatforms,
  creationBrief: draft.creationBrief,
}, null, 2)}

【市场拆书规律，只能抽象使用】
${cleanText(marketDigest, 12000) || '无，按平台常识生成但避免陈词滥调'}

JSON 格式：
{
  "titles":[{"id":"t1","title":"标题","strategy":"策略","reason":"为什么适合本书"}],
  "intros":[{"id":"i1","text":"简介","strategy":"策略","reason":"读者承诺"}]
}`,
    },
  ];
}

export function buildNovelPackagingReviewMessages(draft, candidates, marketDigest = '') {
  return [
    {
      role: 'system',
      content: `你是独立包装总编，负责淘汰机器感、同质化和名不副实的标题简介。你没有义务保留候选原文。

标题按 100 分评审：题材识别 20、冲突/情绪承诺 25、具体性 20、自然口语或独特意象 15、差异化 20。另给 aiRisk 0-100，越高越像 AI。
简介按 100 分评审：开场抓力 25、人物与困境清晰 25、信息密度 20、具体追看动力 20、自然表达 10。
删除与榜单作品过近、只有套话、与正文无关或读起来像提示词的候选。可以重写后保留。最终保留 5 个标题和 3 个简介。
只输出严格 JSON。`,
    },
    {
      role: 'user',
      content: `作品核心：${cleanText(JSON.stringify(draft.creationBrief || { idea: draft.idea, protagonist: draft.protagonist }), 6000)}
市场规律：${cleanText(marketDigest, 8000) || '无'}
待审候选：${cleanText(JSON.stringify(candidates), 20000)}

JSON 格式：
{
  "titles":[{"id":"t1","title":"终选标题","strategy":"策略","reason":"具体评语","score":88,"aiRisk":12}],
  "intros":[{"id":"i1","text":"终选简介","strategy":"策略","reason":"具体评语","score":90}],
  "recommendedTitleId":"t1",
  "recommendedIntroId":"i1",
  "auditSummary":"淘汰与重写结论"
}`,
    },
  ];
}

// 封面提示词兜底：模型没给 coverPrompt 时用
export function fallbackCoverPrompt(draft) {
  const tone = draft.channel === 'female'
    ? '唯美浪漫氛围，情绪张力，柔和高级色调'
    : '热血高燃氛围，强对比电影光效，暗金色调';
  return `竖版小说成品封面，题材：${draft.genre || '都市爽文'}。画面主体为故事主角，${tone}，构图有冲击力，精致细节，网文爆款封面风格，商业海报级品质。故事：${cleanText(draft.intro || draft.idea, 300)}。`;
}

export function buildCoverImagePrompt(draft, basePrompt = '', references = []) {
  const title = String(draft?.title || '未命名小说').trim() || '未命名小说';
  const raw = String(basePrompt || fallbackCoverPrompt(draft) || '').split('【书名艺术字硬性要求】')[0];
  const cleaned = raw
    .replace(/画面中禁止出现任何文字、字母、水印、logo。?/g, '')
    .replace(/底图中?禁止出现任何文字、字母、水印、logo[^。]*。?/g, '')
    .replace(/底图禁止出现任何文字、水印、logo[^。]*。?/g, '')
    .replace(/系统会在生成后准确叠加[^。]*。?/g, '')
    .replace(/小说封面底图/g, '小说成品封面')
    .replace(/底图/g, '画面')
    .trim();
  const referenceLines = (Array.isArray(references) ? references : [])
    .slice(0, 10)
    .map((item, index) => {
      const name = String(item?.name || `素材${index + 1}`).trim();
      const type = String(item?.assetTypeLabel || '参考素材').trim();
      const category = String(item?.sourceCategory || '').trim();
      let rule = '把该素材的主体实际融入封面，保持可识别的外观、造型、结构和关键视觉特征';
      if (category === 'character') rule = '对应人物必须实际出现在封面中，严格保持脸部特征、发型、年龄感、服装造型和人物辨识度，不得另换人物';
      else if (category === 'scene') rule = '将该场景作为封面环境依据，保持空间结构、建筑陈设、色彩与标志性环境特征';
      else if (category === 'prop') rule = '该道具必须以可识别形态实际出现在封面中，保持轮廓、材质、颜色和标志性细节';
      else if (category === 'style') rule = '只参考画风、笔触、色彩、光影和质感，不照搬其中的人物、场景、文字或构图';
      return `参考图${index + 1}是${type}“${name}”：${rule}。`;
    });
  const referenceSection = referenceLines.length
    ? `\n【参考素材绑定】以下图片已作为真实参考图随请求提交，是封面生成的主要视觉依据。除明确标为画风参考的图片外，所选人物、场景和道具必须真实体现在最终封面中；结合故事重新设计商业封面构图，不照搬原图中的无关背景、文字、水印或排版。\n${referenceLines.join('\n')}`
    : '';
  return `${cleaned || fallbackCoverPrompt(draft)}${referenceSection}
【书名艺术字硬性要求】这是最终成品小说封面，必须在画面中直接生成完整中文书名《${title}》。书名必须清晰可辨认、文字准确，不得漏字、错字或乱码；使用与题材匹配的高质感中文艺术字或书法标题设计，作为画面主视觉，具有描边、光效、层次和商业网文封面排版感。除完整书名外，不要生成其他无关文字、字母、水印或 logo。`;
}

export function buildStandaloneCoverPrompt({ title = '', genre = '', storyIdea = '', ratio = '3:4', references = [] } = {}) {
  const cleanGenre = cleanText(genre || '都市爽文', 80);
  const cleanStoryIdea = cleanText(storyIdea || '', 1200);
  const storyContext = cleanStoryIdea || `围绕${cleanGenre}题材设计一幕有叙事性的故事封面，突出主角目标、核心冲突和情绪张力。`;
  const base = `${fallbackCoverPrompt({
    channel: 'male',
    genre: cleanGenre,
    intro: storyContext,
  }).replace('画面主体为故事主角', '画面主体优先使用用户上传参考图中的人物或故事主角')} 画面比例为 ${ratio}。`;
  const referenceLines = (Array.isArray(references) ? references : []).slice(0, 10).map((item, index) => {
    const name = String(item?.name || `素材${index + 1}`).trim();
    const type = String(item?.assetTypeLabel || '参考素材').trim();
    const category = String(item?.sourceCategory || '').trim();
    if (category === 'character') return `参考图${index + 1}是人物参考图“${name}”：人物必须实际出现在封面中，严格保持脸部特征、发型、年龄感、服装造型和人物辨识度，不得另换人物。`;
    if (category === 'scene') return `参考图${index + 1}是场景参考图“${name}”：将该场景作为封面环境依据，保持空间结构、建筑陈设、色彩与标志性环境特征。`;
    if (category === 'prop') return `参考图${index + 1}是道具参考图“${name}”：该道具必须以可识别形态实际出现在封面中，保持轮廓、材质、颜色和标志性细节。`;
    return `参考图${index + 1}是${type}“${name}”：只参考画风、笔触、色彩、光影和质感，不照搬无关文字或构图。`;
  });
  const referenceSection = referenceLines.length
    ? `\n【本地参考素材】以下图片已作为真实参考图随请求提交：\n${referenceLines.join('\n')}`
    : '';
  const cleanTitle = String(title || '').trim();
  const titleSection = cleanTitle
    ? `\n【书名艺术字硬性要求】这是最终成品小说封面，必须在画面中直接生成完整中文书名《${cleanTitle}》。书名必须清晰可辨认、文字准确，不得漏字、错字或乱码；使用与题材匹配的高质感中文艺术字或书法标题设计，作为画面主视觉。除完整书名外，不要生成其他无关文字、字母、水印或 logo。`
    : '\n【文字要求】不要生成无法确认的书名、正文、字母、水印或 logo，只保留纯净的封面画面。';
  const storySection = `\n【本次封面题材与故事上下文】题材类型：${cleanGenre}。故事：${storyContext}。请把故事中的主角目标、核心冲突和情绪转译成一眼能看懂的封面画面，不要凭空加入与题材无关的元素。`;
  return `${base}${storySection}${referenceSection}${titleSection}`;
}
