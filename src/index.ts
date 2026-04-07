import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'

import TabbyCoreModule, { TabContextMenuItemProvider } from 'tabby-core'
import { TerminalDecorator } from 'tabby-terminal'

import { DockerConsoleTabComponent } from './components/dockerConsoleTab.component'
import { DockerTabContextMenu } from './tabContextMenu'
import { DockerToolbarDecorator } from './dockerToolbar.decorator'
import { RemoteDockerService } from './services/remoteDocker.service'

/**
 * Tabby plugin module: tabby-docker-console.
 *
 * Registers two entry points into Tabby's UI:
 *  - A "Docker Console" item in the right-click context menu of every SSH tab.
 *  - A "Docker" toolbar button injected next to the Reconnect / SFTP / Ports buttons.
 *
 * Both entry points open a new `DockerConsoleTabComponent` tab that runs Docker CLI
 * commands over the already-established SSH session — no extra connections required.
 */
@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        TabbyCoreModule,
    ],
    providers: [
        RemoteDockerService,
        {
            provide: TabContextMenuItemProvider,
            useClass: DockerTabContextMenu,
            multi: true,
        },
        {
            provide: TerminalDecorator,
            useClass: DockerToolbarDecorator,
            multi: true,
        },
    ],
    declarations: [
        DockerConsoleTabComponent,
    ],
    // entryComponents is required for older Angular / Tabby versions that use
    // ComponentFactoryResolver.resolveComponentFactory() when opening new tabs.
    entryComponents: [
        DockerConsoleTabComponent,
    ],
})
export default class DockerConsoleModule {}

export { DockerConsoleTabComponent } from './components/dockerConsoleTab.component'
export { RemoteDockerService } from './services/remoteDocker.service'
export { DockerContainer, DockerImage, DockerStats } from './models'
