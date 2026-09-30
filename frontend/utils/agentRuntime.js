import {
  agentAttachmentLabel,
  createAgentRuntime,
  createAgentStateRuntime,
  formatAgentFileSize,
  readAgentTxtFiles as readAgentTxtFilesData,
} from './agentFiles.js';

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
