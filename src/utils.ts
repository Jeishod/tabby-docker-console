/**
 * Shared utilities for detecting SSH tabs and resolving display labels.
 * Both the context menu provider and the toolbar decorator need this logic,
 * so it lives here to avoid duplication.
 */

/**
 * Duck-typing check for SSH tabs.
 *
 * Using `instanceof` across Electron module boundaries is unreliable because
 * each renderer process may load its own copy of a module, so the constructor
 * references differ even for the same class.
 *
 * @param tab - Any Tabby tab component instance.
 * @returns True if the tab is (or wraps) an SSH session.
 */
export function isSSHTab(tab: any): boolean {
    return 'sshSession' in tab || tab.profile?.type === 'ssh'
}

/**
 * Returns the most human-readable label for an SSH tab.
 * Prefers the profile name, falls back to the host IP/hostname.
 *
 * @param tab - Any Tabby tab component instance.
 * @returns Display string for use in the Docker Console tab title.
 */
export function resolveHostLabel(tab: any): string {
    return (
        tab.profile?.name ??
        tab.sshSession?.profile?.name ??
        tab.profile?.options?.host ??
        tab.sshSession?.profile?.options?.host ??
        'SSH'
    )
}
