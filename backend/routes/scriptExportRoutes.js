import { buildScriptExport, buildStoryboardExport } from '../docExport.js';
import { exportStoryboardCards, loadProject, normalizeProjectScript, pickFolder } from '../storage.js';

export async function handleScriptExportRoutes({ req, res, url, p, method, readBody, sendJson }) {
  if (p === '/api/script/export' && method === 'GET') {
    const project = loadProject(url.searchParams.get('id'));
    if (!project) return sendJson(res, 404, { error: '项目不存在' });
    normalizeProjectScript(project);
    const script = project.script;
    const kind = url.searchParams.get('kind') === 'storyboard' ? 'storyboard' : 'script';
    const format = url.searchParams.get('format') === 'docx' ? 'docx' : 'txt';
    const merged = url.searchParams.get('merged') === '1';
    const episodeId = url.searchParams.get('episodeId');
    const chapterId = url.searchParams.get('chapterId');
    // 注意：Number(null) === 0 而不是 NaN，所以必须先判断参数是否存在/为空，
    // 否则"不填范围"会被当成 from=0,to=0，把 id≥1 的集全部过滤掉。
    const rawFrom = url.searchParams.get('fromEpisodeId');
    const rawTo = url.searchParams.get('toEpisodeId');
    const fromEpisodeId = rawFrom == null || String(rawFrom).trim() === '' ? NaN : Number(rawFrom);
    const toEpisodeId = rawTo == null || String(rawTo).trim() === '' ? NaN : Number(rawTo);
    try {
      let episodes = script.episodes || [];
      if (episodeId) episodes = episodes.filter((episode) => episode.id === Number(episodeId));
      else if (chapterId) episodes = episodes.filter((episode) => episode.chapterId === Number(chapterId));
      else if (Number.isFinite(fromEpisodeId) || Number.isFinite(toEpisodeId)) {
        // 集数范围：只填起点=从该集到最后；与「导出成片」的范围语义保持一致（两端都是闭区间）。
        episodes = episodes.filter((episode) => {
          const no = Number(episode.id);
          if (!Number.isFinite(no)) return false;
          if (Number.isFinite(fromEpisodeId) && no < fromEpisodeId) return false;
          if (Number.isFinite(toEpisodeId) && no > toEpisodeId) return false;
          return true;
        });
      }
      episodes = episodes.slice().sort((a, b) => a.id - b.id);
      let items;
      if (kind === 'storyboard') {
        const episodeIds = new Set(episodes.map((episode) => episode.id));
        items = (script.storyboards || [])
          .filter((storyboard) => episodeIds.has(storyboard.episodeId))
          .sort((a, b) => a.episodeId - b.episodeId)
          .map((storyboard) => ({ title: `第${storyboard.episodeId}集 ${storyboard.episodeTitle || ''}`.trim(), content: storyboard.content || '' }));
      } else {
        items = episodes.map((episode) => ({ title: `第${episode.id}集 ${episode.title || ''}`.trim(), content: episode.content || '' }));
      }
      if (!items.length) return sendJson(res, 400, { error: '没有可导出的内容' });
      const builder = kind === 'storyboard' ? buildStoryboardExport : buildScriptExport;
      const output = await builder(project.name, items, { format, merged: merged || items.length === 1 });
      res.writeHead(200, {
        'Content-Type': output.mime,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(output.filename)}"`,
      });
      res.end(output.buffer);
      return true;
    } catch (error) {
      return sendJson(res, 200, { ok: false, error: error.message });
    }
  }

  if (p === '/api/script/storyboard/export-cards' && method === 'POST') {
    const body = await readBody(req);
    const project = loadProject(body.projectId);
    if (!project) return sendJson(res, 404, { error: '项目不存在' });
    normalizeProjectScript(project);
    const episodeId = Number(body.episodeId);
    const episode = project.script.episodes.find((item) => item.id === episodeId);
    if (!episode) return sendJson(res, 404, { error: '该集不存在' });
    const storyboard = project.script.storyboards.find((item) => item.episodeId === episodeId);
    if (!storyboard?.content) return sendJson(res, 400, { error: '该集还没有分镜' });
    const target = pickFolder();
    if (!target) return sendJson(res, 200, { ok: false, canceled: true });
    try {
      const result = await exportStoryboardCards(project, target, episode, storyboard);
      if (!result.shots) return sendJson(res, 200, { ok: false, error: '没有可导出的镜头' });
      return sendJson(res, 200, { ok: true, shots: result.shots, target: result.target });
    } catch (error) {
      return sendJson(res, 200, { ok: false, error: error.message });
    }
  }
  return false;
}
