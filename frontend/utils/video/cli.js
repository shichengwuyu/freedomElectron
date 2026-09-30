import { delay } from './timing.js';
import { libtvModelNames } from '../../constants/options.js';

export function dreaminaCreditBalance(credit) {
  const value = credit?.total_credit ?? credit?.totalCredit ?? credit?.credit ?? credit?.balance;
  if (value === null || value === undefined || value === '') return null;
  const balance = Number(value);
  return Number.isFinite(balance) ? balance : null;
}

function applyDreaminaCredit(target, result = {}) {
  target.credit = result.credit || null;
  target.creditBalance = dreaminaCreditBalance(result.credit);
  target.creditError = result.creditError || '';
}

export function applyXiaoyunqueCliStatus(target, result = null, error = null) {
  target.checked = true;
  if (error) {
    target.installed = false;
    target.message = '检测失败：' + (error?.message || error);
    return target;
  }
  target.installed = !!result.installed;
  target.version = result.version || '';
  target.message = result.installed
    ? `已安装${result.version ? `：${result.version}` : ''}`
    : '未检测到 pippit-tool-cli';
  return target;
}

export function applyDreaminaCliStatus(target, result = null, error = null) {
  target.checked = true;
  if (error) {
    target.installed = false;
    target.authenticated = false;
    target.credit = null;
    target.creditBalance = null;
    target.creditError = error?.message || String(error);
    target.message = '检测失败：' + (error?.message || error);
    return target;
  }
  target.installed = !!result.installed;
  target.authenticated = !!result.authenticated;
  target.version = result.version || '';
  applyDreaminaCredit(target, result);
  target.message = !result.installed
    ? '未检测到 dreamina CLI'
    : (result.authenticated
      ? `已登录${result.version ? `：${result.version}` : ''}`
      : `已安装但未登录${result.authError ? `：${result.authError}` : ''}`);
  return target;
}

export function applyDreaminaAgentStatus(target, result = null, error = null) {
  target.checked = true;
  if (error) {
    target.running = false;
    target.authenticated = false;
    target.message = '检测失败：' + (error?.message || error);
    return target;
  }
  target.installed = result.installed !== false;
  target.running = !!result.running;
  target.authenticated = !!result.authenticated;
  target.accountId = result.accountId || '';
  target.accountName = result.accountName || '';
  target.message = result.message || (target.authenticated ? '即梦 Agent 网页登录态可用' : '网页登录未打开');
  return target;
}

function syncDreaminaAgentAccounts(config, result = {}) {
  if (!config?.video) return;
  if (Array.isArray(result.accounts)) config.video.dreaminaAgentAccounts = result.accounts;
  if (result.accountId) config.video.dreaminaAgentAccountId = result.accountId;
  if (result.accountId && (result.authenticated != null || result.running != null)) {
    const account = (config.video.dreaminaAgentAccounts || []).find((item) => item.id === result.accountId);
    if (account) {
      account.authenticated = !!result.authenticated;
      account.running = !!result.running;
      account.statusMessage = result.message || '';
    }
  }
}

