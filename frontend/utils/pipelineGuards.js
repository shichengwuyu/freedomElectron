// 生产流水线的边界校验：HTTP 成功不代表业务成功，SSE done 也不代表产物可用。

export function requireOkResponse(response, fallbackMessage = '操作失败') {
  if (response?.ok === true) return response;
  const message = response?.error || response?.message || fallbackMessage;
  throw new Error(String(message));
}

export function requireGeneratedEpisode(response, episodeId) {
  const content = String(response?.episode?.content || '').trim();
  if (content) return response;
  throw new Error(`第${episodeId}集剧本生成完成但内容为空`);
}

export function requireGeneratedStoryboard(storyboard, episodeId) {
  if (String(storyboard?.content || '').trim()) return storyboard;
  throw new Error(`第${episodeId}集分镜生成完成但内容为空`);
}

export function requireCompletedImageBatch(response, category) {
  if (response?.ok === false) {
    throw new Error(response.error || response.message || `「${category}」出图任务失败`);
  }
  const failed = Array.isArray(response?.failed) ? response.failed.filter(Boolean) : [];
  if (!failed.length) return response;
  throw new Error(`「${category}」出图重试后仍有 ${failed.length} 张失败`);
}
