# Contributing to RoachJS

Welcome, fellow roach. You've made an excellent life decision.

Whether you're fixing a typo, squashing a bug, or making RoachJS even faster (is that possible?), we appreciate every contribution. This guide will get you up and running in under 5 minutes — because if it took longer, we'd have failed at our own philosophy.

## Code of Conduct

Be excellent to each other. That's it. No 47-page legal document. Just be a decent human. Don't be toxic, don't be dismissive, and don't submit PRs that make things slower without a very good reason.

If someone is being harmful, ping a maintainer. We'll handle it.

## Getting Started

### Prerequisites

- Node.js 18 or later
- npm
- A terminal and a willingness to make HTTP frameworks faster

### Setup

```bash
# Clone the repo
git clone https://github.com/oggy-org/roachjs.git
cd roachjs

# Install dependencies
npm install

# Run the tests to make sure everything works
npm test
```

That's it. You're ready.

### Running Tests

```bash
# Run the full test suite
npm test

# Run a specific test file
node --test test/router.test.js
```

### Running Benchmarks

```bash
# Run the full benchmark suite (RoachJS vs Fastify vs Express)
npm run benchmark

# Generate the benchmark SVG
npm run benchmark:svg
```

## Making Changes

### Branch Naming Convention

```
fix/description-of-fix       # Bug fixes
feat/description-of-feature  # New features
perf/description-of-change   # Performance improvements
docs/description-of-change   # Documentation updates
chore/description-of-change  # Maintenance, CI, etc.
```

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
fix: correct route matching for trailing slashes
feat: add support for HEAD method
perf: reduce object allocation in hot path
docs: update middleware documentation
chore: update CI workflow to Node.js 22
```

The first line should be under 72 characters. Add a body if the change warrants explanation.

### What Makes a Good PR

- **Focused.** One change per PR. Don't fix a bug, add a feature, and refactor the router in the same PR.
- **Tested.** New features need new tests. Bug fixes need regression tests. No exceptions.
- **Documented.** If you're adding or changing public API, update the README.
- **Clean.** No commented-out code, no `console.log` debugging, no unrelated formatting changes.
- **JSDoc'd.** Every function needs proper JSDoc with `@description`, `@param`, `@returns`, and `@example` for public functions.

### What Gets Rejected

- PRs that add external dependencies without prior discussion in an issue
- PRs that claim performance improvements without benchmark results
- PRs with failing tests
- PRs that break the existing API without a deprecation path
- PRs with commit messages like "fix stuff" or "update"

### Performance PRs

If you're submitting a performance improvement:

1. Run `npm run benchmark` **before** your change
2. Save the results
3. Make your change
4. Run `npm run benchmark` **after** your change
5. Include both sets of numbers in your PR description
6. The improvement must be reproducible and statistically significant

We take performance seriously. RoachJS is fast because we measure everything.

## Bug Reports

When filing a bug report, include:

- RoachJS version (`npm ls @oggy-org/roachjs`)
- Node.js version (`node --version`)
- Operating system
- Minimal reproduction code
- Expected behavior vs actual behavior
- Error output / stack trace if applicable

The easier it is to reproduce, the faster we fix it.

## Feature Requests

Before requesting a feature:

1. Check existing issues — it might already be planned
2. Consider the performance impact — we won't add something that slows down the hot path
3. Think about whether it benefits the majority of users, not just your specific use case
4. Open an issue with the **Feature Request** template

Features go through discussion before implementation. Not everything will be accepted, and that's okay — we'd rather have a focused, fast framework than a bloated one.

## Maintainer Response Time

We aim to respond to all issues and PRs within **48 hours**. Usually faster.

## Recognition

All contributors are automatically added to the README contributors wall via [contrib.rocks](https://contrib.rocks). Your face shows up for every person who visits the repo. Not bad for a PR.

---

Thanks for contributing. The roaches appreciate it. 🪲
