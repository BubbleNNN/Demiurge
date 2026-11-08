# Contributing to Demiurge

Demiurge is an Electron / React / TypeScript desktop companion. Use Node.js 22.12 or newer and the pnpm version declared in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm desktop
```

Live2D is optional for ordinary development. To use it, run `pnpm setup:live2d` and read [the vendor notice](docs/THIRD_PARTY.md). Do not commit the downloaded Core runtime.

The development launcher uses `.local/development-v2`. Set `MORI_DATA_DIR` to a separate directory for manual tests. Do not test against someone's real character, chat, or credential storage. Native integration scripts under `scripts/test-*-desktop.cjs` create isolated workspaces; some require a graphical desktop or separately downloaded model fixtures. CI runs the source tests and production web build, not the full native or visual acceptance suite.

Keep changes focused and describe the user-visible behavior, validation, and limitations in the pull request. Generated animation fixtures establish software behavior; they do not establish character identity or artistic quality. Preserve the candidate review step and do not automatically retry potentially billable image requests.

Never commit API keys, user backups, chat logs, local model files, or downloaded character reference images. Source code is MIT licensed; character artwork and third-party dependencies retain their separate rights. Contributions of assets should include their provenance and distribution terms.
