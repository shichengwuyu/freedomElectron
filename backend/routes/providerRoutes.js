import {
  addAccounts as addXiaoyunqueAccounts,
  deleteAccount as deleteXiaoyunqueAccount,
  listAccountsMasked as listXiaoyunqueAccountsMasked,
  parseAccountsText as parseXiaoyunqueAccountsText,
} from '../xiaoyunqueAccounts.js';
import {
  getCliStatus as getXiaoyunqueCliStatus,
  installCli as installXiaoyunqueCli,
} from '../xiaoyunqueClient.js';
import {
  getCliStatus as getDreaminaCliStatus,
  installCli as installDreaminaCli,
  loginCli as loginDreaminaCli,
  logoutCli as logoutDreaminaCli,
} from '../dreaminaClient.js';
import {
  getCliStatus as getLibtvCliStatus,
  getImageModelCapabilities as getLibtvImageModelCapabilities,
  installCli as installLibtvCli,
  listImageModels as listLibtvImageModels,
  listVideoModels as listLibtvVideoModels,
  loginCli as loginLibtvCli,
  logoutCli as logoutLibtvCli,
} from '../libtvClient.js';
import { listImageModels as listUpdreamImageModels } from '../updreamClient.js';
import {
  captureNeowowTokenWithLogin,
  clearNeowowLoginSession,
  neowowLoginProfileDirectory,
  normalizeCapturedNeowowToken,
} from '../neowowAuth.js';
import { NeowowClient, testConnection as testNeowowConnection } from '../neowowClient.js';
import {
  addNeowowAccount,
  clearNeowowAccountToken,
  deleteNeowowAccount,
  importNeowowTokenAccount,
  markNeowowAccountStatus,
  neowowAccountsPublicView,
  neowowConfigForAccount,
  refreshNeowowAccount,
  requireNeowowAccount,
  selectNeowowAccount,
  selectedNeowowAccountId,
  setNeowowAccountEnabled,
  updateNeowowAccountAuth,
} from '../neowowAccounts.js';
import { loadConfig, saveConfig } from '../config.js';
import { listPending } from '../pendingVideos.js';

function handled(sendJson, res, code, body) {
  sendJson(res, code, body);
  return true;
}

function persistUpdreamTokens({ accessToken, refreshToken } = {}) {
  const current = loadConfig();
  saveConfig({
    video: {
      ...current.video,
      updreamAccessToken: String(accessToken || current.video?.updreamAccessToken || '').trim(),
      updreamRefreshToken: String(refreshToken || current.video?.updreamRefreshToken || '').trim(),
    },
  });
}

