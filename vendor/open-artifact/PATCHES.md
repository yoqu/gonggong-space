# open-artifact: our changes

Upstream: https://github.com/JimLiu/open-artifact at the commit in `UPSTREAM`, copied by `scripts/vendor-open-artifact.sh`
(22 of its packages plus `test-artifacts/slides/`, the root `package.json` / `tsconfig.json` cut down to them, its
`package-lock.json` pruned by `npm install`). The Rust sources of `wasm-*` are not copied: their `generated/` builds
are upstream's.

Only three kinds of change are allowed (plan 产物容器 §7): theme token mapping, removing local-daemon-only entry points,
bug fixes. List each one below — file, what, why — so an upgrade can replay them one by one.

## Upgrading

1. `scripts/vendor-open-artifact.sh <commit>` (replaces `packages/` and `test-artifacts/`, rewrites the root manifests).
2. `cd vendor/open-artifact && npm install` (Node ≥ 22.18), then `npm run typecheck && npm test`.
3. Replay every patch below; compare `CONTRACT_VERSION` in `packages/runtime/src/capabilities.ts` and `CAP_PROTOCOL` /
   `CHROME_PROTOCOL` in `packages/protocol/src/shell.ts` with the previous commit (plan §9 合约漂移).
4. `scripts/build-open-artifact.sh` and the spike: `pnpm exec playwright test -c e2e/oa-spike`.

## Patches

None yet. The Slides editor runs behind our broker unpatched (`docs/plan/产物容器-S0-spike.md`); the patches that
spike expects for S1 are listed there in §5.
