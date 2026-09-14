# npm publishing

`@seed-ship/duckdb-mcp-native` is published to the public npm registry by GitHub Actions.

## Normal release path

Prepare the release on a branch. For a patch release such as `1.6.1`, update both
`package.json` and `package-lock.json` without creating a local Git tag:

```bash
npm version patch --no-git-tag-version
```

Then update the release-facing documentation:

- `README.md`
- `CHANGELOG.md`
- `docs/CHANGELOG.md`

Before opening the pull request, run the same quality gates used for publication:

```bash
npm run check:all
npm run build
npm pack --dry-run
```

Open a pull request and wait for CI to pass on the supported Node.js versions. When the
pull request is merged into `main`, a change to `package.json` triggers
`.github/workflows/publish.yml`. That workflow:

1. verifies that the version changed from the previous commit;
2. installs the locked dependencies on Node.js 22;
3. runs `npm run check:all` and `npm run build`;
4. verifies npm authentication and skips versions that already exist;
5. publishes the package with public access;
6. creates the matching `v<version>` tag and GitHub release.

Do not create or push the release tag as part of the normal path. The publish workflow owns
that step.

## Repository setup

Create a granular npm access token that can read and write
`@seed-ship/duckdb-mcp-native`, then store it as the GitHub Actions repository secret
`NPM_TOKEN`. The npm account that owns the token must have publish access to the
`@seed-ship` scope.

The workflows pass this secret to npm as `NODE_AUTH_TOKEN`. Never commit a token or a local
`.npmrc` containing one.

## Alternative release workflows

`.github/workflows/release.yml` supports an explicit `v*` tag or a manual workflow dispatch.
This is an alternative recovery/manual path, not the normal release path. Its tag or input
version must exactly match `package.json`, and it runs the full quality suite before
publishing.

`.github/workflows/release-please.yml` is manual-only. It is retained as a possible migration
path and is not part of the current release process. Before adopting release-please, remove
the manual version-bump convention and consolidate the npm publication and GitHub release
steps so that only one workflow owns them.

The `workflow_dispatch` option on `.github/workflows/publish.yml` can rerun the publication
workflow for an unpublished package version. Its `force` input bypasses the Git comparison;
it cannot overwrite a version that already exists on npm.

## Troubleshooting

Check the package version and publication state with:

```bash
node -p "require('./package.json').version"
npm view @seed-ship/duckdb-mcp-native versions
npm view @seed-ship/duckdb-mcp-native dist-tags
```

If authentication fails, verify that the `NPM_TOKEN` repository secret exists, is current,
has read/write access to the package, and belongs to an npm user allowed to publish under
`@seed-ship`.

If npm reports that the version already exists, choose a new version. npm package versions
are immutable and cannot be republished.

To inspect the package contents without publishing:

```bash
npm pack --dry-run
```

## References

- [Publishing Node.js packages with GitHub Actions](https://docs.github.com/en/actions/publishing-packages/publishing-nodejs-packages)
- [Creating and viewing access tokens](https://docs.npmjs.com/creating-and-viewing-access-tokens)
- [About package access](https://docs.npmjs.com/package-access)
- [Semantic Versioning](https://semver.org/)
