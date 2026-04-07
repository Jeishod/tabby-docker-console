import { Injectable } from '@angular/core'
import { Subscription } from 'rxjs'
import { AppService } from 'tabby-core'
import { TerminalDecorator } from 'tabby-terminal'
import { DockerConsoleTabComponent } from './components/dockerConsoleTab.component'
import { isSSHTab, resolveHostLabel } from './utils'

/** Attribute used to mark our injected button so we never insert it twice. */
const BUTTON_ATTR = 'data-docker-console-btn'

/**
 * Injects a "Docker" toolbar button into every SSH terminal tab,
 * placing it next to the built-in Reconnect / SFTP / Ports buttons.
 *
 * Direct DOM manipulation is used (the same approach as `tabby-sftp-ui`) because
 * the toolbar buttons in `SSHTabComponent` are hardcoded in its template and
 * there is no Angular-based extension point for them.
 *
 * The decorator polls with a short interval after `attach()` because the toolbar
 * element may not yet be in the DOM at the time of the call (Angular renders
 * asynchronously).  Polling stops as soon as the button is inserted or after
 * a maximum of 10 seconds (20 × 500 ms).
 */
@Injectable()
export class DockerToolbarDecorator extends TerminalDecorator {
    constructor(private app: AppService) {
        super()
    }

    attach(terminal: any): void {
        super.attach(terminal)

        let attempts = 0
        const timer = setInterval(() => {
            attempts++
            if (this.tryInsert(terminal) || attempts > 20) {
                clearInterval(timer)
            }
        }, 500)

        // Tie the interval lifetime to the tab so it is always cleaned up.
        const timerSub = new Subscription(() => clearInterval(timer))
        this.subscribeUntilDetached(terminal, timerSub)
    }

    /**
     * Locates the terminal toolbar in the DOM and injects the Docker button.
     * Only runs for SSH tabs; returns `true` immediately for all other tab types.
     *
     * @param terminal - Terminal tab component instance.
     * @returns `true` when the button is present (or was just inserted), `false` when
     *   the toolbar is not yet in the DOM and the caller should retry.
     */
    private tryInsert(terminal: any): boolean {
        try {
            if (!isSSHTab(terminal)) {
                return true
            }

            const host: HTMLElement | null = terminal.element?.nativeElement ?? null
            if (!host) {
                return false
            }

            const toolbar =
                host.querySelector('.terminal-toolbar') ??
                host.querySelector('terminal-toolbar') ??
                host.querySelector('.btn-toolbar') ??
                host

            if (toolbar.querySelector(`[${BUTTON_ATTR}]`)) {
                return true
            }

            const btn = this.createButton(terminal)

            // Insert right after the Reconnect button when present; otherwise append.
            const allButtons = Array.from(toolbar.querySelectorAll<HTMLButtonElement>('button'))
            const reconnectBtn = allButtons.find(b => {
                const text = `${b.textContent ?? ''} ${b.title ?? ''}`.toLowerCase()
                return text.includes('reconnect')
            })

            if (reconnectBtn?.parentElement) {
                reconnectBtn.parentElement.insertBefore(btn, reconnectBtn.nextSibling)
            } else {
                toolbar.appendChild(btn)
            }

            return true
        } catch {
            return false
        }
    }

    private createButton(terminal: any): HTMLButtonElement {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'btn btn-sm btn-link me-2'
        btn.setAttribute(BUTTON_ATTR, '1')
        btn.title = 'Docker Console'
        btn.innerHTML = '<i class="fab fa-docker"></i><span>Docker</span>'
        btn.style.cssText = 'pointer-events:auto;z-index:10;position:relative;'

        // Stop mousedown propagation so Tabby doesn't interpret it as a drag.
        btn.addEventListener('mousedown', ev => ev.stopPropagation())
        btn.addEventListener('click', ev => {
            ev.preventDefault()
            ev.stopPropagation()
            try {
                this.app.openNewTab({
                    type: DockerConsoleTabComponent,
                    inputs: {
                        sshSession: terminal.sshSession,
                        hostLabel: resolveHostLabel(terminal),
                    },
                })
            } catch { /* ignore — tab open failures are non-critical */ }
        })

        return btn
    }
}
