# thesandbox.page

Testing ground for web experiments: static Astro, strict TypeScript, deployed to GitHub Pages. `CLAUDE.md` is a symlink to this file; edit `AGENTS.md`.

## Workflow

- Never push to `main`; work on a branch and open a pull request into `main`
- Sign every commit; the `main` ruleset rejects unsigned commits
- Keep commits small and focused; PRs merge with a merge commit, so each commit lands on `main`
- Write commit messages as [Conventional Commits](https://www.conventionalcommits.org); semantic-release reads them
  - `feat` releases a minor version, `fix` and `perf` a patch, `!` or `BREAKING CHANGE` a major
  - `build`, `chore`, `ci`, `docs`, `refactor`, `style`, and `test` release nothing
- Run `pnpm check` and `pnpm build` before pushing; CI runs both as the required `check-and-build` check
- Name branches `<type>/<short-description>`, using a Conventional Commit type (for example `fix/nav-overflow`)
- Required checks: `check-and-build`, `dependency-review`, and CodeQL; no approval is needed except for changes under `.github/` or to `.releaserc.json`, which need the owner's review (`.github/CODEOWNERS`)
- Enable auto-merge on PRs; they merge once checks pass. If a PR from the owner (including `/sandbox` runs) is waiting on code owner review, merge it with the admin bypass after checks pass
- Merging to `main` runs the Production workflow: deploy to GitHub Pages, then semantic-release. Merges by anyone other than the owner wait for owner approval on the `production` environment
- Never push tags; semantic-release creates every version tag
- Releases are git tags plus GitHub releases only; do not edit the `package.json` version or add a CHANGELOG
- Agents stop for a local review before pushing a branch
- Design tokens and shared components go in `src/theme/` (see `src/theme/README.md`)

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
