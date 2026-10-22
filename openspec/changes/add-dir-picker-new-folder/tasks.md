## 1. API

- [x] 1.1 Add `POST /api/fs/mkdir` route with zod-validated `{ parentPath, name }` body.
- [x] 1.2 Validate folder names: reject `.`, `..`, path separators, leading dot, Windows-invalid characters, control characters, and over-length names with 400.
- [x] 1.3 Apply listdir-identical parent path checks (absolute, exists, directory, `isPathSafe` with home-as-start allowed) plus `isPathSafe` on the joined target.
- [x] 1.4 Map `EEXIST` to 409, `EACCES`/`EPERM` to 403, other mkdir failures to 500; return 201 `{ path }` on success.

## 2. Frontend

- [x] 2.1 Add `createDirectory` helper to `src/lib/api.ts`.
- [x] 2.2 Add FolderPlus button to the picker path bar with correct disabled states.
- [x] 2.3 Add inline creation row (Input + confirm/cancel) with Enter/Esc handling and busy spinner.
- [x] 2.4 Navigate into the created folder on success; keep input and show inline error on failure.

## 3. Tests And Docs

- [x] 3.1 Add vitest route tests covering creation, invalid names, 404, 409, non-JSON body, relative parent, and POSIX `/etc` 403.
- [x] 3.2 Run typecheck and eslint on changed files.
- [x] 3.3 Verify against the running dev server (curl: 201/409/400/403).
- [x] 3.4 Document the endpoint in `specs/11-platform.md` and record this OpenSpec change.
