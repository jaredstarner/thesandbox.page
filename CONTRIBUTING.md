# Contributing

Contributions are welcome: new experiments, fixes, and improvements to the site or its tooling. By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- For anything beyond a small fix, open an issue first so the idea can be discussed
- Report security issues privately; see [SECURITY.md](SECURITY.md)

## Setup

1. Fork the repo and clone your fork
2. Install Node.js 22.12+ and enable pnpm with `corepack enable`
3. Run `pnpm install`
4. Set up commit signing (SSH or GPG) and add the key to your GitHub account as a signing key; see [GitHub's guide](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification). Unsigned commits cannot be merged

## Making a change

The full rules live in the **Workflow** section of [AGENTS.md](AGENTS.md), which both people and coding agents follow. In short:

1. Branch from `main`
2. Make small, focused, signed commits with [Conventional Commit](https://www.conventionalcommits.org) messages
3. Run `pnpm check` and `pnpm build`
4. Open a pull request into `main` and fill in the template

Pull requests merge once the `check-and-build` check passes and a maintainer merges them. Merging to `main` deploys the site and, for `feat` and `fix` commits, cuts a release.
