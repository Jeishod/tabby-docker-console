# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## How to Release

```bash
# Bump patch version (0.1.0 → 0.1.1), push tag, trigger CI → GitHub Release + npm publish
npm run release:patch

# Bump minor version (0.1.0 → 0.2.0)
npm run release:minor

# Bump major version (0.1.0 → 1.0.0)
npm run release:major
```

After running the command, GitHub Actions will automatically:
1. Build the plugin
2. Create a GitHub Release with the changelog
3. Publish the new version to npm

---

## [0.1.0] - 2026-04-04

### Added
- Initial release
- Container list with search, filter (All / Running / Exited) and Docker version display
- Image list with remove action
- Container stats panel with CPU, Memory, Network I/O, Block I/O (auto-refresh every 5s)
- Logs viewer with configurable tail (50/100/300/500/1000/All), timestamps toggle, auto-refresh (default: on, 3s), and log download
- Interactive exec terminal inside containers via SSH channel monkey-patch
- Pinned toolbar button on SSH tabs (alongside SFTP-UI / Ports)
- Context menu entry on SSH tabs
- Theme-aware colors (uses Tabby terminal color scheme CSS variables)
- SSH profile name displayed in tab header instead of IP address
