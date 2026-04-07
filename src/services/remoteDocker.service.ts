import { Injectable } from '@angular/core'
import { NotificationsService } from 'tabby-core'
import { DockerContainer, DockerImage, DockerStats } from '../models'

/**
 * Service for executing Docker CLI commands on a remote host via an existing SSH session.
 *
 * Uses the russh `AuthenticatedSSHClient` that Tabby exposes on `SSHSession.ssh`.
 * Each command opens a non-interactive SSH exec channel (RFC 4254 §6.5), which ensures
 * clean stdout output suitable for JSON parsing — no PTY noise or shell prompts.
 */
@Injectable()
export class RemoteDockerService {
    constructor(private notifications: NotificationsService) {}

    /**
     * Executes a shell command on the remote host via an SSH exec channel.
     *
     * Opens a new session channel, subscribes to its data/close observables,
     * sends the command as an exec request, and returns the combined output.
     * The channel is explicitly closed after the command finishes to release
     * the SSH channel slot immediately (prevents slot exhaustion on frequent polling).
     *
     * @param session - The `SSHSession` from the active SSH tab (`tab.sshSession`).
     * @param command - Shell command string to execute remotely.
     * @returns Combined stdout + stderr as a UTF-8 string.
     * @throws Error if the SSH client is not connected or the channel fails to open.
     */
    async execCommand(session: any, command: string): Promise<string> {
        const sshClient = session?.ssh
        if (!sshClient) {
            throw new Error('SSH client is not available — the session may not be connected yet')
        }

        const rawChannel = await sshClient.openSessionChannel()
        const channel = await sshClient.activateChannel(rawChannel)

        const chunks: Uint8Array[] = []
        let timeoutId: ReturnType<typeof setTimeout> | null = null

        // Subscribe to data/close events BEFORE sending the exec request
        // so that no output bytes are missed during the async handshake.
        const outputPromise = new Promise<void>((resolve) => {
            channel.data$.subscribe({
                next: (data: Uint8Array) => chunks.push(data),
            })

            // `closed$` fires when the channel is fully torn down (server + client).
            // `eof$`    fires when the remote process finishes writing (preferred fallback).
            if (channel.closed$) {
                channel.closed$.subscribe(() => resolve())
            } else if (channel.eof$) {
                channel.eof$.subscribe(() => resolve())
            }

            // Hard cap: avoid hanging forever if the server never sends close/eof.
            timeoutId = setTimeout(() => resolve(), 15_000)
        })

        try {
            await channel.requestExec(command)
            await outputPromise
        } finally {
            if (timeoutId !== null) {
                clearTimeout(timeoutId)
            }
            // Send a close request to free the server-side channel slot.
            // Do NOT await — russh may never resolve the close promise if the
            // server already sent its close first.  Fire-and-forget is safe here
            // because the server will eventually GC the slot on its own.
            try { channel.close() } catch { /* channel already closed */ }
        }

        const total = chunks.reduce((sum, c) => sum + c.length, 0)
        const merged = new Uint8Array(total)
        let offset = 0
        for (const chunk of chunks) {
            merged.set(chunk, offset)
            offset += chunk.length
        }
        return Buffer.from(merged).toString('utf8').trim()
    }

    /**
     * Parses newline-delimited JSON output (one JSON object per line).
     * Lines that fail to parse are silently dropped.
     *
     * @param raw - Raw command output string.
     * @returns Array of parsed objects.
     */
    private parseJsonLines<T>(raw: string): T[] {
        if (!raw) {
            return []
        }
        return raw
            .split('\n')
            .filter(line => line.trimStart().startsWith('{'))
            .map(line => {
                try {
                    return JSON.parse(line) as T
                } catch {
                    return null
                }
            })
            .filter((item): item is T => item !== null)
    }

    /**
     * Returns a list of all containers (running + stopped) on the remote host.
     *
     * @param session - Active `SSHSession` from an SSH tab.
     * @returns Array of `DockerContainer` objects.
     */
    async listContainers(session: any): Promise<DockerContainer[]> {
        const format =
            '{"id":"{{.ID}}","names":"{{.Names}}","image":"{{.Image}}",' +
            '"status":"{{.Status}}","state":"{{.State}}","ports":"{{.Ports}}",' +
            '"created":"{{.CreatedAt}}"}'
        const raw = await this.execCommand(session, `docker ps -a --format '${format}'`)
        return this.parseJsonLines<DockerContainer>(raw)
    }

    /**
     * Returns a list of Docker images available on the remote host.
     *
     * @param session - Active `SSHSession` from an SSH tab.
     * @returns Array of `DockerImage` objects.
     */
    async listImages(session: any): Promise<DockerImage[]> {
        const format =
            '{"id":"{{.ID}}","repository":"{{.Repository}}",' +
            '"tag":"{{.Tag}}","size":"{{.Size}}","created":"{{.CreatedAt}}"}'
        const raw = await this.execCommand(session, `docker images --format '${format}'`)
        return this.parseJsonLines<DockerImage>(raw)
    }

