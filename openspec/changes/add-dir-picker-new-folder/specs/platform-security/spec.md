## ADDED Requirements

### Requirement: DirPicker SHALL support creating a subfolder in place

The directory picker MUST offer a "new folder" action that creates exactly one subfolder under the currently browsed directory, guarded by the same path-safety rules as directory listing.

#### Scenario: User creates a folder in the picker

- **WHEN** the user activates the new-folder action in a browsable directory and confirms a valid name
- **THEN** the system creates the folder via `mkdirSync(target, { recursive: false })`
- **AND** returns 201 with the absolute path on success
- **AND** the picker navigates into the newly created folder.

#### Scenario: Folder name is rejected

- **WHEN** the submitted name is `.`, `..`, contains a path separator, starts with `.`, contains a Windows-invalid character (`:*?"<>|`) or control character, or exceeds 255 characters
- **THEN** the API responds 400 with an explanatory error
- **AND** no directory is created and the picker keeps the user's input for editing.

#### Scenario: Parent path fails safety checks

- **WHEN** the parent is not absolute, does not exist, is not a directory, or is a blocked system/sensitive path per `isPathSafe` (home itself remains allowed as a starting point)
- **THEN** the API responds 400/404/403 accordingly
- **AND** the joined target path is additionally checked against `isPathSafe` before any filesystem write.

#### Scenario: Folder already exists

- **WHEN** the target folder already exists on disk
- **THEN** the API responds 409 with `Folder already exists`
- **AND** the picker surfaces the error inline without losing the entered name.

#### Scenario: New-folder action is unavailable

- **WHEN** the picker is loading, has no current path, or shows the Windows drives view
- **THEN** the new-folder action is disabled.
