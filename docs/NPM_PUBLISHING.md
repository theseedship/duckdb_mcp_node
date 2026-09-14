# npm publishing

GitHub Actions builds `@seed-ship/duckdb-mcp-native` and submits it to **Staged Packages** on npmjs.com. A maintainer then clicks **Approve** and confirms with 2FA. Approval makes the version available for installation; no local command is required.

## Normal release path

1. Bump `package.json` and `package-lock.json` with `npm version patch --no-git-tag-version`, then update the README and both changelogs.
2. Merge the release PR after CI passes.
3. The **Publish to NPM** workflow installs Node.js 22 and npm 11.17.0, runs the quality checks, builds the package, and executes `npm stage publish`.
4. Open **Staged Packages** on npmjs.com, review the package/version shown in the workflow summary, click **Approve**, and confirm with 2FA.

The workflow uses the existing GitHub secret `NPM_TOKEN`. It never attempts direct npm publication or automatic approval. Staged publishing requires npm >= 11.15.0 and Node.js >= 22.14.0.

## Retries and version state

Use **Actions → Publish to NPM → Run workflow** to retry the current version. A new version is not needed after an authorization failure.

- If the version is already public, the workflow reports that fact and skips staging.
- If it is already staged with the expected npm tag, the workflow reuses that stage and prints its ID.
- Otherwise, the workflow stages it. Registry authentication or network failures remain blocking.

A staged version is not yet installable. The job summary distinguishes **staged** from **published** and gives the manual approval instructions. An npm version already published or staged cannot be overwritten.

On `main` or a version tag, GitHub release metadata is created with an explicit npm status. A GitHub tag or release alone does not mean the version is publicly available on npm. Metadata created before approval records that the package was submitted and that installation requires approval.

## Other workflow entry points

**Release (Manual)** still accepts a `v*` tag or a manual version input matching `package.json`; it delegates to the same staging workflow. Release Please is a manual migration tool and no longer contains a separate npm publication step.

A change to `package.json`, the staging workflow, or its helper on `main` triggers the normal workflow. Retries are serialized to avoid simultaneous submissions.

## Repository setup

Store a granular npm token with package write access in the GitHub Actions secret `NPM_TOKEN`. The workflow passes it as `NODE_AUTH_TOKEN`. Keep tokens out of source files and logs.

The maintainer approving the staged package needs npm publish permissions and 2FA. The CI token does not perform that approval.

## References

- [npm staged publishing](https://docs.npmjs.com/staged-publishing/)
- [npm stage commands](https://docs.npmjs.com/cli/v11/commands/npm-stage/)
