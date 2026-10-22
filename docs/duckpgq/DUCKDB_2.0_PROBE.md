# DuckDB 2.0 Compatibility Probe

> **EXPERIMENTAL BRANCH.** This document describes branch `exp/duckdb-2.0` (created from `origin/main` =
> v1.7.0, `e58160d`; rebased on v1.7.3, `ca84d11`, on 2026-10-22 — see section 10). It is a **compatibility probe, not a release candidate**, and it is not meant to
> be merged as is. Nothing here changes the supported engine of the published package, which stays
> DuckDB 1.5.4. Every number below comes from a command run on 2026-10-22 on Linux x64 (WSL2),
> Node 22.22.0 unless stated otherwise. Raw logs live outside the repository.

## 1. Summary

| Question                                  | Answer                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the code build against node-api 2.0? | Yes. `tsc` needs no change: the package uses six node-api members (`DuckDBInstance.create/connect/closeSync`, `run`, `getRowObjectsJson`, `disconnectSync`).                                                                                                                                                                                                   |
| Do the existing tests pass on DuckDB 2.0? | 564 passed, 26 skipped, 0 failed (identical to the 1.5.4 baseline) with the default config. With the opt-in CI network step: 2 failures (stale test precondition, section 4).                                                                                                                                                                                  |
| Is there a real functional break?         | **Yes, one: DuckPGQ.** On 2.0 the SQL/PGQ grammar is opt-in per connection. Without `SET active_grammar_extensions = ['duckpgq']`, `CREATE PROPERTY GRAPH` and `GRAPH_TABLE` fail with a Parser Error even though `LOAD duckpgq` succeeds and the service logs "loaded successfully". No existing test catches it.                                             |
| Does the sandbox still hold?              | For everything tested so far, yes (not a general proof; see sections 9 and 10). `service.sandbox.test.ts` (19), `service.lifecycle.test.ts` (31) and `service.sandbox-network.test.ts` (2, after a precondition fix) pass on 2.0.0, and an end-to-end MCP run in `MCP_SECURITY_MODE=production` blocks `read_text('/etc/hostname')` while `GRAPH_TABLE` works. |
| Onager?                                   | No 2.0.0 build exists (HTTP 404 on all 8 platform URLs). `ENABLE_ONAGER=true` degrades as documented: warn and `onagerLoaded === false`, or throw with `ONAGER_STRICT_MODE=true`.                                                                                                                                                                              |
| Patch size                                | `src/duckdb/service.ts`: +52 lines (version-gated opt-in). One test precondition changed (+6/-2). 1 new test file (6 tests), 1 new manual capability script, this document.                                                                                                                                                                                    |

## 2. Method and environment

- Host: Linux 6.6.87.2-microsoft-standard-WSL2 (x64), glibc 2.39. Default Node v22.22.0, npm 10.9.4.
  Extra Node versions fetched from the npm registry into isolated directories: 20.19.5, 20.20.2, 24.22.1.
- Baseline measured on this same checkout before the bump (DuckDB v1.5.4, `@duckdb/node-api@1.5.4-r.1`).
- A scratch mirror of the worktree with `@duckdb/node-api@1.5.4-r.1` installed `--no-save` was used to
  prove that behaviour on DuckDB 1.x is unchanged by the patch. It is outside the repository.
- Network: registry.npmjs.org, extensions.duckdb.org, community-extensions.duckdb.org and one plain GET
  of the public DuckDB v2.0.0 release notes on github.com. No credentials were used; the worktree has no `.env`.

### Environment caveats found on the way (category E)

1. **Working tree line endings.** The maintainer's global git config has `core.autocrlf=true`, so this
   linked worktree was checked out with CRLF (185 tracked files `i/lf w/crlf`). On the unmodified
   baseline that makes `npm run lint` report 18968 problems (18808 errors, for example prettier/prettier "Delete `CR`") and
   `npm run format:check` flag 96 files. After rewriting the working tree from the index with LF
   (`git -c core.autocrlf=false checkout-index`, no git config changed) the baseline is lint 0 errors /
   160 warnings and format OK. This is unrelated to DuckDB 2.0; the commit stores LF either way.
2. **Test side effect.** `src/tools/process-tools.test.ts` rewrites the tracked fixtures
   `test-data/process/*.parquet` on every run, so the tree is dirty after any test run. They were
   restored (`git checkout -- test-data/process`) before each commit and are not part of it.
3. **Lockfile writer.** npm 10.9.4 rewrites unrelated lock entries (drops the `libc` fields), so the
   lockfile was produced with `npx npm@11.21.1` to keep the diff minimal (section 3.1).

## 3. Facts

### 3.1 Packages, engines, lockfile