export function createDreaminaAgentRuntime({ api, message, refs = {} } = {}) {
  const selectedAccountId = (accountId = '') => String(
    accountId
    || refs.videoBar?.dreaminaAgentAccountId
    || refs.config?.video?.dreaminaAgentAccountId
    || ''
  ).trim();
  const refreshAccounts = async () => {
    const result = await api.get('/api/dreamina-agent/accounts');
    syncDreaminaAgentAccounts(refs.config, result);
    return result;
  };
  const refresh = async (accountId = '') => {
    try {
      const id = selectedAccountId(accountId);
      const result = await api.get(`/api/dreamina-agent/status${id ? `?accountId=${encodeURIComponent(id)}` : ''}`);
      applyDreaminaAgentStatus(refs.status, result);
      syncDreaminaAgentAccounts(refs.config, result);
      return result;
    } catch (error) {
      applyDreaminaAgentStatus(refs.status, null, error);
      return null;
    }
  };
  const selectAccount = async (accountId) => {
    const id = selectedAccountId(accountId);
    if (!id) return message.warning('请先选择即梦 Agent 账号');
    const result = await api.post('/api/dreamina-agent/accounts/select', { accountId: id });
    syncDreaminaAgentAccounts(refs.config, result);
    if (refs.videoBar) refs.videoBar.dreaminaAgentAccountId = id;
    refs.status.checked = false;
    refs.status.authenticated = false;
    refs.status.running = false;
    refs.status.accountId = id;
    refs.status.accountName = result.accountName || '';
    refs.status.message = `${result.accountName || '账号'} · 未检测`;
    return result;
  };
  const login = async (accountId = '') => {
    if (refs.loading.value) return;
    const id = selectedAccountId(accountId);
    if (!id) return message.warning('请先选择即梦 Agent 账号');
    refs.loading.value = true;
    try {
      const result = await api.post('/api/dreamina-agent/login', { accountId: id });
      applyDreaminaAgentStatus(refs.status, result);
      syncDreaminaAgentAccounts(refs.config, result);
      if (result.authenticated) message.success('即梦 Agent 网页登录态可用');
      else message.info(result.message || '已打开即梦官网，请完成抖音登录后点击检测');
    } catch (error) {
      applyDreaminaAgentStatus(refs.status, null, error);
      message.error('打开即梦 Agent 登录失败：' + (error?.message || error));
    } finally {
      refs.loading.value = false;
    }
  };
  const applySession = async (accountId = '') => {
    if (refs.loading.value) return;
    const id = selectedAccountId(accountId);
    const sessionId = String(refs.config?.video?.dreaminaAgentSessionId || '').trim();
    if (!sessionId) return message.warning('请先填写即梦官网 Session ID');
    if (!id) return message.warning('请先选择要替换的即梦 Agent 账号');
    refs.loading.value = true;
    try {
      const result = await api.post('/api/dreamina-agent/session', { accountId: id, sessionId });
      applyDreaminaAgentStatus(refs.status, result);
      syncDreaminaAgentAccounts(refs.config, result);
      if (result.authenticated) {
        refs.config.video.dreaminaAgentHasSessionId = true;
        refs.config.video.dreaminaAgentSessionId = '';
        await refreshAccounts();
        message.success(result.message || '即梦 Agent Session ID 已应用');
      } else {
        message.error(result.message || 'Session ID 未能登录即梦官网');
      }
      return result;
    } catch (error) {
      applyDreaminaAgentStatus(refs.status, null, error);
      message.error('应用即梦 Session ID 失败：' + (error?.message || error));
      return null;
    } finally {
      refs.loading.value = false;
    }
  };
  const addAccount = async ({ withSession = false } = {}) => {
    if (refs.loading.value) return;
    const name = String(refs.config?.video?.dreaminaAgentAccountName || '').trim();
    const sessionId = withSession ? String(refs.config?.video?.dreaminaAgentSessionId || '').trim() : '';
    if (withSession && !sessionId) return message.warning('请先填写即梦官网 Session ID');
    refs.loading.value = true;
    try {
      const result = await api.post('/api/dreamina-agent/accounts', { name, sessionId });
      syncDreaminaAgentAccounts(refs.config, result);
      if (refs.videoBar) refs.videoBar.dreaminaAgentAccountId = result.accountId || '';
      refs.config.video.dreaminaAgentAccountName = '';
      if (withSession && result.status) applyDreaminaAgentStatus(refs.status, result.status);
      if (withSession && !result.status?.authenticated) {
        message.error(result.message || 'Session ID 未能登录即梦官网');
      } else {
        refs.config.video.dreaminaAgentSessionId = '';
        message.success(result.message || '即梦账号已添加');
      }
      return result;
    } catch (error) {
      message.error('添加即梦账号失败：' + (error?.message || error));
      return null;
    } finally {
      refs.loading.value = false;
    }
  };
  const addSessionAccount = () => addAccount({ withSession: true });
  const addBrowserAccount = async () => {
    const result = await addAccount({ withSession: false });
    if (result?.accountId) await login(result.accountId);
    return result;
  };
  const deleteAccount = async (accountId) => {
    if (refs.loading.value) return;
    refs.loading.value = true;
    try {
      const result = await api.post('/api/dreamina-agent/accounts/delete', { accountId });
      syncDreaminaAgentAccounts(refs.config, result);
      const selectedId = result.accountId || refs.config.video.dreaminaAgentAccounts[0]?.id || '';
      if (refs.videoBar?.dreaminaAgentAccountId === accountId) refs.videoBar.dreaminaAgentAccountId = selectedId;
      message.success('即梦账号已移除，本地登录资料已保留');
      return result;
    } catch (error) {
      message.error('移除即梦账号失败：' + (error?.message || error));
      return null;
    } finally {
      refs.loading.value = false;
    }
  };
  return {
    refresh,
    refreshAccounts,
    login,
    applySession,
    selectAccount,
    addSessionAccount,
    addBrowserAccount,
    deleteAccount,
  };
}