export async function handleProviderRoutes(ctx) {
  const { req, res, p, method, readBody, sendJson, setJob } = ctx;

  if (p === '/api/xiaoyunque/accounts' && method === 'GET') {
    return handled(sendJson, res, 200, { accounts: listXiaoyunqueAccountsMasked() });
  }

  if (p === '/api/xiaoyunque/account/add-manual' && method === 'POST') {
    const body = await readBody(req);
    const drafts = parseXiaoyunqueAccountsText(body.text || '');
    if (!drafts.length) return handled(sendJson, res, 400, { error: '未解析到有效的小云雀 access key' });
    const added = addXiaoyunqueAccounts(drafts);
    return handled(sendJson, res, 200, { ok: true, added, accounts: listXiaoyunqueAccountsMasked() });
  }

  if (p === '/api/xiaoyunque/account/delete' && method === 'POST') {
    const body = await readBody(req);
    if (!body.id) return handled(sendJson, res, 400, { error: '缺少账号 id' });
    deleteXiaoyunqueAccount(body.id);
    return handled(sendJson, res, 200, { ok: true, accounts: listXiaoyunqueAccountsMasked() });
  }

  if (p === '/api/xiaoyunque/cli-status' && method === 'GET') {
    const status = await getXiaoyunqueCliStatus();
    return handled(sendJson, res, 200, { ok: true, ...status });
  }

  if (p === '/api/xiaoyunque/install-cli' && method === 'POST') {
    const jobId = `xyq_install_${Date.now()}`;
    setJob(jobId, { status: 'running', phase: 'install', message: '开始安装小云雀 CLI...' });
    (async () => {
      try {
        const result = await installXiaoyunqueCli({ onProgress: (message) => setJob(jobId, { message }) });
        setJob(jobId, {
          status: 'done',
          message: result.alreadyInstalled ? '小云雀 CLI 已安装' : '小云雀 CLI 安装完成',
          cli: result,
        });
      } catch (e) {
        setJob(jobId, { status: 'error', error: e.message, message: e.message });
      }
    })();
    return handled(sendJson, res, 200, { ok: true, jobId });
  }

  if (p === '/api/dreamina/cli-status' && method === 'GET') {
    const status = await getDreaminaCliStatus();
    return handled(sendJson, res, 200, { ok: true, ...status });
  }

  if (p === '/api/dreamina/install-cli' && method === 'POST') {
    const jobId = `dreamina_install_${Date.now()}`;
    setJob(jobId, { status: 'running', phase: 'install', provider: 'dreamina-cli', message: '开始安装 Dreamina CLI...' });
    (async () => {
      try {
        const result = await installDreaminaCli({ onProgress: (message) => setJob(jobId, { message }) });
        setJob(jobId, {
          status: 'done',
          provider: 'dreamina-cli',
          message: result.alreadyInstalled ? 'Dreamina CLI 已安装' : 'Dreamina CLI 安装完成',
          cli: result,
        });
      } catch (e) {
        setJob(jobId, { status: 'error', provider: 'dreamina-cli', error: e.message, message: e.message });
      }
    })();
    return handled(sendJson, res, 200, { ok: true, jobId });
  }

  if (p === '/api/dreamina/login-cli' && method === 'POST') {
    const body = await readBody(req);
    const jobId = `dreamina_login_${Date.now()}`;
    setJob(jobId, { status: 'running', phase: 'login', provider: 'dreamina-cli', message: '正在打开 Dreamina CLI 登录...' });
    (async () => {
      try {
        const result = await loginDreaminaCli({
          force: !!body.force,
          onProgress: (message) => setJob(jobId, { message }),
        });
        setJob(jobId, {
          status: 'done',
          provider: 'dreamina-cli',
          message: result.alreadyAuthenticated ? 'Dreamina CLI 已登录' : 'Dreamina CLI 登录完成',
          cli: result,
        });
      } catch (e) {
        setJob(jobId, { status: 'error', provider: 'dreamina-cli', error: e.message, message: e.message });
      }
    })();
    return handled(sendJson, res, 200, { ok: true, jobId });
  }

  if (p === '/api/dreamina/logout-cli' && method === 'POST') {
    const jobId = `dreamina_logout_${Date.now()}`;
    setJob(jobId, { status: 'running', phase: 'logout', provider: 'dreamina-cli', message: '正在退出 Dreamina CLI 登录...' });
    (async () => {
      try {
        const result = await logoutDreaminaCli({
          onProgress: (message) => setJob(jobId, { message }),
        });
        setJob(jobId, {
          status: 'done',
          provider: 'dreamina-cli',
          message: 'Dreamina CLI 已退出登录',
          cli: result,
        });
      } catch (e) {
        setJob(jobId, { status: 'error', provider: 'dreamina-cli', error: e.message, message: e.message });
      }
    })();
    return handled(sendJson, res, 200, { ok: true, jobId });
  }

  if (p === '/api/libtv/cli-status' && method === 'GET') {
    const status = await getLibtvCliStatus({ checkUpdate: false });
    return handled(sendJson, res, 200, { ok: true, ...status });
  }

  if (p === '/api/libtv/models' && method === 'GET') {
    try {
      return handled(sendJson, res, 200, { ok: true, ...(await listLibtvVideoModels()) });
    } catch (error) {
      const status = error?.code === 'AUTH_EXPIRED' ? 401 : 400;
      return handled(sendJson, res, status, { ok: false, error: error.message, code: error.code || 'LIBTV_MODEL_LIST_FAILED' });
    }
  }

  if (p === '/api/libtv/image-models' && method === 'GET') {
    try {
      return handled(sendJson, res, 200, { ok: true, ...(await listLibtvImageModels()) });
    } catch (error) {
      const status = error?.code === 'AUTH_EXPIRED' ? 401 : 400;
      return handled(sendJson, res, status, { ok: false, error: error.message, code: error.code || 'LIBTV_IMAGE_MODEL_LIST_FAILED' });
    }
  }

  if (p === '/api/libtv/image-model-capabilities' && method === 'POST') {
    const body = await readBody(req);
    try {
      return handled(sendJson, res, 200, { ok: true, ...(await getLibtvImageModelCapabilities(body.model)) });
    } catch (error) {
      const status = error?.code === 'AUTH_EXPIRED' ? 401 : 400;
      return handled(sendJson, res, status, { ok: false, error: error.message, code: error.code || 'LIBTV_IMAGE_MODEL_CAPABILITIES_FAILED' });
    }
  }

  if (p === '/api/updream/image-models' && method === 'GET') {
    const cfg = loadConfig();
    try {
      const result = await listUpdreamImageModels({
        config: cfg.video || {},
        onTokens: persistUpdreamTokens,
      });
      return handled(sendJson, res, 200, { ok: true, ...result });
    } catch (error) {
      const status = ['AUTH_EXPIRED', 'AUTH_MISSING'].includes(error?.code) ? 401 : 400;
      return handled(sendJson, res, status, { ok: false, error: error.message, code: error.code || 'UPDREAM_IMAGE_MODEL_LIST_FAILED' });
    }
  }

  if (p === '/api/neowow/image-models' && method === 'GET') {
    const cfg = loadConfig();
    const requestUrl = new URL(req.url || p, 'http://localhost');
    const accountId = String(requestUrl.searchParams.get('accountId') || cfg.image?.neowowAccountId || selectedNeowowAccountId()).trim();
    try {
      const client = new NeowowClient(neowowConfigForAccount(accountId, cfg));
      const models = await client.listImageModels();
      return handled(sendJson, res, 200, { ok: true, accountId, models });
    } catch (error) {
      const status = ['AUTH_EXPIRED', 'AUTH_MISSING'].includes(error?.code) ? 401 : 400;
      return handled(sendJson, res, status, {
        ok: false,
        error: error.message,
        code: error.code || 'NEOWOW_IMAGE_MODEL_LIST_FAILED',
      });
    }
  }

  if (p === '/api/neowow/accounts' && method === 'GET') {
    return handled(sendJson, res, 200, {
      ok: true,
      accountId: selectedNeowowAccountId(),
      accounts: neowowAccountsPublicView(),
    });
  }

  if (p === '/api/neowow/accounts/select' && method === 'POST') {
    const body = await readBody(req);
    try {
      const account = selectNeowowAccount(body.accountId);
      return handled(sendJson, res, 200, {
        ok: true,
        accountId: account.id,
        accounts: neowowAccountsPublicView(),
      });
    } catch (error) {
      return handled(sendJson, res, 400, { ok: false, error: error.message });
    }
  }

  if (p === '/api/neowow/accounts/enabled' && method === 'POST') {
    const body = await readBody(req);
    try {
      setNeowowAccountEnabled(body.accountId, body.enabled !== false);
      return handled(sendJson, res, 200, { ok: true, accounts: neowowAccountsPublicView() });
    } catch (error) {
      return handled(sendJson, res, 400, { ok: false, error: error.message });
    }
  }

  if (p === '/api/neowow/accounts/token' && method === 'POST') {
    const body = await readBody(req);
    const token = normalizeCapturedNeowowToken(body.token);
    if (!token) {
      return handled(sendJson, res, 400, {
        ok: false,
        error: 'Token 格式无效，请粘贴完整的 Neowow Token',
        code: 'NEOWOW_TOKEN_INVALID',
      });
    }
    try {
      const current = loadConfig();
      const verified = await testNeowowConnection({
        config: {
          ...current.video,
          neowowBaseUrl: String(body.baseUrl || current.video?.neowowBaseUrl || '').trim(),
          neowowToken: token,
        },
      });
      const requestedAccountId = String(body.accountId || '').trim();
      const saved = requestedAccountId
        ? updateNeowowAccountAuth(requestedAccountId, {
          token,
          name: body.name,
          authMethod: 'token',
          accountName: verified.accountName || verified.name,
          userId: verified.userId,
          points: verified.points,
        })
        : importNeowowTokenAccount({
          name: body.name,
          token,
          accountName: verified.accountName || verified.name,
          userId: verified.userId,
          points: verified.points,
        });
      selectNeowowAccount(saved.id);
      return handled(sendJson, res, 200, {
        ok: true,
        accountId: saved.id,
        importedAccountId: saved.id,
        accounts: neowowAccountsPublicView(),
      });
    } catch (error) {
      const status = error?.code === 'AUTH_EXPIRED' || Number(error?.status) === 401 ? 401 : 400;
      return handled(sendJson, res, status, {
        ok: false,
        error: error.message,
        code: error.code || 'NEOWOW_TOKEN_IMPORT_FAILED',
      });
    }
  }

  if (p === '/api/neowow/accounts/refresh' && method === 'POST') {
    const body = await readBody(req);
    const accountId = String(body.accountId || '').trim() || selectedNeowowAccountId();
    try {
      await refreshNeowowAccount(accountId);
      return handled(sendJson, res, 200, {
        ok: true,
        accountId: selectedNeowowAccountId(),
        refreshedAccountId: accountId,
        accounts: neowowAccountsPublicView(),
      });
    } catch (error) {
      const status = error?.code === 'AUTH_EXPIRED' || Number(error?.status) === 401 ? 401 : 400;
      return handled(sendJson, res, status, { ok: false, error: error.message, accounts: neowowAccountsPublicView() });
    }
  }

  if (p === '/api/neowow/accounts/delete' && method === 'POST') {
    const body = await readBody(req);
    const accountId = String(body.accountId || '').trim();
    try {
      requireNeowowAccount(accountId);
      const hasPending = listPending().some((task) => (
        task.provider === 'neowow'
        && (task.accountId === accountId
          || ((!task.accountId || task.accountId === 'neowow') && accountId === selectedNeowowAccountId()))
        && ['queued', 'submitting'].includes(task.status)
      ));
      if (hasPending) throw new Error('这个账号还有排队或生成中的视频，请先取消或等待完成');
      deleteNeowowAccount(accountId);
      return handled(sendJson, res, 200, {
        ok: true,
        accountId: selectedNeowowAccountId(),
        accounts: neowowAccountsPublicView(),
      });
    } catch (error) {
      return handled(sendJson, res, 400, { ok: false, error: error.message });
    }
  }

  if (p === '/api/neowow/login' && method === 'POST') {
    const body = await readBody(req);
    let account;
    try {
      account = String(body.accountId || '').trim()
        ? requireNeowowAccount(body.accountId)
        : addNeowowAccount({ name: body.name });
      selectNeowowAccount(account.id);
      markNeowowAccountStatus(account.id, 'logging_in');
    } catch (error) {
      return handled(sendJson, res, 400, { ok: false, error: error.message });
    }
    const jobId = `neowow_login_${account.id}_${Date.now()}`;
    setJob(jobId, {
      status: 'running',
      phase: 'login',
      provider: 'neowow',
      accountId: account.id,
      message: '正在打开 Neowow 登录窗口...',
    });
    (async () => {
      try {
        const captured = await captureNeowowTokenWithLogin({
          profileDirectory: neowowLoginProfileDirectory(account.profileKey || account.id),
          onProgress: (message) => setJob(jobId, { message }),
        });
        const current = loadConfig();
        const verified = await testNeowowConnection({
          config: { ...current.video, neowowToken: captured.token },
        });
        const saved = updateNeowowAccountAuth(account.id, {
          token: captured.token,
          authMethod: 'browser',
          accountName: verified.accountName || verified.name,
          userId: verified.userId,
          points: verified.points,
        });
        selectNeowowAccount(saved.id);
        setJob(jobId, {
          status: 'done',
          provider: 'neowow',
          accountId: saved.id,
          message: 'Neowow 登录完成，账号已保存',
          auth: {
            ok: true,
            hasToken: true,
            accountId: saved.id,
            accountName: saved.name,
            userId: saved.userId,
            points: saved.points,
          },
        });
      } catch (error) {
        try { markNeowowAccountStatus(account.id, 'error', error.message); } catch { /* account may have been removed */ }
        setJob(jobId, {
          status: 'error',
          provider: 'neowow',
          accountId: account.id,
          code: error.code || 'NEOWOW_LOGIN_FAILED',
          error: error.message,
          message: error.message,
        });
      }
    })();
    return handled(sendJson, res, 200, { ok: true, jobId, accountId: account.id });
  }

  if (p === '/api/neowow/logout' && method === 'POST') {
    const body = await readBody(req);
    let account;
    try {
      account = requireNeowowAccount(body.accountId || selectedNeowowAccountId());
    } catch (error) {
      return handled(sendJson, res, 400, { ok: false, error: error.message });
    }
    const jobId = `neowow_logout_${account.id}_${Date.now()}`;
    setJob(jobId, {
      status: 'running',
      phase: 'logout',
      provider: 'neowow',
      accountId: account.id,
      message: `正在退出 ${account.name}...`,
    });
    (async () => {
      let tokenClearError = null;
      let browserClearError = null;
      try {
        clearNeowowAccountToken(account.id);
        setJob(jobId, {
          message: account.authMethod === 'browser'
            ? `${account.name} 的软件 Token 已停用，正在清理该账号的独立登录资料...`
            : `${account.name} 的 Token 已停用`,
        });
      } catch (error) {
        tokenClearError = error;
      }
      if (account.authMethod === 'browser') {
        try {
          await clearNeowowLoginSession({
            profileDirectory: neowowLoginProfileDirectory(account.profileKey || account.id),
            onProgress: (message) => setJob(jobId, { message }),
          });
        } catch (error) {
          browserClearError = error;
        }
      }

      if (!tokenClearError && !browserClearError) {
        setJob(jobId, {
          status: 'done',
          provider: 'neowow',
          accountId: account.id,
          message: `${account.name} 已退出登录`,
          auth: { ok: true, accountId: account.id, hasToken: false },
        });
      } else {
        const details = [
          tokenClearError ? `软件 Token 清除失败：${tokenClearError.message}` : '软件 Token 已清除',
          ...(account.authMethod === 'browser'
            ? [browserClearError ? `账号独立登录资料清理失败：${browserClearError.message}` : '账号独立登录资料已清除']
            : []),
        ];
        const error = tokenClearError || browserClearError;
        setJob(jobId, {
          status: 'error',
          provider: 'neowow',
          accountId: account.id,
          code: error.code || 'NEOWOW_LOGOUT_FAILED',
          error: details.join('；'),
          message: details.join('；'),
          auth: { ok: false, accountId: account.id, hasToken: Boolean(tokenClearError) },
        });
      }
    })();
    return handled(sendJson, res, 200, { ok: true, jobId, accountId: account.id });
  }

  if (p === '/api/libtv/check-update' && method === 'GET') {
    const status = await getLibtvCliStatus({ checkUpdate: true });
    return handled(sendJson, res, 200, { ok: true, ...status });
  }

  if (p === '/api/libtv/install-cli' && method === 'POST') {
    const body = await readBody(req);
    const jobId = `libtv_install_${Date.now()}`;
    setJob(jobId, { status: 'running', phase: 'install', provider: 'libtv-cli', message: '开始安装或更新 LibTV CLI...' });
    (async () => {
      try {
        const result = await installLibtvCli({
          force: !!body.force,
          onProgress: (message) => setJob(jobId, { message }),
        });
        setJob(jobId, {
          status: 'done',
          provider: 'libtv-cli',
          message: result.alreadyInstalled ? 'LibTV CLI 已是最新版本' : 'LibTV CLI 安装或更新完成',
          cli: result,
        });
      } catch (error) {
        setJob(jobId, { status: 'error', provider: 'libtv-cli', error: error.message, message: error.message });
      }
    })();
    return handled(sendJson, res, 200, { ok: true, jobId });
  }

  if (p === '/api/libtv/login-cli' && method === 'POST') {
    const jobId = `libtv_login_${Date.now()}`;
    setJob(jobId, { status: 'running', phase: 'login', provider: 'libtv-cli', message: '正在打开 LibTV CLI 登录...' });
    (async () => {
      try {
        const result = await loginLibtvCli({ onProgress: (message) => setJob(jobId, { message }) });
        setJob(jobId, {
          status: 'done',
          provider: 'libtv-cli',
          message: result.alreadyAuthenticated ? 'LibTV CLI 已登录' : 'LibTV CLI 登录完成',
          cli: result,
        });
      } catch (error) {
        setJob(jobId, { status: 'error', provider: 'libtv-cli', error: error.message, message: error.message });
      }
    })();
    return handled(sendJson, res, 200, { ok: true, jobId });
  }

  if (p === '/api/libtv/logout-cli' && method === 'POST') {
    const jobId = `libtv_logout_${Date.now()}`;
    setJob(jobId, { status: 'running', phase: 'logout', provider: 'libtv-cli', message: '正在退出 LibTV CLI 登录...' });
    (async () => {
      try {
        const result = await logoutLibtvCli({ onProgress: (message) => setJob(jobId, { message }) });
        setJob(jobId, { status: 'done', provider: 'libtv-cli', message: 'LibTV CLI 已退出登录', cli: result });
      } catch (error) {
        setJob(jobId, { status: 'error', provider: 'libtv-cli', error: error.message, message: error.message });
      }
    })();
    return handled(sendJson, res, 200, { ok: true, jobId });
  }

  return false;
}
