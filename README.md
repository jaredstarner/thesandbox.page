# thesandbox.page

A testing ground for web experiments, built with [Astro](https://astro.build) and TypeScript. Deployed to GitHub Pages at [thesandbox.page](https://thesandbox.page).

## Requirements

- Node.js 22.12 or later
- pnpm 12 (pinned in `package.json` via `packageManager`; `corepack enable` picks it up)

## Commands

Run from the repo root.

| Command        | Action                                          |
| :------------- | :---------------------------------------------- |
| `pnpm install` | Install dependencies                            |
| `pnpm dev`     | Start the dev server at `http://localhost:4321` |
| `pnpm check`   | Type-check `.astro` and `.ts` files             |
| `pnpm build`   | Build the static site to `./dist/`              |
| `pnpm preview` | Serve the production build locally              |

Run `pnpm check` and `pnpm build` before opening a pull request; both must pass.

## Project structure

```text
public/            Static assets served as-is
src/experiments/   Experiment metadata, one JSON file each (see src/experiments/README.md)
src/home/          The home page's falling-sand field
src/layouts/       Page layouts
src/pages/         Routes; each file becomes a page. Experiments live in src/pages/<slug>/; /experiments/ lists them
src/theme/         Design tokens and shared components (see src/theme/README.md)
```

## Toolchain notes

- `pnpm-workspace.yaml` approves esbuild's build script; without it `pnpm install` exits 1
- TypeScript is pinned to 6.x because `@astrojs/check` supports `^5 || ^6` only
- `pmOnFail: ignore` in `pnpm-workspace.yaml` keeps `pnpm-lock.yaml` to one YAML document so Dependabot can read it ([dependabot-core#15904](https://github.com/dependabot/dependabot-core/issues/15904)); pnpm no longer enforces `packageManager`, so CI pins the pnpm version. Remove it once that issue is fixed
- `CLAUDE.md` is a symlink to `AGENTS.md`; edit `AGENTS.md`. On Windows, clone with `core.symlinks=true` to keep it a link

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately per [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