export function applyLibtvCliStatus(target, result = null, error = null) {
  target.checked = true;
  if (error) {
    target.installed = false;
    target.authenticated = false;
    target.updateAvailable = false;
    target.message = '检测失败：' + (error?.message || error);
    return target;
  }
  target.installed = !!result.installed;
  target.authenticated = !!result.authenticated;
  target.version = result.version || '';
  target.latestVersion = result.latestVersion || '';
  target.updateAvailable = !!result.updateAvailable;
  target.accountName = result.accountName || '';
  target.updateError = result.updateError || '';
  if (!result.installed) {
    target.message = '未检测到 LibTV CLI';
  } else if (result.updateAvailable) {
    target.message = `可更新至 ${result.latestVersion}${result.version ? `（当前 ${result.version}）` : ''}`;
  } else if (result.authenticated) {
    target.message = result.accountName
      ? `已登录：${result.accountName}${result.version ? ` · ${result.version}` : ''}`
      : `已登录${result.version ? `：${result.version}` : ''}`;
  } else {
    target.message = `已安装但未登录${result.version ? `：${result.version}` : ''}`;
  }
  return target;
}

export function normalizeLibtvModelOptions(models = [], currentModel = '') {
  const allowed = new Set(libtvModelNames);
  const byName = new Map();
  const add = (value, source = {}) => {
    const modelName = String(value || '').trim() === 'Seedance 2.0'
      ? 'Seedance 2.0 VIP'
      : String(value || '').trim();
    if (!allowed.has(modelName) || byName.has(modelName)) return;
    byName.set(modelName, {
      label: modelName,
      value: modelName,
      modelKey: String(source.modelKey || '').trim(),
      description: String(source.description || '').trim(),
      estimatedTime: String(source.estimatedTime || '').trim(),
      vip: source.vip === true,
    });
  };
  for (const model of Array.isArray(models) ? models : []) {
    add(model?.modelName || model?.value || model?.label, model || {});
  }
  add(currentModel);
  return libtvModelNames.map((modelName) => byName.get(modelName)).filter(Boolean);
}

export async function addXiaoyunqueAccountsFlow(handlers = {}) {
  const text = handlers.manualText() || '';
  if (!String(text).trim()) return handlers.warning('请粘贴小云雀 access key');
  handlers.setLoading(true);
  try {
    const result = await handlers.addManualAccounts(text);
    if (result.ok) {
      handlers.setAccounts(result.accounts || []);
      handlers.setManualText('');
      handlers.setManualVisible(false);
      handlers.success(`已添加 ${result.added} 条小云雀线路`);
    } else {
      handlers.error(result.error || '导入失败');
    }
  } catch (error) {
    handlers.error('导入失败：' + (error?.message || error));
  } finally {
    handlers.setLoading(false);
  }
}

