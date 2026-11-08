#!/bin/zsh
set -eu
cd -- "${0:A:h}"

# Prefer the user's Node; the bundled Codex runtime is an optional local fallback.
if command -v node >/dev/null 2>&1; then
  mori_node="$(command -v node)"
elif [[ -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  mori_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
else
  print 'Demiurge 需要 Node.js 22.12+。请安装后按 README 运行 pnpm install。'
  read -r '?按回车关闭。'
  exit 1
fi

if [[ ! -f node_modules/electron/cli.js ]]; then
  print '请先在项目目录执行 pnpm install，再打开 Demiurge。'
  read -r '?按回车关闭。'
  exit 1
fi

"$mori_node" node_modules/typescript/bin/tsc -b
"$mori_node" node_modules/vite/bin/vite.js build
exec env -u ELECTRON_RUN_AS_NODE "$mori_node" node_modules/electron/cli.js "$PWD"
