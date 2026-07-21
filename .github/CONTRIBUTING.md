# Contributing to MonsterOps

Thanks for your interest in MonsterOps! This project is currently built and
maintained by one person, so please be patient with response times — but issues
and pull requests are genuinely welcome, and a lot of what's here started as
someone (often me) needing it on a real network.

## Ways to help

- **Report a bug.** Open an issue with the *Bug report* template. Include your
  MonsterOps version, OS, and clear steps to reproduce.
- **Request a feature.** Open an issue with the *Feature request* template. Tell
  me what you're trying to do and why — the "why" is the useful part.
- **Improve the docs.** Corrections and clarifications to the
  [documentation](https://monsterops.org/docs/) are always appreciated.
- **Send a pull request.** See below.

## Pull requests

- For anything beyond a small fix, **please open an issue first** so we can agree
  on the approach before you invest time in it.
- Keep each PR focused on a single change, and describe **what** it changes and
  **why**.
- Match the style of the surrounding code. The backend is FastAPI + SQLAlchemy;
  the frontend is dependency-free vanilla JS (Web Components) with **no build
  step** — please keep it that way (no bundlers, no `node_modules`).
- If you change behavior, update the relevant documentation.
- By contributing, you agree that your contribution is licensed under the
  project's [MIT License](../LICENSE).

## Reporting a security issue

Please **do not** open a public issue for security problems. Report them
privately as described in [SECURITY.md](../SECURITY.md).

## Code of Conduct

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). By participating,
you're expected to uphold it.
