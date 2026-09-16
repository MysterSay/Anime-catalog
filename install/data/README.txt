YORU Installer 1.4.0 data directory.

All installer-managed portable tools, authorization/config data, caches,
downloads, logs, encrypted state and the cloned Anime-catalog repository
are stored under this folder.

WSL, Ubuntu and Turso CLI are no longer required. Turso is managed directly
through the official Turso Platform API; its Platform API token is encrypted
with Windows DPAPI in data/state/installer-state.json.

Do not commit generated contents of this folder.