export function createAddXiaoyunqueAccountsRuntimeContext({ api, message, refs = {} } = {}) {
  return {
    ...message,
    manualText: () => refs.manualText.value,
    setLoading: (value) => { refs.loading.value = value; },
    addManualAccounts: (text) => api.post('/api/xiaoyunque/account/add-manual', { text }),
    setAccounts: (accounts) => {
      refs.config.video.xiaoyunqueAccounts.splice(0, refs.config.video.xiaoyunqueAccounts.length, ...accounts);
    },
    setManualText: (value) => { refs.manualText.value = value; },
    setManualVisible: (value) => { refs.manualVisible.value = value; },
  };
}

export function createAddXiaoyunqueAccountsRuntime({ api, message, refs = {} } = {}) {
  const context = createAddXiaoyunqueAccountsRuntimeContext({ api, message, refs });
  return () => addXiaoyunqueAccountsFlow(context);
}

export async function deleteXiaoyunqueAccountFlow(id, handlers = {}) {
  try {
    const result = await handlers.deleteAccount(id);
    if (result.accounts) handlers.setAccounts(result.accounts);
    handlers.clearSelectedAccount(id);
    handlers.success('已删除');
  } catch (error) {
    handlers.error('删除失败：' + (error?.message || error));
  }
}

export function createDeleteXiaoyunqueAccountRuntime({ api, message, refs = {} } = {}) {
  const context = {
    ...message,
    deleteAccount: (id) => api.post('/api/xiaoyunque/account/delete', { id }),
    setAccounts: (accounts) => {
      refs.config.video.xiaoyunqueAccounts.splice(0, refs.config.video.xiaoyunqueAccounts.length, ...accounts);
    },
    clearSelectedAccount: (id) => {
      if (refs.videoBar.xiaoyunqueAccountId === id) refs.videoBar.xiaoyunqueAccountId = '';
    },
  };
  return (id) => deleteXiaoyunqueAccountFlow(id, context);
}

export async function installXiaoyunqueCliFlow(handlers = {}) {
  if (handlers.isLoading()) return;
  handlers.setLoading(true);
  const tip = handlers.infoTip('正在安装小云雀 CLI...');
  try {
    const result = await handlers.installCli();
    if (!result.jobId) throw new Error(result.error || '安装启动失败');
    await handlers.waitJob(result.jobId, '小云雀 CLI 安装完成');
    await handlers.refreshStatus();
  } catch (error) {
    handlers.error('安装失败：' + (error?.message || error));
  } finally {
    tip.close();
    handlers.setLoading(false);
  }
}

export function createInstallXiaoyunqueCliRuntimeContext({ api, message, refs = {}, helpers = {} } = {}) {
  return {
    ...message,
    isLoading: () => refs.loading.value,
    setLoading: (value) => { refs.loading.value = value; },
    infoTip: helpers.infoTip,
    installCli: () => api.post('/api/xiaoyunque/install-cli', {}),
    waitJob: helpers.waitJob,
    refreshStatus: helpers.refreshStatus,
  };
}

export function createInstallXiaoyunqueCliRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  const context = createInstallXiaoyunqueCliRuntimeContext({ api, message, refs, helpers });
  return () => installXiaoyunqueCliFlow(context);
}

export async function installDreaminaCliFlow(handlers = {}) {
  if (handlers.isLoading()) return;
  handlers.setLoading(true);
  const tip = handlers.infoTip('正在安装 Dreamina CLI...');
  try {
    const result = await handlers.installCli();
    if (!result.jobId) throw new Error(result.error || '安装启动失败');
    await handlers.waitJob(result.jobId, 'Dreamina CLI 安装完成');
    await handlers.refreshStatus();
  } catch (error) {
    handlers.error('安装失败：' + (error?.message || error));
  } finally {
    tip.close();
    handlers.setLoading(false);
  }
}

