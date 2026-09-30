export const textBaseUrlOptions = [
  { label: 'GeekNow', value: 'https://www.geeknow.top/v1', websiteUrl: 'https://geeknow.ai/' },
  { label: 'Grsai 国内节点', value: 'https://grsai.dakka.com.cn/v1', websiteUrl: 'https://grsai.ai/zh/dashboard/api-keys' },
  { label: 'Grsai 全球节点', value: 'https://grsaiapi.com/v1', websiteUrl: 'https://grsai.ai/zh/dashboard/api-keys' },
  { label: 'DeepSeek', value: 'https://api.deepseek.com', websiteUrl: 'https://platform.deepseek.com/' },
];

export const textModelOptions = [
  { label: 'gpt-5.5', value: 'gpt-5.5' },
  { label: 'deepseek-v4-pro', value: 'deepseek-v4-pro' },
  { label: 'gemini-3-pro-preview', value: 'gemini-3-pro-preview' },
];

export const imageBaseUrlOptions = [
  { label: 'GeekNow', value: 'https://www.geeknow.top/v1', websiteUrl: 'https://geeknow.ai/' },
  { label: 'Grsai 国内节点', value: 'https://grsai.dakka.com.cn', websiteUrl: 'https://grsai.ai/zh/dashboard/api-keys' },
  { label: 'Grsai 全球节点', value: 'https://grsaiapi.com', websiteUrl: 'https://grsai.ai/zh/dashboard/api-keys' },
];

// 内置默认 Base URL(api.xiaoyxiao.xyz/v1) 上实测可用的生图模型：
//   gpt-image-2-特价      → /images/generations，~30s 返回 b64 ✅
//   gpt-image-2.5-sunburs → /images/generations，~90s 返回 url ✅
//   gpt-image-2.5-flare   → 同协议，上游偶发 "Generation failed"（会自动退额度）
// new-api 按模型名精确匹配渠道，默认项必须是网关真实注册的名字，否则会报
// "No available channel for model gpt-image-2 under group default"。
// 注意：GPT-image-2 / Image-nano-banana* 系列当前取不到图，已由后端发现逻辑过滤，不要加回来。
export const imageModelOptions = [
  { label: 'gpt-image-2-特价（XiaoyXiao 网关 · 默认）', value: 'gpt-image-2-特价' },
  { label: 'gpt-image-2.5-sunburs（XiaoyXiao 网关）', value: 'gpt-image-2.5-sunburs' },
  { label: 'gpt-image-2.5-flare（XiaoyXiao 网关 · 上游偶发失败）', value: 'gpt-image-2.5-flare' },
  { label: 'gpt-image-2', value: 'gpt-image-2' },
  { label: 'gpt-image-2-pro', value: 'gpt-image-2-pro' },
  { label: 'gpt-image-2-vip', value: 'gpt-image-2-vip' },
];

export const grsaiImageModelOptions = [
  { label: 'gpt-image-2', value: 'gpt-image-2' },
  { label: 'gpt-image-2-vip', value: 'gpt-image-2-vip' },
  { label: 'nano-banana-2', value: 'nano-banana-2' },
  { label: 'nano-banana', value: 'nano-banana' },
  { label: 'nano-banana-fast', value: 'nano-banana-fast' },
  { label: 'nano-banana-2-cl', value: 'nano-banana-2-cl' },
  { label: 'nano-banana-2-2k-cl', value: 'nano-banana-2-2k-cl' },
  { label: 'nano-banana-2-4k-cl', value: 'nano-banana-2-4k-cl' },
  { label: 'nano-banana-pro', value: 'nano-banana-pro' },
  { label: 'nano-banana-pro-vt', value: 'nano-banana-pro-vt' },
  { label: 'nano-banana-pro-cl', value: 'nano-banana-pro-cl' },
  { label: 'nano-banana-pro-vip', value: 'nano-banana-pro-vip' },
  { label: 'nano-banana-pro-4k-vip', value: 'nano-banana-pro-4k-vip' },
];

export const styleOptions = [
  { label: '真人实拍', value: 'realistic' },
  { label: '2D 日漫', value: 'anime' },
  { label: '3D 国漫', value: '3d' },
  { label: '漫剧', value: 'webtoon' },
  { label: '水墨国风', value: 'inkwash' },
  { label: '美漫', value: 'american' },
  { label: '黏土定格', value: 'clay' },
];

