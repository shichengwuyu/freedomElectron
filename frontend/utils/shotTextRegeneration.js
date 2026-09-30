import {
  normalizeShotEditBody,
  replaceShotBodyInStoryboardContent,
} from './shotUtils.js';

export const SHOT_TEXT_REGENERATION_ENDPOINT = '/api/script/storyboard/shot/regenerate';

export function normalizeRegeneratedShotText(value) {
  let text = String(value || '').trim();
  text = text.replace(/^```(?:text|plain|markdown)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return normalizeShotEditBody(text);
}

export async function regenerateShotTextFlow(shot, handlers = {}) {
  const storyboard = handlers.storyboard?.();
  if (!storyboard) {
    handlers.warning?.('当前集还没有分镜');
    return null;
  }
  if (shot?.fallback || !Number.isFinite(Number(shot?.start)) || !Number.isFinite(Number(shot?.end))) {
    handlers.warning?.('无法定位当前镜头正文，请刷新分镜后重试');
    return null;
  }
  if (handlers.isLocked?.(shot)) {
    handlers.warning?.('该镜头已锁定，请先解锁');
    return null;
  }
  if (handlers.isRunning?.(shot)) return null;

  const shotBody = normalizeShotEditBody(shot.body);
  if (!shotBody) {
    handlers.warning?.('当前镜头正文为空，无法重新生成文本');
    return null;
  }

  const projectId = handlers.projectId?.();
  const episodeId = handlers.episodeId?.();
  const originalContent = String(storyboard.content || '');
  handlers.setRunning?.(shot, true);
  try {
    const result = await handlers.request({
      projectId,
      episodeId,
      shotNo: shot.no,
      shotTitle: String(shot.title || '').trim(),
      shotBody,
      failureReason: String(handlers.failureReason?.(shot) || '').trim(),
    });
    if (result?.ok === false) throw new Error(result.error || result.message || '文本重新生成失败');
    if (handlers.isContextCurrent && !handlers.isContextCurrent(projectId, episodeId)) {
      throw new Error('项目或集数已切换，文本未保存');
    }
    const body = normalizeRegeneratedShotText(result?.text ?? result?.body);
    if (!body) throw new Error('文本模型没有返回可用的镜头正文');

    storyboard.content = replaceShotBodyInStoryboardContent(originalContent, shot, body);
    try {
      const save = handlers.saveScriptNow || handlers.saveScript;
      if (typeof save !== 'function') throw new Error('分镜保存方法不可用');
      await save();
    } catch (error) {
      storyboard.content = originalContent;
      throw error;
    }
    handlers.success?.(`镜头 ${shot.no} 文本已重新生成并保存，请重新生成视频`);
    return { body, content: storyboard.content };
  } catch (error) {
    handlers.error?.(error?.message || '文本重新生成失败');
    return null;
  } finally {
    handlers.setRunning?.(shot, false);
  }
}

export function createShotTextRegenerationRuntime({ api, message, refs = {}, helpers = {}, ref } = {}) {
  const running = typeof ref === 'function' ? ref('') : { value: '' };
  const shotKey = (shot) => `${String(refs.project?.value?.id || '')}:${String(refs.episodeId?.value || '')}:${String(shot?.no ?? '')}`;
  const isShotTextRegenerating = (shot) => running.value === shotKey(shot);
  const setRunning = (shot, active) => {
    running.value = active ? shotKey(shot) : '';
  };
  const regenerateShotText = (shot) => {
    const projectId = refs.project.value?.id;
    const episodeId = refs.episodeId.value;
    return regenerateShotTextFlow(shot, {
      storyboard: () => helpers.findStoryboard(episodeId),
      projectId: () => projectId,
      episodeId: () => episodeId,
      request: (payload) => api.post(SHOT_TEXT_REGENERATION_ENDPOINT, payload),
      saveScriptNow: helpers.saveScriptNow,
      saveScript: helpers.saveScript,
      isLocked: helpers.isShotLocked,
      isRunning: isShotTextRegenerating,
      setRunning,
      failureReason: helpers.failureReason,
      isContextCurrent: () => (
        String(refs.project.value?.id || '') === String(projectId || '')
        && String(refs.episodeId.value || '') === String(episodeId || '')
      ),
      warning: message.warning,
      success: message.success,
      error: message.error,
    });
  };
  return {
    shotTextRegenerating: running,
    isShotTextRegenerating,
    regenerateShotText,
  };
}