export async function loginDreaminaCliFlow(handlers = {}) {
  if (handlers.isLoading()) return;
  handlers.setLoading(true);
  const tip = handlers.infoTip('正在打开即梦 CLI 登录...');
  try {
    const result = await handlers.loginCli();
    if (!result.jobId) throw new Error(result.error || '登录启动失败');
    const status = await handlers.waitJob(result.jobId, 'Dreamina CLI 登录完成', {
      progress: (message) => handlers.setStatusMessage?.(message),
    });
    handlers.applyLoginStatus(status?.cli || {});
  } catch (error) {
    handlers.error('登录失败：' + (error?.message || error));
  } finally {
    tip.close();
    handlers.setLoading(false);
  }
}

export async function logoutDreaminaCliFlow(handlers = {}) {
  if (handlers.isLoading()) return;
  const confirmed = await handlers.confirmLogout();
  if (!confirmed) return;
  handlers.setLoading(true);
  const tip = handlers.infoTip('正在退出即梦 CLI 登录...');
  try {
    const result = await handlers.logoutCli();
    if (!result.jobId) throw new Error(result.error || '退出启动失败');
    await handlers.waitJob(result.jobId, 'Dreamina CLI 已退出登录');
    await handlers.refreshStatus();
  } catch (error) {
    handlers.error('退出失败：' + (error?.message || error));
  } finally {
    tip.close();
    handlers.setLoading(false);
  }
}

export function createDreaminaCliRuntimeContext({ api, message, refs = {}, helpers = {} } = {}) {
  return {
    ...message,
    isLoading: () => refs.loading.value,
    setLoading: (value) => { refs.loading.value = value; },
    infoTip: helpers.infoTip,
    installCli: () => api.post('/api/dreamina/install-cli', {}),
    loginCli: () => api.post('/api/dreamina/login-cli', {}),
    logoutCli: () => api.post('/api/dreamina/logout-cli', {}),
    waitJob: helpers.waitJob,
    refreshStatus: helpers.refreshStatus,
    confirmLogout: helpers.confirmLogout,
    setStatusMessage: (message) => {
      if (!message) return;
      refs.status.checked = true;
      refs.status.installed = true;
      refs.status.message = message;
    },
    applyLoginStatus: (cli = {}) => {
      applyDreaminaCliStatus(refs.status, {
        installed: true,
        version: refs.status.version || '',
        ...cli,
      });
      if (!refs.status.authenticated) {
        refs.status.message = cli.authError || cli.authWarning || 'Dreamina CLI 登录未通过检测';
      }
    },
  };
}

export function createDreaminaCliRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  const context = createDreaminaCliRuntimeContext({ api, message, refs, helpers });
  return {
    install: () => installDreaminaCliFlow(context),
    login: () => loginDreaminaCliFlow(context),
    logout: () => logoutDreaminaCliFlow(context),
  };
}

export async function installLibtvCliFlow(handlers = {}) {
  if (handlers.isLoading()) return;
  handlers.setLoading(true);
  const tip = handlers.infoTip('正在安装或更新 LibTV CLI...');
  try {
    const result = await handlers.installCli();
    if (!result.jobId) throw new Error(result.error || '安装启动失败');
    await handlers.waitJob(result.jobId, 'LibTV CLI 安装或更新完成');
    await handlers.refreshStatus();
  } catch (error) {
    handlers.error('安装或更新失败：' + (error?.message || error));
  } finally {
    tip.close();
    handlers.setLoading(false);
  }
}

