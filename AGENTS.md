# Project Instructions

## Tooling

- All package management and JavaScript ecosystem execution must be done using `bun`.
- All linting and formatting must be done with `biome`.
- All packaging must be done with `esbuild`.
- All tests must be runnable using `bun test`.
- Markdown must pass `make spelling`. The tracked `typos.toml` is generated
  from the shared en-GB-oxendict base plus `typos.local.toml`; do not edit it
  by hand.

## Frontend Standards

- Use modules only.
- Do not use inline CSS.
- Use React 19.
- Use semantic classes.
- All code must be typechecked.
- All code must include JSDoc.
