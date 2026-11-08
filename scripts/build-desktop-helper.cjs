'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');
if (process.platform !== 'darwin') throw Error('桌面窗口帮助程序需要在 macOS 上编译。');
execFileSync(
  'swiftc',
  [
    path.resolve(__dirname, '../electron/native/desktop-bounds.swift'),
    '-o',
    path.resolve(__dirname, '../electron/native/desktop-bounds'),
  ],
  { stdio: 'inherit' },
);
