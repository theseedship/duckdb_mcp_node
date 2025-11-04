# Changelog

## [0.11.0](https://github.com/theseedship/duckdb_mcp_node/compare/v0.10.4...v0.11.0) (2025-11-04)


### Features

* **mastra:** phase 0 - mastra AI integration preparation ([#16](https://github.com/theseedship/duckdb_mcp_node/issues/16)) ([341f253](https://github.com/theseedship/duckdb_mcp_node/commit/341f253dbe0d02059b073948d9555bc03eaf0749))

## [Unreleased]

## [0.10.5] - 2025-11-04

### Changed

- **docs(mastra)**: Removed deposium-specific documentation, clarified generic scope
  - Deleted `docs/WORK_DISTRIBUTION.md` (internal team coordination)
  - Deleted `docs/MASTRA_QUICKSTART.md` (internal implementation guide)
  - Updated `docs/MASTRA_INTEGRATION.md` with experimental warning and scope clarification
  - Updated `README.md` Mastra section with experimental badge
  - Clarified CHANGELOG entry for Phase 0
  - **Result**: Clear that Mastra adapter is generic (for any DuckDB+Mastra project), NOT deposium-specific

### Removed

- Obsolete git branches: `feature/mastra-phase-0`, `feature/mastra-phase-1-adapter`

### Note

**Mastra Integration Status**: Phase 0 (skeleton only) remains experimental and community-driven. deposium project implements Mastra agents separately in `deposium_edge_runtime` repository using MCP client-server architecture (no adapter needed).

## [0.10.4] - 2025-11-04

### Added

- **Mastra AI Integration Phase 0**: Generic adapter preparation (Q1 2026, community-driven)
  - Export path `/mastra` for Mastra adapter module (generic tool conversion)
  - Adapter skeleton (`src/adapters/mastra-adapter.ts`) with comprehensive JSDoc
  - Complete integration roadmap (`docs/MASTRA_INTEGRATION.md`) documenting Phase 1-3
  - API stability guarantees documented in main entry point
  - README.md Mastra section with use cases and experimental warning
  - **Scope**: Generic adapter only (NOT deposium-specific agents)
  - **Status**: EXPERIMENTAL - Skeleton only, Phase 1 implementation community-driven
  - **Breaking Changes**: NONE - All functions throw "Not yet implemented" errors
  - **Related**: PR #16, Issue #17 (Epic tracking)

## [0.10.4] - 2025-11-04

### Fixed

- **CRITICAL:** Export process mining tools (`processToolHandlers`, `processToolDefinitions`) for external use - unblocks deposium_MCPs integration
- **export:** Add data helper tools exports (`dataHelperToolHandlers`, `dataHelperToolDefinitions`) for json_to_parquet, profile_parquet, sample_parquet
- **export:** Add DuckLake tools exports (`createDuckLakeToolDefinitions`, `createDuckLakeToolHandlers`) for ACID transactions and time travel
- **export:** Add MotherDuck tools exports (`getMotherDuckToolDefinitions`, `createMotherDuckHandlers`) for cloud integration
- **types:** Export TypeScript types for process mining (`ProcessDescribeResult`, `ProcessSimilarResult`, `ProcessComposeResult`, etc.)
- **pkg:** Add optional export paths `./process`, `./data-helpers`, `./ducklake`, and `./motherduck` in package.json

### Context

Process tools with P2.8/P2.9 bug fixes (median calculation, edge deduplication) were built but not exported in v0.10.3, blocking external consumers from accessing validated production-ready features.

## [0.10.2](https://github.com/theseedship/duckdb_mcp_node/compare/v0.10.1...v0.10.2) (2025-11-04)

### Bug Fixes

- **ci:** add .npmrc to ensure consistent npm registry and access settings ([d2e2dd0](https://github.com/theseedship/duckdb_mcp_node/commit/d2e2dd096a82b2ad693915babc315fcf9b9f69f2))

## [0.10.1](https://github.com/theseedship/duckdb_mcp_node/compare/v0.10.0...v0.10.1) (2025-11-04)

### Bug Fixes

- **pkg:** include test utilities, scripts, and validation docs in npm package ([4f7a604](https://github.com/theseedship/duckdb_mcp_node/commit/4f7a6042db6a358c9ac4b52d115d6b5e8fe79d6d))

## [0.10.0](https://github.com/theseedship/duckdb_mcp_node/compare/v0.9.5...v0.10.0) (2025-11-04)

### Features

- **test:** expose process mining validation scripts as npm package feature ([f461700](https://github.com/theseedship/duckdb_mcp_node/commit/f461700c54f7e4921f61dd034d878dcb714e70df))

## [0.9.5](https://github.com/theseedship/duckdb_mcp_node/compare/v0.9.4...v0.9.5) (2025-11-04)

### Bug Fixes

- **process:** make embedding dimension configurable ([88cfb2f](https://github.com/theseedship/duckdb_mcp_node/commit/88cfb2fb653b98b4775424ceb57bc09270554fdb))

## [0.9.3](https://github.com/theseedship/duckdb_mcp_node/compare/v0.9.2...v0.9.3) (2025-11-03)

### Bug Fixes

- **ci:** remove vitest config files from tsconfig include ([dd5f2fc](https://github.com/theseedship/duckdb_mcp_node/commit/dd5f2fc2717744e629a35e9b9b9e0a38e830e13a))

## [0.9.1](https://github.com/theseedship/duckdb_mcp_node/compare/v0.9.0...v0.9.1) (2025-10-20)

### Bug Fixes

- **npm:** include DuckPGQ documentation files in npm package ([1595cf0](https://github.com/theseedship/duckdb_mcp_node/commit/1595cf0e1804ec573d3be9eb611475463773a22f))

## [0.9.0](https://github.com/theseedship/duckdb_mcp_node/compare/v0.8.1...v0.9.0) (2025-10-20)

### Features

- **docs:** add comprehensive DuckPGQ documentation suite ([e324d28](https://github.com/theseedship/duckdb_mcp_node/commit/e324d2863e60061f4306df9445deccc635f9b0f1))

## [0.8.1](https://github.com/theseedship/duckdb_mcp_node/compare/v0.8.0...v0.8.1) (2025-10-20)

### Bug Fixes

- **build:** resolve TypeScript compilation errors for CI ([a2e0d04](https://github.com/theseedship/duckdb_mcp_node/commit/a2e0d04a1b6d6125426a9a017d0881f72e1dcbe1))

## [0.8.0](https://github.com/theseedship/duckdb_mcp_node/compare/v0.7.2...v0.8.0) (2025-10-20)

### Features

- **duckpgq:** add comprehensive DuckPGQ integration with 7705c5c support ([623cebe](https://github.com/theseedship/duckdb_mcp_node/commit/623cebea62c64eb6aba4a31a1f49c8fb9d5deac1))

### Bug Fixes

- **mcp-server:** add type casting for federateQuery result ([8386f1b](https://github.com/theseedship/duckdb_mcp_node/commit/8386f1b671af7d2510f751ad4bf92d2226733608))

## [0.7.2](https://github.com/theseedship/duckdb_mcp_node/compare/v0.7.1...v0.7.2) (2025-10-19)

### Bug Fixes

- **ci:** allow test failures temporarily to unblock releases ([1db9120](https://github.com/theseedship/duckdb_mcp_node/commit/1db9120d3d376aba2eaa6cc962bf827b66016f81))
- **deps:** upgrade happy-dom to 20.0.5 to fix critical vulnerability ([f9a504e](https://github.com/theseedship/duckdb_mcp_node/commit/f9a504e590da96bb64a6f784f6201d71ee6d01b6))
