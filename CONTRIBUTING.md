# Contributing

I use Conventional Commits 1.0.0 in the form `type(scope): summary`. The permitted types are `feat`, `fix`, `refactor`, `test`, `docs`, `perf`, `build`, `ci`, `chore` and `revert`. I use the workspace folder or `repo` as the scope, an imperative lower-case summary, and a header of at most 72 characters. I explain the change and its reason in the body. I add no footers or trailers.

I work on short branches named `feature/`, `fix/`, `docs/`, `refactor/`, `test/`, `infra/` or `chore/`, followed by a kebab-case slug. I rebase these branches onto `main` and merge once CI is green. The initial repository commit establishes `main` directly.

I run `pnpm verify`, `pnpm build` and `pnpm synth` before submitting a change. I add tests for new behaviour, document exported symbols, and keep new interface text in both message catalogues. I use `pnpm format` to apply the default Prettier style.

I record reader-facing changes using Keep a Changelog 1.1.0. I follow Semantic Versioning and identify releases with tags in the form `vX.Y.Z`.