export async function loginLibtvCliFlow(handlers = {}) {
  if (handlers.isLoading()) return;
  handlers.setLoading(true);
  const tip = handlers.infoTip('正在打开 LibTV CLI 登录...');
  try {
    const result = await handlers.loginCli();
    if (!result.jobId) throw new Error(result.error || '登录启动失败');
    const status = await handlers.waitJob(result.jobId, 'LibTV CLI 登录完成', {
      progress: (text) => handlers.setStatusMessage?.(text),
    });
    handlers.applyStatus(status?.cli || {});
    await handlers.refreshModels?.({ notify: false });
  } catch (error) {
    handlers.error('登录失败：' + (error?.message || error));
  } finally {
    tip.close();
    handlers.setLoading(false);
  }
}

export async function logoutLibtvCliFlow(handlers = {}) {
  if (handlers.isLoading()) return;
  if (!await handlers.confirmLogout()) return;
  handlers.setLoading(true);
  const tip = handlers.infoTip('正在退出 LibTV CLI 登录...');
  try {
    const result = await handlers.logoutCli();
    if (!result.jobId) throw new Error(result.error || '退出启动失败');
    await handlers.waitJob(result.jobId, 'LibTV CLI 已退出登录');
    await handlers.refreshStatus();
  } catch (error) {
    handlers.error('退出失败：' + (error?.message || error));
  } finally {
    tip.close();
    handlers.setLoading(false);
  }
}

export async function checkLibtvCliUpdateFlow(handlers = {}) {
  if (handlers.isLoading()) return;
  handlers.setLoading(true);
  try {
    const result = await handlers.checkUpdate();
    handlers.applyStatus(result);
    if (!result.installed) handlers.warning('未检测到 LibTV CLI');
    else if (result.updateAvailable) handlers.info(`发现 LibTV CLI ${result.latestVersion}，点击“安装 / 更新”即可升级`);
    else if (result.updateError) handlers.warning(`版本检查失败：${result.updateError}`);
    else handlers.success(`LibTV CLI 已是最新版本${result.version ? `：${result.version}` : ''}`);
  } catch (error) {
    handlers.error('检查更新失败：' + (error?.message || error));
  } finally {
    handlers.setLoading(false);
  }
}

export function createLibtvCliRuntime({ api, message, refs = {}, helpers = {} } = {}) {
  const context = {
    ...message,
    isLoading: () => refs.loading.value,
    setLoading: (value) => { refs.loading.value = value; },
    infoTip: helpers.infoTip,
    installCli: () => api.post('/api/libtv/install-cli', {}),
    loginCli: () => api.post('/api/libtv/login-cli', {}),
    logoutCli: () => api.post('/api/libtv/logout-cli', {}),
    checkUpdate: () => api.get('/api/libtv/check-update'),
    waitJob: helpers.waitJob,
    refreshStatus: helpers.refreshStatus,
    refreshModels: helpers.refreshModels,
    confirmLogout: helpers.confirmLogout,
    setStatusMessage: (text) => {
      if (!text) return;
      refs.status.checked = true;
      refs.status.installed = true;
      refs.status.message = text;
    },
    applyStatus: (result = {}) => applyLibtvCliStatus(refs.status, {
      installed: true,
      version: refs.status.version || '',
      ...result,
    }),
  };
  return {
    install: () => installLibtvCliFlow(context),
    login: () => loginLibtvCliFlow(context),
    logout: () => logoutLibtvCliFlow(context),
    checkUpdate: () => checkLibtvCliUpdateFlow(context),
  };
}

