import { readFileSync } from 'node:fs';
// scriptPrompts.js
// 提示词生成函数与常量（从短剧本生成器 aiService.ts 提取，转为纯 ESM JavaScript）
// 注意：所有提示词长文本一字未改，完整保留。

// 默认参数
export const DEFAULT_TEMPERATURE = 0.7;
export const DEFAULT_MAX_TOKENS = 256000;
const P_STORYBOARD_PROMPT_TEMPLATE = readFileSync(new URL('./storyboard-prompts/p.txt', import.meta.url), 'utf8').trim();

const STORYBOARD_PROMPT_TEMPLATES = {
  p: {
    id: 'p',
    name: '金牌分镜导演',
    description: '电影级短视频分镜，严格15秒、帧级承接，并按题材智能选择战斗特效。',
    content: P_STORYBOARD_PROMPT_TEMPLATE,
  },
};

export function listStoryboardPromptTemplates() {
  return Object.values(STORYBOARD_PROMPT_TEMPLATES).map(({ id, name, description }) => ({ id, name, description }));
}

function getStoryboardPromptTemplate(templateId = 'p') {
  return STORYBOARD_PROMPT_TEMPLATES[templateId] || STORYBOARD_PROMPT_TEMPLATES.p;
}

export const ADAPTATION_STRENGTH_LABELS = {
  faithful: '忠实改编',
  enhanced: '强化改编',
  rewrite: '二创重构',
};

export function normalizeAdaptationStrength(value = 'enhanced') {
  const raw = String(value || '').trim();
  if (['faithful', '忠实改编', '忠实'].includes(raw)) return 'faithful';
  if (['rewrite', '大幅重构', '二创重构', '重构', '二创'].includes(raw)) return 'rewrite';
  return 'enhanced';
}

function adaptationStrengthGuide(value = 'enhanced') {
  const strength = normalizeAdaptationStrength(value);
  if (strength === 'faithful') {
    return `改编强度：忠实改编。
- 保持原文事件顺序和人物关系，不新增事件、不改因果。
- 可以压缩铺陈、外化心理、增强镜头感，但不得改变原文核心表达。
- 冷开场只能从已给原文/完整章节参考中提取，不得虚构新事实。`;
  }
  if (strength === 'rewrite') {
    return `改编强度：二创重构。
- 保留原文核心设定、人物逻辑、主要冲突和关键真相。
- 允许重排呈现顺序、前置爆点、合并弱节拍、强化冲突和悬念。
- 不得新增会改变主线走向的大事件、关键人物关系或结局；如补充表达，只能补“情绪、镜头、动作细节”。`;
  }
  return `改编强度：强化改编。
- 保留主线剧情、人物关系、关键事实和关系方向。
- 允许重排呈现顺序、前置钩子、合并弱节拍、强化情绪冲突。
- 不得新增改变原文主线的新事件、新人物关系或新结局；补充内容必须服务于表达，而不是改写事实。`;
}

function scriptAdaptationExecutionGuide(value = 'enhanced') {
  const strength = normalizeAdaptationStrength(value);
  const strengthLabel = ADAPTATION_STRENGTH_LABELS[strength] || ADAPTATION_STRENGTH_LABELS.enhanced;
  if (strength === 'faithful') {
    return `2. 本次改编强度执行规则：${strengthLabel}
你的全部素材来源是用户提供的原文。本档位追求高保真剧本化，核心是"不改事实、不乱加料、完整落地"。

事实红线：
- 不新增原文没有的剧情事件、人物关系、身份背景、因果、道具作用、结局或后续发展。
- 原文没有说过的具体信息，不要借角色台词说出来；已有对白只能口语化润色，不能改变核心意思。
- 原文没有明确心理内容时，不要替角色新增内心独白；只能用动作、表情、沉默、环境意象表现其已发生的情绪。
- 冷开场只能从已给原文或完整章节参考中提取，不得虚构新事实。

允许的表达处理：
- 压缩冗余铺陈、寒暄和重复情绪，但不能删除承载关系、动机、误会、证据、威胁、承诺、交易或转折的信息。
- 将叙述、心理、说明转成可演的动作、神态、道具变化、空间调度、屏幕信息或角色对话。
- 调整呈现顺序时，只能改变观看顺序，不能改变事件本身和因果。`;
  }
  if (strength === 'rewrite') {
    return `2. 本次改编强度执行规则：${strengthLabel}
本档位允许短剧结构重设，但不是脱离原文重写。核心是"保核心、重节奏、强戏剧"。

事实红线：
- 必须保留原文核心设定、主角逻辑、主要冲突、关键真相、关系方向和结局边界。
- 禁止新增会改变主线走向的大事件、关键人物关系、新反派、新金手指、新结局或本集之后的真实后续。
- 所有补充都只能服务已有事实的戏剧化表达，不得让观众获得原文不存在的新事实。

允许的改编权限：
- 可以重排开场顺序、前置爆点、合并弱节拍、压缩低效过渡、重设场次功能。
- 可以基于原文已有冲突补强承压台词、反应台词、过渡动作和情绪动作，但台词不能承载新事实。
- 可以把原文弱表达的情绪升级为更强的可视化表演、视觉反差和镜头调度。
- 如果补充表达，必须能回答：它强化了原文已有冲突，而不是新增了另一条剧情。`;
  }
  return `2. 本次改编强度执行规则：${strengthLabel}
本档位是默认推荐：保留原文主线和人物关系，同时把表达改成更像竖屏短剧。

事实红线：
- 禁止新增改变原文主线的新事件、新人物关系、新设定、新结局或本集之后的后续剧情。
- 禁止把完整章节参考中超出本集正文范围的后续事实写进正文；后续材料只可服务冷开场选爆点。
- 禁止为了爽点改坏人物动机、因果链、关系方向或关键真相。

允许的强化权限：
- 可以前置钩子、重排呈现顺序、合并弱节拍、强化情绪冲突和结尾悬念。
- 可以基于原文已有事实补充短剧化的承压动作、反应镜头、过渡台词、情绪台词和对峙节奏；这些补充不得提供原文没有的新事实。
- 原文心理活动优先转为角色心声、表情动作、物件特写、环境意象或屏幕信息；不要默认使用长篇旁白。
- 原文说明文要转为画面、动作、道具、屏幕信息或角色对话自然带出。`;
}

function shortDramaCoreComboGuide({
  strength = 'enhanced',
  useColdOpen = false,
  usePurification = false,
} = {}) {
  const normalized = normalizeAdaptationStrength(strength);
  if (normalized !== 'enhanced' || !useColdOpen || !usePurification) return '';
  return `2.1 本次开关组合执行规则：短剧强化 + 冷开场 + 精准提纯
本组合目标：逻辑清晰、情绪能被剧情带起来、节奏紧凑，让观众持续追看。

执行优先级：
- 先保因果：人物动机、关系变化、信息揭露、关键证据、冲突后果必须清楚，不能为了快而断逻辑。
- 再强情绪：围绕原文已有冲突放大受辱、误会、危机、反杀预期、关系撕裂、爽点或痛点，让观众有明确情绪入口。
- 最后提密度：删重复表达、低价值铺垫和无信息寒暄；不得删掉支撑共情、理解和情绪递进的内容。

执行方式：
- 冷开场只挑一个最贴题材的微型高潮，3秒内抛出危机、悬念或情绪痛点；冷开场结束后，正文必须回到本集原文起点并完整覆盖。
- 每场戏原则上要有明确戏剧任务：钩子、承压、蓄力、爬升、爆发、余波、转场校准或信息校准均可；避免连续同强度硬炸，要有起伏和落差。
- 精准提纯是“不注水地加速”，不是粗暴压短；该交代的动机、因果、关系和情绪递进，宁可多写半场也不能断。
- 结尾应在覆盖完本集原文后，留下未解决的问题、威胁、关系变化、情绪余波或下一集期待；不能为了硬卡点切断因果。`;
}

function coldOpenGenrePlaybookGuide() {
  return `【冷开场题材玩法表｜先判题材，再选钩子】
冷开场不是通用狗血台词库，必须匹配本书题材、受众情绪和原文核心卖点。先从蓝图/原文判断主类型，再选择一个最强钩子，不要把多个题材套路硬堆在一起。

1. 玄幻 / 修仙 / 升级 / 系统
- 观众情绪：受辱后的逆袭期待、越阶反杀爽感、金手指觉醒震撼。
- 首选钩子：宗门审判、擂台羞辱、灵根/天赋被否定、濒死觉醒、系统/传承突然响应、强敌压境。
- 画面抓手：跪地少年 vs 高台众人、灵光炸裂、血滴入古物、系统面板一闪、全场静默后的反应特写。
- 禁忌：不要凭空发明新功法、新师门、新敌人；觉醒必须来自原文已有设定、道具、血脉、系统或后文参考。

2. 都市战神 / 赘婿 / 神豪 / 商战
- 观众情绪：隐藏身份反差、公开打脸、冷静压制。
- 首选钩子：被当众羞辱、合同/宴会/家族会议压迫、身份令牌/电话/车队/后台势力揭露、对方靠山反被压住。
- 画面抓手：破旧衣着 vs 奢华空间、低头受辱 vs 一通电话全场变色、冷脸沉默、反派笑容凝固。
- 禁忌：身份揭露只能揭到原文已给或冷开场参考允许的层级，不要提前透完全书最大底牌。

3. 女频豪门 / 追妻火葬场 / 真假千金 / 替嫁契约
- 观众情绪：心疼、误会、偏爱错位、离开决断、迟来的真相。
- 首选钩子：当众偏袒、婚礼/宴会羞辱、替身真相、亲情背刺、女主沉默离开、男主第一次失控。
- 画面抓手：冷暖光对撞、雨夜背影、戒指/离婚协议/亲子鉴定、眼泪忍住不落、男主伸手落空。
- 禁忌：不要为了虐而改坏角色关系方向；不提前写原文没有揭开的亲子/怀孕/替身真相。

4. 重生复仇 / 穿书系统 / 女强
- 观众情绪：带着记忆回来的掌控感、设局反杀、预知爽点。
- 首选钩子：前世死亡一瞬、睁眼回到关键节点、仇人重复旧招、女主反手设局、系统任务/惩罚倒计时。
- 画面抓手：血色闪回、瞳孔骤缩、旧物触发记忆、倒计时UI、女主冷笑和仇人错愕。
- 禁忌：前世信息必须来自原文已交代；系统只在原文明确有系统/任务/规则时使用。

5. 古言宅斗 / 宫斗 / 权谋
- 观众情绪：礼法压迫、阶级羞辱、证据反转、步步为营。
- 首选钩子：祠堂/宫宴/公堂问罪、嫡庶压制、圣旨/家法/毒证、跪地受审、证人倒戈。
- 画面抓手：屏风烛影、跪垫、凤冠/令牌/药碗、众人俯视、袖中证据露出一角。
- 禁忌：礼法、官职、身份不要乱加；反转证据必须与原文已有线索相关。

6. 兽世 / 异族 / 末世 / 悬疑灵异
- 观众情绪：生存危机、规则压迫、未知恐惧、资源背叛。
- 首选钩子：部落审判、求偶/契约印记、寒季/尸潮/禁忌规则、队友背叛、门外异响、倒计时危机。
- 画面抓手：兽印发烫、雪夜火堆熄灭、废墟尘光、门缝黑影、资源袋被抢、规则UI短暂闪烁。
- 禁忌：不要把恋爱误会写成都市豪门套路；优先把抽象关系转成外部生存危机。

7. 校园 / 年代 / 种田 / 娱乐圈
- 观众情绪：小环境里的公开羞辱、逆袭证明、身份反差、事业翻盘。
- 首选钩子：课堂/舞台/片场/村会公开质疑、成绩/票据/合同/粮食危机、镜头前翻车、主角当众证明。
- 画面抓手：黑板成绩、旧票据、聚光灯、土灶烟火、众人围观、主角抬眼反击。
- 禁忌：不要强行升级到豪门战神或玄幻觉醒，保持题材生活质感。`;
}

