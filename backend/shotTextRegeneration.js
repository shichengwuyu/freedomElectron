const SHOT_TEXT_REGENERATION_SYSTEM_PROMPT = `你是影视分镜提示词安全改写器。
请把一个镜头正文改写成适合视频生成平台的安全、清晰、可执行中文提示词。
必须遵守：
1. 保留原镜头的时长区间、景别、机位或镜头运动、人物身份、场景、服装、情绪、对白和音效功能，以及动作之间的因果关系。
2. 对暴力、血腥、伤口细节、虐待、色情、露骨性行为、性器官和其他容易触发审核的内容，改写成非露骨、非血腥的影视化表达；可以使用对峙、冲突、动作被打断、画面切到反应、烟尘遮挡等方式表现剧情，不得新增刺激细节。
3. 涉政/政治敏感表述同样必须改写，这是国内平台最高频的拒审原因之一：把"政治罪名、立场标签、现实政治指称"换成剧情内的具体行为和私人恩怨。
   - 例："卖国贼 / 汉奸 / 叛国" → "害得裴家满门获罪的那个人"；"通敌" → "与外人勾结的罪状"；"把他爹的坟给刨了" → "扬言要毁了裴家先人的安息之地"。
   - 不保留罪名定性；不出现现实国家、政党、领导人、政治运动或口号的指称；也不要新增任何政治指涉。
4. 风险词出现在台词里时，允许在不改变说话人、语气强度和剧情意图的前提下替换措辞；不得因此删掉这句话或削弱它的戏剧作用。
5. 不改变人物关系、关键剧情意图和镜头节奏，不把危险行为写成可模仿的操作说明。
6. 只输出重写后的镜头正文，不要输出镜头标题、解释、引号、Markdown、安全声明或其他前后缀。`;

// 高风险的涉政/立场标签词：国内平台的高频拒审点。改写后若仍然出现，说明这次改写没生效，
// 继续提交只会再被拒一次，所以要能识别出来（见 regenerateShotTextWithModel 的校验）。
export const RISKY_TEXT_PATTERNS = [
  /卖国贼|汉奸|叛国|辱华|反华|亡国奴/,
  /造反|起义|革命党|政治犯/,
];

function cleanPromptPart(value, maxLength) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, maxLength);
}

export function buildShotTextRegenerationMessages({
  episodeTitle = '',
  shotNo = '',
  shotTitle = '',
  shotBody = '',
  failureReason = '',
} = {}) {
  const title = cleanPromptPart(episodeTitle, 120) || '未命名集';
  const number = cleanPromptPart(shotNo, 40) || '未知';
  const sceneTitle = cleanPromptPart(shotTitle, 120) || '未命名镜头';
  const body = cleanPromptPart(shotBody, 12000);
  const reason = cleanPromptPart(failureReason, 800);
  return [
    { role: 'system', content: SHOT_TEXT_REGENERATION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `集标题：${title}`,
        `第${number}镜：${sceneTitle}`,
        '原镜头正文：',
        body,
        reason ? `\n视频服务失败提示（仅用于判断风险，不要复述）：${reason}` : '',
        '\n请输出改写后的镜头正文。',
      ].filter(Boolean).join('\n'),
    },
  ];
}

export function normalizeShotTextResponse(value) {
  let text = String(value || '').trim();
  text = text.replace(/^```(?:text|plain|markdown)?\s*/i, '').replace(/\s*```$/i, '').trim();
  text = text.replace(/^(?:(?:分镜|镜头)\s*\d+\s*[：:]|【(?:分镜|镜头)\s*\d+】)\s*(?:\r?\n)?/i, '').trim();
  return text;
}

// 文本模型自己也可能拒绝改写（它会把安全判定当回复返回，例如
// "User Safety: unsafe / Safety Categories: Violence, Criminal Planning/Confessions"）。
// 这种回复绝不能当成新正文写回分镜——会把原镜头正文整段覆盖掉。
const MODEL_REFUSAL_PATTERNS = [
  /(?:^|\n)\s*(?:user[_ ]safety|safety[_ ]categories)\s*[:：]/i,
  /safety[_ ]categories\s*[:：]/i,
  /(?:I can(?:'|no)?t|I cannot|I'm sorry|I am sorry|Sorry)[,\s]+(?:I|cannot|but)/i,
  /(?:抱歉|对不起)[，,。!！]?\s*(?:我)?(?:无法|不能|不便|恕难)/,
  /作为(?:一个)?\s*(?:AI|人工智能|语言模型|助手)/,
];

export function isShotTextRefusal(value) {
  const text = String(value || '').trim();
  if (!text) return true;
  if (MODEL_REFUSAL_PATTERNS.some((pattern) => pattern.test(text))) return true;
  // 有效的镜头正文是完整分镜描述：过短又没有任何分镜结构标记，说明模型没真在改写。
  return text.length < 80 && !/【/.test(text);
}

export async function regenerateShotTextWithModel({
  episodeTitle = '',
  shotNo = '',
  shotTitle = '',
  shotBody = '',
  failureReason = '',
  generate,
} = {}) {
  if (typeof generate !== 'function') throw new Error('文本生成方法不可用');
  const raw = await generate(
    buildShotTextRegenerationMessages({ episodeTitle, shotNo, shotTitle, shotBody, failureReason }),
    { temperature: 0.2, maxTokens: 5000 },
  );
  const text = normalizeShotTextResponse(raw);
  if (!text) throw new Error('文本模型没有返回可用的镜头正文');
  // 模型拒答（返回安全判定/套话）时必须报错而不是写回分镜，否则会把原镜头正文覆盖掉。
  if (isShotTextRefusal(text)) {
    throw new Error(`文本模型拒绝了这次改写（返回：${text.slice(0, 60).replace(/\s+/g, ' ')}…），原镜头正文未改动；可换一个文本模型或手动调整后再试`);
  }
  // 涉政/立场标签词没被改掉时不能写回：继续提交几乎必然再被上游拒一次（白跑一轮）。
  const risky = [...new Set(RISKY_TEXT_PATTERNS.map((re) => text.match(re)?.[0]).filter(Boolean))];
  if (risky.length) {
    throw new Error(
      `改写后正文里仍有高风险措辞「${risky.join('、')}」，继续提交大概率再被拒，原镜头正文未改动。`
      + '可换一个文本模型重试，或手动把这处改成剧情内的具体行为'
      + '（例如"卖国贼"→"害得裴家满门获罪的那个人"），再点「重新生成视频」',
    );
  }
  return text;
}
