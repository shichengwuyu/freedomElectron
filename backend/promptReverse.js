// 参考素材 → 提示词（vision）。两种分析模式：
//   shot      —— 输出本项目格式的分镜提示词（可直接喂给"衔接合成"）
//   breakdown —— 按 15 秒节点做专业拉片，输出结构化报告（给人和外部 AI 视频模型用）
// 关键约束：静态帧能"确证"的只有画面/光影/构图/景别/服装/场景；动作与节奏只能"推断"，声音更是完全听不到。

function cleanPart(value, maxLength) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, maxLength);
}

function formatMediaLine(kind, mediaMeta = {}, frameCount = 0) {
  if (kind === 'image') return `素材类型：单张图片（${frameCount} 帧视觉输入）`;
  const bits = [
    '素材类型：视频',
    `时长 ${Number(mediaMeta.duration) || 0}s`,
    mediaMeta.width && mediaMeta.height ? `原始画面 ${mediaMeta.width}x${mediaMeta.height}` : '',
    mediaMeta.fps ? `${mediaMeta.fps}fps` : '',
    `按时间顺序抽了 ${frameCount} 帧`,
  ].filter(Boolean);
  return bits.join('；');
}

// 公共的"诚实约束"：不管哪种模式、哪种输入都不能编造。
// 注意输入方式会改变约束——直读视频时模型可能真能看到动作连续性、甚至听到声音；抽帧则两者都没有。
function honestyRules({ hasVideo = false } = {}) {
  return `【不可违反的诚实约束】
1. ${hasVideo
    ? '你拿到的是**完整视频**（不是抽帧），因此动作的时序与节奏可以具体描述；但仍不要把观察夸大成逐帧精确。'
    : '你拿到的是**按时间顺序抽取的静态画面帧**，没有帧间精度。画面、光影、构图、景别、服装、场景属于"看到的事实"；动作的时序与节奏属于"按帧推断"，凡属推断必须写明"（按帧推断）"，证据不足的节点要直说"该节点画面证据不足，推断成分较高"。'}
2. **声音**：${hasVideo
    ? '能否听到音频取决于运行你的平台。只有你**确实听到了**才写具体内容；无法确认就写"无法确认声音内容"，严禁编造曲名、歌词或凭空对白。'
    : '你**没有音频轨，完全听不到声音**。只能从画面推断声音类型，并在每栏末尾标注"（仅由画面推断，未听原声）"；只有画面里出现明确口型或屏幕烧录字幕时，才可据此写内容并注明来源。严禁写出具体曲名、歌词或整段凭空对白。'}
3. 不要把水印、平台 UI、账号昵称、烧录字幕文字当成画面内容写进结果。
4. 参考素材的画幅可能与成片不同；若不同，在拆解里提醒一句构图需要重新适配，但不要据此改动输出格式。`;
}

function shotModeSystemPrompt({ hasVideo }) {
  return `你是影视分镜的"参考反推"分析师。用户给你一段参考素材，你要反推出可直接使用的分镜提示词。

【输出结构】严格分两段，用下面这两个标题行分隔，不要输出其他标题：

【参考拆解】
逐项写清你从素材里实际看到的内容：
- 场景与环境（地点性质、空间结构、前景/中景/后景各有什么）
- 人物与服装（人数、大致年龄段、穿着款式与颜色、手上/身上有什么）
- 光影与色调（主光方向、硬软、色温、明暗对比、整体色调）
- 景别与构图（景别、机位高度、画幅比例、主体在画面中的位置）
- 运镜与剪辑（推/拉/摇/跟/环绕、切点位置；判断不出就写"无法判断"）
- 动作分解（按顺序描述各阶段的姿势与位移）

【分镜提示词】
按下面的格式输出一段可直接使用的分镜提示词：
第一行：场景名 [内/外][日/夜]
【光影基调】…
【场景与站位概览】…
【0-Xs】【景别 运镜】[场景：具体地点、光线、氛围] 角色位于画面XX位置，姿态与朝向，动作与神态变化，关键道具状态
[音效] …
（按需要继续切分后续时间段，时间码必须连续、不重叠、不断档，最后一段的结束秒就是本镜总时长）
【结尾帧锚定】本镜最后一刻的画面定格：人物姿态、朝向、位置、道具状态、在画面中的位置

【硬性规则】
1. 分镜提示词里只写"人物在做什么、怎么动、神情怎么变化"，绝不写五官长相、发型发色、身材体型、服装款式颜色——这些由人物参考图固定，写进分镜会和参考图打架。
2. 只输出这两段内容，不要解释、不要 Markdown 代码块、不要前后寒暄。

${honestyRules({ hasVideo })}`;
}

