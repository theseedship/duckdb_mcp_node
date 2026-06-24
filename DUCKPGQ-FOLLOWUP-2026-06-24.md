# DuckPGQ Blocker Status — 2026-06-24

## Weekly Status Check

**Assessment: FULLY STALLED** — no maintainer reply, PR unmerged, no new binaries, branch frozen.

---

## Findings

### (a) Maintainer reply (Dtenwolde)

**None.** PR #307 has exactly 1 comment (our Jun 17 bump). Issue #305 has 3 comments (all ours + vyasraos — no Dtenwolde). The bump got 3 👍 reactions from other affected users, showing community interest, but zero upstream engagement in the past week.

### (b) PR #307 state

| Field | Value |
|---|---|
| State | **open** (not merged, not closed) |
| Last updated | 2026-06-17T21:31:51Z (our own bump) |
| Mergeable | **true** |
| Rebaseable | **true** |
| Merge state | **clean** (no conflicts) |
| Review comments | 0 |
| CI | No required checks configured |

The PR is sitting in a "ready to merge" state and has been since it was opened on 2026-04-09 (~75 days).

### (c) v1.5-variegata branch HEAD

**Frozen at `cbe4d9e58ebc3984d725a83c4dd46e6acd723cec`** — Dtenwolde's "Fix loading errors" commit from 2026-04-09. This commit applied the same `ExtensionCallbackManager` → `DBConfig::GetConfig` registration pattern as our PR, but critically **did not update the `duckdb` submodule SHA**.

Current submodule state on v1.5-variegata: `31d179b184ce9e9b3421a21d2cf4a075d07f9de4`  
Our PR's proposed submodule SHA: `f7f679eba9670db741312c07a9ace0f1aebf2e49`

This explains why the Apr 10 CDN rebuild still SIGSEGVs: Dtenwolde applied half the fix. The submodule correction is the missing piece.

### (d) CDN binary status

The `community-extensions.duckdb.org` CDN is **blocked at the proxy level** in this remote execution environment (policy denial on CONNECT). Cannot verify directly from this run.

Last confirmed state (from our 2026-06-17 bump comment):

| DuckDB version | CDN status | Notes |
|---|---|---|
| 1.5.1 | 200 OK | Binary dated 10 Apr; **still SIGSEGVs** (exit 139) |
| 1.5.2 | 404 | No binary |
| 1.5.3 | 404 | No binary |
| 1.5.4 | 404 | No binary |

The cwida/duckdb-pgq submodule fork has **no tags for v1.5.2, v1.5.3, or v1.5.4** — only up to v1.5.1. Main branch HEAD: `7970b598817a`. This is a prerequisite blocker for building any 1.5.2+ community binary.

---

## Root-Cause Recap

Dtenwolde's `cbe4d9e` commit applied the registration pattern fix but left the submodule at `31d179b184ce` (labeled `v1.5.1` in cwida/duckdb-pgq but actually a dev-era SHA). Our PR #307 additionally pins it to `f7f679eba967` — the SHA that aligns with the stable 1.5.1 community build environment. The persistent SIGSEGV after the Apr 10 rebuild is strong evidence the submodule pin is the critical component.

---

## Plan A: Rebase PR #307 onto v1.5.4

