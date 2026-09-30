import { createAppVideoRuntime } from '../utils/videoRuntime.js';

export function createVideoRuntimeForApp({
  api,
  elementPlus,
  message,
  refs,
  helpers,
  vue,
  globals,
}) {
  const { ElMessage, ElMessageBox } = elementPlus;
  const { reactive, computed, watch, ref } = vue;

  return createAppVideoRuntime({
    api,
    message,
    messageBox: ElMessageBox,
    refs,
    helpers: {
      ...helpers,
      autoTailFrameName: () => '本段开场状态参考图',
      infoTip: (messageText) => ElMessage({ message: messageText, type: 'info', duration: 0 }),
      confirmDreaminaLogout: () => ElMessageBox.confirm(
        '退出后即梦 CLI 会清除本机登录态，继续生成前需要重新登录。确定退出当前账号？',
        '退出即梦账号',
        { type: 'warning', confirmButtonText: '退出账号', cancelButtonText: '取消' }
      ).then(() => true).catch(() => false),
      confirmLibtvLogout: () => ElMessageBox.confirm(
        '退出后 LibTV CLI 会清除本机登录态，继续生成前需要重新登录。确定退出当前账号？',
        '退出 LibTV 账号',
        { type: 'warning', confirmButtonText: '退出账号', cancelButtonText: '取消' }
      ).then(() => true).catch(() => false),
    },
    globals,
    reactive,
    computed,
    watch,
    ref,
  });
}
