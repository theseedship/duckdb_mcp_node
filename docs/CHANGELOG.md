# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2025-09-18

### Added

- Initial release of DuckDB MCP Native
- Full MCP protocol implementation (JSON-RPC 2.0)
- Stdio transport support
- DuckDB integration with 5 core tools:
  - `query_duckdb` - Execute SQL queries
  - `list_tables` - List all tables
  - `describe_table` - Get table schema
  - `load_csv` - Load CSV files
  - `load_parquet` - Load Parquet files
- Resource management for exposing DuckDB tables
- Security modes (development/production)
- S3/MinIO configuration support
- TypeScript implementation with full type safety
- Comprehensive documentation
- Jest test setup
- ESLint + Prettier configuration
- Husky + commitlint for code quality
- GitHub Actions CI/CD workflows

### Security

- Query validation in production mode
- SQL injection prevention
- Query size limits
- Timeout controls

[Unreleased]: https://github.com/deposium/duckdb-mcp-native/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/deposium/duckdb-mcp-native/releases/tag/v0.1.0
