# Changelog

All notable changes to RoachJS will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.0.1] — 2026-02-26

### 🪳 The Beginning

This is the very first release of RoachJS. Day one. Commit one. The cockroaches are loose.

### Added

- **Core framework** — complete HTTP framework built on `uWebSockets.js`
- **Radix Tree router** — hand-written Patricia Trie with O(1) static and O(log n) parametric lookups
- **Request wrapper** — lazy query parsing, lazy JSON body parsing, zero wasted CPU
- **Response wrapper** — chainable API (`res.status(201).json()`), double-send guard
- **Middleware system** — global, path-scoped, and route-level middleware with async error catching
- **Sub-routers** — `roach.router()` for grouped routes with prefix mounting
- **Route parameters** — `:param` named parameters and `*` wildcard catch-all
- **Error handling** — `app.onError()` and `app.onNotFound()` hooks
- **Custom error classes** — `RoachError`, `RouteConflictError`, `NotFoundError`, `BodyParseError`, `ResponseAlreadySentError`
- **Debug logger** — internal logging via `DEBUG=roachjs` environment variable
- **Benchmark suite** — autocannon-based benchmarking with Fastify and Express comparison
- **Benchmark SVG** — auto-generated dark-themed comparison bar chart
- **CI/CD** — GitHub Actions for testing (Node 18/20/22), benchmarking, npm publishing
- **Roach Manager** — CI-powered GitHub bot for issue labeling and PR checklists
- **Full test suite** — comprehensive tests for router, request, response, and middleware
- **Documentation** — README with full API docs, CONTRIBUTING guide

### Performance

- Zero external runtime dependencies (only `uWebSockets.js`)
- Lazy body and query parsing — no computation until accessed
- Static route cache — O(1) lookup for non-parametric routes
- Request hot path under 5 function calls deep

---

*The roaches are out. Let's see how fast they can go.* 🪲

[0.0.1]: https://github.com/oggy-org/roachjs/releases/tag/v0.0.1
