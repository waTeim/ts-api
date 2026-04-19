# Known Issues

- Generated Swagger array responses do not reuse schema references. `GET /user/` currently emits an inline object for items instead of a `$ref` to `#/components/schemas/IUser`; need to trace why `returnAtom` falls back to inline expansion.
- CLI `cg` still relies on `tsconfig.json` `include` globs; projects without an `include` array must pass files on the command line or they are skipped. Restore a sensible glob fallback when `tsInclude` is absent.
- Analyzer lacks regression coverage for unions that mix `Res` with regular return types nested multiple levels deep. Behaviour there is unverified and could regress unnoticed.
