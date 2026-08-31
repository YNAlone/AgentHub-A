## Why

The directory picker (`DirPickerDialog`, used to bind a local directory when creating a conversation) can only browse existing directories. When the user wants to point an Agent at a brand-new working directory, they must leave the app, create the folder in a file manager or terminal, and come back. Creating the folder inline keeps the whole "new conversation → bind directory" flow in one place.

## What Changes

- Add `POST /api/fs/mkdir` that creates a single subfolder under a given parent directory.
- Reuse the exact path-safety rules of `GET /api/fs/listdir` for the parent (home itself allowed as a starting point, system/sensitive directories rejected), plus a second `isPathSafe` check on the resulting target path (defense in depth).
- Restrict folder names to a single visible directory name: reject `.`/`..`, path separators, dotfile names, Windows-invalid characters, and control characters. Dotdirs are filtered out by listdir, so allowing them would create folders that are invisible in the picker — a "creation failed" illusion.
- Add a `FolderPlus` ghost button in the picker's path bar (disabled while loading, before load, or in the drives view) that reveals an inline creation row at the top of the directory list.
- On success, navigate directly into the new folder so the user can immediately confirm with "选择此目录". On failure, surface the API error in the existing inline error block and keep the input for editing.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `platform-security`: The DirPicker fs surface gains a write endpoint (`/api/fs/mkdir`) guarded by the same `isPathSafe` rules as `/api/fs/listdir`, plus single-segment folder-name validation.

## Impact

- `src/app/api/fs/mkdir/route.ts` (new): POST route, zod-validated body, `mkdirSync` with `recursive: false`.
- `src/app/api/fs/mkdir/route.test.ts` (new): vitest coverage for happy path and every error branch.
- `src/lib/api.ts`: new `createDirectory` client helper in the DirPicker filesystem section.
- `src/components/dir-picker-dialog.tsx`: creation-mode state, path-bar button, inline creation row.
- `specs/11-platform.md`: new "DirPicker 新建文件夹" section documenting validation rules.
- No schema, adapter, or tool changes; no new dependencies.
