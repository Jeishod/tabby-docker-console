import { Injectable } from '@angular/core'
import { AppService, BaseTabComponent, MenuItemOptions, NotificationsService, TabContextMenuItemProvider } from 'tabby-core'
import { DockerConsoleTabComponent } from './components/dockerConsoleTab.component'
import { isSSHTab, resolveHostLabel } from './utils'

/**
 * Adds a "Docker Console" entry to the right-click context menu of SSH tabs.
 *
 * Clicking the item opens a new `DockerConsoleTabComponent` tab that reuses
 * the existing SSH session — no additional connection is established.
 */
@Injectable()
export class DockerTabContextMenu extends TabContextMenuItemProvider {
    weight = 20

    constructor(
        private app: AppService,
        private notifications: NotificationsService,
    ) {
        super()
    }

    async getItems(tab: BaseTabComponent): Promise<MenuItemOptions[]> {
        if (!isSSHTab(tab)) {
            return []
        }
        return [
            {
                label: 'Docker Console',
                click: () => this.openDockerConsole(tab),
            },
        ]
    }

    private openDockerConsole(tab: any): void {
        try {
            this.app.openNewTab({
                type: DockerConsoleTabComponent,
                inputs: {
                    sshSession: tab.sshSession,
                    hostLabel: resolveHostLabel(tab),
                },
            })
        } catch (e: any) {
            this.notifications.error(`Could not open Docker Console: ${e?.message ?? e}`)
        }
    }
}