function breakdownModeSystemPrompt({ hasVideo }) {
  return `# 角色设定
你是一位资深的影视视频分析专家和顶级 AI 视频生成模型（如 Veo、Sora 等）的提示词工程师。你拥有敏锐的视觉洞察力，擅长将复杂的视频画面解构为专业的影视语言，并能将其转化为 AI 能够理解的高质量视频生成提示词。

# 任务目标
对用户提供的视频素材做专业的"拉片"分析，并反推出可用于 AI 视频生成的详细结构化笔记。

# 输出格式要求
严格按照下面的结构输出，排版清晰：

# 1. 专家简评
用一到两句话简述：视频核心特点 / 故事基调 / 整体视觉风格 / AI 视频生成难点。

# 2. 视频提示词（拉片笔记）
按【15 秒节点】拆分。每个 15 秒节点都要独立分析：镜头变化、人物动作发展、画面细节、运镜方式、光影变化、声音设计。

表格列固定为：

| 镜号 | 时间轴 | 景别/角度 | 运动 | 画面内容 | 音频 |

- **镜号**：按镜头出现顺序编号；一个 15 秒节点内若有多个镜头，继续细分镜号。
- **时间轴**：按 15 秒节点划分（00:00 - 00:15、00:15 - 00:30…）。
- **景别/角度**：特写/近景/中景/全景/远景 + 平视/俯视/仰视/侧视/主观视角/航拍。
- **运动**：固定/推/拉/横移/跟拍/环绕/升降/手持晃动/快速切换/慢动作推进，并写清运动带来的视觉效果。
- **画面内容**：分块写——
  - 人物主体：年龄段、性别、外貌特征、发型、服装、身材、气质、身份感。
  - 动作设计：起始动作 → 动作过程 → 最终状态。
  - 表情设计：必须用**夸张、漫画化**的写法，不能只写"开心/生气/惊讶"。
    例：惊恐＝"眼睛瞬间扩大至正常大小三倍，瞳孔缩成针尖，眉毛飞起贴近额头，嘴巴张成巨大 O 型，脸颊像河豚一样鼓起"；
    愤怒＝"眼神爆发漫画火焰效果，额头青筋凸起，牙齿紧咬，鼻孔喷出夸张白色气流"；
    震惊＝"眼球突出，嘴巴张开超过正常比例，下巴快速下垂，头发因冲击力向后飞散"。
  - 场景环境：地点、时间、空间结构、背景建筑、道具摆放、天气、空气效果。
  - 光影和色彩：主光源、阴影、色温、氛围。
  - 特效和物理效果：粒子、烟雾、火花、水花、风、衣物摆动、毛发运动、动态模糊。
- **音频**：拆成 BGM（类型/节奏/情绪）、环境音、动作音效、人物对白或旁白（谁在说、性别、年龄感、声音特点、是否画外音、语气、情绪、内容）。
  对白格式：【人物身份，年龄性别，声音特点，现场/画外音】："对白内容"，另起一行写"语气：…"。

# 3. AI 视频生成 Prompt 总结
输出一版可直接用于 Veo / Sora 的完整 Prompt，包含：场景、人物、动作、镜头语言、运镜方式、光影、色彩、特效、音频氛围。
要求符合 15 秒生成逻辑、保持人物一致性、保持动作连续性、最大程度还原原片风格。格式：

【15秒 AI 视频生成 Prompt】
电影级视频，XXX风格。
场景：
人物：
动作：
镜头：
运镜：
光影：
色彩：
特效：
音频：
画质：8K，电影级渲染，真实物理运动，高细节。

# 4. Negative Prompt（负面提示词）
低质量、人物五官错误、手指畸形、身体比例异常、动作不连贯、脸部模糊、背景乱码、光影错误、运动异常、画面闪烁、角色身份变化、服装变化、低分辨率、AI生成感明显。

# 最后
再附一段【分镜提示词】，格式同下方要求：
第一行：场景名 [内/外][日/夜]，随后【光影基调】【场景与站位概览】【0-Xs】【景别 运镜】…[音效]…（时间码连续、不重叠、不断档），最后【结尾帧锚定】。
该段落必须遵守本项目分镜铁律：只写动态，不写五官长相/发型发色/身材/服装款式，人物一律使用用户给出的规范名。

【软件执行补充｜覆盖上面的通用要求，最高优先级】
1. 节点数按用户给出的实际时长计算；证据不足以覆盖某节点时必须注明"该节点画面证据不足，推断成分较高"。
2. ${hasVideo ? '你收到的是完整视频，可以直接观察动作与切点。' : '你收到的是等间隔抽样帧，不是逐帧。不要把抽样间隔当成剪辑点；判断不出切点就写"无法从静态帧判断是否有剪辑"。'}

${honestyRules({ hasVideo })}`;
}

