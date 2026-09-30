// 片头：项目级共用的开场片段（比如魔性跳舞片段）。
// 全项目所有集共用一段，导出成片 / 剪映草稿时排在镜头1之前；
// 刻意不进 storyboard.content —— 那边会被插入/删除/重排整体重写成「分镜N：」，
// 片头写进去就会被当垃圾文本删掉，所以它只存在 project.introClip 里。
export function createIntroClipRuntime({ api, message, ref, computed, refs = {} } = {}) {
  // 无渲染层的调用方（比如 .workbuddy 下的无头测试）不传 ref/computed，
  // 这里退化成普通取值器，保证这些调用方不会因为少传参数而崩。
  const makeRef = typeof ref === 'function' ? ref : ((initial) => ({ value: initial }));
  const makeComputed = typeof computed === 'function' ? computed : ((getter) => ({ get value() { return getter(); } }));

  const introBusy = makeRef(false);
  const introError = makeRef('');

  const projectId = () => String(refs.project?.value?.id || '');
  const projectObject = () => refs.project?.value || null;

  const introClip = makeComputed(() => projectObject()?.introClip || null);
  const introUrl = makeComputed(() => introClip.value?.url || '');
  const introEnabled = makeComputed(() => (introClip.value ? introClip.value.enabled !== false : false));
  const introDurationText = makeComputed(() => {
    const seconds = Number(introClip.value?.durationSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    return `${Math.round(seconds * 10) / 10}s`;
  });

  const setIntroClip = (next) => {
    const project = projectObject();
    if (!project) return;
    if (next) project.introClip = next;
    else delete project.introClip;
  };

  const importIntro = async (file) => {
    const id = projectId();
    if (!id || !file) return null;
    introBusy.value = true;
    introError.value = '';
    try {
      const url = `/api/video/intro/import?projectId=${encodeURIComponent(id)}&name=${encodeURIComponent(file.name || '片头')}`;
      const result = await api.upload(url, file);
      setIntroClip(result?.introClip || null);
      message?.success?.('片头已导入，导出时会排在镜头1之前');
      return result?.introClip || null;
    } catch (error) {
      introError.value = error?.message || '片头导入失败';
      message?.error?.(introError.value);
      return null;
    } finally {
      introBusy.value = false;
    }
  };

  // 文件选择框的 change 处理器：先取文件再清空 input，保证同一个文件能重复选。
  const onPickIntroClip = async (event) => {
    const file = event?.target?.files?.[0] || null;
    if (event?.target) event.target.value = '';
    if (!file) return null;
    return importIntro(file);
  };

  const setIntroEnabled = async (enabled) => {
    const id = projectId();
    if (!id || !introClip.value) return null;
    introBusy.value = true;
    introError.value = '';
    try {
      const result = await api.post('/api/video/intro/update', { projectId: id, enabled: enabled !== false });
      setIntroClip(result?.introClip || null);
      return result?.introClip || null;
    } catch (error) {
      introError.value = error?.message || '片头状态更新失败';
      message?.error?.(introError.value);
      return null;
    } finally {
      introBusy.value = false;
    }
  };

  const removeIntro = async () => {
    const id = projectId();
    if (!id || !introClip.value) return false;
    introBusy.value = true;
    introError.value = '';
    try {
      await api.post('/api/video/intro/remove', { projectId: id });
      setIntroClip(null);
      message?.success?.('片头已清除');
      return true;
    } catch (error) {
      introError.value = error?.message || '片头清除失败';
      message?.error?.(introError.value);
      return false;
    } finally {
      introBusy.value = false;
    }
  };

  return {
    introClip,
    introUrl,
    introEnabled,
    introDurationText,
    introBusy,
    introError,
    importIntro,
    onPickIntroClip,
    setIntroEnabled,
    removeIntro,
  };
}
