import {
  agentAttachmentLabel,
  createAgentRuntime,
  createAgentStateRuntime,
  formatAgentFileSize,
  readAgentTxtFiles as readAgentTxtFilesData,
} from './agentFiles.js';
import {
  AGENT_CAPABILITIES,
  AGENT_EXAMPLES,
  agentActionLabel,
  isRiskyAgentAction,
} from './agentUi.js';

export function createAppAgentRuntime({
  api,
  reactive,
  refs = {},
  readers = {},
  message = {},
  helpers = {},
} = {}) {
  const agent = createAgentStateRuntime({ reactive });
  const runtime = createAgentRuntime({
    api,
    refs: { ...refs, agent },
    readers,
    message,
    helpers: {
      ...helpers,
      readTxtFiles: helpers.readTxtFiles || readAgentTxtFilesData,
    },
  });

  return {
    agent,
    openAgent: runtime.openAgent,
    runAgentInstruction: runtime.runAgentInstruction,
    runAgentPendingPlan: runtime.runAgentPendingPlan,
    cancelAgentPendingPlan: runtime.cancelAgentPendingPlan,
    AGENT_CAPABILITIES,
    AGENT_EXAMPLES,
    agentActionLabel,
    isRiskyAgentAction,
    useAgentExample: (text) => { agent.input = String(text || ''); },
    handleAgentInputKeydown: runtime.handleAgentInputKeydown,
    formatAgentFileSize,
    agentAttachmentLabel,
    onAgentPickFile: runtime.onAgentPickFile,
    onAgentDrop: runtime.onAgentDrop,
    removeAgentFile: runtime.removeAgentFile,
    clearAgentFiles: runtime.clearAgentFiles,
    onAgentPickTxt: runtime.onAgentPickTxt,
    onAgentTxtDrop: runtime.onAgentTxtDrop,
    clearAgentUploadedSource: runtime.clearAgentUploadedSource,
    runAgentUploadedPipeline: runtime.runAgentUploadedPipeline,
  };
}
