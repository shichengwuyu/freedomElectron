const DEFAULT_HEARTBEAT_MS = 15_000;

export function sseStart(res) {
  if (res.headersSent) return;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
}

export function sseSend(res, event, data) {
  if (!res || res.destroyed || res.writableEnded) return false;
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

export function createSseSession(req, res, { heartbeatMs = DEFAULT_HEARTBEAT_MS } = {}) {
  sseStart(res);
  const controller = new AbortController();
  let closed = false;

  const abort = (reason) => {
    if (!controller.signal.aborted) {
      controller.abort(reason instanceof Error ? reason : new Error(String(reason || 'SSE connection closed')));
    }
  };
  const onAborted = () => abort(new Error('Client aborted the request'));
  const onResponseClose = () => {
    if (!res.writableEnded) abort(new Error('Client disconnected'));
  };

  req?.once?.('aborted', onAborted);
  res?.once?.('close', onResponseClose);

  const requestedHeartbeatMs = Number(heartbeatMs);
  const heartbeatIntervalMs = Number.isFinite(requestedHeartbeatMs)
    ? Math.max(100, requestedHeartbeatMs)
    : DEFAULT_HEARTBEAT_MS;
  const heartbeat = setInterval(() => {
    if (res.destroyed || res.writableEnded) {
      abort(new Error('SSE response is no longer writable'));
      return;
    }
    try {
      res.write(': heartbeat\n\n');
    } catch (error) {
      abort(error);
    }
  }, heartbeatIntervalMs);
  heartbeat.unref?.();

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    req?.off?.('aborted', onAborted);
    res?.off?.('close', onResponseClose);
  };

  return { signal: controller.signal, abort, close };
}

