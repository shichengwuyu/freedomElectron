import fs from 'fs';
import path from 'path';

export function launchDesktop(url, dataDir) {
  import('child_process').then(({ spawn }) => {
    const candidates = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
    ];
    const browser = candidates.find((candidate) => candidate && fs.existsSync(candidate));
    if (browser) {
      const profileDir = path.join(dataDir, '.app-window');
      try {
        const child = spawn(
          browser,
          [
            `--app=${url}`,
            `--user-data-dir=${profileDir}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--window-size=1280,860',
          ],
          { detached: true, stdio: 'ignore' }
        );
        // spawn 失败（如路径存在但启动报错）以 'error' 事件异步抛出，不接会变成未捕获异常
        child.on('error', (e) => {
          console.error('  以应用窗口打开失败，回退到默认浏览器：', e.message);
          openWithDefaultBrowser(spawn, url);
        });
        child.unref();
        console.log('  已以桌面应用窗口方式打开。关闭此命令行窗口可停止服务。\n');
        return;
      } catch (e) {
        console.error('  以应用窗口打开失败，回退到默认浏览器：', e.message);
      }
    }
    openWithDefaultBrowser(spawn, url);
  }).catch((error) => {
    console.error('  加载 child_process 失败，无法打开应用窗口：', error?.message || error);
  });
}

function openWithDefaultBrowser(spawn, url) {
  // 用参数数组代替字符串拼接，避免 shell 注入/引号转义问题
  try {
    const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', url], { detached: true, stdio: 'ignore' });
    child.on('error', (e) => console.error('  打开默认浏览器失败：', e.message));
    child.unref();
  } catch (e) {
    console.error('  打开默认浏览器失败：', e.message);
  }
}
