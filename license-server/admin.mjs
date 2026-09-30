#!/usr/bin/env node
/**
 * 授权服务管理 CLI（服务端本地运行，不要暴露到公网）
 *
 *   node admin.mjs list                       列出所有账号
 *   node admin.mjs approve <用户名>            批准待审核账号
 *   node admin.mjs revoke <用户名>             吊销（客户端下次复验即被锁）
 *   node admin.mjs restore <用户名>            恢复为正常
 *   node admin.mjs passwd <用户名> <新密码>     重置密码
 *   node admin.mjs devices <用户名>            查看已登记设备
 *   node admin.mjs forget-device <用户名> <序号> 移除某台设备（换机时用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStore } from './lib/store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 允许 --config=<路径>，方便对测试库/多环境操作（与 server.mjs 一致）。
const configArg = process.argv.find((arg) => arg.startsWith('--config='));
const configPath = configArg ? path.resolve(configArg.slice('--config='.length)) : path.join(HERE, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
// 与 server.mjs 保持一致：dataDir 可能是绝对路径（测试/多环境），也可能相对 license-server/。
const dataDir = path.isAbsolute(config.dataDir || 'data')
  ? config.dataDir
  : path.join(HERE, config.dataDir || 'data');
const store = createStore({ filePath: path.join(dataDir, 'accounts.json') });

const [command, ...args] = process.argv.slice(2).filter((arg) => !arg.startsWith('--config='));

function requireUser(name) {
  const account = store.findByUsername(name);
  if (!account) {
    console.error(`找不到账号：${name}`);
    process.exit(1);
  }
  return account;
}

function setStatus(username, status) {
  const updated = store.update(username, (account) => ({
    ...account,
    status,
    approvedAt: status === 'active' ? (account.approvedAt || new Date().toISOString()) : account.approvedAt,
  }));
  if (!updated) {
    console.error(`找不到账号：${username}`);
    process.exit(1);
  }
  console.log(`${updated.username} → ${status}`);
}

switch (command) {
  case 'list': {
    const accounts = store.list();
    if (!accounts.length) { console.log('还没有任何账号。'); break; }
    console.log('用户名'.padEnd(24), '状态'.padEnd(9), '设备', '最近登录');
    for (const account of accounts) {
      console.log(
        String(account.username).padEnd(24),
        String(account.status).padEnd(9),
        String((account.devices || []).length).padEnd(4),
        account.lastLoginAt ? account.lastLoginAt.replace('T', ' ').slice(0, 19) : '—',
      );
    }
    break;
  }
  case 'approve':
    setStatus(requireUser(args[0]).username, 'active');
    break;
  case 'revoke':
    setStatus(requireUser(args[0]).username, 'revoked');
    break;
  case 'restore':
    setStatus(requireUser(args[0]).username, 'active');
    break;
  case 'passwd': {
    const account = requireUser(args[0]);
    if (!args[1] || args[1].length < 5) {
      console.error('新密码至少 5 个字符。');
      process.exit(1);
    }
    store.update(account.username, (current) => ({ ...current, passwordHash: store.hashPassword(args[1]) }));
    console.log(`${account.username} 密码已重置。`);
    break;
  }
  case 'devices': {
    const account = requireUser(args[0]);
    const devices = account.devices || [];
    if (!devices.length) { console.log('该账号还没有登录过的设备。'); break; }
    devices.forEach((device, index) => {
      console.log(`[${index}] ${device.hash.slice(0, 16)}…  最近 ${device.lastSeenAt || '—'}  ${device.appVersion || ''}`);
    });
    break;
  }
  case 'forget-device': {
    const account = requireUser(args[0]);
    const index = Number(args[1]);
    const devices = account.devices || [];
    if (!Number.isInteger(index) || index < 0 || index >= devices.length) {
      console.error('序号不合法，先用 devices 查看。');
      process.exit(1);
    }
    const removed = devices[index];
    store.update(account.username, (current) => ({
      ...current,
      devices: (current.devices || []).filter((device) => device.grant !== removed.grant),
    }));
    console.log(`已移除设备 ${removed.hash.slice(0, 16)}…`);
    break;
  }
  default:
    console.log(`用法：
  node admin.mjs list
  node admin.mjs approve <用户名>
  node admin.mjs revoke <用户名>
  node admin.mjs restore <用户名>
  node admin.mjs passwd <用户名> <新密码>
  node admin.mjs devices <用户名>
  node admin.mjs forget-device <用户名> <序号>`);
    break;
}
