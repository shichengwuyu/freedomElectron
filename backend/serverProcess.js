// 后端服务子进程入口：由 Electron 主进程用 utilityProcess.fork 启动。
// 后端所有同步 IO（项目读写、目录统计、ffmpeg、日志落盘等）从此发生在
// 独立进程里，不再阻塞界面进程的事件循环。
// 存储根目录等由主进程通过 GG_STORAGE_ROOT / GG_INSTALL_DIR 环境变量传入，
// 保证两个进程解析出的路径完全一致。
import { startServer } from './server.js';

const port = Number(process.env.GG_SERVER_PORT || 0) || 0;

function send(message) {
  try { process.parentPort?.postMessage(message); } catch { /* 主进程已退出 */ }
}

let serverRef = null;
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const finish = () => process.exit(0);
  if (!serverRef?.listening) return finish();
  const timer = setTimeout(finish, 3000);
  serverRef.close(() => {
    clearTimeout(timer);
    finish();
  });
}

process.parentPort?.on('message', (event) => {
  if (event?.data?.type === 'shutdown') shutdown();
});

try {
  const started = await startServer({ port, openDesktop: false });
  serverRef = started.server;
  send({ type: 'server-ready', url: started.url, port: started.port });
} catch (error) {
  send({ type: 'server-error', code: error?.code || '', message: error?.message || String(error) });
  process.exit(1);
}
