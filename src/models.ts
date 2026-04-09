/**
 * Data models returned by Docker CLI commands on the remote host.
 * All fields are strings because docker --format templates produce raw text.
 */

export interface DockerContainer {
    id: string
    names: string
    image: string
    status: string
    state: string
    health: string
    ports: string
    created: string
}

export interface DockerImage {
    id: string
    repository: string
    tag: string
    size: string
    created: string
}

export interface DockerStats {
    containerId: string
    name: string
    cpuPercent: string
    memUsage: string
    memPercent: string
    netIO: string
    blockIO: string
    pids: string
}
