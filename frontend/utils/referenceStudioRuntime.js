// 参考反推 + 衔接合成：
//   参考视频/图片 →（ffmpeg 抽帧 + vision）→ 分镜提示词 →（一次模型调用）→ 带承接定帧与转场的镜头
//   最后用现成的 insertShot{Before,After}Flow 落盘（编号、元数据、磁盘文件一起平移）。
// 不直接 import shotUtils：那条路径会和 shotUtils 形成循环依赖，需要的纯函数由调用方注入。
export function createReferenceStudioRuntime({
  api,
  message,
  ref,
  computed,
  refs = {},
  helpers = {},
  insertShotBefore,
  insertShotAfter,
} = {}) {
  // 无渲染层的调用方（.workbuddy 下的无头测试）不传 ref/computed，退化成普通取值器。
  const makeRef = typeof ref === 'function' ? ref : ((initial) => ({ value: initial }));
  const makeComputed = typeof computed === 'function' ? computed : ((getter) => ({ get value() { return getter(); } }));

  const studio = makeRef({
    visible: false,
    reverseBusy: false,
    reverseError: '',
    reverseText: '',
    reverseMedia: null,
    reverseFrames: 0,
    frameCount: 8,
    hint: '',
    mode: 'shot',
    // 默认走视频直读：抽帧只对"静态风格参考"（构图/光影/色调/服装）有用，
    // 对跳舞、打斗这类靠动作与节奏的参考，帧里没有时间信息，反推出来基本是猜的。
    inputMode: 'video',
    inputUsed: '',
    videoFallbackReason: '',
    composeBusy: false,
    composeError: '',
    description: '',
    anchorShotNo: '',
    position: 'before',
    insertAtNo: 0,
    result: null,
    resultEdited: '',
    patchApplied: false,
    inserting: false,
  });
  const set = (patch) => { studio.value = { ...studio.value, ...patch }; };

  const projectId = () => String(refs.project?.value?.id || '');
  const episodeId = () => Number(refs.episodeId?.value) || 0;
  const storyboard = () => helpers.findStoryboard?.(refs.episodeId?.value) || null;
  const shots = () => helpers.parseShots?.(storyboard()?.content || '') || [];
  // 插入只能发生在当前集（insertShot*Flow 操作的就是当前分镜），所以镜头列表也取当前集。
  const referenceStudioShots = makeComputed(() => shots().map((item) => ({ no: String(item.no), title: String(item.title || '') })));
  const referenceStudioEpisodeId = makeComputed(() => episodeId());

  const openReferenceStudio = () => {
    const list = shots();
    set({
      visible: true,
      anchorShotNo: String(list[0]?.no || '1'),
      position: 'before',
      reverseError: '',
      composeError: '',
    });
  };
  const closeReferenceStudio = () => set({ visible: false });

  // 参考反推：原始字节上传（和「导入本地预览」同一条路），后端负责抽帧与 vision。
  const reverseReference = async (file, { count, hint } = {}) => {
    const id = projectId();
    if (!id || !file) return null;
    const kind = /^image\//i.test(file.type || '') ? 'image' : 'video';
    set({ reverseBusy: true, reverseError: '', reverseText: '', result: null, inputUsed: '', videoFallbackReason: '' });
    try {
      const frames = Number.isFinite(Number(count)) && Number(count) > 0
        ? Math.floor(Number(count))
        : Number(studio.value.frameCount) || 8;
      const extraHint = String(hint === undefined ? studio.value.hint : hint || '').trim();
      const params = new URLSearchParams({
        projectId: id,
        kind,
        count: String(frames),
        mode: studio.value.mode === 'breakdown' ? 'breakdown' : 'shot',
        input: ['video', 'frames', 'auto'].includes(studio.value.inputMode) ? studio.value.inputMode : 'auto',
      });
      if (extraHint) params.set('hint', extraHint);
      const result = await api.upload(`/api/script/reference/reverse?${params.toString()}`, file);
      set({
        reverseText: String(result?.prompt || ''),
        reverseMedia: result?.media || null,
        reverseFrames: Number(result?.frames) || 0,
        inputUsed: String(result?.inputUsed || ''),
        videoFallbackReason: String(result?.videoFallbackReason || ''),
      });
      const used = String(result?.inputUsed || '');
      const how = used === 'video' ? '视频直读' : (used === 'image' ? '图片' : `${result?.frames || 0} 帧`);
      message?.success?.(`参考反推完成（${how}）`);
      return result;
    } catch (error) {
      const text = error?.message || '参考反推失败';
      set({ reverseError: text });
      message?.error?.(text);
      return null;
    } finally {
      set({ reverseBusy: false });
    }
  };

  // 文件选择框的 change 处理器：先取文件再清空 input，保证同一个文件能重复选。
  const onPickReferenceFile = async (event, options = {}) => {
    const file = event?.target?.files?.[0] || null;
    if (event?.target) event.target.value = '';
    if (!file) return null;
    return reverseReference(file, options);
  };

  // 反推结果里【分镜提示词】那一段，直接送去合成。
  const useReverseForCompose = () => {
    const text = String(studio.value.reverseText || '');
    const match = text.match(/【分镜提示词】\s*([\s\S]*)$/);
    const section = (match ? match[1] : text).trim();
    if (!section) {
      message?.warning?.('还没有可用的反推结果');
      return;
    }
    set({ description: section, composeError: '' });
    message?.success?.('已填入衔接合成，接着选插入位置即可');
  };

  const composeShot = async () => {
    const id = projectId();
    const targetEpisode = episodeId();
    const anchorShotNo = String(studio.value.anchorShotNo || '').trim();
    const description = String(studio.value.description || '').trim();
    if (!id) return null;
    if (!targetEpisode) { message?.warning?.('请先选择一集'); return null; }
    if (!anchorShotNo) { message?.warning?.('请先选择基准镜头'); return null; }
    if (!description) { message?.warning?.('请先填写要插入的镜头描述或提示词'); return null; }
    set({ composeBusy: true, composeError: '', result: null });
    try {
      const result = await api.post('/api/script/storyboard/shot/compose', {
        projectId: id,
        episodeId: targetEpisode,
        anchorShotNo,
        position: studio.value.position === 'after' ? 'after' : 'before',
        description,
      });
      set({
        result,
        resultEdited: String(result?.shotText || ''),
        insertAtNo: Number(result?.insertAtNo) || 0,
      });
      return result;
    } catch (error) {
      const text = error?.message || '衔接镜头合成失败';
      set({ composeError: text });
      message?.error?.(text);
      return null;
    } finally {
      set({ composeBusy: false });
    }
  };

  // 把合成结果插进分镜。关键顺序：**先给"后一镜"打承接补丁，再插入** ——
  // 插入会把整段正文连同编号一起平移，所以插入前改好，比插入后再去找第 N+1 镜可靠得多。
  const insertComposedShot = async () => {
    const snapshot = studio.value;
    const result = snapshot.result;
    const shotText = String(snapshot.resultEdited || result?.shotText || '').trim();
    if (!result || !shotText) { message?.warning?.('还没有可插入的镜头内容'); return false; }
    const board = storyboard();
    if (!board) { message?.warning?.('当前集还没有分镜'); return false; }
    const list = shots();
    const anchor = list.find((item) => String(item.no) === String(snapshot.anchorShotNo));
    if (!anchor) { message?.warning?.('找不到目标镜头，可能分镜已变化，请重新生成'); return false; }

    const position = snapshot.position === 'after' ? 'after' : 'before';
    // 补丁要打在"插入后会排在它后面"的那个镜头上。
    const patchTargetNo = position === 'before' ? Number(anchor.no) : Number(anchor.no) + 1;
    const patch = result.nextShotPatch;
    let patched = false;

    set({ inserting: true });
    try {
      if (patch?.needPatch && patch?.patch) {
        const target = list.find((item) => String(item.no) === String(patchTargetNo));
        if (target && helpers.applyCarryPatch) {
          const nextBody = helpers.applyCarryPatch(String(target.body || ''), patch.patch);
          board.content = helpers.replaceShotBodyInStoryboardContent(board.content, target, nextBody);
          patched = true;
        }
      }
      const insert = position === 'before' ? insertShotBefore : insertShotAfter;
      await insert(anchor, {
        insertBody: shotText,
        successMessage: patched
          ? `已插入新镜头，并改写了后一镜的承接定帧`
          : `已插入新镜头`,
      });
      helpers.saveScript?.();
      set({ patchApplied: patched, result: null, resultEdited: '', visible: false });
      return true;
    } catch (error) {
      message?.error?.(error?.message || '插入失败');
      return false;
    } finally {
      set({ inserting: false });
    }
  };

  return {
    referenceStudio: studio,
    referenceStudioShots,
    referenceStudioEpisodeId,
    openReferenceStudio,
    closeReferenceStudio,
    reverseReference,
    onPickReferenceFile,
    useReverseForCompose,
    composeShot,
    insertComposedShot,
  };
}

// 把新的【承接定帧】整段贴回镜头正文：原有承接行就地替换，没有则插在首行之后。
// 与 splitShot.js 里拆镜时重建承接用的是同一套写法（承接定帧是单行）。
export function applyCarryPatchToBody(body, patchText) {
  const text = String(body || '');
  const line = String(patchText || '').trim();
  if (!line) return text;
  const normalized = /^【承接定帧】/.test(line) ? line : `【承接定帧】${line}`;
  const carryLineRe = /^[ \t]*【承接定帧】.*$/m;
  if (carryLineRe.test(text)) return text.replace(carryLineRe, normalized);
  const breakAt = text.indexOf('\n');
  if (breakAt < 0) return `${text}\n${normalized}`;
  return `${text.slice(0, breakAt)}\n${normalized}${text.slice(breakAt)}`;
}