A full v1.5.4 rebase requires Dtenwolde to first update the `cwida/duckdb-pgq` fork (the DuckDB+PGQ patches fork used as the extension's submodule) to track DuckDB v1.5.4. Without that, there is no v1.5.4-compatible submodule SHA to point at.

**Submodule target SHAs (for reference once cwida/duckdb-pgq is updated):**

| DuckDB release | duckdb/duckdb tag SHA | cwida/duckdb-pgq tag |
|---|---|---|
| v1.5.1 | `7dbb2e646fea939a89f10a55aa98c474cbb0c098` | exists (`31d179b1` / our fix: `f7f679eb`) |
| v1.5.2 | `8a5851971fae891f292c2714d86046ee018e9737` | **missing** |
| v1.5.3 | `14eca11bd9d4a0de2ea0f078be588a9c1c5b279c` | **missing** |
| v1.5.4 | `08e34c447bae34eaee3723cac61f2878b6bdf787` | **missing** |

**Rebase steps (when cwida/duckdb-pgq v1.5.4 is available):**

```bash
# In the theseedship fork:
cd duckpgq-extension

# Fetch upstream
git fetch upstream v1.5-variegata

# Rebase our branch onto latest v1.5-variegata HEAD
git checkout fix/issue-305-load-segfault
git rebase upstream/v1.5-variegata

# Update duckdb submodule to v1.5.4 SHA (replace <SHA> with actual cwida/duckdb-pgq v1.5.4 commit)
git -C duckdb checkout <cwida/duckdb-pgq v1.5.4 SHA>
git add duckdb
git commit --amend  # fold into the existing fix commit

# Push and update PR
git push --force-with-lease origin fix/issue-305-load-segfault
```

**Minimum viable path (unblock v1.5.1 now, chase v1.5.4 later):**

Merge PR #307 as-is. This fixes the 1.5.1 SIGSEGV and gets the community binary rebuilt with the correct submodule pin. Then open a separate PR/issue to track v1.5.2–1.5.4 support once the cwida/duckdb-pgq fork is updated.

---

## Plan B: Direct message to Daniel ten Wolde (Dtenwolde)

> **Subject/opener:** DuckPGQ #307 — 2-month stall, 4 versions behind, still crashing
>
> Hi Daniel,
>
> Following up on PR #307 (https://github.com/cwida/duckpgq-extension/pull/307) — it's now been ~75 days since opening and ~1 week since our bump comment, with no reply.
>
> Quick situation summary, in case it helps triage:
>
> - **v1.5.1 binary still crashes.** The `cbe4d9e` "Fix loading errors" commit you pushed on Apr 9 applied the `DBConfig::GetConfig` + static `Register()` pattern (same as #307), but left the `duckdb` submodule at `31d179b184ce` instead of the stable-build-aligned `f7f679eb`. The Apr 10 CDN rebuild still SIGSEGVs on `LOAD` (confirmed on `linux_amd64`, `osx_arm64`). The submodule pin appears to be the missing piece.
>
> - **We're now 4 versions behind.** DuckDB shipped 1.5.2 on [date], 1.5.3, and 1.5.4 (latest, Jun 2026). There are no DuckPGQ binaries at all for 1.5.2/1.5.3/1.5.4 (404 on the CDN). We've been stuck on DuckDB 1.5.0 + the `aec2e25` build since April.
>
> - **What we're missing from 1.5.4:** Native geometry Parquet stats pruning (`OPERATOR_ROW_GROUPS_SCANNED`), the GeoArrow CRS double-free fix, and geometry-stats checkpointing — all things we need alongside DuckPGQ for our GeoParquet workloads.
>
> - **PR #307 is ready.** It's marked `mergeable: true`, `rebaseable: true`, merge state `clean`, 0 review comments. The code change is 8 additions / 21 deletions across 5 files. Happy to rebase onto `v1.5-variegata` HEAD and add 1.5.2/1.5.3/1.5.4 submodule updates if that helps (though that would first need cwida/duckdb-pgq tagged/updated for those versions).
>
> Could we get a quick review and merge of #307 to unblock the 1.5.1 binary rebuild, and a rough timeline for 1.5.2+ support?
>
> Thanks a lot — the extension is great and we want to keep using it.  
> Nicolas (nicolas-geysse / theseedship)

---

## Our Current Pin (for reference)

```
DuckDB: 1.5.0 (node-api: @duckdb/node-api@1.5.0-r.1)
DuckPGQ: aec2e25 (pre-v1.5.1 community binary era, loads fine)
Blocked on: SIGSEGV on any 1.5.1+ community binary + no 1.5.2/1.5.3/1.5.4 binary
```

## Next Check

Schedule next status check: 2026-07-01. If still no reply, consider:
1. Opening a new GitHub Discussion on cwida/duckpgq-extension tagging Dtenwolde directly
2. Asking in the DuckDB Discord `#extensions` channel whether Dtenwolde is reachable
3. Posting in `#community-extensions` about the CDN gap for 1.5.2–1.5.4
