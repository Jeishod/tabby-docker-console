# tabby-docker-console

       

A [Tabby](https://github.com/Eugeny/tabby) plugin that adds a Docker management panel to SSH sessions, inspired by the Docker interface in [Termix](https://github.com/Termix-SSH/Termix).

All commands are executed over the **existing SSH session** — no extra connections are opened.

---

## Features


| Feature             | Details                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Containers**      | Card grid with state badges (running / exited / paused), image, ID, ports, creation date                                                    |
| **Search & filter** | Live search by name / image / ID; filter by state                                                                                           |
| **Actions**         | Start / Stop / Restart / Remove (with per-card busy state)                                                                                  |
| **Exec terminal**   | Opens a new SSH tab running `docker exec -it <container> bash` (falls back to `sh`)                                                         |
| **Logs**            | Scrollable log view with tail selector, timestamps toggle, live auto-refresh (configurable interval), inline filter, and one-click download |
| **Stats**           | CPU, memory (with progress bars), network I/O, block I/O, PIDs — auto-refreshed every 5 s without re-rendering the layout                   |
| **Images**          | Grid with ID, size, creation date; remove button                                                                                            |
| **Theme-aware UI**  | Uses Tabby's dynamic CSS variables (`--theme-bg`, `--theme-fg`, …) so the panel matches any terminal colour scheme                          |


Containers list

Container exec

Container logs

Container stats

Images

---

## Installation

### From the plugin marketplace

Search for `tabby-docker-console` in **Settings → Plugin manager**.

### Manual (development / testing)

```bash
git clone https://github.com/jeishod/tabby-docker-console
cd tabby-docker-console
npm install --legacy-peer-deps
npm run build
```

Copy the built artefacts to Tabby's plugin directory:

```bash
PLUGIN_DIR=~/Library/Application\ Support/tabby/plugins/node_modules/tabby-docker-console
mkdir -p "$PLUGIN_DIR/dist"
cp package.json "$PLUGIN_DIR/"
cp dist/index.js "$PLUGIN_DIR/dist/"
```

> **macOS path** shown above.  On Linux: `~/.config/tabby/plugins/node_modules/…`
>
> ⚠️ Copy **only** `dist/` and `package.json`.  Do **not** symlink the whole project
> directory — Tabby would pick up the local `node_modules/@angular/core` and crash
> with a version mismatch.

Fully quit Tabby (`Cmd+Q` / `Ctrl+Q`) and reopen it.  The plugin is loaded at startup.

---

## Usage

1. Open an SSH connection to a server that has Docker installed.
2. Click the **Docker** button in the tab toolbar (next to Reconnect / SFTP / Ports),
  **or** right-click the SSH tab → **Docker Console**.
3. The Docker Console opens as a new Tabby tab.

Plugin shortcut

> **Docker permissions** — the remote user must be able to run `docker` commands without
> `sudo`.  Add the user to the `docker` group if needed:
>
> ```bash
> sudo usermod -aG docker $USER   # then log out and back in
> ```

---

## Project structure

```
src/
├── models.ts                          # DockerContainer / DockerImage / DockerStats interfaces
├── utils.ts                           # Shared SSH tab detection + host label helpers
├── index.ts                           # Angular module registration
├── tabContextMenu.ts                  # "Docker Console" right-click menu entry
├── dockerToolbar.decorator.ts         # "Docker" toolbar button injector
├── components/
│   └── dockerConsoleTab.component.ts  # Main UI component (template + styles inlined)
└── services/
    └── remoteDocker.service.ts        # SSH exec channel + Docker CLI wrappers
```

---

## How it works internally

Commands are executed via **SSH exec channels** (RFC 4254 §6.5) using the `russh`
library that ships inside Tabby.  Each command opens a dedicated non-PTY channel,
collects stdout/stderr, then explicitly closes the channel to release the slot.

The interactive `exec` terminal (Open terminal button) uses a different path: it
temporarily monkey-patches `sshSession.openShellChannel` to open a PTY exec channel
running `docker exec -it <id> <shell>` instead of a regular login shell.  The patch
self-restores after the first invocation so no other tab is affected.

---

## Known limitations

- **sudo** — if Docker requires `sudo` on the remote host, commands will fail with a
permission error.  See the *Docker permissions* note above.
- **Tabby version** — developed and tested against Tabby 1.0.163+.  The plugin uses
internal russh APIs (`channel.requestExec`, `channel.closed$`) that may change in
future Tabby releases.
- **Docker availability** — if Docker is not installed or the daemon is not running,
the panel displays an error and all buttons are disabled.

---

## Author

[Telegram](https://t.me/Jeishod)
[LinkedIn](https://linkedin.com/in/Jeishod)
[GitHub](https://github.com/Jeishod)

## License

MIT — see [LICENSE](./LICENSE)