const DEFAULT_JSON_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_STREAM_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 2 * 60 * 1000;

function createAbortScope({ signal, timeoutMs, timeoutMessage }) {
  const controller = new AbortController();
  let abortKind = '';
  const onExternalAbort = () => {
    abortKind = 'external';
    controller.abort(signal?.reason);
  };
  if (signal?.aborted) onExternalAbort();
  else signal?.addEventListener('abort', onExternalAbort, { once: true });
  const timer = timeoutMs > 0 ? setTimeout(() => {
    abortKind = 'timeout';
    controller.abort();
  }, timeoutMs) : null;
  return {
    signal: controller.signal,
    abortKind: () => abortKind,
    close() {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onExternalAbort);
    },
    error(error) {
      if (abortKind === 'timeout') return new Error(timeoutMessage);
      if (abortKind === 'external' || signal?.aborted) {
        const aborted = new Error('请求已取消');
        aborted.name = 'AbortError';
        return aborted;
      }
      return error;
    },
  };
}

async function responseError(response) {
  const text = await response.text().catch(() => '');
  try {
    const json = text ? JSON.parse(text) : {};
    return new Error(json.error || json.message || `HTTP ${response.status}`);
  } catch {
    return new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`);
  }
}

async function requestJson(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_JSON_TIMEOUT_MS;
  const scope = createAbortScope({
    signal: options.signal,
    timeoutMs,
    timeoutMessage: `请求超时（${Math.round(timeoutMs / 1000)} 秒）`,
  });
  try {
    const response = await fetch(url, {
      ...options,
      cache: 'no-store',
      signal: scope.signal,
    });
    if (!response.ok) throw await responseError(response);
    return await response.json();
  } catch (error) {
    throw scope.error(error);
  } finally {
    scope.close();
  }
}

export const api = {
  get(url, options = {}) {
    return requestJson(url, { ...options, method: 'GET' });
  },

  post(url, body, options = {}) {
    return requestJson(url, {
      ...options,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: JSON.stringify(body || {}),
    });
  },

  patch(url, body, options = {}) {
    return requestJson(url, {
      ...options,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: JSON.stringify(body || {}),
    });
  },

  delete(url, options = {}) {
    return requestJson(url, { ...options, method: 'DELETE' });
  },

  upload(url, file, options = {}) {
    return requestJson(url, {
      ...options,
      method: 'POST',
      headers: { 'Content-Type': options.contentType || file?.type || 'application/octet-stream', ...(options.headers || {}) },
      body: file,
      timeoutMs: options.timeoutMs || 30 * 60 * 1000,
    });
  },

  // 消费后端 SSE 流。POST 无法用 EventSource，手工解析。
  async postStream(url, body, {
    onDelta,
    onDone,
    onError,
    onProgress,
    onEvent,
    signal,
    timeoutMs = DEFAULT_STREAM_TIMEOUT_MS,
    idleTimeoutMs = DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  } = {}) {
    const scope = createAbortScope({
      signal,
      timeoutMs,
      timeoutMessage: `生成请求超时（${Math.round(timeoutMs / 60000)} 分钟）`,
    });
    let idleTimer = null;
    let reader = null;
    let errorReported = false;
    const fail = (error) => {
      const finalError = scope.error(error);
      if (!errorReported) {
        errorReported = true;
        onError?.(finalError);
      }
      throw finalError;
    };
    // 空闲超时需要独立控制器，因为 AbortSignal 不能由外部 dispatch 真正取消 fetch。
    const idleController = new AbortController();
    const onScopeAbort = () => idleController.abort(scope.signal.reason);
    if (scope.signal.aborted) onScopeAbort();
    else scope.signal.addEventListener('abort', onScopeAbort, { once: true });
    let idleTimedOut = false;
    const armIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimedOut = true;
        idleController.abort();
      }, Math.max(5000, Number(idleTimeoutMs) || DEFAULT_STREAM_IDLE_TIMEOUT_MS));
    };

    try {
      armIdleTimer();
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(body || {}),
        signal: idleController.signal,
      });
      const ctype = response.headers.get('content-type') || '';
      if (!response.ok || !response.body || ctype.includes('application/json')) {
        throw await responseError(response);
      }

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let result;
      let finished = false;
      const handleBlock = (block) => {
        let event = 'message';
        let data = '';
        for (const rawLine of block.split('\n')) {
          const line = rawLine.replace(/\r$/, '');
          if (line.startsWith(':')) continue;
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trimStart();
        }
        if (!data) return;
        let payload;
        try { payload = JSON.parse(data); } catch { return; }
        const type = event === 'message' ? payload.type : event;
        const eventData = event === 'message' && payload.data !== undefined ? payload.data : payload;
        if (type === 'delta') onDelta?.(eventData.text ?? eventData.chunk ?? '');
        else if (type === 'progress') onProgress?.(eventData);
        else if (type === 'done') {
          result = eventData;
          onDone?.(eventData);
          finished = true;
        } else if (type === 'error') {
          throw new Error(eventData.message || '生成失败');
        } else if (type) {
          onEvent?.(type, eventData);
        }
      };

      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        armIdleTimer();
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';
        for (const block of blocks) {
          handleBlock(block);
          if (finished) break;
        }
      }
      if (!finished) {
        buffer += decoder.decode();
        if (buffer.trim()) handleBlock(buffer);
      }
      if (!finished && !idleController.signal.aborted) throw new Error('生成连接提前结束');
      return result;
    } catch (error) {
      if (idleTimedOut) return fail(new Error(`生成请求超过 ${Math.round(idleTimeoutMs / 1000)} 秒没有返回内容`));
      return fail(error);
    } finally {
      clearTimeout(idleTimer);
      scope.signal.removeEventListener('abort', onScopeAbort);
      try { await reader?.cancel(); } catch { /* ignore */ }
      scope.close();
    }
  },
};