| Item                                    | 1.5.4-r.1                                                        | 2.0.0-r.1                                                               |
| --------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `@duckdb/node-api` dependencies         | `@duckdb/node-bindings`                                          | `@duckdb/node-bindings` (same shape)                                    |
| `@duckdb/node-bindings` dependencies    | `detect-libc ^2.1.2`                                             | `detect-libc ^2.1.2` (unchanged)                                        |
| `engines` / `peerDependencies`          | none                                                             | **none** (npm 10.9.4 and 11.21.1 printed no EBADENGINE or peer warning) |
| Native addon                            | Node-API addon (`node_api_module_get_api_version_v1`, type tags) | Node-API addon (same symbols)                                           |
| Native floor (linux-x64)                | libduckdb: GLIBC 2.25, GLIBCXX 3.4.22                            | libduckdb: GLIBC 2.25, GLIBCXX 3.4.22 (unchanged)                       |
| Unpacked size, linux-x64 / linux-arm64  | 70.8 MB / 63.3 MB                                                | 96.4 MB / 100.5 MB                                                      |
| Unpacked size, darwin-arm64 / win32-x64 | 112.9 MB / 37.8 MB                                               | 66.2 MB / 62.9 MB                                                       |
| npm dist-tag                            | -                                                                | `latest` = 2.0.0-r.1 (published 2026-10-21); `lts-v1.4` = 1.4.5-r.1     |

Required Node version: the new bindings declare none, so `package.json` `engines.node >=20.0.0` is not
contradicted. The full suite with the patch passes on Node 20.19.5, 20.20.2, 22.22.0 and 24.22.1
(572 passed, 24 skipped, 0 failed with the network step enabled). Node 20.0 to 20.19.4 was not tested.

Lockfile: `package-lock.json` changes 40 lines in and 40 out, all inside the `@duckdb/node-api`,
`@duckdb/node-bindings` and 8 platform entries (version, resolved, integrity, optionalDependencies)
plus the root dependency line. `npm ci` (npm 10.9.4) on that lock installs 395 packages, and
`npm rebuild @duckdb/node-api` (a CI step) succeeds.

### 3.2 DuckPGQ grammar opt-in (category C)

Measured with `INSTALL duckpgq FROM community; LOAD duckpgq` on a fresh instance per engine:

| Check                                                   | DuckDB 1.5.4 (duckpgq `f386a6c`)                      | DuckDB 2.0.0 (duckpgq `29ca668a22`)                                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `current_setting('active_grammar_extensions')`          | `Catalog Error: unrecognized configuration parameter` | `[]` (empty by default)                                                                                                            |
| `CREATE PROPERTY GRAPH` right after `LOAD`              | works                                                 | **`Parser Error: syntax error at or near "PROPERTY"`**                                                                             |
| `SET active_grammar_extensions = ['duckpgq']`           | `unrecognized configuration parameter`                | works; setting reads back `["duckpgq"]`                                                                                            |
| `SET active_grammar_extensions = ['nonexistent']`       | `unrecognized configuration parameter`                | `Can't set 'active_grammar_extensions', the following extensions don't exist: nonexistent`                                         |
| Second connection on the same instance                  | n/a                                                   | setting is `[]`; `GRAPH_TABLE` gives `Parser Error ... near "MATCH"`; works after its own SET; the property graph itself is shared |
| `SET` or `RESET` after `SET lock_configuration=true`    | rejected (`... the configuration has been locked`)    | rejected (`Cannot change configuration option ""active_grammar_extensions"" - the configuration has been locked`)                  |
| `GRAPH_TABLE` on the opted-in connection after the lock | works                                                 | works                                                                                                                              |

Consequences: the opt-in must run on every connection that parses graph SQL, and in this package it
must run during `initialize()` before `applyEngineHardening()`, because the sandbox seals the
configuration. The service owns a single connection (`src/duckdb/service.ts:129` is the only
`instance.connect()` in `src/`), so the package itself needs one SET. A host that opens extra
connections on its own `DuckDBInstance` must issue the SET on each of them.