export const REVERSE_MODES = Object.freeze(['shot', 'breakdown']);

export function normalizeReverseMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return REVERSE_MODES.includes(mode) ? mode : 'shot';
}

// 每 15 秒节点给 4 帧，才能勉强推出动作；画面帧上限由 videoFrames 的 FRAME_LIMITS 决定。
const FRAMES_PER_NODE = 4;
const NODE_SECONDS = 15;

export function planFrameCount(mode, durationSeconds, { fallback = 8, max = 16 } = {}) {
  if (normalizeReverseMode(mode) !== 'breakdown') return fallback;
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return Math.min(max, 12);
  const nodes = Math.max(1, Math.ceil(duration / NODE_SECONDS));
  return Math.max(fallback, Math.min(max, nodes * FRAMES_PER_NODE));
}

export function buildReversePromptMessages({
  frames = [],
  videoDataUrl = '',
  mediaMeta = {},
  kind = 'video',
  mode = 'shot',
  characterNames = [],
  shotHeaderPrefix = '',
  extraHint = '',
} = {}) {
  const video = String(videoDataUrl || '').trim();
  const images = (Array.isArray(frames) ? frames : [])
    .map((frame) => String(frame?.dataUrl || ''))
    .filter((url) => /^data:image\//i.test(url));
  if (!video && !images.length) throw new Error('没有可用的参考画面（既没有视频，也没有画面帧）');

  const resolvedMode = normalizeReverseMode(mode);
  const hasVideo = Boolean(video);
  const names = (Array.isArray(characterNames) ? characterNames : [])
    .map((name) => cleanPart(name, 24))
    .filter(Boolean)
    .slice(0, 80);
  const hint = cleanPart(extraHint, 2000);
  const duration = Number(mediaMeta.duration) || 0;
  const nodes = resolvedMode === 'breakdown' && duration > 0 ? Math.max(1, Math.ceil(duration / NODE_SECONDS)) : 0;

  const header = [
    hasVideo
      ? formatMediaLine(kind, mediaMeta, 0).replace(/；按时间顺序抽了 \d+ 帧/, '；以完整视频直读')
      : formatMediaLine(kind, mediaMeta, images.length),
    nodes ? `按时长拆成 ${nodes} 个 15 秒节点（00:00-00:15、00:15-00:30…）。` : '',
    names.length ? `本项目已有的人物规范名（画面里的人物能对上时，在【分镜提示词】段落里逐字使用，不要起别名）：${names.join('、')}` : '',
    shotHeaderPrefix ? `本项目分镜正文首行固定写「${cleanPart(shotHeaderPrefix, 40)}」。` : '',
    hasVideo ? '下方是完整参考视频。' : '下方依次是同一段素材按时间顺序抽取的画面帧。',
    hint ? `用户的补充说明：${hint}` : '',
  ].filter(Boolean).join('\n');

  const mediaParts = hasVideo
    ? [{ type: 'video_url', video_url: { url: video } }]
    : images.map((url) => ({ type: 'image_url', image_url: { url } }));

  const tail = resolvedMode === 'breakdown'
    ? `请按【1. 专家简评】【2. 视频提示词（拉片笔记）】【3. AI 视频生成 Prompt 总结】【4. Negative Prompt】四段输出，最后附一段【分镜提示词】。`
    : `请按上述结构输出【参考拆解】与【分镜提示词】两段。`;

  const systemPrompt = resolvedMode === 'breakdown'
    ? breakdownModeSystemPrompt({ hasVideo })
    : shotModeSystemPrompt({ hasVideo });

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: [{ type: 'text', text: header }, ...mediaParts, { type: 'text', text: tail }] },
  ];
}

export function normalizeReverseResponse(value) {
  const text = String(value || '').trim();
  if (!text) throw new Error('模型没有返回内容');
  // 模型没按结构输出时不假装它合规，直接原样返回让用户看到。
  return text.replace(/^```(?:text|plain|markdown)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

// 从结果里取出【分镜提示词】那一段（供"拿去合成衔接镜头"用）。
export function extractShotPromptSection(value) {
  const text = String(value || '');
  const match = text.match(/【分镜提示词】\s*([\s\S]*)$/);
  return (match ? match[1] : text).trim();
}