function internalVoiceLabelGuide() {
  return `【心声与信息标签规范｜替代传统旁白】
目标：不用长篇旁白硬解释，把心理、规则、设定和钩子变成可听、可画、可分镜的信息。

统一标签：
- 角色名（心声）：角色未开口的私密想法、恐惧、判断、选择、忍耐、预感。下游分镜等同于 OS，角色嘴部必须闭合或没有开口动作。
- 【脑海传音】：修仙、契约、精神力、远程传音、师徒/灵宠/神器等剧情内声音。
- 【烙印回响】：契约印记、兽印、血脉、诅咒、前世执念等从身体或灵魂里响起的声音。
- 【系统提示】：只有原文明确存在系统、任务、面板、数值、规则、游戏化提示时使用；它是剧情内 UI/电子音，不是解释旁白。
- 【屏幕大字】：冷开场钩子、身份揭示、危险警告、章节式标题、极短信息点；必须短、狠、可视化，不要写成长句说明。
- 【黑幕字幕】：只用于时间/地点转换或冷开场过渡，不当作旁白朗读。
- 画外音：只用于广播、新闻、电话、门外议论、回忆声、未入镜角色声音等有明确声音来源的内容。

使用规则：
- 心声必须短，优先一到两句，贴着角色当下动作或选择写；不要写成全知视角剧情梗概。
- 能用表情、动作、道具、光影、反应镜头表现的信息，优先不用心声。
- 重要设定不要整段塞进心声；拆成道具焦点、角色追问、屏幕信息、系统提示或冲突对白。
- 不要使用“旁白：”作为默认标签；除非用户明确要求旁白或原文存在明确叙述声。
- 不要使用“心神”作为脚本标签；“心神一震/心神不宁”只能写在动作或状态描述里。
- 屏幕大字不是字幕台词，不要让角色朗读；分镜时应转成画面信息或转场。

格式示例：
角色A（心声）：不能慌。他还没发现那枚令牌。
【系统提示】：支线任务触发。
【屏幕大字】：三年前，雨夜。
【脑海传音】：别回头。`;
}

function scriptQualityHardRules() {
  return `【短剧剧本硬规则｜清逻辑、快节奏、强情绪】
最高目标：因果清楚 > 情绪带动 > 节奏密度 > 文采。观众必须一眼看懂：谁想要什么、谁阻止、冲突如何升级、这一场结束后局面发生了什么变化。
执行总控：先保因果，再拉情绪，最后提密度。快节奏只压缩表达，不跳过动机、证据、关系变化和冲突后果；强情绪必须由剧情动作带起，不靠空喊"很爽/很虐/很燃"。
剧情可读底线：任何改编、压缩、前置钩子和结尾卡点，都不能牺牲前因后果。人物为什么这样做、信息从哪里来、关系为什么变化、冲突造成什么后果，必须交代清楚，不能出现剧情断裂、空间断层、动机断层或情绪断层。
因果桥硬检查：凡是出现转场、跳时、关系转向、误会升级、真相揭露、反击、牺牲、交易、承诺、背叛、受伤、获利或失去，都必须让观众知道"上一个状态是什么 -> 谁做了什么 -> 为什么会这样 -> 造成了什么新状态"。如果缺少其中任一环，先补清因果，再追求节奏和爆点。

分级覆盖原文：
- A类必须完整落地：主线事件、人物动机、关系变化、关键证据、关键对白/OS、身份信息、承诺/威胁/交易、冲突结果。
- B类压缩转化：重复情绪、环境铺陈、解释性心理，改成动作、表情、道具、短心声或一句有效对白。
- C类可以删除：无信息寒暄、同义反复、不会影响人物理解和后续因果的注水说明。
- D类合并带过：只起承接作用的移动、等待、简单过渡，并入相邻场景一句交代。

每场戏的因果链门槛：
- 每场戏原则上应有存在理由：产生新信息、推进冲突、改变关系、触发选择、完成情绪升级、承接余波、转场校准、埋下或回收伏笔。
- 每场戏必须标定一个主功能：钩子、承压、蓄力、爬升、爆发、余波、转向、信息校准、伏笔/回收。不要让多场戏承担同一种低效铺垫功能。
- 每场戏内部要尽量形成"入口问题 -> 角色动作 -> 阻碍/冲突 -> 结果/新问题"。如果既不推进剧情，也不改变关系，也不带出信息，也不承接情绪，就应合并、压缩或删除。
- 快节奏不是跳剧情，而是晚进早出、减少无效解释，让台词和动作尽量承担信息、态度、关系、情绪或转场功能。

情绪带动门槛：
- 每集应明确主情绪方向：爽、虐、甜、燃、心疼、解气、期待、恐惧或反差震惊。
- 每集必须明确观众情绪收益：观众具体爽在哪里、疼在哪里、甜在哪里、解气在哪里、期待下一集在哪里；如果说不清收益，本集爆点就不成立。
- 每集必须形成可感知情绪曲线：初始情绪 -> 加压点 -> 反转/选择 -> 高潮爆点 -> 余味/追看理由。
- 不要直接写"某类情绪会自动成立"这种判断，必须落到剧情动作：谁被误解、谁付出代价、谁做出选择、谁掌握信息差、谁的关系发生变化、谁在爆点后承受结果。
- 强情绪点必须有铺垫、加压、爆发和余味，不能只堆狠话、惨叫或夸张形容词。
- 爆点之后必须给反应镜头或后果落地，让观众感到"这件事改变了局面"。

输出前隐式自检（不要写进成稿）：
- A类主线事件、动机、关系变化、证据、关键对白/OS、承诺/威胁/交易、冲突结果是否全部落地。
- 每次转场、跳时、误会升级、真相揭露、反击或关系变化是否都有因果桥。
- 每场戏是否有主功能，是否形成入口问题、角色动作、阻碍/冲突、结果/新问题。
- 本集情绪收益是否具体，高潮前是否有加压，高潮后是否有反应或后果。
- 结尾是否留下清楚的追看理由，而不是靠故意省略该交代的信息制造混乱。`;
}

function shortDramaRhythmGuide() {
  return `【短剧节奏控制｜灵活执行，不机械套模板】
核心：短剧节奏不是每场都爆、每句都短、每集都硬卡，而是让观众持续知道"发生了什么、为什么发生、接下来想看什么"。

单集节奏建议：
- 开头尽量快速给出画面钩子、冲突、反常信息、危险或强情绪入口。
- 前段尽快立清当前局面和核心矛盾，不要让观众猜人物关系和事件起因。
- 中段通过加压、选择、误会、信息差、反击或揭示推动情绪上升。
- 后段完成本集主要变化：局面改变、关系改变、秘密推进、危机升级或目标转向。
- 结尾留下追看动力，但形式必须服务剧情阶段。
- 每一次提速都要保留因果桥：谁知道了什么、为什么选择这样做、这个选择让局面发生了什么变化。

场次功能建议：
- 每场戏原则上应承担至少一个戏剧任务：钩子、压迫、误会、选择、反击、揭示、关系变化、伏笔、余波、转场、情绪沉淀、信息校准、卡点。
- 过渡、停顿、氛围和余波可以存在，但必须帮助观众理解前因后果、人物状态或下一步行动。
- 没有存在理由的场，直接合并、压缩或删除。

对白节奏建议：
- 不按固定字数限制对白。普通推进对白要简洁，避免绕；冲突对白优先短句、反问、压迫感。
- 情绪爆发、真相揭露、告别、决裂、关键选择等场景允许较长台词，但必须带来信息、态度、关系或情绪变化。
- 解释信息不要连续堆太久，尽量夹在动作、冲突、追问或人物反应里。

结尾处理建议：
- 结尾要有追看理由，不一定非要硬卡。
- 冲突未完：可用悬念卡点。情绪爆发后：可用余波和关系变化。阶段收束：可用新目标、新代价或新期待。真相推进：只揭必要一层，不机械藏信息。
- 如果结尾停在动作或真相前，必须已经交代清楚停在这里的前因；不能为了下一集期待故意省掉本集应该讲明的动机、证据或冲突后果。
- 可用方式包括但不限于：新危机出现、关键选择被迫发生、关系变化、证据/线索出现、误会加深、真相推进但不完全揭开、反击即将发生、旧伏笔被重新点亮、人物态度突然变化、情绪余波未落、场景切到新的危险或机会。`;
}