The pre-existing success log ("DuckPGQ extension loaded successfully ... Property Graph features
available") is misleading on 2.0 without the opt-in. `scripts/test-duckpgq.ts` is a false green there:
it prints "All tests completed successfully" with `Passed: 3 | Skipped: 1` because the failed graph
creation is reported as "DuckPGQ not loaded".

### 3.3 Sandbox primitives on 2.0.0 (repo test files)

| Test file                                    | Result on 2.0.0                                                                                                                                                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/duckdb/service.sandbox.test.ts`         | 19 passed (local read and write blocked, lock holds, HTTP and S3 blocked in strict)                                                                                                                             |
| `src/duckdb/service.lifecycle.test.ts`       | 31 passed                                                                                                                                                                                                       |
| `src/duckdb/service.sandbox-network.test.ts` | 2 failed before, 2 passed after the precondition fix (section 4). Both security assertions (no request reaches the localhost canary in production, S3 reachable in `no-local-fs` as documented) hold unchanged. |

End to end over MCP stdio with the real server (`MCP_SECURITY_MODE=production`, so sandbox `strict`):
`CREATE PROPERTY GRAPH`, a 1-hop `GRAPH_TABLE` and `ANY SHORTEST ->*` all work, while
`read_text('/etc/hostname')` returns `Permission Error: Cannot access file "/etc/hostname" - file system
operations are disabled by configuration`. In development mode the same file read succeeds (sandbox
off, as designed). The 1.5.4 run of the same script behaves identically, minus the grammar log line.

### 3.4 httpfs and the legacy `s3_*` settings (category B)

After `LOAD httpfs`, `duckdb_settings()` lists 33 new settings on 1.5.4 and 24 on 2.0.0. The legacy
credential settings `s3_region`, `s3_endpoint`, `s3_access_key_id`, `s3_secret_access_key`,
`s3_session_token`, `s3_url_style`, `s3_use_ssl`, `s3_url_compatibility_mode`, `s3_kms_key_id`,
`s3_requester_pays` (and `hf_max_per_page`, `unsafe_disable_etag_checks`, `s3_uploader_thread_limit`)
are no longer listed on 2.0.0. The six that `ducklake-tools.ts` sets (`s3_endpoint`, `s3_region`,
`s3_access_key_id`, `s3_secret_access_key`, `s3_use_ssl`, `s3_url_style`) are **still accepted and still
effective** on 2.0.0: after `SET s3_endpoint=...; SET s3_region='eu-west-3'`, `current_setting('s3_region')`
returns `eu-west-3`, and a `read_csv('s3://...')` reaches a 127.0.0.1 canary server on the configured
endpoint with an `Authorization` header, exactly as on 1.5.4. They simply no longer appear in
`duckdb_settings()`. The other legacy names were not exercised.

Impact: `src/tools/ducklake-tools.ts` `configureS3()` (six `SET s3_*` statements) keeps working on 2.0.0
(its real-engine test, which passes an `s3Config`, does not fail), but relies on settings that DuckDB no
longer advertises. `CREATE SECRET`
(what `DuckDBService.configureS3` already uses) works on both.

### 3.5 Extension availability

| Extension             | DuckDB 2.0.0                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `duckpgq` (community) | installs and loads, version `29ca668a22`                                                              |
| `spatial` (core)      | installs and loads, version `a3dbcd1781`                                                              |
| `httpfs` (core)       | installs and loads (`prepare-sandbox-tests.mjs` reports "Prepared official httpfs for DuckDB v2.0.0") |
| `onager` (community)  | **HTTP 404** for `.../v2.0.0/linux_amd64/onager.duckdb_extension.gz`; 404 for all 8 platforms probed  |

HTTP status of the community binaries (HEAD, 2026-10-22):

| Platform                               | duckpgq v1.5.4 | duckpgq v2.0.0 | onager v1.5.4 | onager v2.0.0 |
| -------------------------------------- | -------------- | -------------- | ------------- | ------------- |
| linux_amd64                            | 200            | 200            | 200           | 404           |
| linux_arm64                            | 200            | 200            | 200           | 404           |
| osx_arm64                              | 200            | 200            | 200           | 404           |
| osx_amd64                              | 200            | **404**        | 404           | 404           |
| windows_amd64                          | 200            | 200            | 200           | 404           |
| linux musl (x64, arm64), windows_arm64 | 404            | 404            | 404           | 404           |

`@duckdb/node-bindings@2.0.0-r.1` still ships a darwin-x64 binary, so on Intel macOS the engine installs
but DuckPGQ is unavailable on 2.0.0 (it was available on 1.5.4).

### 3.6 Result shapes and rendering

`getRowObjectsJson()` (the only result API the service uses) was compared on 43 statements across both
engines (BIGINT, HUGEINT, DECIMAL, DOUBLE, NaN and Infinity, DATE/TIME/TIMESTAMP variants, INTERVAL, UUID,
BLOB, LIST, STRUCT, MAP, ENUM, UNION, BIT, JSON, BIGNUM, GEOMETRY text and raw, DDL, INSERT, SET, empty,
`information_schema`, `duckdb_settings`). The JSON is byte-identical except `version()` and the
**`EXPLAIN` text, which is rendered with a new box style** (`╭─ Projection ───╮` instead of the
`┌───┐ PROJECTION` layout). Anything that parses `EXPLAIN` output needs a look.

## 4. Failure inventory

Gates run on the bumped tree before any fix: `prepare-sandbox-tests` OK, `typecheck` OK, `lint` OK (0 errors,
160 warnings), `format:check` OK, `build` OK, `npm test` 564 passed / 26 skipped / 0 failed.

| #   | Test or script                                                                                                                                                             | Cat. | Root cause (evidence)                                                                                                                                                                                                                                                                                                                                                                   | Fixed by                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | `service.sandbox-network.test.ts` "default production blocks HTTP before a request, with a successful off-mode control" (opt-in CI step, `DUCKDB_SANDBOX_NETWORK_TESTS=1`) | B    | Precondition `SELECT name FROM duckdb_settings() WHERE name='s3_region'` returns `[]` on 2.0.0 (`AssertionError: expected [] to deeply equal [ { name: 's3_region' } ]`). httpfs is loaded (autoloaded by `CREATE SECRET`); the legacy settings are just no longer listed (section 3.4).                                                                                                | Marker changed to `httpfs_client_implementation` (listed on 1.5.4 and 2.0.0) |
| 2   | same file, "default production blocks S3 access even when a temporary secret selects localhost"                                                                            | B    | Same precondition in the shared `mk()` helper.                                                                                                                                                                                                                                                                                                                                          | same                                                                         |
| 3   | New test "GRAPH_TABLE works right after initialize() on a 2.x engine" (written first, run on unmodified `service.ts`)                                                      | C    | `Query failed: Parser Error: syntax error at or near "PROPERTY"`: grammar not opted in (section 3.2).                                                                                                                                                                                                                                                                                   | `enableDuckPGQGrammar()`                                                     |
| 4   | New test "enables the grammar before the sandbox seals the configuration (strict)"                                                                                         | C    | Same Parser Error.                                                                                                                                                                                                                                                                                                                                                                      | same                                                                         |
| 5   | New control-flow tests (opt-in issued before the lock, warn on failure, throw only in strict): 3 fail on unmodified code, "never issues the opt-in on 1.x" passes          | C    | Feature absent (no `active_grammar_extensions` statement is ever issued).                                                                                                                                                                                                                                                                                                               | same                                                                         |
| 6   | `tests/duckpgq-1.5-capabilities.ts` (manual script, unchanged)                                                                                                             | C    | `FATAL: Parser Error: syntax error at or near "PROPERTY"` in its shared setup, before T4.1.                                                                                                                                                                                                                                                                                             | New `tests/duckpgq-2.0-capabilities.ts`                                      |
| 7   | The scripts behind `npm run test:duckpgq:syntax` and `:failures` (manual), on the unmodified service                                                                       | C    | `Setup failed: ... Parser Error: syntax error at or near "PROPERTY"`, exit 1. The one behind `npm run test:duckpgq` is a false green (4 tests: 3 passed, 1 skipped, "All tests completed successfully"). With the patch all three match 1.5.4: 5 of 5 pass; syntax scores identical (ANY SHORTEST 2/4, Kleene star 0/3, Kleene plus 0/3, bounded 1/3); the same 18 negative tests fail. | same                                                                         |
| 8   | Capability T7.5 and `ENABLE_ONAGER=true`                                                                                                                                   | D    | `HTTP Error: Failed to download extension "onager" ... (HTTP 404)`. No Onager build for 2.0.0 on any platform. `service-onager.test.ts` (4 tests) still passes: it accepts the degraded branch.                                                                                                                                                                                         | Nothing to fix; degrades as documented (section 6)                           |
| 9   | `npm run lint` and `format:check` on a CRLF checkout                                                                                                                       | E    | Global `core.autocrlf=true`; fails identically on the 1.5.4 baseline (section 2).                                                                                                                                                                                                                                                                                                       | LF checkout of the worktree, no repository change                            |
| 10  | Tree dirty after tests                                                                                                                                                     | E    | `process-tools.test.ts` rewrites tracked parquet fixtures (pre-existing).                                                                                                                                                                                                                                                                                                               | Restored before commits                                                      |
| 11  | `npm audit --audit-level=high` (CI "security" job)                                                                                                                         | F    | 10 vulnerabilities (1 critical, 4 high, 5 moderate: `proxy-addr`, `follow-redirects`, `source-map-js`, `vite`, `@modelcontextprotocol/sdk`, ...). Identical on the baseline lock and the 2.0 lock, so unrelated to the bump.                                                                                                                                                            | Out of scope                                                                 |
| 12  | Flakiness                                                                                                                                                                  | F    | None observed: `npm test` three times in a row on the final tree gives 570 passed / 26 skipped each time; the full suite also passes from a cold HOME (no cached extensions), and on 4 Node versions.                                                                                                                                                                                   | n/a                                                                          |

The 24 tests skipped when the network step is enabled are hard `it.skip` calls in three files
(`mcp-server.test.ts` 18, `mcp-server.simple.test.ts` 1, `logger.test.ts` 5), unchanged between engines.

## 5. Patch

Branch `exp/duckdb-2.0`, two commits on top of `e58160d`.

**Commit 1: dependency bump.** `package.json`, `package-lock.json` (node-api, node-bindings and the 8
platform packages only), and the one-line marker change in `service.sandbox-network.test.ts`.
Checked on its own (`git archive` of that commit): `typecheck`, `lint` (0 errors, 160 warnings) and
`format:check` pass, and the suite with the network step enabled gives 566 passed / 24 skipped / 0 failed
on 2.0.0, the same numbers as the 1.5.4 baseline. The commit does not make DuckPGQ graph SQL work.

**Commit 2: DuckPGQ grammar opt-in.**

- `src/duckdb/service.ts`
  - `loadDuckPGQ()` records `extensionLoaded = true` right after `INSTALL ...; LOAD duckpgq;`
    and, after its existing `try/catch`, calls the new `enableDuckPGQGrammar(strictMode)`.
    The existing error handling is untouched.
  - `enableDuckPGQGrammar()` runs `SELECT version()`, parses the major (`v2.0.0` gives 2) and, only when
    the major is 2 or higher, runs `SET active_grammar_extensions = ['duckpgq']` on the service
    connection. On 1.x only the `SELECT version()` query is issued, never the SET. An unparseable version
    is treated as legacy (no SET).
  - It runs inside `initialize()` before `applyEngineHardening()`, so it precedes
    `SET lock_configuration=true`.
  - Failure handling mirrors the existing unexpected-error branch. A failure is logged with
    `logger.warn` ("Failed to enable the DuckPGQ SQL/PGQ grammar (SET active_grammar_extensions):
    MSG. Database will continue without graph features.") and an `Error` ("DuckPGQ strict mode
    enabled but grammar activation failed: MSG") is thrown only when `DUCKPGQ_STRICT_MODE=true`.
    The call sits outside the main `try/catch` on purpose: that block's legacy "unavailable for
    DuckDB 1.4.x" classification would otherwise re-wrap the message.
- `src/duckdb/service-duckpgq.test.ts` (6 tests)
  1. 2.x engine: `CREATE PROPERTY GRAPH`, a 1-hop `GRAPH_TABLE` and `ANY SHORTEST ->*` work right after `initialize()`.
  2. 2.x engine, sandbox `strict`: the same queries work on the sealed connection, and
     `SET active_grammar_extensions = ['duckpgq']` is rejected afterwards (the control showing why the order matters).
  3. Fault-injected (engine and network independent): on a `v2.0.0` engine the SET is issued exactly once, before `lock_configuration=true`.
  4. Fault-injected: on a `v1.5.4` engine the SET is never issued and nothing is warned.
  5. Fault-injected: a failing SET warns and leaves the service usable.
  6. Fault-injected: a failing SET throws only with `DUCKPGQ_STRICT_MODE=true`.

  Tests 1 and 2 skip themselves with a reason on a 1.x engine
  (`DuckDB v1.5.4: the SQL/PGQ grammar is always active on 1.x, the opt-in applies to >= 2.0`) and when the
  community extension cannot be installed. Mutation check: moving the opt-in after the hardening makes
  tests 2 and 3 fail while test 1 still passes.

- `src/duckdb/service.sandbox-network.test.ts`: marker setting `s3_region` replaced by `httpfs_client_implementation`.
- `tests/duckpgq-2.0-capabilities.ts`: copy of the 1.5 script with the same 20 test bodies plus the
  version-gated opt-in, so it runs on both engines (identical output to the original on 1.5.4).
  The original script is untouched.
- This document.

**Not changed on purpose:** README, CLAUDE.md, CHANGELOG, the stale `isDuckDB14x = true` branch,
`ducklake-tools.ts`, CI workflows, the Onager code, and every other test.

## 6. Onager on 2.0.0 (real run)

`ENABLE_ONAGER=true`, `allowUnsignedExtensions: true`, real `DuckDBService`:

| Scenario                  | Result                                                                                                                                                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| default                   | `initialize()` resolves, `onagerLoaded === false`, `[warn] Failed to load Onager: HTTP Error: Failed to download extension "onager" ... (HTTP 404) ... Database continues without Onager graph analytics`; service answers queries and `GRAPH_TABLE` works |
| `ONAGER_STRICT_MODE=true` | `initialize()` rejects with `Onager strict mode enabled but load failed: HTTP Error: Failed to download extension "onager" ... (HTTP 404)`; `isReady()` is false                                                                                           |

## 7. DuckPGQ capabilities: 1.5.4 versus 2.0.0

Same script bodies (`tests/duckpgq-1.5-capabilities.ts` on 1.5.4, `tests/duckpgq-2.0-capabilities.ts` on 2.0.0).
Baseline re-run reproduces `CAPABILITY_REPORT_1.5.md`: 15 of 20.

| Id     | Test               | 1.5.4 (`f386a6c`)                     | 2.0.0 (`29ca668a22`)      | Difference                                                                                                                            |
| ------ | ------------------ | ------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| T4.1   | pagerank           | pass (5 rows)                         | pass (5 rows)             | values equal up to the last digit (`0.13716150420111312` vs `...14`)                                                                  |
| T4.2   | WCC                | pass                                  | pass                      | none                                                                                                                                  |
| T4.3   | clustering         | pass                                  | pass                      | none                                                                                                                                  |
| T4.4   | ANY SHORTEST `->*` | pass (5 rows)                         | pass (5 rows)             | **row order of the unordered result differs**; add `ORDER BY`                                                                         |
| T4.5   | ALL SHORTEST       | fail                                  | fail                      | same "not implemented"; message now adds a `LINE 1: ... ^^^` context                                                                  |
| T4.6   | path extraction    | pass                                  | pass                      | none                                                                                                                                  |
| T4.7   | summarize graph    | pass                                  | pass                      | none                                                                                                                                  |
| T5.1-3 | GEOMETRY vertex    | pass                                  | pass                      | pagerank last digits only                                                                                                             |
| T6.1-2 | CRS                | pass                                  | pass                      | none                                                                                                                                  |
| T7.1   | `->*` syntax       | pass                                  | pass                      | none                                                                                                                                  |
| T7.2   | bounded `{1,3}`    | pass (18 rows)                        | pass (18 rows)            | none                                                                                                                                  |
| T7.3a  | WHERE, 1 hop       | pass                                  | pass                      | none                                                                                                                                  |
| T7.3b  | WHERE, bounded     | fail                                  | fail                      | same `Binder Error: Referenced table "e" not found!`                                                                                  |
| T7.4   | MATCH + CTE        | pass                                  | pass                      | none                                                                                                                                  |
| T7.5   | Onager             | fail (INTEGER ids, extension present) | fail (HTTP 404, no build) | **different cause** (section 3.5)                                                                                                     |
| T7.6   | Kleene `*` alone   | fail                                  | fail                      | same guard message                                                                                                                    |
| T7.7   | anonymous edge     | fail                                  | fail                      | **error class changed**: `Constraint Error: All patterns must bind to a variable` becomes `Parser Error: syntax error at or near ":"` |

Score: 15/20 on both. Further differences seen in `npm run test:duckpgq:syntax` and `:failures` (same
tests pass and fail on both engines; only the error text moves):

- A pattern without an edge label: `Constraint Error: All patterns must bind to a label` becomes
  `Binder Error: The label e is not registered in property graph test_graph`.
- Explicit path modes: `WALK`, `TRAIL`, `ACYCLIC` were Parser Errors on 1.5.4. On 2.0.0 they parse;
  `WALK` hits the unbounded-WALK guard and `TRAIL` / `ACYCLIC` return
  `Not implemented Error: Path modes other than WALK have not been implemented yet.`
- `MATCH ALL (...)` and `MATCH ALL TRAIL (...)`: `Constraint Error` becomes `Parser Error` (near `(` and `TRAIL`).
- Error taxonomy in the failures script: parser errors 5 becomes 7, binder errors 0 becomes 2.
- Extension revision `f386a6c` (1.5.4) becomes `29ca668a22` (2.0.0).

Code in `src/` does not depend on these error strings: `GraphError.fromUnknown` only looks for the
words "binder", "catalog", "parser" (for filter errors) and "timeout", and the engine still prefixes
its errors with the same class names.

## 8. Final verification matrix (patched tree)

| Command                                                                               | DuckDB 2.0.0                                                                                                                                    | DuckDB 1.5.4 (scratch mirror)                                           |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `node .github/scripts/prepare-sandbox-tests.mjs`                                      | OK ("Prepared official httpfs for DuckDB v2.0.0")                                                                                               | OK                                                                      |
| `npm run check:all` (typecheck, lint, format:check, test)                             | OK; lint 0 errors, 162 warnings (160 before; +1 new `catch (error: any)` mirroring the existing style, +1 "file ignored" for the new test file) | n/a                                                                     |
| `npm test` (default)                                                                  | 570 passed, 26 skipped, 0 failed (3 runs)                                                                                                       | 568 passed, 28 skipped, 0 failed (the 2 real-engine DuckPGQ tests skip) |
| CI network step (`DUCKDB_SANDBOX_NETWORK_TESTS=1`, `service.sandbox-network.test.ts`) | 2 passed                                                                                                                                        | 2 passed                                                                |
| Full suite with the network flag                                                      | 572 passed, 24 skipped (Node 20.19.5, 20.20.2, 22.22.0, 24.22.1)                                                                                | 570 passed, 26 skipped                                                  |
| Full suite from an empty HOME (no cached extensions)                                  | 572 passed, 24 skipped                                                                                                                          | n/a                                                                     |
| `node --test .github/scripts/stage-npm.test.mjs`                                      | 9 passed                                                                                                                                        | n/a                                                                     |
| `npm run build`                                                                       | OK                                                                                                                                              | n/a                                                                     |
| `npm ci` + `npm rebuild @duckdb/node-api` with the new lockfile (npm 10.9.4)          | OK                                                                                                                                              | n/a                                                                     |

## 9. Risks

1. **First revision of a one-day-old major.** DuckDB 2.0.0 and node-api `2.0.0-r.1` were published on 2026-10-21; the extension ecosystem is catching up (no Onager, no DuckPGQ for `osx_amd64`).
2. **Hosts with their own connections** must run the SET per connection; the library cannot do it for them.
3. **Deprecated `s3_*` settings** still work but are hidden. `ducklake.attach` with `s3Config` depends on them; a later 2.x release may remove them.
4. **New 2.0 statement surface vs the sandbox gate.** The release notes list "External Extension Repositories" (#24777), an `EXTERNAL RESOURCE` grammar (#24771) and a `connection` secret storage (#23527). `enforceSandboxPolicy()` only blocks statements that start with `INSTALL`, `LOAD`, `ATTACH` (and `FORCE`). The engine-level sandbox passed all existing tests, but these new statements were **not reviewed or tested** here. A security re-review is needed before declaring 2.0 sandbox-safe.
5. **MotherDuck.** README says MotherDuck supports clients 1.4.x through 1.5.4 (as of July 2026). DuckDB 2.0 is outside that stated window; not verified (motherduck.com is outside the probe's network allow-list). `src/service/motherduck.ts` uses `ATTACH 'md:...'`.
6. **Stale 1.4.x messaging.** When the DuckPGQ install fails with `source=community`, the pre-existing handler logs "DuckPGQ community binaries not yet available for DuckDB 1.4.x (as of 2025-10-20)" at info level, and in strict mode throws "...unavailable for DuckDB 1.4.x" (reproduced on 2.0.0 with an empty HOME and a bogus `DUCKPGQ_VERSION`). Intel Mac users on 2.0 would see this.
7. **Result-order and EXPLAIN-format changes** (sections 3.6 and 7) can surprise consumers that compare rows or parse plans.
8. **Install footprint** grows by about 26 MB on linux-x64 and 37 MB on linux-arm64.
9. **CPU baseline.** The release notes list "Try -march x86-64-v3 for CLI and v2 for extensions" (#24391). Which baseline `libduckdb.so` uses for the node bindings was not verified; old x86-64 CPUs were not tested.
10. **No 2.x CI.** `ci.yml` has no job pinned to an engine version; once adopted, the matrix has to follow the single exact pin.

## 10. Recommended next steps and effort

| Step                                                                                                                                         | Effort             |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Decide the release policy: one exact engine pin means this package either moves to 2.x for everybody or forks a 2.x line (sections 9 and 11) | 0.5 day (decision) |
| Review and rebase this patch (about 50 lines of production code, 6 tests), regenerate the lock with npm 11, rerun the gates                  | 0.5 day            |
| Security re-review of 2.0 statements against `enforceSandboxPolicy()` and the engine settings (risk 4)                                       | 1 to 2 days        |
| Check the MotherDuck window and, if needed, adjust `motherduck.ts` or the docs (risk 5)                                                      | 0.5 day            |
| Cross-platform smoke on macOS arm64, Windows x64 and linux arm64 (DuckPGQ loads, grammar opt-in, sandbox)                                    | 1 day              |
| Docs: README, CLAUDE.md, `DUCKPGQ_INTEGRATION.md`, new `CAPABILITY_REPORT_2.0.md`, CHANGELOG; replace the stale 1.4.x messaging              | 1 day              |
| Optional: migrate `ducklake-tools.ts` `SET s3_*` to `CREATE SECRET` (works on both engines)                                                  | 0.5 day            |
| Optional: expose a small helper so hosts can opt their own connections in                                                                    | 0.5 day            |
| Wait for: Onager 2.0 build (optional feature), DuckPGQ `osx_amd64` build for 2.0                                                             | external           |

Estimated total to a shippable 2.x-compatible release: about 4 to 6 working days, most of it review,
security re-validation and documentation rather than code.

## 11. Places that pin or mention the engine version

| Location                                                                                                              | Kind        | On this branch / when adopting                                         |
| --------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| `package.json` `@duckdb/node-api`                                                                                     | dependency  | changed to `2.0.0-r.1` (exact)                                         |
| `package-lock.json` (11 entries)                                                                                      | lockfile    | regenerated, minimal diff                                              |
| `README.md` lines 8, 37, 38, 42, 152, 251 to 255, 295, 324                                                            | docs        | unchanged (still say 1.5.4); update when adopting                      |
| `CLAUDE.md` line 9, `docs/DUCKPGQ_INTEGRATION.md` lines 46 to 54                                                      | docs        | unchanged; update when adopting                                        |
| `src/duckdb/service.ts` comments at the sandbox ("Validated on DuckDB 1.5.4") and Onager ("Requires DuckDB >= 1.5.4") | comments    | unchanged; the sandbox claim is now also validated on 2.0.0            |
| `src/duckdb/service.ts` `isDuckDB14x = true` and the 1.4.x log texts                                                  | code        | unchanged (pre-existing, misleading on 2.0)                            |
| `.github/workflows/ci.yml`, `.github/scripts/prepare-sandbox-tests.mjs`                                               | CI          | no pin; the script provisions httpfs for whichever engine is installed |
| `.env*.example`, `scripts/*duckpgq*`, `examples/duckpgq-graph-example.ts`                                             | docs, tools | mention 1.4.x; unchanged                                               |

## 12. Reproduction

```bash
# bump (npm 11 keeps the lockfile diff minimal)
HUSKY=0 npx npm@11.21.1 install --save-exact @duckdb/node-api@2.0.0-r.1

# gates
node .github/scripts/prepare-sandbox-tests.mjs
npm run check:all
DUCKDB_SANDBOX_NETWORK_TESTS=1 npm test -- --coverage.enabled=false src/duckdb/service.sandbox-network.test.ts
npm run build

# capability comparison (run once per engine version)
npx tsx tests/duckpgq-2.0-capabilities.ts
```

## 10. Rebase on v1.7.3 (2026-10-22, evening)

The branch was rebased on `origin/main` = v1.7.3 (`ca84d11`), which brings the 1.7.2 sandbox hardening
and the 1.7.3 forward-compatible credential reset. Re-run on DuckDB 2.0.0 with the CI network step
(`DUCKDB_SANDBOX_NETWORK_TESTS=1`):

- Full suite: all green after one test change. The 1.7.2 test "does not expose ambient AWS_* credentials"
  used `duckdb_settings()` as its **control**, and 2.0 no longer lists the legacy `s3_*` names there; the
  control now uses `current_setting()`, which works on both engines. The protection itself holds on 2.0
  **only because of 1.7.3**: the 1.7.2 listing-based reset was a no-op on 2.0 (verified: `current_setting('s3_access_key_id')`
  still returned the `AWS_ACCESS_KEY_ID` value until an unconditional `RESET`).
- New 2.0 statements against `DuckDBService` at `strict` and `no-local-fs`, with a localhost listener
  that received **0 requests**: `CONNECT 'quack:127.0.0.1:<port>'` → blocked by the engine
  ("Loading external extensions is disabled" / "LocalFileSystem has been disabled"); `INSTALL x FROM r`
  → statement gate; `SET allow_extension_repositories` → locked; `CREATE SECRET ... IN connection`
  → secret type unavailable (httpfs not loaded; with httpfs it is still subject to `enable_external_access`);
  `ATTACH 'http://...'` → gate; `read_text('http://...')` → engine; `CALL enable_logging('HTTP')` → locked;
  `SET active_grammar_extensions` after the lock → locked (so the opt-in **must** stay before hardening).
  `CREATE EXTENSION REPOSITORY r FROM '...'` was a parse error with the syntax tried; the setting that
  enables repositories is locked anyway. This is evidence for the listed statements, not a proof of the
  sandbox on 2.0; the full red-team pass of 1.7.0 was not repeated on 2.0.
- Review items from the first probe addressed: `shouldSkipNetworkTests()` honoured in the probe
  `beforeAll`; a test pins the `if (extensionLoaded)` guard (no grammar `SET` when the extension failed
  to load); `catch (error: unknown)` in `enableDuckPGQGrammar`. Still open: the "loaded successfully"
  log precedes the opt-in on 2.x; this document ships in the npm tarball via `docs/**/*.md` if the
  branch is ever merged as is (rename to a capability report first); Onager still has no 2.0 build.
- Benchmark (synthetic graph, deposium-shaped queries): no DuckPGQ speed-up on 2.0 (1-hop 1.6–1.8×
  slower, `CREATE PROPERTY GRAPH` 5–15× slower, others within noise); plain SQL joins ~1.6× faster.
  Details in the maintainer's local `DUCKDB-2.0-ANALYSIS-2026-10-22.md`.