export function createVideoCliStatusRuntime({ api, message, refs = {} } = {}) {
  const refreshXiaoyunqueAccounts = async () => {
    try {
      const result = await api.get('/api/xiaoyunque/accounts');
      if (result.accounts) {
        refs.config.video.xiaoyunqueAccounts.splice(0, refs.config.video.xiaoyunqueAccounts.length, ...result.accounts);
      }
    } catch {
      // Account refresh is opportunistic; status checks surface actionable errors.
    }
  };

  const refreshXiaoyunqueCliStatus = async () => {
    try {
      const result = await api.get('/api/xiaoyunque/cli-status');
      applyXiaoyunqueCliStatus(refs.xiaoyunqueCliStatus, result);
    } catch (error) {
      applyXiaoyunqueCliStatus(refs.xiaoyunqueCliStatus, null, error);
    }
  };

  const refreshDreaminaCliStatus = async () => {
    try {
      const result = await api.get('/api/dreamina/cli-status');
      applyDreaminaCliStatus(refs.dreaminaCliStatus, result);
    } catch (error) {
      applyDreaminaCliStatus(refs.dreaminaCliStatus, null, error);
    }
  };

  const refreshDreaminaAgentStatus = async (accountId = '') => {
    try {
      const id = String(accountId || refs.config?.video?.dreaminaAgentAccountId || '').trim();
      const result = await api.get(`/api/dreamina-agent/status${id ? `?accountId=${encodeURIComponent(id)}` : ''}`);
      applyDreaminaAgentStatus(refs.dreaminaAgentStatus, result);
      syncDreaminaAgentAccounts(refs.config, result);
      return result;
    } catch (error) {
      applyDreaminaAgentStatus(refs.dreaminaAgentStatus, null, error);
      return null;
    }
  };

  const refreshLibtvModels = async ({ notify = true } = {}) => {
    if (refs.libtvModelsLoading?.value) return refs.libtvModelOptions || [];
    if (refs.libtvModelsLoading) refs.libtvModelsLoading.value = true;
    try {
      const result = await api.get('/api/libtv/models');
      const options = normalizeLibtvModelOptions(result.models, refs.config.video.libtvModel);
      if (!options.length) throw new Error('LibTV CLI 未返回可用的视频模型');
      refs.libtvModelOptions.splice(0, refs.libtvModelOptions.length, ...options);
      if (notify) message.success(`已加载 ${options.length} 个 LibTV 视频模型`);
      return options;
    } catch (error) {
      if (notify) message.error('加载 LibTV 模型失败：' + (error?.message || error));
      return [];
    } finally {
      if (refs.libtvModelsLoading) refs.libtvModelsLoading.value = false;
    }
  };

  const refreshLibtvCliStatus = async () => {
    try {
      const result = await api.get('/api/libtv/cli-status');
      applyLibtvCliStatus(refs.libtvCliStatus, result);
      if (result.authenticated && refs.libtvModelOptions) await refreshLibtvModels({ notify: false });
    } catch (error) {
      applyLibtvCliStatus(refs.libtvCliStatus, null, error);
    }
  };

  const waitSimpleJob = (jobId, successMessage, options = {}) => waitSimpleVideoJobFlow(jobId, successMessage, {
    getStatus: (id) => api.get(`/api/video/status?jobId=${encodeURIComponent(id)}`),
    success: (text) => message.success(text),
    progress: options.progress,
  });

  return {
    refreshXiaoyunqueAccounts,
    refreshXiaoyunqueCliStatus,
    refreshDreaminaCliStatus,
    refreshDreaminaAgentStatus,
    refreshLibtvCliStatus,
    refreshLibtvModels,
    waitSimpleJob,
  };
}

export async function waitSimpleVideoJobFlow(jobId, successMessage, handlers = {}, options = {}) {
  const initialDelayMs = Number(options.initialDelayMs) || 1000;
  const intervalMs = Number(options.intervalMs) || 1500;
  let lastMessage = '';
  await delay(initialDelayMs);
  while (true) {
    const status = await handlers.getStatus(jobId);
    const message = String(status.message || '').trim();
    if (message && message !== lastMessage) {
      lastMessage = message;
      handlers.progress?.(message, status);
    }
    if (status.status === 'done') {
      handlers.success(successMessage || status.message || '完成');
      return status;
    }
    if (status.status === 'error') {
      throw new Error(status.error || status.message || '任务失败');
    }
    await delay(intervalMs);
  }
}
