import { loadConfig } from '../config.js';
import { extractElements } from '../extractor.js';
import { getJob, registerJobActions, setJob } from '../jobs.js';
import { hasTextModelKey, resolveTextModelConfig } from '../modelRouting.js';
import { loadProject, normalizeProjectScript, saveProject, MAIN_CATEGORIES } from '../storage.js';
import { preserveCharacterAssetIndexes } from '../services/characterAssetRecoveryService.js';

const activeExtractionJobs = new Map();

function handled(sendJson, res, code, body) {
  sendJson(res, code, body);
  return true;
}

export async function handleExtractRoutes(ctx) {
  const { req, res, url, p, method, readBody, sendJson, projectImageStyle } = ctx;

  if (p === '/api/extract' && method === 'POST') {
    const body = await readBody(req);
    const text = (body.text || '').trim();
    const projectId = (body.projectId || '').trim();
    const requestedCategories = Array.isArray(body.categories)
      ? [...new Set(body.categories.filter((category) => MAIN_CATEGORIES.includes(category)))]
      : [];
    const categories = requestedCategories.length && requestedCategories.length < MAIN_CATEGORIES.length
      ? requestedCategories
      : null;
    if (!text) return handled(sendJson, res, 400, { error: '请提供小说文本' });
    if (!projectId) return handled(sendJson, res, 400, { error: '请先创建或选择一个项目' });
    const proj = loadProject(projectId);
    if (!proj) return handled(sendJson, res, 404, { error: '项目不存在' });
    const cfg = loadConfig();
    if (!hasTextModelKey(cfg, 'extraction')) return handled(sendJson, res, 400, { error: '请先在设置里配置文本模型 API Key' });

    const chapterSigs = (body.chapterSigs && typeof body.chapterSigs === 'object') ? body.chapterSigs : null;
    const categoryKey = categories ? categories.slice().sort().join(',') : 'all';
    const chapterSigKey = chapterSigs
      ? JSON.stringify(Object.entries(chapterSigs).sort(([a], [b]) => a.localeCompare(b)))
      : '';
    const extractionKey = `${projectId}:${categoryKey}:${chapterSigKey}:${text.length}:${text.slice(0, 48)}:${text.slice(-48)}`;
    const existingJobId = activeExtractionJobs.get(extractionKey);
    const existingJob = existingJobId ? getJob(existingJobId) : null;
    if (existingJob && ['queued', 'running', 'retrying'].includes(existingJob.status)) {
      return handled(sendJson, res, 200, { jobId: existingJobId, deduplicated: true });
    }
    const jobId = `job_${Date.now()}`;
    activeExtractionJobs.set(extractionKey, jobId);
    let controller = null;

    const runExtraction = () => {
      activeExtractionJobs.set(extractionKey, jobId);
      controller = new AbortController();
      setJob(jobId, {
        status: 'running',
        phase: 'extract',
        title: `元素提取 · ${proj.name || proj.id}`,
        projectId: proj.id,
        chunkIndex: 0,
        chunkTotal: 0,
        error: '',
        message: '正在分析文本并提取元素',
      });
      (async () => {
        try {
          const latestProject = loadProject(projectId) || proj;
          const result = await extractElements(
            text,
            resolveTextModelConfig(cfg, 'extraction', { projectId, operation: 'extract-elements' }),
            cfg.chunkSize,
            (status) => setJob(jobId, {
              ...status,
              message: status.progressStatus === 'waiting'
                ? `正在等待模型返回（已完成 ${Number(status.completed) || 0}/${Number(status.chunkTotal) || '?'} 段）`
                : status.progressStatus === 'chunk_done'
                  ? `已完成分析 ${Number(status.completed) || 0}/${Number(status.chunkTotal) || '?'} 段`
                  : status.progressStatus === 'batch_done'
                    ? `已完成分析 ${Number(status.completed) || 0}/${Number(status.chunkTotal) || '?'} 段，准备继续`
                  : '正在分析文本并提取元素',
            }),
            latestProject.elements,
            projectImageStyle(latestProject, cfg),
            cfg.promptTemplate,
            cfg.stylePrompts,
            { signal: controller.signal, categories, concurrency: cfg.extractConcurrency }
          );
          const latest = loadProject(projectId) || latestProject;
          if (categories) {
            for (const category of MAIN_CATEGORIES) {
              if (categories.includes(category)) continue;
              result.elements[category] = Array.isArray(latestProject.elements?.[category])
                ? latestProject.elements[category]
                : [];
            }
          }
          preserveCharacterAssetIndexes(result.elements, latestProject.elements);
          latest.elements = result.elements;
          if (chapterSigs && !categories) {
            normalizeProjectScript(latest);
            latest.script.extractedSigs = { ...(latest.script.extractedSigs || {}), ...chapterSigs };
          }
          latest.updatedAt = new Date().toISOString();
          saveProject(latest);
          setJob(jobId, {
            status: 'done',
            chunkTotal: result.chunkTotal,
            projectId: proj.id,
            errors: result.errors,
            message: result.errors?.length ? `提取完成，${result.errors.length} 个分段有提示` : '元素提取完成',
          });
          activeExtractionJobs.delete(extractionKey);
        } catch (error) {
          if (controller.signal.aborted || error?.name === 'AbortError') {
            setJob(jobId, { status: 'cancelled', message: '元素提取已取消' });
          } else {
            setJob(jobId, { status: 'error', error: error.message, message: error.message });
          }
          activeExtractionJobs.delete(extractionKey);
        }
      })();
    };

    registerJobActions(jobId, {
      cancel: () => controller?.abort(),
      retry: runExtraction,
    });
    runExtraction();

    return handled(sendJson, res, 200, { jobId });
  }

  if (p === '/api/extract/status' && method === 'GET') {
    const jobId = url.searchParams.get('jobId');
    const status = getJob(jobId);
    if (!status) return handled(sendJson, res, 404, { error: '任务不存在' });
    return handled(sendJson, res, 200, status);
  }

  return false;
}