    /**
     * Fetches the last N lines of logs for a container.
     *
     * @param session - Active `SSHSession`.
     * @param containerId - Container ID or name.
     * @param tail - Number of lines to return from the end of the log (`0` = all).
     * @param flags - Additional flags to pass to `docker logs` (e.g. `--timestamps`).
     * @returns Log output as a raw string.
     */
    async getContainerLogs(
        session: any,
        containerId: string,
        tail = 100,
        flags = '',
    ): Promise<string> {
        const tailArg = tail > 0 ? `--tail ${tail}` : ''
        return this.execCommand(
            session,
            `docker logs ${tailArg} ${flags} ${containerId} 2>&1`.replace(/\s+/g, ' ').trim(),
        )
    }

    /**
     * Returns a single-snapshot (non-streaming) stats sample for a container.
     *
     * @param session - Active `SSHSession`.
     * @param containerId - Container ID or name.
     * @returns `DockerStats` object, or `null` if the container is not running / stats unavailable.
     */
    async getContainerStats(session: any, containerId: string): Promise<DockerStats | null> {
        const format =
            '{"containerId":"{{.ID}}","name":"{{.Name}}",' +
            '"cpuPercent":"{{.CPUPerc}}","memUsage":"{{.MemUsage}}",' +
            '"memPercent":"{{.MemPerc}}","netIO":"{{.NetIO}}",' +
            '"blockIO":"{{.BlockIO}}","pids":"{{.PIDs}}"}'
        try {
            const raw = await this.execCommand(
                session,
                `docker stats --no-stream --format '${format}' ${containerId}`,
            )
            if (!raw) {
                return null
            }
            return JSON.parse(raw.split('\n')[0]) as DockerStats
        } catch {
            return null
        }
    }

    /**
     * Starts a stopped container.
     *
     * @param session - Active `SSHSession`.
     * @param containerId - Container ID or name.
     */
    async startContainer(session: any, containerId: string): Promise<void> {
        await this.execCommand(session, `docker start ${containerId}`)
        this.notifications.notice(`Container ${containerId.substring(0, 12)} started`)
    }

    /**
     * Stops a running container (sends SIGTERM, then SIGKILL after the default timeout).
     *
     * @param session - Active `SSHSession`.
     * @param containerId - Container ID or name.
     */
    async stopContainer(session: any, containerId: string): Promise<void> {
        await this.execCommand(session, `docker stop ${containerId}`)
        this.notifications.notice(`Container ${containerId.substring(0, 12)} stopped`)
    }

    /**
     * Restarts a container.
     *
     * @param session - Active `SSHSession`.
     * @param containerId - Container ID or name.
     */
    async restartContainer(session: any, containerId: string): Promise<void> {
        await this.execCommand(session, `docker restart ${containerId}`)
        this.notifications.notice(`Container ${containerId.substring(0, 12)} restarted`)
    }

    /**
     * Removes a stopped container.
     * Will throw if the container is still running.
     *
     * @param session - Active `SSHSession`.
     * @param containerId - Container ID or name.
     */
    async removeContainer(session: any, containerId: string): Promise<void> {
        await this.execCommand(session, `docker rm ${containerId}`)
        this.notifications.notice(`Container ${containerId.substring(0, 12)} removed`)
    }

    /**
     * Removes a Docker image.
     * Will throw if the image is used by a running container.
     *
     * @param session - Active `SSHSession`.
     * @param imageId - Image ID or tag.
     */
    async removeImage(session: any, imageId: string): Promise<void> {
        await this.execCommand(session, `docker rmi ${imageId}`)
        this.notifications.notice(`Image ${imageId.substring(0, 12)} removed`)
    }

    /**
     * Returns the Docker server version string (e.g. `"27.3.1"`).
     *
     * @param session - Active `SSHSession`.
     * @returns Version string, or an empty string if Docker is unavailable.
     */
    async getDockerVersion(session: any): Promise<string> {
        try {
            const raw = await this.execCommand(
                session,
                'docker version --format "{{.Server.Version}}" 2>/dev/null',
            )
            return raw.split('\n')[0]?.trim() ?? ''
        } catch {
            return ''
        }
    }

    /**
     * Checks whether the Docker daemon is accessible on the remote host.
     *
     * @param session - Active `SSHSession`.
     * @returns `true` if `docker info` succeeds, `false` otherwise.
     */
    async isDockerAvailable(session: any): Promise<boolean> {
        try {
            const output = await this.execCommand(
                session,
                'docker info --format "{{.ServerVersion}}" 2>/dev/null',
            )
            return output.length > 0
        } catch {
            return false
        }
    }
}
