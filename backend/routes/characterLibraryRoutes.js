import {
  addGlobalAssetsToProject,
  applyGlobalAssetImage,
  applyGlobalAssetImageMatches,
  listGlobalCharacters,
  previewGlobalAssetImageMatches,
  removeGlobalAssets,
} from '../services/characterLibraryService.js';

export async function handleCharacterLibraryRoutes({ req, res, url, p, method, readBody, sendJson }) {
  try {
    if (p === '/api/character-library' && method === 'GET') {
      return sendJson(res, 200, listGlobalCharacters({
        query: url.searchParams.get('query') || '',
        category: url.searchParams.get('category') || '',
        projectId: url.searchParams.get('projectId') || '',
      }));
    }
    if (p === '/api/character-library/apply' && method === 'POST') {
      return sendJson(res, 200, { ok: true, ...applyGlobalAssetImage(await readBody(req)) });
    }
    if (p === '/api/character-library/match-preview' && method === 'POST') {
      return sendJson(res, 200, { ok: true, ...previewGlobalAssetImageMatches(await readBody(req)) });
    }
    if (p === '/api/character-library/match-apply' && method === 'POST') {
      return sendJson(res, 200, { ok: true, ...applyGlobalAssetImageMatches(await readBody(req)) });
    }
    if (p === '/api/character-library/batch-add' && method === 'POST') {
      return sendJson(res, 200, { ok: true, ...addGlobalAssetsToProject(await readBody(req)) });
    }
    if (p === '/api/character-library/remove' && method === 'POST') {
      return sendJson(res, 200, { ok: true, ...removeGlobalAssets(await readBody(req)) });
    }
  } catch (error) {
    return sendJson(res, 400, { error: error.message });
  }
  return false;
}
