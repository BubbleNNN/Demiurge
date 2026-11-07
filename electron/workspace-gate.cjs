'use strict';

const MAINTENANCE = new Set([
  'export-workspace',
  'import-workspace',
  'restore-previous-state',
  'reset-credentials',
]);
const OPEN_DIRECTORY = 'open-data-directory';

function createWorkspaceGate() {
  const active = new Map();
  let maintenance = false;
  let sealed = false;

  async function run(name, callback) {
    const exempt = name === OPEN_DIRECTORY;
    const exclusive = MAINTENANCE.has(name);
    if (!exempt && (maintenance || sealed)) throw new Error('正在备份或恢复工作区，请稍后重试。');
    if (exclusive && [...active.values()].some((operation) => operation !== OPEN_DIRECTORY))
      throw new Error('请等待当前操作完成并关闭文件选择窗口后，再备份或恢复工作区。');

    // Register before invoking the callback: it can start disk work or yield to
    // a native dialog before its first promise settles. Each request has its
    // own token, including concurrent requests with the same IPC name.
    const token = Symbol(name);
    active.set(token, name);
    if (exclusive) maintenance = true;
    try {
      return await callback();
    } finally {
      active.delete(token);
      if (exclusive) maintenance = false;
    }
  }

  return {
    run,
    // Imported files must remain protected from the old process's caches until
    // restart, even after the importing callback returns or throws.
    seal: () => {
      sealed = true;
    },
  };
}

module.exports = { createWorkspaceGate };