export const stylePromptFields = [
  { key: 'realistic', label: '真人实拍画风', placeholder: '例如：高端影视演员定妆照，真实皮肤纹理，柔和电影光，白底人物设定图' },
  { key: 'anime', label: '2D 日漫画风', placeholder: '例如：高质量日系厚涂角色设定，干净线稿，通透色彩，精修封面插画质感' },
  { key: '3d', label: '3D 国漫画风', placeholder: '例如：3D国漫风格，UE5渲染，8K，电影级光影，PBR材质，发丝和服装层次清晰' },
  { key: 'webtoon', label: '漫剧画风', placeholder: '例如：2D 动态漫画/韩漫条漫风，清晰描线，干净上色，影视级打光，网感高颜值' },
  { key: 'inkwash', label: '水墨国漫画风', placeholder: '例如：水墨写意与国风插画融合，留白构图，墨色晕染，青绿/绛红传统配色，宣纸质感' },
  { key: 'american', label: '美漫画风', placeholder: '例如：美式漫画硬朗描线，强对比块面光影，经典分色印刷质感，海报级构图' },
  { key: 'clay', label: '黏土定格画风', placeholder: '例如：黏土定格动画，可见黏土肌理与手作痕迹，微缩影棚布光，浅景深实拍质感' },
];

export const elementPromptFields = [
  { key: 'character', label: '人物提示词', placeholder: '例如：单人全身角色设定图，纯色背景，柔和光线，服装与面部细节清晰' },
  { key: 'group', label: '群像提示词', placeholder: '例如：多人全身群像设定图，站位错落，每个人的外貌和服装有明显区别' },
  { key: 'scene', label: '场景提示词', placeholder: '例如：宽幅环境概念图，空间结构清晰，电影感光影，画面中不出现人物' },
  { key: 'prop', label: '道具提示词', placeholder: '例如：单个物品居中展示，纯色背景，清楚表现造型、材质、颜色和纹饰' },
  { key: 'effect', label: '特效提示词', placeholder: '例如：特效概念图，突出能量形态、颜色、发光边缘和运动轨迹' },
  { key: 'creature', label: '生物提示词', placeholder: '例如：完整生物设定图，主体轮廓清晰，突出体型、材质和标志性特征' },
];

export const imageRatioOptions = [
  { label: '16:9 横版', value: '16:9' },
  { label: '4:3 横版', value: '4:3' },
  { label: '3:4 竖版', value: '3:4' },
  { label: '9:16 竖版', value: '9:16' },
  { label: '自定义', value: 'custom' },
];

export const characterImageModeOptions = [
  { label: '脸部+全身', value: 'double' },
  { label: '脸部+三视图', value: 'threeView' },
  { label: '脸部（分开）+三视图', value: 'threeViewSplitFace' },
  { label: '彩绘设定板+三视图（防卡脸·推荐）', value: 'threeViewPainting' },
  { label: '专业角色设计', value: 'professionalDesign' },
];

export const elementFilterOptions = {
  hasImage: [
    { label: '全部', value: 'all' },
    { label: '有图', value: 'yes' },
    { label: '无图', value: 'no' },
  ],
  isEdited: [
    { label: '全部', value: 'all' },
    { label: '已编辑', value: 'yes' },
    { label: '未编辑', value: 'no' },
  ],
  sortBy: [
    { label: '默认', value: 'default' },
    { label: '名称', value: 'name' },
    { label: '最近修改', value: 'recent' },
  ],
};

export const batchCategoryOptions = [
  { label: '当前分类', value: 'current' },
  { label: '全部', value: 'all' },
  { label: '人物', value: 'character' },
  { label: '群像', value: 'group' },
  { label: '场景', value: 'scene' },
  { label: '道具', value: 'prop' },
  { label: '特效', value: 'effect' },
  { label: '妖兽', value: 'creature' },
];

export const extractionCategoryOptions = [
  { label: '全部元素', value: 'all' },
  { label: '仅人物', value: 'character' },
  { label: '仅群像', value: 'group' },
  { label: '仅场景', value: 'scene' },
  { label: '仅道具', value: 'prop' },
  { label: '仅特效', value: 'effect' },
  { label: '仅妖兽', value: 'creature' },
];