export function generateCustomEpisodeScriptPrompt({
  novelContent,
  episodePlan = {},
  previousEpisodesSummary = '',
  priorArcSummary = '',
  customPrompt = '',
  requirement = '',
  isFirstEpisode = false,
} = {}) {
  const custom = String(customPrompt || '').trim();
  const extra = String(requirement || '').trim();
  const source = String(novelContent || '').trim();
  const keyScenes = Array.isArray(episodePlan.keyScenes) ? episodePlan.keyScenes.join('、') : '';
  const systemPrompt = `你正在执行用户自定义剧本提示词。

【执行原则】
- 用户自定义剧本提示词是唯一创作规则，必须完全按照它执行。
- 不要套用内置冷开场、精准提纯、质量审稿或默认短剧模板。
- 除非自定义提示词明确要求，否则不要输出分析、解释、Markdown 标题或额外说明，直接输出生成结果。
- 如果自定义提示词与下方素材信息冲突，以自定义提示词为准；素材信息只用于让你知道本次要处理的原文范围。

【用户自定义剧本提示词】
${custom}`;

  const userPrompt = `请根据上方自定义剧本提示词处理下面材料。

【集信息】
- 集号：${episodePlan.episodeNumber || ''}
- 标题：${episodePlan.title || ''}
- 是否全书第一集：${isFirstEpisode ? '是' : '否'}
- 改编范围：${episodePlan.startIndex ?? ''}-${episodePlan.endIndex ?? ''}
- 关键场景：${keyScenes}
- 规划钩子：${episodePlan.cliffhanger || ''}

${priorArcSummary ? `【前情脉络】\n${priorArcSummary}\n\n` : ''}${previousEpisodesSummary ? `【上一集结尾】\n${previousEpisodesSummary}\n\n` : ''}${extra ? `【额外要求】\n${extra}\n\n` : ''}【本集原文】
${source}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateWholeNovelDigestPrompt({
  sourceText,
  chunkIndex = 0,
  chunkTotal = 1,
  rangeLabel = '',
} = {}) {
  const source = String(sourceText || '').trim();
  return [
    {
      role: 'system',
      content: `你是整本小说改编前置阅读员。你的任务不是写剧本，而是通读当前分块，提取供整本短剧改编使用的结构化信息。

要求：
1. 只基于当前分块内容，不编造后文。
2. 抓主线、人物、关系、设定、伏笔、反转、强情绪段落和名场面。
3. 标出后续改编必须保留的因果、秘密、误会、证据、承诺、威胁、交易和关系变化。
4. 单独整理因果连续台账：起因、角色动作、结果、后续影响、原文锚点都要尽量清楚。
5. 只输出 JSON，不要 Markdown，不要解释。`,
    },
    {
      role: 'user',
      content: `请阅读整本小说的第 ${chunkIndex + 1}/${chunkTotal} 个分块，提取改编资料。

【分块范围】
${rangeLabel || `第 ${chunkIndex + 1}/${chunkTotal} 块`}

【小说分块原文】
${source}

JSON 格式：
{
  "range": "当前分块范围",
  "summary": "本分块剧情摘要",
  "mainEvents": ["主线事件"],
  "characters": [
    {
      "name": "人物名",
      "identity": "身份",
      "goal": "当前目标",
      "relationshipChanges": ["关系变化"],
      "knownSecrets": ["已揭示秘密"],
      "unknownSecrets": ["仍未揭示秘密"]
    }
  ],
  "worldRules": ["世界观/系统/规则/势力设定"],
  "causalContinuityLedger": [
    {
      "cause": "事件起因/前置状态",
      "characterAction": "角色做了什么",
      "result": "直接结果",
      "laterImpact": "对后续关系/冲突/伏笔的影响",
      "sourceAnchor": "原文锚点短句"
    }
  ],
  "foreshadowing": [
    {
      "setup": "伏笔或线索",
      "possiblePayoff": "可能回收方向",
      "sourceAnchor": "原文锚点短句"
    }
  ],
  "emotionBeats": [
    {
      "emotion": "爽/虐/甜/燃/心疼/解气/期待/恐惧/反差震惊",
      "cause": "情绪由什么剧情带起",
      "scene": "对应场面"
    }
  ],
  "mustKeepScenes": ["必须保留的名场面"],
  "adaptationWarnings": ["改编时不能改坏的因果/人设/关系"]
}`,
    },
  ];
}

export function generateWholeNovelBiblePrompt({ digests = [], chapterIndex = [] } = {}) {
  const digestText = Array.isArray(digests)
    ? digests.map((item, index) => `【分块${index + 1}】\n${typeof item === 'string' ? item : JSON.stringify(item, null, 2)}`).join('\n\n')
    : String(digests || '').trim();
  const chapterText = Array.isArray(chapterIndex)
    ? chapterIndex.map((chapter) => `${chapter.order ?? ''}. ${chapter.title || ''}（${chapter.length || 0}字）`).join('\n')
    : '';
  return [
    {
      role: 'system',
      content: `你是整本小说改编总策划。你已经拿到分块阅读笔记，现在要合并成一份供后续全书分集和逐集剧本生成使用的【全书故事圣经】。

目标：
1. 建立全书级理解，而不是只总结局部剧情。
2. 明确主线、人物弧光、关系线、伏笔回收、强情绪节点和名场面。
3. 给后续分集规划提供全局节奏原则，避免前期乱放后期爆点、误解人物关系或漏埋伏笔。
4. 合并出全书因果连续台账，保证后续拆集不会切断人物动机、信息来源、关系变化和冲突后果。
5. 只输出 JSON，不要 Markdown，不要解释。`,
    },
    {
      role: 'user',
      content: `请把下面的分块阅读笔记合并成全书故事圣经。

【章节索引】
${chapterText || '无'}

【分块阅读笔记】
${digestText}

JSON 格式：
{
  "logline": "全书一句话主线",
  "genre": {
    "primary": "主类型",
    "secondary": "副类型",
    "audience": "目标受众",
    "coreAppeal": "核心看点"
  },
  "mainStory": {
    "openingSituation": "开局局面",
    "centralConflict": "核心矛盾",
    "majorTurns": ["主要转折"],
    "finalDirection": "后期/结局方向"
  },
  "characters": [
    {
      "name": "人物名",
      "identity": "身份",
      "desire": "核心欲望",
      "arc": "人物弧光",
      "relationships": ["关键关系"],
      "secrets": ["秘密/误会/隐藏信息"],
      "doNotBreak": ["不能改坏的人物逻辑"]
    }
  ],
  "characterLedger": [
    {
      "name": "人物名",
      "identity": "身份",
      "firstAppearance": "首次出现位置",
      "camp": "阵营/立场",
      "relationshipToProtagonist": "与主角关系",
      "currentGoal": "当前/长期目标",
      "knownSecrets": ["已知秘密"],
      "unrevealedSecrets": ["未揭秘密"],
      "relationshipChangeNodes": ["关系变化节点"],
      "doNotBreak": ["不可改动的人设逻辑"]
    }
  ],
  "worldRules": ["世界观/系统/势力/规则"],
  "relationshipLines": ["感情线/敌对线/师徒线/家族线等"],
  "causalContinuityLedger": [
    {
      "arcOrRange": "篇章/章节范围",
      "cause": "事件起因/前置状态",
      "characterAction": "关键角色动作或选择",
      "result": "直接结果",
      "laterImpact": "对后续剧情、关系或伏笔的影响",
      "doNotCut": "改编时不能切断或省略的因果环节"
    }
  ],
  "foreshadowingLedger": [
    {
      "setup": "伏笔/真相/反转线索",
      "firstAppearance": "首次出现位置或锚点",
      "misdirection": "误导方向",
      "trueMeaning": "真实含义",
      "payoffPosition": "回收位置",
      "canRevealEarly": "前期能透露什么",
      "mustHideUntil": "必须隐藏到什么时候",
      "placementAdvice": "前期如何埋，不要提前剧透什么"
    }
  ],
  "emotionCurve": ["全书情绪推进"],
  "keyScenes": ["必须保留或前置利用的名场面"],
  "adaptationStrategy": {
    "episodeRhythm": "分集节奏原则",
    "openingStrategy": "前几集开局策略",
    "cliffhangerStrategy": "结尾钩子策略",
    "compressionRules": ["哪些内容可压缩"],
    "riskBoundaries": ["不能改动/不能提前透露的内容"]
  },
  "continuityRules": ["逐集生成必须遵守的连续性规则"]
}`,
    },
  ];
}

export function generateWholeNovelStageBiblePrompt({
  digests = [],
  stageIndex = 0,
  stageTotal = 1,
  rangeLabel = '',
} = {}) {
  const digestText = Array.isArray(digests)
    ? digests.map((item, index) => `【分块${index + 1}】\n${typeof item === 'string' ? item : JSON.stringify(item, null, 2)}`).join('\n\n')
    : String(digests || '').trim();
  return [
    {
      role: 'system',
      content: `你是长篇小说改编的阶段主编。你要把若干分块阅读笔记合并成一个【阶段圣经】。

目标：
1. 这一层不是最终全书总结，而是保护长篇信息，避免 50w/100w 字小说在一次总合并时被压缩丢失。
2. 必须单独维护人物关系台账、伏笔/真相/反转台账、阶段情绪曲线和阶段名场面。
3. 必须单独维护阶段因果连续台账，记录每条关键因果的起因、角色动作、结果和后续影响。
4. 只输出 JSON，不要 Markdown，不要解释。`,
    },
    {
      role: 'user',
      content: `请把下面分块笔记合并成第 ${stageIndex + 1}/${stageTotal} 个阶段圣经。

【阶段范围】
${rangeLabel || `阶段 ${stageIndex + 1}/${stageTotal}`}

【分块阅读笔记】
${digestText}

JSON 格式：
{
  "stage": "${stageIndex + 1}/${stageTotal}",
  "range": "阶段范围",
  "stageSummary": "阶段剧情摘要",
  "mainConflict": "本阶段核心冲突",
  "causalContinuityLedger": [
    {
      "cause": "事件起因/前置状态",
      "characterAction": "角色做了什么/做出什么选择",
      "result": "直接结果",
      "laterImpact": "对后续剧情、关系或伏笔的影响",
      "sourceAnchor": "原文/分块锚点"
    }
  ],
  "characterLedger": [
    {
      "name": "人物名",
      "identity": "身份",
      "firstSeenHere": "是否本阶段首次出现/首次重要出场",
      "camp": "阵营/立场",
      "relationshipToProtagonist": "与主角关系",
      "knownSecrets": ["已知秘密"],
      "unrevealedSecrets": ["未揭秘密"],
      "relationshipChangeNodes": ["关系变化节点"],
      "doNotBreak": ["不可改动的人设逻辑"]
    }
  ],
  "foreshadowingLedger": [
    {
      "setup": "伏笔/真相/反转线索",
      "firstAppearance": "首次出现位置或锚点",
      "misdirection": "误导方向",
      "trueMeaning": "真实含义",
      "payoffPosition": "本阶段回收/后续回收位置",
      "canRevealEarly": "前期能透露什么",
      "mustHideUntil": "必须隐藏到什么时候"
    }
  ],
  "emotionCurve": [
    {
      "emotion": "爽/虐/甜/燃/心疼/解气/期待/恐惧/反差震惊",
      "plotAction": "由什么具体剧情动作带起",
      "peakScene": "情绪峰值场面"
    }
  ],
  "mustKeepScenes": ["阶段名场面"],
  "adaptationNotes": ["本阶段改编注意事项"]
}`,
    },
  ];
}

export function generateWholeNovelSeriesPlanPrompt({
  wholeNovelBible = '',
  stageBibles = [],
  chapterIndex = [],
} = {}) {
  const bibleText = typeof wholeNovelBible === 'string' ? wholeNovelBible : JSON.stringify(wholeNovelBible || {}, null, 2);
  const stageText = Array.isArray(stageBibles)
    ? stageBibles.map((item, index) => `【阶段圣经${index + 1}】\n${typeof item === 'string' ? item : JSON.stringify(item, null, 2)}`).join('\n\n')
    : String(stageBibles || '').trim();
  const chapterText = Array.isArray(chapterIndex)
    ? chapterIndex.map((chapter, index) => `${index + 1}. 章节ID=${chapter.id}｜${chapter.title || ''}（${chapter.length || 0}字）`).join('\n')
    : '';
  return [
    {
      role: 'system',
      content: `你是整本小说短剧改编的总策划。你现在只做【全剧阶段规划】，不要在这一层生成逐集列表。

目标：
1. 根据全书主线、人物弧光、关系线、伏笔和情绪升级，把全书划分成若干连续改编阶段。
2. 每个阶段必须使用明确的 startChapterId / endChapterId，完整、连续、无重叠地覆盖章节索引中的全部章节ID。
3. 阶段边界优先落在目标变化、地图变化、关系变化、主要对手变化、真相层级变化或阶段高潮之后。
4. 只制定全局策略和阶段策略；不要输出 episodePlan、chapterGuides 或逐集标题。
5. 不得提前揭露故事圣经中要求隐藏的真相。
6. 只输出严格 JSON，不要 Markdown、解释或寒暄。`,
    },
    {
      role: 'user',
      content: `请基于以下资料生成全剧阶段规划。

【章节索引｜阶段范围必须使用这里的章节ID】
${chapterText || '无'}

【全书故事圣经】
${bibleText}

【阶段圣经】
${stageText || '无'}

JSON 格式：
{
  "seriesStrategy": {
    "recommendedEpisodeRange": "建议总集数区间及理由，不要在这里展开逐集",
    "openingStrategy": "前期如何建立卖点、规则和关系",
    "middleStrategy": "中段如何升级冲突、关系和代价",
    "lateStrategy": "后段如何逼近真相和回收伏笔",
    "continuityRules": ["全剧连续性红线"],
    "compressionRules": ["可压缩内容"],
    "doNotRevealEarly": ["不能提前揭露的真相"]
  },
  "arcPlan": [
    {
      "arcId": "ARC-01",
      "arcName": "阶段名",
      "startChapterId": 1,
      "endChapterId": 8,
      "dramaticFunction": "本阶段在全剧中的功能",
      "coreConflict": "阶段核心冲突",
      "emotionDrive": "由哪些具体剧情动作推动情绪",
      "mustKeep": ["阶段必须保留的事件/名场面"],
      "doNotReveal": ["本阶段不能提前揭露的内容"],
      "endingTarget": "阶段结束时人物、关系和局面应到达的状态"
    }
  ]
}`,
    },
  ];
}

export function generateArcEpisodeBatchPrompt({
  wholeNovelBible = '',
  seriesPlan = {},
  arc = {},
  sourceBeatCatalog = '',
  batchIndex = 0,
  batchTotal = 1,
  startEpisodeNumber = 1,
  previousBatchSummary = '',
} = {}) {
  const bibleText = typeof wholeNovelBible === 'string' ? wholeNovelBible : JSON.stringify(wholeNovelBible || {}, null, 2);
  const seriesText = typeof seriesPlan === 'string' ? seriesPlan : JSON.stringify(seriesPlan || {}, null, 2);
  const arcText = typeof arc === 'string' ? arc : JSON.stringify(arc || {}, null, 2);
  return [
    {
      role: 'system',
      content: `你是竖屏短剧的分集规划师。你正在为一个已确定的阶段，按批次规划具体剧集。

最高规则：
1. 【素材ID是唯一事实坐标】。只能使用用户提供的 sourceBeatIds，不得编造ID，不得用概括性短句代替ID。
2. 当前批次提供的每一个素材ID必须且只能分配给一集；不得遗漏、不得重复、不得打乱原文顺序。
3. 不允许设置 skippedBeats。即使某段是铺垫或注水，也要归入某一集，由后续剧本按A/B/C/D规则压缩处理。
4. 一集可以包含多个连续素材ID，但不能从后面的ID跳回前面的ID。
5. 分集依据是剧情目标、因果完整度、情绪收益和追看动力，不按固定字数或固定素材数量机械切分。
6. 不要把人物动机、信息来源、关系变化、关键证据、冲突后果切断到看不懂。
7. endingHook 必须写清类型和内容。类型可为：悬念、关系变化、情绪余波、新目标、新代价、新机会、真相推进。
8. 只输出严格 JSON，不要 Markdown、解释或寒暄。`,
    },
    {
      role: 'user',
      content: `请规划阶段「${arc?.arcName || arc?.arcId || '未命名阶段'}」的第 ${batchIndex + 1}/${batchTotal} 个素材批次，从第 ${startEpisodeNumber} 集开始编号。

【全剧总策略】
${seriesText}

【当前阶段】
${arcText}

【全书故事圣经｜只用于人物、伏笔和真相边界】
${bibleText}

${previousBatchSummary ? `【上一批次结尾状态】\n${previousBatchSummary}\n\n` : ''}【当前批次素材目录｜每个ID必须且只能出现一次】
${sourceBeatCatalog}

JSON 格式：
{
  "episodes": [
    {
      "episodeNumber": ${startEpisodeNumber},
      "title": "第${startEpisodeNumber}集 标题",
      "sourceBeatIds": ["CH1-B0001", "CH1-B0002"],
      "plotGoal": "本集结束后局面发生什么变化",
      "keyScenes": ["必须保留或重点表现的场面"],
      "compression": "哪些素材只压缩表达，不删除关键事实",
      "mustExplain": ["本集必须讲清楚的前因后果"],
      "causalBridge": ["上一状态 -> 角色动作 -> 原因 -> 新状态"],
      "emotionAction": "观众情绪由什么具体剧情动作带起",
      "revealNow": ["本集允许揭露的信息层级"],
      "hideUntilLater": ["仍需隐藏的真相"],
      "endingHook": {
        "type": "悬念/关系变化/情绪余波/新目标/新代价/新机会/真相推进",
        "content": "本集具体追看动力"
      }
    }
  ]
}`,
    },
  ];
}

export function generateWholeEpisodeReviewPrompt({
  sourceText = '',
  scriptText = '',
  episodePlan = {},
  priorState = {},
  globalContext = '',
} = {}) {
  return [
    {
      role: 'system',
      content: `你是完整单集短剧的终审编辑。当前剧本可能由多个分段拼接而成，你要检查分段级审稿看不到的整集问题。

终审范围：
1. 是否重复改编同一事件、重复解释同一信息或重复进入同一场景。
2. 分段衔接是否存在人物瞬移、时间断层、空间断层、状态回退、称呼变化或道具归属冲突。
3. 本集 plotGoal、情绪曲线、高潮后果和 endingHook 是否真正执行。
4. 对照本集全部原文，检查会影响理解的A类事实、因果、关系变化、关键证据和冲突结果是否被遗漏或在拼接/修订中丢失。
5. 是否出现原文没有的新事实、新关系、新证据、新结果或提前泄露的后文真相。
6. 场次编号、结束标记、心声/系统提示/屏幕大字等格式是否一致。
7. 根据 priorState 和本集实际剧情，生成精简 stateAfter，供下一集使用。
8. 只输出严格 JSON，不要 Markdown、解释或剧本文本。`,
    },
    {
      role: 'user',
      content: `请终审下面这一个完整单集。

【全局约束】
${globalContext || '无'}

【本集规划】
${JSON.stringify(episodePlan || {}, null, 2)}

【上一集结束后的连续性状态】
${JSON.stringify(priorState || {}, null, 2)}

【本集全部原文】
${String(sourceText || '').trim()}

【拼接后的完整剧本】
${String(scriptText || '').trim()}

JSON 格式：
{
  "ok": true,
  "summary": "一句话终审结论",
  "issues": [
    {
      "type": "重复/连续性/因果/人物状态/道具/格式/结尾钩子/新增事实/提前剧透",
      "location": "第X场或具体位置",
      "issue": "问题",
      "fix": "修复目标"
    }
  ],
  "stateAfter": {
    "timeLocation": "本集结束时间和地点",
    "characters": [
      {
        "name": "人物名",
        "status": "本集结束状态/伤势/处境",
        "goal": "下一步目标",
        "location": "所在位置",
        "knownFacts": ["此时已经知道的关键信息"]
      }
    ],
    "relationships": [
      {
        "pair": "人物A-人物B",
        "status": "当前关系",
        "change": "本集关系变化"
      }
    ],
    "props": [
      {
        "name": "关键道具",
        "holder": "持有者/所在位置",
        "state": "当前状态"
      }
    ],
    "revealedFacts": ["本集已揭露事实"],
    "unresolvedThreads": ["下一集仍未解决的问题"]
  }
}`,
    },
  ];
}

export function generateWholeEpisodeRepairPrompt({
  sourceText = '',
  scriptText = '',
  episodePlan = {},
  priorState = {},
  issues = [],
} = {}) {
  return [
    {
      role: 'system',
      content: `你是完整单集短剧修订编辑。请只修复终审指出的问题，同时保护原文覆盖、人物逻辑、因果链和已有正确内容。

硬规则：
1. 输出完整修订后的单集剧本，不输出分析、JSON、Markdown标题或说明。
2. 不新增原文没有的新事件、新关系、新证据、新结果和后续发展。
3. 修订后仍必须完整保留本集原文中会影响理解的A类事实、因果桥、关系变化、关键证据与冲突结果；不得为了去重或加快节奏而误删。
4. 删除跨分段重复，修复时间、空间、人物状态、称呼和道具连续性。
5. 必须执行本集 plotGoal 和 endingHook，但不能为了钩子提前停笔或跳过原文最后的关键事件。
6. 不输出【本集完】或【本集完 - 留悬念】，结束标记由系统追加。`,
    },
    {
      role: 'user',
      content: `请修订下面完整单集。

【本集规划】
${JSON.stringify(episodePlan || {}, null, 2)}

【上一集结束状态】
${JSON.stringify(priorState || {}, null, 2)}

【终审问题】
${JSON.stringify(issues || [], null, 2)}

【本集全部原文】
${String(sourceText || '').trim()}

【当前完整剧本】
${String(scriptText || '').trim()}`,
    },
  ];
}

export function generateWholeNovelEpisodePlanPrompt({
  wholeNovelBible = '',
  stageBibles = [],
  chapterIndex = [],
} = {}) {
  const bibleText = typeof wholeNovelBible === 'string' ? wholeNovelBible : JSON.stringify(wholeNovelBible || {}, null, 2);
  const stageText = Array.isArray(stageBibles)
    ? stageBibles.map((item, index) => `【阶段圣经${index + 1}】\n${typeof item === 'string' ? item : JSON.stringify(item, null, 2)}`).join('\n\n')
    : String(stageBibles || '').trim();
  const chapterText = Array.isArray(chapterIndex)
    ? chapterIndex.map((chapter) => `${chapter.order ?? ''}. ${chapter.title || ''}（${chapter.length || 0}字）`).join('\n')
    : '';
  return [
    {
      role: 'system',
      content: `你是整本小说短剧改编总规划师。你已经拥有全书故事圣经和阶段圣经，现在要做【全剧集总规划】。

要求：
1. 不要逐章机械切片，要先把全书分成短剧阶段/篇章。
2. 规划每个阶段承担的剧情功能、情绪推进、伏笔隐藏和回收策略。
3. 直接判断整本小说适合改成多少集，并给出每一集的取材范围；集数由剧情密度、爆点、因果完整度和短剧追看节奏决定，不由章节数或字数机械决定。
4. 情绪必须由剧情动作带起，禁止空写抽象情绪判断。
5. 节奏要短剧化但不能机械：开局抓人、中段加压、后段有变化、结尾有追看动力；不要固定每集必须套某一种卡点。
6. 全剧规划必须保护因果可读性：人物动机、信息来源、关系变化、冲突后果、伏笔埋收不能在分集时断裂断层。
7. 每集可以跨章节，也可以只取某章的一小段；可以合并低价值章节、压缩过渡、跳过注水、单独放大爆点。必须在 sourceRanges 里说明每集吃哪些原文范围。
8. 只输出 JSON，不要 Markdown，不要解释。

${shortDramaRhythmGuide()}`,
    },
    {
      role: 'user',
      content: `请基于以下资料生成全剧集总规划。

【章节索引】
${chapterText || '无'}

【全书故事圣经】
${bibleText}

【阶段圣经】
${stageText || '无'}

JSON 格式：
{
  "seriesStrategy": {
    "totalEpisodes": "整本小说建议改编总集数，数字",
    "episodeCountReason": "为什么是这个集数：按主线阶段、爆点密度、因果容量和短剧节奏说明，不按章节数机械说明",
    "openingEpisodes": "前几集如何开局、埋什么、不能提前透什么",
    "middleEpisodes": "中段如何升级冲突和关系",
    "lateEpisodes": "后段如何逼近真相和回收伏笔",
    "cliffhangerRules": ["结尾追看动力规则，不机械套固定卡点"],
    "continuityRules": ["整本改编时必须持续保护的前因后果、人物动机、信息来源和关系变化"],
    "compressionRules": ["全书层面可压缩内容"],
    "doNotRevealEarly": ["绝不能提前透露的真相"]
  },
  "arcPlan": [
    {
      "arcName": "阶段/篇章名",
      "chapterRange": "大致章节范围",
      "dramaticFunction": "本阶段在全剧中的功能",
      "coreConflict": "核心冲突",
      "emotionDrive": "情绪如何由剧情带起来",
      "rhythmAdvice": "本阶段短剧节奏建议：哪里快、哪里留白、哪里收束",
      "causalContinuity": "本阶段必须讲清楚的前因后果和状态变化",
      "mustKeepScenes": ["必须保留名场面"],
      "foreshadowingTasks": ["要埋/要藏/要回收的伏笔"],
      "endingTarget": "阶段结尾应停在什么局面"
    }
  ],
  "episodePlan": [
    {
      "episodeNumber": 1,
      "title": "第1集 标题",
      "sourceRanges": [
        {
          "chapterOrder": 1,
          "chapterTitle": "对应原文章节标题",
          "startText": "本集取材起点附近原文短句；若从章首开始可留空",
          "endText": "本集取材终点附近原文短句；若到章尾结束可留空",
          "treatment": "保留/压缩/合并/跳过铺垫后承接/放大爆点",
          "reason": "为什么这段归入本集"
        }
      ],
      "plotGoal": "本集剧情目标：这集看完局面发生什么变化",
      "keyScenes": ["本集关键场面"],
      "compression": "本集哪里合并、删减或压缩",
      "mustExplain": ["本集必须讲清楚的前因后果"],
      "emotionAction": "本集情绪由什么具体剧情动作带起",
      "endingHook": "本集结尾追看动力，不机械硬卡"
    }
  ],
  "chapterGuides": [
    {
      "chapterTitle": "章节标题或范围",
      "adaptationRole": "这一章在全剧中的功能",
      "episodeSplitAdvice": "拆集建议",
      "mustKeep": ["必须保留"],
      "canCompress": ["可以压缩"],
      "emotionAction": "本章情绪由什么剧情动作带起",
      "continuityMustExplain": ["本章改编时必须讲清楚的前因后果"],
      "causalBridge": "拆集时上一状态、角色动作、原因和新状态如何连续",
      "endingAdvice": "本章拆集结尾如何留下追看动力，不机械硬卡",
      "foreshadowingInstruction": "伏笔处理要求"
    }
  ]
}`,
    },
  ];
}

// 智能分集分析提示词
export function generateAnalysisPrompt(novelContent, totalLength) {
  const systemPrompt = {
    role: 'system',
    content: `你是一位专业的短剧分集规划师。请分析提供的小说内容，并给出详细的分集规划。

分析要求：
1. 根据小说内容的自然章节和情节转折点来划分集数
2. 每集应该有清晰的剧情推进、情绪变化、关键场面和追看理由，但不要机械套固定卡点
3. 考虑短剧的特点（快节奏、强冲突），合理控制每集的内容量
4. 确保分集位置在合理的段落边界（不要切断对话或场景）
5. 观众必须看得懂前因后果：不要把人物动机、信息来源、关系变化、冲突后果切断到下一集才勉强补

输出格式必须是标准的 JSON，格式如下：
{
  "totalEpisodes": 总集数,
  "episodes": [
    {
      "episodeNumber": 1,
      "title": "本集标题（简洁有力，突出冲突）",
      "startIndex": 0,
      "endIndex": 3500,
      "contentRange": "该集涵盖的小说内容范围描述",
      "keyScenes": ["关键场景1", "关键场景2"],
      "continuityMustExplain": ["本集必须讲清楚的前因后果"],
      "cliffhanger": "本集结尾的追看动力（一句话，不机械硬卡）"
    }
  ],
  "mainCharacters": ["主角1", "主角2", "反派1"],
  "genre": "题材类型（如：都市爽文、玄幻修仙、甜宠言情）",
  "suggestedStyle": "建议的改编风格（如：快节奏打脸、甜虐交织、热血升级）",
  "totalLength": ${totalLength}
}`,
  };

  const userPrompt = {
    role: 'user',
    content: `请分析以下小说内容并规划分集。

全文总长度：${totalLength} 字符

小说内容：

${novelContent.slice(0, 300000)}${novelContent.length > 300000 ? '\n\n...（内容已截断，请基于已有内容分析并返回合理的位置索引）' : ''}`,
  };

  return [systemPrompt, userPrompt];
}

export function analyzeContinuationPrompt(fullContent, context) {
  const newContentLength = fullContent.length - context.previousContentLength;

  const systemPrompt = {
    role: 'system',
    content: `你是一位专业的短剧分集规划师。现在需要为**新增的小说内容**规划新的分集。

重要规则：
1. **只分析新增内容**，不要重新规划已生成的剧集
2. 新分集的编号要延续之前的集数（从第${context.previousEpisodes.length + 1}集开始）
3. 新分集的 startIndex 必须 >= ${context.previousContentLength}（新增内容的起始位置）
4. 新分集的 endIndex 必须 <= ${fullContent.length}（全文结尾）
5. 考虑与已生成剧情的连贯性
6. 确保分集位置在合理的段落边界
7. 观众必须看得懂前因后果：新增分集不能切断人物动机、信息来源、关系变化和冲突后果

输出格式必须是标准的 JSON，格式如下：
{
  "totalEpisodes": 新增集数,
  "episodes": [
    {
      "episodeNumber": ${context.previousEpisodes.length + 1},
      "title": "本集标题",
      "startIndex": ${context.previousContentLength},
      "endIndex": 3500,
      "contentRange": "该集涵盖的小说内容范围描述",
      "keyScenes": ["关键场景1", "关键场景2"],
      "continuityMustExplain": ["本集必须讲清楚的前因后果"],
      "cliffhanger": "本集结尾的追看动力"
    }
  ]
}`,
  };

  const lastEpisode = context.previousEpisodes[context.previousEpisodes.length - 1];

  const userPrompt = {
    role: 'user',
    content: `请为**新增内容**规划分集。

已生成剧集信息：
- 已生成 ${context.previousEpisodes.length} 集
- 最后一集（第${context.previousEpisodes.length}集）结尾内容：
${lastEpisode.content.slice(-500)}
- 已生成内容字数：${context.previousContentLength} 字

**新增小说内容**（从第 ${context.previousContentLength} 字符开始，共 ${newContentLength} 字）：

${fullContent.slice(context.previousContentLength, context.previousContentLength + 300000)}${newContentLength > 300000 ? '\n\n...（内容已截断，请基于已有内容分析并返回合理的位置索引）' : ''}

请只针对上述**新增内容**进行分集规划，不要重新规划已生成的 ${context.previousEpisodes.length} 集。`,
  };

  return [systemPrompt, userPrompt];
}

// 生成指定集的脚本提示词
export function generateEpisodeScriptPrompt(
  novelContent,
  episodePlan,
  previousEpisodesSummary,
  isFirstEpisode,
  requirement,
  useColdOpen = true,
  usePurification = true,
  useLongScript = false,
  useContentReview = false,
  priorArcSummary = '',
  coldOpenSource = '',
  adaptationStrength = 'enhanced',
  useEpisodeHook = true,
  segmentInfo = {}
) {
  const coldOpenReference = String(coldOpenSource || '').trim();
  const segmentIndex = Math.max(0, Number(segmentInfo?.index) || 0);
  const segmentTotal = Math.max(1, Number(segmentInfo?.total) || 1);
  const isContinuationSegment = segmentIndex > 0;
  const isLastSegment = segmentInfo?.isLast === undefined ? segmentIndex >= segmentTotal - 1 : segmentInfo.isLast === true;
  const coldOpenEnabled = useColdOpen && isFirstEpisode && !isContinuationSegment;
  const endingHookEnabled = useEpisodeHook && isLastSegment;
  const shouldOutputEndMarker = isLastSegment;
  const episodeEndMarker = endingHookEnabled ? '【本集完 - 留悬念】' : '【本集完】';
  const scriptStrength = normalizeAdaptationStrength(adaptationStrength);
  const scriptExecutionGuide = scriptAdaptationExecutionGuide(scriptStrength);
  const comboExecutionGuide = shortDramaCoreComboGuide({
    strength: scriptStrength,
    useColdOpen: coldOpenEnabled,
    usePurification,
  });
  // 冷开场要"先判题材，再选钩子"：题材玩法表写好了却一直没接进提示词，
  // 等于冷开场只能靠模型自由发挥，容易套错题材的狗血套路。
  const coldOpenPlaybook = coldOpenEnabled ? coldOpenGenrePlaybookGuide() : '';
  // 动态建议场数锚点：用本集原文长度反推一个软区间，给模型"该快进/放慢"的量化参照。
  // 节拍完整仍然优先；这只是防止集与集之间长短乱飘、防止场数动辄几十场。
  const srcLen = String(novelContent || '').length;
  let sceneRange = '6-12 场';
  if (srcLen < 800) sceneRange = '5-8 场';
  else if (srcLen <= 1500) sceneRange = '6-12 场';
  else if (srcLen <= 2500) sceneRange = '8-14 场';
  else sceneRange = '10-18 场';
  const sceneHint = `（本集原文约 ${srcLen} 字，建议改编为 ${sceneRange}；这是软区间，节拍完整永远优先于凑场数）`;

  const systemPrompt = `🎭 智能体名称：铁血金牌短剧改编编剧 (The Precision Adaptor)

1. 角色定位 (Role)
你是一位拥有顶级职业素养的"铁血剧本改编专家"，深谙流媒体时代竖屏微短剧的爆款密码（黄金开局、极速节奏、极致反转、打脸爽感、情绪拉扯）。你的第一原则是：你是改编者，绝对不是原创作者。

${scriptExecutionGuide}

${comboExecutionGuide}

${coldOpenPlaybook}

${internalVoiceLabelGuide()}

${scriptQualityHardRules()}

${shortDramaRhythmGuide()}

3. 表达工具清单（根据本次改编强度选择使用）

✅ 口语化润色：原文有的对话，可以调整为更口语化、更符合角色身份的表达，但不能改变对话的核心意思。

✅ 顺序调整：可以调整事件呈现顺序（如先抛结果再倒叙），但不能增删事件本身。

✅ 心理外化：原文的心理描写必须转化为可演的动作、神态、表情，不能保留"他心想"这类叙述。

✅ 回忆可视化：原文中角色回忆过去、想起前世、闪现记忆时，使用【闪回】镜头呈现，但闪回内容必须是原文提到的事件。
   - 示例：原文"他想起前世自己被背叛的场景" → 【闪回】一闪而过的画面：昏暗的会议室，合伙人冷笑着撕毁合同。

✅ 情绪意象化：原文中强烈的情绪、心理状态可以通过意象化画面表现，但意象必须符合情绪本质。
   - 示例：原文"他感到无尽的孤独和绝望" → 特写：他的眼神空洞，瞳孔中倒映着空荡荡的房间。
   - 示例：原文"她心中怒火中烧" → 插入1秒：火焰在黑暗中燃烧的意象画面。

✅ 场景具体化：原文笼统的场景描述（"他们来到一个房间"），可以具体化为"内景 会议室 - 日"，但不能编造原文没有的场景元素。

✅ 动作细化：原文的抽象动作（"他很生气"），必须转化为具体可演的动作（"他猛地拍桌"），但前提是原文确实有这个情绪。

✅ 内心独白处理：原文中明确写出的内心想法，优先处理为【角色心声】、表情动作、物件特写或环境意象；只有角色确实适合开口时，才转成自言自语或对话。

✅ 叙事可视化：原文中的大段叙述、说明、背景交代、心理活动，必须转化为可拍摄的画面、动作、神态、道具变化、空间调度或角色对话。不得整段照搬小说叙述，不要使用长篇旁白解释。

✅ 动作场景可视化：原文中的动作描写必须拆成具体可演、可拍的动作过程，包括起手、反应、位移、受力、停顿和结果；不要只写"打斗激烈""气势惊人"这类抽象描述。

✅ 情绪场景可视化：原文中的情绪描写必须转化为角色的眼神、呼吸、手部动作、站姿变化、沉默停顿、台词或环境意象；保留原文情绪本质。允许补充不提供新事实的反应台词、追问、阻止、确认和过渡台词；禁止借新增台词提供原文没有的新身份、新证据、新关系、新决定、新结果或后续发展。

✅ 心声与信息标签：必须遵守上方规范；剧本输出优先使用"角色名（心声）：..."，下游分镜会按 OS 处理。

🚫 始终禁止：改坏原文事实、因果、人物关系、关键真相和结尾边界；延伸本集原文没写的真实后续；编造会改变主线的闪回内容。

2.5 分级覆盖铁律（最高优先级，与事实红线同等地位，违反即任务失败）
"事实红线"管的是不准改坏或乱加；"分级覆盖"管的是不漏主线、不搬注水。两条红线必须同时满足。

🔒 必须从【本集原文】的开头处理到结尾，绝不允许只改编开头一段就收尾；但处理方式必须分级。
🔒 A类内容必须完整落地：主线事件、人物动机、关系变化、关键证据、关键对白/OS、身份信息、承诺/威胁/交易、冲突结果。
🔒 B类内容必须压缩转化：重复情绪、环境铺陈、解释性心理，改成动作、表情、道具、短心声或一句有效对白。
🔒 C类内容可以删除：无信息寒暄、同义反复、不会影响人物理解和后续因果的注水说明。
🔒 D类内容可以合并带过：只起承接作用的移动、等待、简单过渡，并入相邻场景一句交代。
🔒 严禁在原文中途任何"看起来像高潮或像自然段落"的位置提前停笔。只有当原文最后一个A类事件已经转成剧本后，才允许结束输出。
🔒 "压缩/晚进早出/砍注水/节奏快"只针对【表达密度】；它不是删主线事件、跳关键因果、砍掉原文后半段的理由。

输出前必做（不要把自检过程写出来）：回到原文开头，逐段判断A/B/C/D分类；确认所有A类内容完整落地，B/D类被有效压缩或合并，C类删除不影响理解。本集原文的最后一个A类事件，必须出现在剧本的最后部分。

2.6 本次剧本执行路径（最高优先级，写作时隐式执行，不要输出为分析）
正式写剧本前，必须先在心里完成四步判断：
1. 因果桥：本集所有关键变化都能回答"上一个状态是什么 -> 谁做了什么 -> 为什么这样做 -> 造成什么新状态"。
2. 节拍表：每场戏只抓一个主功能，优先从"钩子 / 承压 / 蓄力 / 爬升 / 爆发 / 余波 / 转向 / 信息校准 / 伏笔回收"中选择；没有主功能的场必须合并或删除。
3. 情绪收益：明确观众本集具体获得什么，爽在哪里、疼在哪里、甜在哪里、解气在哪里、期待在哪里；情绪必须落在角色动作、选择、代价、反应或关系变化上。
4. 成稿自检：A类内容完整落地，B/D类压缩有效，C类删除不伤理解；高潮前有加压，高潮后有反应或后果，结尾有清楚追看理由。

${useContentReview ? `
内容审核与合规法则（最高优先级）：
【审核标准】严格检查并删除/修改以下内容：
• 低俗擦边：性暗示、软色情、暧昧挑逗、不当身体接触描写
• 血腥暴力：详细暴力场面、血腥描写、残忍行为、过度打斗
• 极端复仇：以暴制暴、私刑、过度报复、违法手段解决问题
• 炫富拜金：过度炫耀财富、金钱至上、物质主义、攀比炫富
• 儿童不宜：涉及儿童的成人化内容、暴力、低俗、不当情节
• 错误历史：歪曲历史、错误史实、不当历史解读

【处理方式】
1. 发现违规内容 → 直接删除或改为合规内容
2. 暴力场面 → 改为暗示性描述或删除细节
3. 低俗内容 → 改为健康积极的表达
4. 错误历史 → 改为架空背景或删除
5. 儿童相关 → 确保内容适合全年龄段

【输出要求】审核通过的内容才能输出，确保剧本健康向上、符合平台规范
` : ''}

3. 法则一：爆款开头与结构重塑（黄金三分钟）
${coldOpenEnabled ? `
冷开场（Cold Open）- 超强钩子法则：
【核心原则】冷开场应是一个独立、贴题材、强相关的"微型高潮"：尽量在3秒内给出危机、悬念、反常信息或情绪痛点，让观众马上知道这部剧在讲什么、为什么值得看。

题材玩法必须服从全书故事圣经或原文中已经确定的主类型，不要混入其他题材套路。

【创作要求】
1. 只能从完整章节参考或已给素材中选择最强冲突点，不得虚构新的剧情事实
2. 可以强化原文已有冲突、情绪和视觉反差，但不得改变人物关系、因果和后文真相
3. 冷开场是独立引子，标记为【冷开场】，不计入正文场次编号
4. 冷开场结束后通过【黑幕字幕】过渡，正文从第1场开始
` : (isContinuationSegment ? `
本集分段承接：这是同一集的第 ${segmentIndex + 1}/${segmentTotal} 个生成分段。直接承接本集上一分段的最后动作、台词、位置和人物状态，不要回顾，不要重新建立已经建立过的场景。
` : (isFirstEpisode ? `
直接开场：本集不使用冷开场，直接从正文素材开始。前3秒优先给有效画面、冲突或情绪入口，同时迅速立清人物关系和当下局面。
` : `
承接开场：直接接入上一集结尾之后发生的剧情，不做前情回顾。必须沿用上一集已经确定的人物状态、关系、称呼、地点、道具和已知信息。
`))}

${usePurification ? `4. 法则二：保守精准提纯与剧情连贯（分级覆盖，压缩表达）
短剧需要快节奏，但第一目标是让观众看懂，并保证剧情连贯不断层。

精准提纯的定义：只改变【表达密度】，不改变【关键剧情事实】。你可以把重复铺陈写短、把弱过渡合并、把无效寒暄删除，但不能把A类事件、因果、身份关系、情绪转折、关键动作、关键对白从故事里抹掉。

保留底线（最高优先级）：原文中每一个推动主线、交代关系、造成转折、触发后果、解释人物动机、承接前后因果的A类内容，都必须在剧本中有明确对应。宁可多写半场，也不要让观众看不懂。

疑似冗余的处理原则：如果无法确定某段是否承载A类信息，默认压短保留核心意思；只有确定是C类注水，才可以删除。

压缩注水独白：反复咀嚼同一情绪的内心戏，可以压缩为一句动作、一个神态或一句台词带过；但原文给出的具体决定、误会、信息、身份、威胁、承诺、交易、伤害、证据、道具、时间地点，必须保留。

寒暄与过渡处理：无信息量的寒暄可以缩成一句或一个动作，不要整段铺开；但不能无痕跳过。涉及人物关系、态度变化、冲突升级或后续因果的寒暄，必须保留核心意思。

说明文处理：历史背景、设定和旁白说明要转化为画面、动作、道具、屏幕信息或角色对话自然带出；不得因为不用旁白就删除其中的关键信息。

场次处理：只有在同一时间、同一地点、同一戏剧节拍内，才允许把纯过渡压入相邻场次；凡是时间/地点变化、人物出入、信息揭露、关系变化、冲突升级或后果落地，都必须独立交代，不能合并到看不懂。

输出前自检（不要把自检写出来）：逐段核对原文，确认所有A类内容完整落地，B/D类被压缩或合并，C类删除不影响理解；若发现A类内容没有对应，必须补回后再输出。` : `4. 剧情改编原则
在保持剧情连贯的前提下进行改编，确保故事完整流畅。

完整保留：尊重原文的剧情结构，保留主要情节和细节描写。

自然转化：将叙述性内容自然转化为剧本格式，包括对话和动作描写。`}

5. 法则三：零门槛可读（最高优先级）
自然交代关系：角色首次出场，必须通过称呼、对话自然带出身份。
前因后果闭环：每一场戏的起因、冲突、结果必须形成逻辑闭环。
因果桥检查：每次转场、跳时、人物态度变化、误会升级、真相揭露或冲突结果落地，都要让观众看懂"之前是什么状态、谁做了什么、为什么这样做、之后局面变成什么"。
信息来源清楚：角色知道一件事，必须有来源；角色改变决定，必须有触发；关系变化，必须有动作、台词、证据或事件支撑。
世界观可视化：严禁用旁白硬灌设定，全部融入对话和画面中。

6. 法则四：台词自然与爆款视听网感
台词自然法则：台词要口语化、自然，符合角色身份。关键信息必须完整传达。

强切入（晚进早出）：每一场戏的第一个镜头尽量直接进入有效戏份，少铺垫；但必要的时间、地点、人物关系和冲突起因不能省到看不懂。

极致视觉反差：提取原文中体现"地位落差"的物理动作（如：跪地发抖、高高在上的俯视）。

情绪反作用力：主角释放爽点后，必须紧跟配角的【特写】镜头（震惊、恐惧、嫉妒的微表情）。

7. 法则（节奏曲线）：集内要有起伏，避免全程同强度

一集短剧不是"许多场高潮的并列"，而是一条由剧情动作推动的情绪曲线。可参考"钩子/承压/蓄力/爬升/爆发/余波/转向"这些功能，但不要机械凑固定数量，也不要每集都硬套同一顺序。

节奏执行建议：
- 开场负责抓人和立清局面：可以是冷开场、承接上集、危险入口、反常信息或关系撕裂，但要让观众知道当下冲突从哪里来。
- 中段负责加压和选择：用信息差、误会、追问、反击、证据、代价或关系变化推动情绪，而不是只堆狠话。
- 爆点负责改变局面：真正的高潮/爽点/反转要让人物付出动作或代价，并留下清楚后果。
- 余波负责承接结果：爆发后给反应镜头、关系变化或下一步目标，让观众感到这件事改变了局面。

节奏判断：
- **不是每场都要爆**。需要立关系、放信息、埋伏笔、承接后果时，可以克制处理；克制不等于拖沓，必须服务理解或下一步行动。
- **快体现在表达密度**：交代性、铺垫性的原文（寒暄、环境说明、重复情绪）用晚进早出压到有效信息；能合并的纯过渡可以合并。
- **慢体现在关键停顿**：爆发点、真相点、关系转折和余波处允许画面停、情绪沉淀、给反应镜头；停顿必须带来情绪或信息变化。
- 改编时先判断每段原文承担什么戏剧任务，再决定"压缩"还是"展开"；不要用统一密度处理所有场次。

8. 法则五：专业场次与结尾追看
绝对单一时空原则："一场戏"必须是"同一时间、同一地点"。时间或地点改变，必须拆分为新的一场戏。

场次规划原则（以戏剧节奏为主导）：
- 切场的首要依据是【戏剧节拍】：一个完整的"动作—反应"单元、一次情绪转折、一次信息揭露、一次冲突升级或回落，构成一场戏
- 字数不是切割线，只是"别让单场拖沓"的上限提醒（单场对应的原文一般不超过 ~400 字）
- 不要为了凑字数把一个完整节拍拦腰切断，也不要为了凑场数把一个节拍硬拆成两场——一个节拍能讲清的，就让它在一整场里讲完
- 关键情节点（冲突爆发、转折、反转、高潮、爽点）优先独立成场，长度服从戏剧需要
- 节拍完整就停。不为多凑场数而碎切，也不为合并而塞两个节拍进一场

场次长度控制：
- 对话场景：一来一回的交锋告一段落即可成场，形成完整节拍
- 动作场景：一个关键动作及其反应独立成场
- 情绪场景：情绪的蓄力、爆发、余波各自成场

拆分原则：
- 按戏剧节奏和情节节点划分，节拍完整优先于字数
${useLongScript ? `
长剧本模式（单一场景）：
- 本集为连续长剧本，不划分场次编号
- 整个剧本就是一场戏，连续呈现
- 通过【黑幕字幕】标明时间/地点转换，但不拆分为新场次
- 保持剧情流畅，一气呵成
` : `
- 时间或地点改变，必须拆分为新场次（绝对单一时空原则优先于一切）
- 同一时空内，按戏剧节拍切分：一个完整的动作-反应/情绪转折/信息揭露为一场
- 关键情节点（冲突爆发、转折、高潮）优先独立成场，长度不受字数限制
- 对话节奏：一来一回的交锋告一段落即可成场，不必硬数句数
- 动作节奏：一个关键动作及其反应独立成场
- 字数仅作"别让单场过长"的提醒，节拍完整永远优先于字数
`}

直给式时间跳跃：遇到明显时间流逝，使用【黑幕字幕】或场景标题标明，避免空间/时间断层。

${!isLastSegment ? '本次不是本集最后一个生成分段：覆盖完当前分段原文后自然承接，不要制造本集结尾，不要输出本集结束标记。' : (endingHookEnabled ? '结尾追看处理：必须先覆盖完本集最后一段原文并讲清因果，再执行规划中的追看动力；可以是悬念、关系变化、情绪余波、新目标、新代价、新机会或真相推进。' : '本集结尾：覆盖完本集最后一段原文后自然收束，不强行制造悬念。')}

【步骤1：开场】
${coldOpenEnabled ? '从完整章节参考中选择最具冲击力的已发生情节点作为冷开场；冷开场不编号，正文从第1场开始' : (isContinuationSegment ? '承接本集上一生成分段，禁止回顾和重复' : (isFirstEpisode ? '直接从本集正文素材开始' : '承接上一集结尾，直接继续剧情'))}

【步骤2：场次规划】
${useLongScript ? `
长剧本模式：
- 本集为连续长剧本，不划分场次（不出现"第X场"）
- 整个剧本就是一场戏，连续呈现
- 使用【黑幕字幕】标明时间/地点转换
- 保持剧情流畅，一气呵成
` : `${coldOpenEnabled ? '冷开场（独立引子，不计入场次编号，冷开场只挑一个最强爆点、1场带过）\n' : ''}按戏剧节拍划分场次，从第1场开始编号（每集都重新从第1场开始）${sceneHint}
切场判据只有两条：①时间或地点变了必须切；②一个戏剧节拍（一个完整的"动作—反应"/情绪转折/信息揭露）讲完了就停。节拍没完绝不切，两个节拍绝不硬塞一场。
确定每场的时间地点
确保剧情连贯不断层
重要：每集的场次编号都独立计算，必须从第1场开始，不能延续上一集的场次编号`}

【步骤3：格式输出 - 严格禁止输出任何非剧本内容】
禁止输出标题、前言、说明、分析、总结
禁止输出"以下是剧本"等引导语
${useLongScript ? '第一行直接开始剧本内容（长剧本模式，不出现"第X场"）' : (coldOpenEnabled ? '第一行必须是【冷开场】' : '第一行必须是【黑幕字幕】或第1场')}
${shouldOutputEndMarker ? `最后一行必须是${episodeEndMarker}` : '本分段不要输出【本集完】或【本集完 - 留悬念】'}

输出格式（只输出这个，前后不加任何文字）：

${useLongScript ? `长剧本格式（连续一场戏）：
[内/外景/幻景] [具体地点] - [时间（日/夜）]
出场人物：角色A、角色B
[视觉动作]
角色A：台词
角色A（心声）：短句，仅承载未开口心理
【系统提示】：仅原文明示系统信息时使用
【黑幕字幕】：仅用于明确时间/地点转换
……
${shouldOutputEndMarker ? episodeEndMarker : ''}` : `${coldOpenEnabled ? `【冷开场】[内/外景/幻景] [具体地点] - [时间（日/夜）]
出场人物：角色A、角色B
[视觉动作]
角色A：台词
角色A（心声）：短句
【屏幕大字】：极短钩子信息
【黑幕字幕】：从冷开场过渡到正文

` : ''}第1场 [内/外景/幻景] [具体地点] - [时间（日/夜）]
出场人物：角色A、角色B
[视觉动作]（直接进入有效戏份）
特写：（仅爆发点需要）
角色A：台词
角色A（心声）：可选；下游按OS处理
【系统提示】：可选；仅原文明确存在系统时使用
角色B：台词

第2场 ……

${shouldOutputEndMarker ? episodeEndMarker : ''}`}`;

  const requirementText = requirement ? `

【额外要求】
${requirement}

请务必按照以上要求重新生成剧本。` : '';

  const keyScenesText = Array.isArray(episodePlan?.keyScenes) ? episodePlan.keyScenes.join('、') : '';
  const mustExplainText = Array.isArray(episodePlan?.mustExplain) ? episodePlan.mustExplain.join('；') : '';
  const causalBridgeText = Array.isArray(episodePlan?.causalBridge)
    ? episodePlan.causalBridge.join('；')
    : String(episodePlan?.causalBridge || '').trim();
  const sourceBeatText = Array.isArray(episodePlan?.sourceBeatIds) ? episodePlan.sourceBeatIds.join('、') : '';
  const endingHookContent = String(episodePlan?.endingHook?.content || episodePlan?.cliffhanger || '').trim();
  const sourceRangeText = sourceBeatText
    ? `素材ID：${sourceBeatText}`
    : `原文位置：${episodePlan?.startIndex ?? ''}-${episodePlan?.endIndex ?? ''}`;
  const openingInstruction = coldOpenEnabled
    ? `先写一个【冷开场】，只能从下方完整章节参考中提取已发生的情节点；冷开场结束后用【黑幕字幕】回到正文起点。`
    : (isContinuationSegment
      ? `这是本集第 ${segmentIndex + 1}/${segmentTotal} 个生成分段，直接承接本集上一分段，不回顾、不重复。`
      : (isFirstEpisode
        ? '不使用冷开场，直接从本集正文素材开始。'
        : '直接承接上一集结尾之后的剧情，不做前情回顾。'));
  const endingInstruction = !isLastSegment
    ? '当前不是本集最后一个生成分段。覆盖完当前原文后保持可继续衔接，不制造本集结尾，不输出结束标记。'
    : (endingHookEnabled
      ? `覆盖完全部本集原文后，执行本集追看动力：${endingHookContent || '根据剧情形成关系变化、情绪余波、新目标、新代价、新机会或真相推进'}。`
      : '覆盖完全部本集原文后自然收束，不强行制造悬念。');
  const carryContext = isContinuationSegment
    ? '本集上一分段的具体结尾已经放在系统消息【前情脉络】末尾，必须直接承接。'
    : (previousEpisodesSummary ? `【上一集结尾】\n${previousEpisodesSummary}` : '');
  const coldOpenBlock = coldOpenEnabled
    ? `【完整章节参考｜只供冷开场选取已发生情节点，不得把参考中的后续内容写进正文】\n${coldOpenReference || novelContent}\n\n`
    : '';

  const userPrompt = `请将下面素材改编为第${episodePlan?.episodeNumber || 1}集短剧脚本${segmentTotal > 1 ? `的第 ${segmentIndex + 1}/${segmentTotal} 个生成分段` : ''}。

【开场执行】
${openingInstruction}

【本集规划】
- 标题：${episodePlan?.title || ''}
- ${sourceRangeText}
- 剧情目标：${episodePlan?.plotGoal || ''}
- 关键场景：${keyScenesText}
- 必须讲清：${mustExplainText}
- 因果桥：${causalBridgeText}
- 情绪动作：${episodePlan?.emotionAction || ''}
- 结尾要求：${endingInstruction}
${requirementText}

${carryContext ? `${carryContext}\n\n` : ''}${coldOpenBlock}【当前分段原文｜必须从开头处理到结尾】
${novelContent}`;

  const creativeContext = [
    priorArcSummary ? `【前情脉络】（前面各集已经讲过的剧情，本集必须承接：沿用已确立的人物关系、称呼、身份与已知事实，不要重复、不要断片、不要与之矛盾）\n${priorArcSummary}` : '',
  ].filter(Boolean).join('\n\n');

  const finalSystem = creativeContext
    ? `${systemPrompt}\n\n========== 创作上下文 ==========\n${creativeContext}`
    : systemPrompt;

  return [
    { role: 'system', content: finalSystem },
    { role: 'user', content: userPrompt },
  ];
}

function storyboardVoiceCompatibilityGuide() {
  return `
【剧本心声/信息标签兼容规则】
- 剧本里的"角色名（心声）：..."、"角色名(心声)：..."、"角色名（OS）：..."一律视为 OS，分镜台词行统一写成"角色名(OS): ..."；角色不实际开口，画面必须写清嘴部闭合或没有开口动作。
- 剧本里的【脑海传音】、【烙印回响】属于剧情内非现场声音；若有明确说话/来源对象，按画外音或OS处理，并用画面焦点表现来源（识海、印记、法器、系统UI等）。
- 剧本里的【系统提示】只在系统/游戏/规则面板明确存在时转成系统UI、电子音或无字幕化界面元素；不得把普通解释文字伪装成系统UI。
- 剧本里的【屏幕大字】、【黑幕字幕】、【字幕】、【画面文字】属于画面/转场信息，不属于台词、OS或画外音；不得让角色朗读，不得改成旁白。
- 无对白/OS的时间段不要为了凑时长补心声或画外音，用动作、运镜、环境音效和反应镜头承接。`;
}

function storyboardQVersionGuide(useQVersion) {
  if (useQVersion) {
    return `
【本次Q版视觉开关｜项目设置，优先执行】
- Q版视觉：轻量开启。
- Q版元素只用于OS、内心话、吐槽、尴尬、慌乱、犹豫、短促崩溃或轻喜剧心理的辅助意象，不得把整段主剧情改成Q版。
- 正常比例角色仍是主画面主体；Q版元素每个镜头最多出现一次，通常只占一个时间段，结束后必须回到正常比例主剧情画面。
- Q版元素可以是当前角色的小版3D萌化缩影、脑内迷你Q版小人拉扯、无文字心理泡泡、夸张汗滴或小型情绪弹跳动作；必须保留当前角色的核心识别特征，不得变成陌生角色。
- Q版元素不替代OS原文，不改写台词格式；台词行仍按模板规则完整保留原文OS。
- 正常比例角色在OS段必须嘴部闭合或没有开口动作，Q版只表达心理意象，不强制承担口型。
- 严肃高压、死亡、重伤、强悲剧、强悬疑、恐怖压迫段落慎用Q版，优先使用写实意象、环境压迫、道具特写、光影变化或抽象视觉符号。`;
  }
  return `
【本次Q版视觉开关｜项目设置，最高优先级覆盖规则】
- Q版视觉：关闭。
- 本次生成严禁使用任何Q版、Q版嘴替、Q版小人、Q版小剧场、脑内会议Q版小人、豆豆眼、打滚撒泼、Q版弹出音、Q版气泡框、Q版情绪背景或任何“萌化小人”表达。
- 如果剧本出现内心OS、吐槽、纠结、解说、情绪爆发或对峙，必须改用正常比例角色表演、镜头语言、环境意象、物件特写、光影压迫、闪回、蒙太奇、游戏UI或抽象视觉符号表达。
- 内置模板中所有要求使用Q版视觉的规则在本次生成中全部失效，以本开关规则为准。`;
}

// 冷开场分镜专用规则。冷开场是「独立引子 + 倒叙/前置爆点」，它切回正文起点是一次
// 时空跳转；分镜模板的铁规却要求「后一镜【承接】与前一镜【定格基准】一字不差」，
// 两者直接冲突 —— 不额外注入本规则，正文首镜就会被写成冷开场画面的延续，导致时空断层。
export function coldOpenStoryboardGuide() {
  return `【冷开场分镜规则｜最高优先级，覆盖上方"逐字承接""本段首镜必须承接上一段"的全部要求】
本集剧本使用了冷开场。冷开场是独立引子（倒叙或前置爆点），不计入本集正片场次编号，通常只占 1 场。
1. 冷开场第 1 个镜头仍按全片首镜处理：【承接】固定写"【承接】全片开场，无上镜承接。"。
2. 冷开场内部各镜之间照常按【承接】/【定格基准】逐字衔接，不受本条影响。
3. 冷开场切回本集正文起点是一次【时空跳转】，不是画面延续：
   - 冷开场最后一个镜头的【定格基准】不得被正文第 1 个镜头逐字复制；
   - 正文第 1 个镜头的【承接】必须写成明确的跳转，例如："【承接】倒叙结束，回到[具体地点][时间]；画面由[冷开场结尾状态]硬切/黑场切入[正文起点状态]。"；
   - 正文第 1 个镜头内必须用【转场】行写清转场类型与新时间、新地点；
   - 禁止沿用冷开场的人物站位、姿态、光线、道具状态，当作同一时刻的延续。
4. 若本段输入以【黑幕字幕】开头（说明上一段停在冷开场里），同样按第 3 条处理：不要承接上一段的结尾状态。
5. 【冷开场】标记必须保留在对应镜头中（可在该镜首行标注【冷开场】），便于识别钩子在哪里结束。
6. 冷开场内容必须完整落成镜头，不得因为它不计场次编号就省略。`;
}

// 生成分镜脚本的提示词
export function generateStoryboardPrompt(scriptContent, _episodeNumber, _episodeTitle, requirement, elementNames = null, prevTailFrame = '', characterVariants = null, _shotHeader = '无字幕无BGM', storyboardPromptTemplateId = 'p', useQVersion = true, maxDuration = 15) {
  const storyboardPromptTemplate = getStoryboardPromptTemplate(storyboardPromptTemplateId);
  const systemPrompt = storyboardPromptTemplate.content;
  const configuredMaxDuration = Math.max(5, Math.min(500, Math.floor(Number(maxDuration) || 15)));

  const requirementText = requirement ? `

【额外要求】
${requirement}

请务必按照以上要求重新生成分镜。` : '';

  const prevTailText = String(prevTailFrame || '').trim() ? `

========== 上一镜定格基准（本段首镜必须逐字承接）==========
下方若为【定格基准】行，本段首个镜头的【承接】行必须只把标签替换为【承接】，其余内容一字不差；若为历史旧格式锚点，则先按同一画面事实转换成新的【承接】格式。
${String(prevTailFrame).trim()}` : '';

  const userPrompt = `【待转换剧本】
${scriptContent}
${prevTailText}
${requirementText}

将以上剧本转化为分镜脚本。直接输出分镜内容，不要有任何引导性文字或说明。`;

  const finalSystemPrompt = systemPrompt + `
${storyboardVoiceCompatibilityGuide()}
${storyboardQVersionGuide(useQVersion)}

【软件执行补充｜本次用户时长设置】
- 本次项目默认最大分镜时长为 ${configuredMaxDuration} 秒。每镜时间轴必须从 0.0s 开始，并在 ${configuredMaxDuration}.0s 结束；若剧情内容超过该时长，必须拆分到下一个镜头，不得删减对白或动作。
- 识别和输出分镜时间标记时，以 ${configuredMaxDuration} 秒作为本次镜头的时间上限；不要把超过 ${configuredMaxDuration} 秒的时间段写入单镜。

【软件执行补充｜不得覆盖上方核心铁规】
- 直接输出分镜内容，不要出现"以下是为您将...转化为.."等引导语
- 不要出现"本集共拆分为X个标准15秒镜头"等说明文字
- 第一个字必须是"【镜头1】"，顶层切割标记严格使用"【镜头X】"并连续编号，中间不要有任何说明
- 每个镜头编号下一行固定写"无字幕无BGM"，不得添加画风前缀、字幕或背景音乐
- 每个镜头都必须从0.0s开始并在${configuredMaxDuration}.0s结束；不要生成零时长、负时长、时间重叠或时间断档的时间段
- 每个镜头只能出现一个【承接】和一个【定格基准】；【定格基准】必须是该镜头最后一行
- 除全片首镜固定写"【承接】全片开场，无上镜承接。"外，后一镜的【承接】必须与前一镜【定格基准】去掉标签后的全文一字不差

【全量覆盖铁律｜最高优先级，违反即失败】
- 必须把上面【整段剧本】从第一场第一句一直转换到最后一场最后一句，逐场、逐镜、逐句对白全部覆盖，绝不允许只做开头一段就收尾。
- "精简/高燃"指的是单镜内部表达精炼、节奏紧凑，绝不是删剧情、跳场、砍后半段；提纯只能压缩冗余铺陈，不能丢失任何剧本场景、动作或台词。
- 分镜阶段不得再次做剧情删改：剧本已有的场次顺序、人物关系、因果承接、关键动作、对白和OS必须全部进入分镜；只能压缩镜头描写的字数，不能压缩掉剧情信息。
- 不确定某句对白或动作是否重要时，默认保留；禁止把"看起来像铺垫"但承担关系、动机、误会、证据、威胁、承诺或转折的信息删掉。
- 剧本里每一场（如"第一场""第二场"…）都必须有对应分镜；每一句原文对白和OS都必须完整出现在某个分镜里，一句都不能漏。
- 【黑幕字幕】【字幕】【屏幕文字】【画面文字】应转成画面、转场、环境变化或时间地点交代，不作为台词或画外音朗读。
- 严禁在剧本中途任何"看起来像高潮或段落"的位置提前停笔。只有当最后一场的最后一句台词、OS、动作和收束镜头都已转成分镜后，才允许结束输出。
- 镜头数量随剧情长度自然增加，不设上限；每镜仍必须严格${configuredMaxDuration}秒。若单镜内容超出${configuredMaxDuration}秒就拆为下一镜，绝不通过缩短镜头、漏掉后半段剧情或省略对白来规避拆镜。`
  + buildElementNameGuide(elementNames)
  + buildCharacterVariantGuide(characterVariants)
  + buildCharacterVoiceGuide(characterVariants)
  + `

【本次时长设置最终覆盖】
上方模板中的固定“15秒”示例和规则仅为默认值；本次项目用户设置的最大分镜时长是 ${configuredMaxDuration} 秒，优先于上方固定数值。请将本次所有镜头时间轴的结束点、拆镜判断和秒数识别统一按 ${configuredMaxDuration} 秒执行。`;

  return [
    { role: 'system', content: finalSystemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateCustomStoryboardPrompt({
  scriptContent = '',
  episodeNumber = '',
  episodeTitle = '',
  customPrompt = '',
  requirement = '',
  elementNames = null,
  characterVariants = null,
  prevTailFrame = '',
  maxDuration = 15,
} = {}) {
  const custom = String(customPrompt || '').trim();
  const extra = String(requirement || '').trim();
  const source = String(scriptContent || '').trim();
  const configuredMaxDuration = Math.max(5, Math.min(500, Math.floor(Number(maxDuration) || 15)));
  // 自定义模式同样使用「强制对齐」版元素规范名、人物形态与时间码指引（与内置模板一致），
  // 否则模型会自创场景/人物别名，导致分镜与元素库资产对不上、出图缺参考；
  // 时间码缺失则会让下游的时长统计、拆镜和截断提醒全部失效。
  const elementGuide = buildElementNameGuide(elementNames);
  const variantGuide = buildCharacterVariantGuide(characterVariants);
  const characterVoiceGuide = buildCharacterVoiceGuide(characterVariants);
  const timeCodeGuide = buildStoryboardTimeCodeGuide();

  const systemPrompt = `你正在执行用户自定义分镜提示词。

【执行原则】
- 用户自定义分镜提示词是唯一创作规则，必须完全按照它执行。
- 不要套用内置“金牌分镜导演”模板、15秒镜头套装、Q版视觉规则或其他内置分镜创作规则。
- 除非自定义提示词明确要求，否则不要输出分析、解释、Markdown标题或额外说明，直接输出生成结果。
- 如果自定义提示词没有规定顶层编号格式，使用连续的“【镜头1】”“【镜头2】”；如果已经规定格式，以自定义提示词为准。
- 本次项目默认最大分镜时长为 ${configuredMaxDuration} 秒。除非自定义提示词明确指定更严格的上限，每镜时间轴从 0.0s 开始并以 ${configuredMaxDuration}.0s 结束；超出时必须拆分镜头，不能删减剧本内容。
- 唯一例外：下方「元素规范名（强制对齐）」「人物形态（强制标注）」和「时间码规范（强制对齐）」约束必须遵守——涉及已建库的元素必须逐字使用规范名，否则下游无法把分镜与元素参考图对应；每个时间段必须写成可识别的时间码，否则下游无法统计时长、拆分超长镜头或判断截断。
- 其余剧本、集信息、上一段结尾都只是本次输入素材，不得替代或覆盖自定义提示词。

【用户自定义分镜提示词】
${custom}`;

  const userPrompt = `请根据上方自定义分镜提示词处理下面材料。

【集信息】
- 集号：${episodeNumber}
- 标题：${episodeTitle}

${elementGuide}${variantGuide}${characterVoiceGuide}${timeCodeGuide}${prevTailFrame ? `\n【上一分段结尾参考】\n${String(prevTailFrame).trim()}\n\n` : '\n'}${extra ? `【额外要求】\n${extra}\n\n` : ''}【待处理剧本】
${source}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

// 把项目已有的元素规范名清单拼成约束，要求分镜逐字使用，便于下游精确匹配与投喂视频模型的具名参考图
function buildElementNameGuide(elementNames) {
  if (!elementNames || typeof elementNames !== 'object') return '';
  const lines = [];
  const labelMap = { character: '人物', group: '群像', scene: '场景', prop: '道具', effect: '特效', creature: '妖兽' };
  for (const cat of ['character', 'group', 'scene', 'prop', 'effect', 'creature']) {
    const names = (elementNames[cat] || []).map((n) => String(n || '').trim()).filter(Boolean);
    if (names.length) lines.push(`${labelMap[cat]}：${names.join('、')}`);
  }
  if (!lines.length) return '';
  return `

========== 元素规范名（强制对齐）==========
本项目已建立以下元素图库。分镜中凡指代到这些元素（人物/场景/道具/特效），必须【逐字使用】下面的规范名，不要用别名、简称或同义改写（例如已有"半地下室出租屋"就不要写成"半地下室""出租屋"；已有"阮钰"就不要写成"女主""她"作为场景/人物标注）。这样下游才能把分镜与对应的元素图精确对应、投喂给视频模型作具名参考图。
${lines.join('\n')}
未在上表中的新元素可照常描述，但已存在的元素一律使用规范名。`;
}

// 人物的多形态清单：让分镜在剧情切到某形态时逐字标出该形态名，
// 下游才能把这一镜绑定到对应的形态图，而不是只绑到人物主图。
// 换装不在此列：换装靠人物主图保脸 + 分镜动态描述即可，形态才需独立参考图。
function buildCharacterVariantGuide(characterVariants) {
  if (!Array.isArray(characterVariants) || !characterVariants.length) return '';
  const lines = [];
  for (const c of characterVariants) {
    const name = String(c?.name || '').trim();
    if (!name) continue;
    const variants = (c.variants || []).map((v) => String(v || '').trim()).filter(Boolean);
    if (variants.length) lines.push(`${name}（形态：${variants.join('、')}）`);
  }
  if (!lines.length) return '';
  return `

========== 人物形态（强制标注）==========
以下人物拥有多个形态版本（不同年龄/觉醒/魔化等，会改变脸型与气质）。当某一分镜的剧情明确处于某个形态时，你必须在该镜画面描述里【逐字写出对应的形态名】，例如剧情进入"觉醒形态"就明确写"阮钰·觉醒形态"或在画面中点明"觉醒形态"。这样下游才能把这一镜精确绑定到对应的形态图，而不是错绑到人物主图。
- 只有剧情真正切到该形态时才标注；普通日常戏用人物主名即可，不要乱套形态。
- 形态名必须与下表逐字一致，不要改写或简称。
${lines.join('\n')}`;
}

// 角色音色（来自人物库的声音档案）：要求台词/OS 行的说话人后括注音色，
// 让分镜正文自带"谁用什么声音说话"——视频模型（如 Seedance 类）可直接读懂，
// 用于口型、语气与表演；真要生成配音则走 TTS/参考音频，与本标注互不冲突。
function buildCharacterVoiceGuide(characterVariants) {
  if (!Array.isArray(characterVariants) || !characterVariants.length) return '';
  const lines = [];
  for (const c of characterVariants) {
    const name = String(c?.name || '').trim();
    const voice = String(c?.voice || '').trim();
    if (!name || !voice) continue;
    lines.push(`- ${name}：${voice}`);
  }
  if (!lines.length) return '';
  return `

========== 角色音色（台词行强制标注）==========
以下音色档案来自人物库，是这些角色在全剧中的唯一声音设定：
${lines.join('\n')}
- 凡是台词行，说话人后必须用中文括号标注其音色，格式为"角色名（音色）：台词内容"，例如"萧云（低沉少年音）：你可知罪？"。
- OS/心声行同样标注（角色虽不开口，但低语声仍需音色），格式为"角色名(OS)（音色）：..."。
- 音色描述必须与上表逐字一致，不得改写、缩写或自行发挥；表中没有的角色，按其年龄、性别、身份推断一次简短音色，并在全剧所有镜头中保持一致。
- 音色标注只出现在台词/OS 行的说话人后，不要写进【画面】描述里，不要用音色替代情绪或动作描写。`;
}

// 时间码强制对齐：下游（时长统计、按时间码拆镜、「会被截成 Xs」提醒、出片时长）都依赖每一镜
// 能解析出时间段。自定义分镜提示词常常只规定字数与节奏而不要求时间码，导致整集分镜没有任何
// 可识别的时间段 —— 拆分按钮和截断提醒就全部失效。与「元素规范名/人物形态」同理，属下游硬约束。
export function buildStoryboardTimeCodeGuide() {
  return `

========== 时间码规范（强制对齐）==========
每一个时间段都必须以可识别的时间码开头，格式为【起始秒-结束秒s】，例如【0-4s】【4-8s】【8-13s】【22-30s】；允许小数，如【0.0s-4.5s】。
- 时间码放在该时间段的行首，后面可以紧跟【景别 运镜】等内容。
- 同一镜内的时间段必须从 0 开始、按顺序连续、不重叠、不断档；最后一个时间段的结束秒就是本镜总时长。
- 严禁省略时间码，严禁用"第一段/第二段/接着/然后"之类的文字代替时间码。
- 除时间码本身外，正文里不要再出现游离的"X秒"字样，否则会干扰时长识别。`;
}

// ==================== 章节分集 ====================
export function generateChapterSplitPrompt(chapterText, startEpisodeNumber = 1, options = {}) {
  const text = String(chapterText || '').slice(0, options.maxChars || 180000);
  const windowIndex = Number(options.windowIndex || 0);
  const windowTotal = Number(options.windowTotal || 1);
  const offsetStart = Number(options.offsetStart || 0);
  const offsetEnd = Number(options.offsetEnd || (offsetStart + text.length));
  const isSegmented = windowTotal > 1;
  const globalBible = String(options.globalBible || '').trim();
  const systemPrompt = {
    role: 'system',
    content: `你是一位专业短剧分集规划师，负责把小说章节切成可改编的连续短剧集。

${globalBible ? `【全书故事圣经｜必须参考】
你已经读完整本小说并获得全书级理解。下面这份故事圣经用于约束分集判断：不要误解人物关系，不要提前透出后期真相，不要漏掉前期该埋的伏笔，也不要把本章当成孤立短篇处理。
${globalBible}
` : ''}

分集规则：
1. 只基于本章原文分集，不虚构本章外剧情。
2. 每集应有清晰的剧情推进、情绪动作、关键场面和追看理由；如果有全书故事圣经，分集还必须服务全书主线、人物弧光和伏笔节奏。
3. 切点必须落在自然段落、场景转换、冲突升级或悬念点附近，不要切断一句话、对话或动作。
4. 每集跨度尽量均衡，但优先保证剧情完整和钩子强度。
5. startText 和 endText 必须直接摘取本章原文中的短句，用于程序定位切点；不要改写、不要概括。
6. ${isSegmented ? '当前只规划本窗口文本，不要规划窗口外内容；开头和结尾可以与相邻窗口自然衔接。' : '当前规划完整章节。'}
7. 观众必须看得懂前因后果：分集不能把人物动机、关系变化、关键信息来源、冲突后果切断到看不懂。
8. 每集切点要保留因果桥：上一状态、角色动作、原因、新状态必须能连起来；如果切点会导致观众看不懂，宁可前后微调。
9. 结尾应尽量留下追看动力，但要服务当前剧情阶段；允许悬念、关系变化、情绪余波、新目标、新代价或新机会，不要机械套固定卡点。
10. 只输出 JSON，不要输出 markdown、解释、分析过程或寒暄。

输出格式：
{
  "episodes": [
    {
      "title": "第${startEpisodeNumber}集 标题",
      "startText": "本集开头附近原文短句",
      "endText": "本集结尾附近原文短句",
      "plotGoal": "本集结束后局面发生什么变化",
      "keyScenes": ["关键场面1", "关键场面2"],
      "continuityMustExplain": ["本集必须讲清楚的前因后果"],
      "causalBridge": "上一状态 -> 角色动作 -> 原因 -> 新状态",
      "emotionAction": "观众情绪由什么具体剧情动作带起",
      "cliffhanger": "本集结尾追看动力，不机械硬卡"
    }
  ]
}`,
  };

  const userPrompt = {
    role: 'user',
    content: `请从第 ${startEpisodeNumber} 集开始，为下面这个${isSegmented ? `章节窗口（第 ${windowIndex + 1}/${windowTotal} 窗，全文字符 ${offsetStart}-${offsetEnd}）` : '章节'}做分集规划。直接返回 JSON。\n\n【章节原文${isSegmented ? '窗口' : ''}】\n${text}`,
  };

  return [systemPrompt, userPrompt];
}
