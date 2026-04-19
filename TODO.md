# TODO

- Add an integration test that boots the generated Express router (from `examples/dist/__routes.js`) with supertest to verify runtime behaviour and validation errors.
- Audit Swagger generation to prefer `$ref` when a schema definition exists (paired with BUGS entry) and add assertions once fixed.
- Document `cg` usage and environment expectations in README; include guidance for projects without `tsconfig.include`.
