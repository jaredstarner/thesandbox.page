# Contributing

Contributions are welcome: new experiments, fixes, and improvements to the site or its tooling. By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

There are two ways to contribute, and most of this guide applies to both:

- **Collaborators** have been invited to the repo with write access. You clone the repo directly, push branches to it, and merge your own pull requests
- **Outside contributors** work from a fork; a collaborator or maintainer reviews and merges your pull requests

## Before you start

- For anything beyond a small fix, open an issue first so the idea can be discussed
- Report security issues privately; see [SECURITY.md](SECURITY.md)

## Setup

1. Get the code
   - Collaborators: `git clone https://github.com/jaredstarner/thesandbox.page.git`
   - Outside contributors: fork the repo, then clone your fork
2. Install Node.js 22.12+ and enable pnpm with `corepack enable`
3. Run `pnpm install`
4. Set up commit signing (SSH or GPG) and add the key to your GitHub account as a **signing** key; see [GitHub's guide](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification). Your commit email must also be a verified email on your GitHub account, or the signature shows as unverified. Unverified commits cannot be merged

## Making a change

The full rules live in the **Workflow** section of [AGENTS.md](AGENTS.md), which both people and coding agents follow. In short:

1. Branch from `main`, named `<type>/<short-description>` (for example `feat/scroll-timeline` or `fix/nav-overflow`). Collaborators push branches to this repo; outside contributors push to their fork
2. Make small, focused, signed commits with [Conventional Commit](https://www.conventionalcommits.org) messages
3. Run `pnpm check` and `pnpm build`
4. Open a pull request into `main` and fill in the template

## Merging

Every pull request into `main` needs passing `check-and-build`, `dependency-review`, and CodeQL checks, and signed, verified commits.

- **Collaborators** merge their own pull requests once checks pass, or enable auto-merge. Only merge commits are allowed. Changes under `.github/` or to `.releaserc.json` also need the owner's approval (see [`.github/CODEOWNERS`](.github/CODEOWNERS)), since they control CI and releases
- **Outside contributors**: CI on a fork pull request runs only after someone with write access approves it, and a collaborator or maintainer merges it after review

## Going live

Merging to `main` starts the **Production** workflow, which deploys the site and, for `feat` and `fix` commits, cuts a release.

- When a collaborator merges, the workflow waits for the owner to approve the `production` environment before deploying. Until then the change is on `main` but not live
- If `main` moves on before approval, the older run skips itself and the newer one deploys everything

Merged branches are deleted automatically.

## Collaborator guidelines

- Do not push tags; semantic-release creates every version tag
- Do not push to `main`; the ruleset blocks it, and every change goes through a pull request
- Review outside contributors' pull requests before approving their CI runs or merging; check workflow and dependency changes closely
