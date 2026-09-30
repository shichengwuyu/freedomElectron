function safeText(value, fallback = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function latestAgentReply(agent) {
  const messages = Array.isArray(agent?.messages) ? agent.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'agent') return safeText(messages[index].content);
  }
  return '';
}

export function createTaskNotifyRuntime({
  watch,
  onMounted,
  refs = {},
  helpers = {},
  globals = {},
} = {}) {
  const host = globals.window?.desktopPetHost;
  const agent = refs.agent;
  const taskCenter = refs.taskCenter;
  let previousActive = false;
  let previousDone = Number(taskCenter?.summary?.done) || 0;
  let previousFailed = Number(taskCenter?.summary?.failed) || 0;
  let summaryInitialized = Boolean(taskCenter?.loadedAt);

  const sync = () => {
    const runningTasks = Number(taskCenter?.summary?.running) || 0;
    const queuedTasks = Number(taskCenter?.summary?.queued) || 0;
    const doneTasks = Number(taskCenter?.summary?.done) || 0;
    const failedTasks = Number(taskCenter?.summary?.failed) || 0;
    const firstSummaryLoad = !summaryInitialized && Boolean(taskCenter?.loadedAt);
    if (firstSummaryLoad) {
      previousDone = doneTasks;
      previousFailed = failedTasks;
      summaryInitialized = true;
    }

    const agentActive = Boolean(agent?.running || agent?.pipelineRunning);
    const active = agentActive || runningTasks + queuedTasks > 0;
    const finished = !active
      && (previousActive || (!firstSummaryLoad && (doneTasks > previousDone || failedTasks > previousFailed)));

    if (finished) {
      const failed = agent?.progress?.status === 'exception' || failedTasks > previousFailed;
      // 与原桌宠通知一致：仅「执行中 → 成功」这一跃迁弹系统通知，失败不弹
      if (previousActive && !failed && host?.notifyTaskDone) {
        host.notifyTaskDone({
          title: 'Freedom Agent 已完成',
          body: safeText(latestAgentReply(agent), '点击查看结果'),
        });
      }
    }

    previousActive = active;
    previousDone = doneTasks;
    previousFailed = failedTasks;
  };

  watch?.(
    () => [
      agent?.running,
      agent?.pipelineRunning,
      agent?.progress?.active,
      agent?.progress?.percentage,
      agent?.progress?.label,
      agent?.progress?.detail,
      agent?.progress?.status,
      agent?.messages?.length,
      taskCenter?.summary?.running,
      taskCenter?.summary?.queued,
      taskCenter?.summary?.done,
      taskCenter?.summary?.failed,
      taskCenter?.loadedAt,
      refs.project?.value?.id,
      refs.project?.value?.name,
    ],
    sync,
    { immediate: true },
  );

  onMounted?.(() => {
    helpers.startBackgroundTaskMonitor?.();
    host?.onOpenAgent?.(() => {
      helpers.openAgent?.();
      globals.window?.setTimeout?.(() => {
        globals.document?.querySelector?.('.agent-input textarea')?.focus?.();
      }, 220);
    });
  });
}
