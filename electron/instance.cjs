'use strict';

// Electron's lock belongs to the configured userData directory. Acquire it
// before opening the store so independent development/test workspaces coexist.
function acquireWorkspaceInstance(app, activate) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on('second-instance', () => activate());
  return true;
}

module.exports = { acquireWorkspaceInstance };