export const videoProviderOptions = [
  { label: '小云雀', value: 'xiaoyunque' },
  { label: '即梦 CLI', value: 'dreamina-cli' },
  { label: '即梦 Agent', value: 'dreamina-agent' },
  { label: 'LibTV CLI', value: 'libtv-cli' },
  { label: 'UpDream', value: 'updream' },
  { label: 'Neowow', value: 'neowow' },
  { label: 'ComfyUI U09/U07', value: 'comfyui' },
  { label: '视频 API', value: 'video-api' },
];

export const xiaoyunqueModelOptions = [
  { label: 'Seedance 2.0 Mini Lite（普通）', value: 'Seedance_2.0_mini_lite' },
  { label: 'Seedance 2.0 Mini（VIP）', value: 'Seedance_2.0_mini' },
  { label: 'Seedance 2.0 Direct（VIP）', value: 'seedance2.0_direct' },
  { label: 'Seedance 2.0 Fast Direct（VIP）', value: 'seedance2.0_fast_direct' },
  { label: 'Seedance 2.0 Vision（VIP）', value: 'seedance2.0_vision' },
  { label: 'Seedance 2.0 Fast Vision（VIP）', value: 'seedance2.0_fast_vision' },
  { label: 'Wan 3.0', value: 'Wan_3.0' },
  { label: 'MiniMax H3', value: 'MiniMax_H3' },
];

export const dreaminaModelOptions = [
  { label: 'CLI 默认', value: '' },
  { label: 'Seedance 2.5（VIP）', value: 'seedance2.5' },
  { label: 'Seedance 2.0 mini', value: 'seedance2.0mini' },
  { label: 'Seedance 2.0 Fast', value: 'seedance2.0fast' },
  { label: 'Seedance 2.0', value: 'seedance2.0' },
  { label: 'Seedance 2.0 Fast VIP', value: 'seedance2.0fast_vip' },
  { label: 'Seedance 2.0 VIP', value: 'seedance2.0_vip' },
];

export const libtvModelNames = Object.freeze([
  'Seedance 2.0 VIP',
  'Seedance 2.0 Fast VIP',
  'Seedance 2.0 Mini',
  'Seedance 2.5',
  'Minimax H3',
  'Wan 3.0',
  'Wan 3.0 Prime',
]);

export const libtvModelOptions = libtvModelNames.map((model) => ({ label: model, value: model }));

export const updreamModelOptions = [
  { label: 'Seedance 2.0 Fast', value: 'sed2-fast' },
  { label: 'Seedance 2.0', value: 'sed2' },
  { label: 'Seedance 2.5', value: 'sed2-5' },
  { label: 'MiniMax H3', value: 'hailuo-h3' },
  { label: 'Wan 3.0', value: 'wan-3.0' },
];

export const neowowModelOptions = [
  { label: 'Seedance 2.0', value: 'neo-video-2-0' },
  { label: 'Seedance 2.0 fast', value: 'neo-video-2-0-fast' },
  { label: 'Seedance 2.0 Mini', value: 'doubao-seedance-2-0-mini-260615' },
  { label: 'Seedance 2.5', value: 'doubao-seedance-2-5-260628' },
  { label: 'MiniMax H3', value: 'MiniMax-H3' },
  { label: 'Wan 3.0', value: 'wan3.0-video' },
];

export const comfyUiWorkflowOptions = [
  {
    label: 'U09 · MiniMax H3 二采重绘',
    value: 'u09',
    path: 'workflows/U视频-MINIMAX-H3/U09-Minimax-H3二采重绘-秒变清晰-超高一致性-效率起飞wuwukasi.json',
  },
  {
    label: 'U07 · MiniMax H3 全能参考',
    value: 'u07',
    path: 'workflows/U视频-MINIMAX-H3/U07-MiniMax-H3全能参考工作流Work-Fisher.json',
  },
];

export const videoApiModelOptions = [
  { label: 'kling-O3', value: 'kling-O3' },
  { label: 'sd-1080p', value: 'sd-1080p' },
  { label: 'sd-2.0', value: 'sd-2.0' },
  { label: 'sd-2.0-fast', value: 'sd-2.0-fast' },
  { label: 'sd-2.5', value: 'sd-2.5' },
  { label: 'sd-720p', value: 'sd-720p' },
  { label: 'sdf-720p', value: 'sdf-720p' },
];

export const videoResolutionOptions = [
  { label: '480p', value: '480p' },
  { label: '720p', value: '720p' },
  { label: '768P', value: '768p' },
  { label: '1080p', value: '1080p' },
  { label: '2K', value: '2k' },
  { label: '4K', value: '4k' },
];
