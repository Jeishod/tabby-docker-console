import { ChangeDetectorRef, Component, ElementRef, Input, Injector, OnDestroy, OnInit, ViewChild } from '@angular/core'
import { AppService, BaseTabComponent, NotificationsService } from 'tabby-core'
import { DockerContainer, DockerImage, DockerStats } from '../models'
import { RemoteDockerService } from '../services/remoteDocker.service'

type ActiveView = 'containers' | 'images' | 'logs' | 'stats'
type FilterState = 'all' | 'running' | 'exited' | 'paused'

/**
 * Tabby tab component for the Docker Console.
 *
 * Opens as a regular Tabby tab via AppService.openNewTab().
 * Receives an SSH session reference and uses it to run docker CLI commands.
 * Displays containers and images in a Termix-style card grid layout.
 */
@Component({
    selector: 'docker-console-tab',
    template: `
        <div class="dc-root">

            <!-- ── Header ─────────────────────────────────────────────── -->
            <div class="dc-topbar">
                <div class="dc-topbar-left">
                    <i class="fab fa-docker dc-docker-icon"></i>
                    <div class="dc-topbar-title">
                        <span class="dc-breadcrumb">{{ hostLabel || 'Docker' }}</span>
                    </div>
                    <span class="dc-version" *ngIf="dockerVersion">Docker {{ dockerVersion }}</span>
                </div>
                <div class="dc-topbar-right">
                    <button class="dc-icon-btn" [ngClass]="{'spinning': loading}" (click)="refresh()" [disabled]="loading" title="Refresh">
                        <i class="fas" [ngClass]="loading ? 'fa-spinner fa-spin' : 'fa-sync-alt'"></i>
                    </button>
                </div>
            </div>

            <!-- ── View Tabs ───────────────────────────────────────────── -->
            <div class="dc-view-tabs">
                <button [ngClass]="{'active': activeView === 'containers' || activeView === 'logs'}"
                        (click)="setView('containers')">
                    <i class="fas fa-cubes"></i> Containers
                    <span class="dc-count" *ngIf="containers.length > 0">{{ containers.length }}</span>
                </button>
                <button [ngClass]="{'active': activeView === 'images'}"
                        (click)="setView('images')">
                    <i class="fas fa-layer-group"></i> Images
                    <span class="dc-count" *ngIf="images.length > 0">{{ images.length }}</span>
                </button>
            </div>

            <!-- ── Error ──────────────────────────────────────────────── -->
            <div class="dc-error" *ngIf="errorMessage">
                <i class="fas fa-exclamation-triangle"></i> {{ errorMessage }}
            </div>

            <!-- ══════════════ CONTAINERS GRID ═══════════════════════════ -->
            <ng-container *ngIf="activeView === 'containers'">

                <!-- Search + Filter toolbar -->
                <div class="dc-toolbar">
                    <div class="dc-search">
                        <i class="fas fa-search dc-search-icon"></i>
                        <input class="dc-search-input" type="text" placeholder="Search containers..."
                               [(ngModel)]="searchQuery" (ngModelChange)="onSearch()">
                    </div>
                    <div class="dc-filter-wrap">
                        <button class="dc-filter-btn" (click)="toggleFilterMenu()" #filterBtn>
                            <i class="fas fa-filter"></i>
                            {{ filterLabel() }}
                            <i class="fas fa-chevron-down dc-chevron"></i>
                        </button>
                        <div class="dc-filter-menu" *ngIf="filterMenuOpen">
                            <button [ngClass]="{'active': filterState === 'all'}" (click)="setFilter('all')">
                                All ({{ containers.length }})
                            </button>
                            <button [ngClass]="{'active': filterState === 'running'}" (click)="setFilter('running')">
                                <span class="dot dot-running"></span> Running ({{ countByState('running') }})
                            </button>
                            <button [ngClass]="{'active': filterState === 'exited'}" (click)="setFilter('exited')">
                                <span class="dot dot-exited"></span> Exited ({{ countByState('exited') }})
                            </button>
                            <button [ngClass]="{'active': filterState === 'paused'}" (click)="setFilter('paused')">
                                <span class="dot dot-paused"></span> Paused ({{ countByState('paused') }})
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Loading skeleton -->
                <div class="dc-loading-bar" *ngIf="loading">
                    <i class="fas fa-spinner fa-spin"></i> Loading containers...
                </div>

                <!-- Empty state -->
                <div class="dc-empty" *ngIf="!loading && filteredContainers.length === 0">
                    <i class="fab fa-docker fa-3x"></i>
                    <p>{{ containers.length === 0 ? 'No containers found' : 'No containers match the filter' }}</p>
                </div>

                <!-- Cards grid -->
                <div class="dc-grid" *ngIf="!loading && filteredContainers.length > 0">
                    <div class="dc-card" *ngFor="let c of filteredContainers"
                         [ngClass]="'state-' + c.state">

                        <div class="dc-card-header">
                            <span class="dc-card-name" [title]="displayName(c.names)">{{ displayName(c.names) }}</span>
                            <span class="dc-state-badge" [ngClass]="'badge-' + c.state">{{ c.state }}</span>
                        </div>

                        <div class="dc-card-fields">
                            <div class="dc-field">
                                <span class="dc-field-label">Image</span>
                                <span class="dc-field-value" [title]="c.image">{{ c.image }}</span>
                            </div>
                            <div class="dc-field">
                                <span class="dc-field-label">ID</span>
                                <span class="dc-field-value dc-mono">{{ c.id | slice:0:12 }}</span>
                            </div>
                            <div class="dc-field">
                                <span class="dc-field-label">Ports</span>
                                <span class="dc-field-value dc-ports" [title]="c.ports">{{ formatPorts(c.ports) }}</span>
                            </div>
                            <div class="dc-field">
                                <span class="dc-field-label">Created</span>
                                <span class="dc-field-value">{{ formatDate(c.created) }}</span>
                            </div>
                        </div>

                        <div class="dc-card-actions">
                            <button class="dc-act-btn" title="Open terminal (exec)"
                                    [disabled]="c.state !== 'running' || busy === c.id"
                                    (click)="openExec(c)">
                                <i class="fas fa-terminal"></i>
                            </button>
                            <button class="dc-act-btn" title="View logs"
                                    [disabled]="busy === c.id"
                                    (click)="viewLogs(c)">
                                <i class="fas fa-align-left"></i>
                            </button>
                            <button class="dc-act-btn" title="Stats"
                                    [disabled]="c.state !== 'running' || busy === c.id"
                                    (click)="viewStats(c)">
                                <i class="fas fa-chart-bar"></i>
                            </button>
                            <button class="dc-act-btn" title="Start" *ngIf="c.state !== 'running'"
                                    [disabled]="busy === c.id" (click)="startContainer(c)">
                                <i class="fas fa-play"></i>
                            </button>
                            <button class="dc-act-btn" title="Stop" *ngIf="c.state === 'running'"
                                    [disabled]="busy === c.id" (click)="stopContainer(c)">
                                <i class="fas fa-stop"></i>
                            </button>
                            <button class="dc-act-btn" title="Restart"
                                    [disabled]="busy === c.id" (click)="restartContainer(c)">
                                <i class="fas fa-redo" [ngClass]="{'fa-spin': busy === c.id}"></i>
                            </button>
                            <button class="dc-act-btn dc-act-danger" title="Remove"
                                    [disabled]="c.state === 'running' || busy === c.id"
                                    (click)="removeContainer(c)">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>

                    </div>
                </div>
            </ng-container>

            <!-- ══════════════ IMAGES GRID ════════════════════════════════ -->
            <ng-container *ngIf="activeView === 'images'">
                <div class="dc-toolbar">
                    <div class="dc-search">
                        <i class="fas fa-search dc-search-icon"></i>
                        <input class="dc-search-input" type="text" placeholder="Search images..."
                               [(ngModel)]="imageSearchQuery">
                    </div>
                </div>

                <div class="dc-loading-bar" *ngIf="loading">
                    <i class="fas fa-spinner fa-spin"></i> Loading images...
                </div>

                <div class="dc-empty" *ngIf="!loading && filteredImages.length === 0">
                    <i class="fab fa-docker fa-3x"></i>
                    <p>No images found</p>
                </div>

                <div class="dc-grid" *ngIf="!loading && filteredImages.length > 0">
                    <div class="dc-card dc-image-card" *ngFor="let img of filteredImages">
                        <div class="dc-card-header">
                            <span class="dc-card-name" [title]="img.repository + ':' + img.tag">
                                {{ img.repository }}<span class="dc-tag">:{{ img.tag }}</span>
                            </span>
                        </div>
                        <div class="dc-card-fields">
                            <div class="dc-field">
                                <span class="dc-field-label">ID</span>
                                <span class="dc-field-value dc-mono">{{ img.id | slice:7:19 }}</span>
                            </div>
                            <div class="dc-field">
                                <span class="dc-field-label">Size</span>
                                <span class="dc-field-value">{{ img.size }}</span>
                            </div>
                            <div class="dc-field">
                                <span class="dc-field-label">Created</span>
                                <span class="dc-field-value">{{ formatDate(img.created) }}</span>
                            </div>
                        </div>
                        <div class="dc-card-actions">
                            <button class="dc-act-btn dc-act-danger" title="Remove image"
                                    (click)="removeImage(img)">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </ng-container>

            <!-- ══════════════ STATS VIEW ═════════════════════════════════ -->
            <ng-container *ngIf="activeView === 'stats'">
                <div class="dc-logs-toolbar">
                    <button class="dc-back-btn" (click)="backToContainers()">
                        <i class="fas fa-arrow-left"></i> Back
                    </button>
                    <span class="dc-logs-title" *ngIf="selectedContainer">
                        <i class="fas fa-chart-bar"></i>
                        {{ displayName(selectedContainer.names) }}
                    </span>
                    <span class="dc-state-badge"
                          [ngClass]="selectedContainer?.state ? 'badge-' + selectedContainer.state : ''"
                          *ngIf="selectedContainer?.state">
                        {{ selectedContainer.state }}
                    </span>
                    <div class="flex-spacer"></div>
                    <span class="dc-autorefresh-badge" title="Auto-refresh every 5s">
                        <i class="fas fa-circle dc-pulse"></i> 5s
                    </span>
                    <button class="dc-icon-btn" (click)="reloadStats()" [disabled]="statsLoading" title="Refresh stats">
                        <i class="fas" [ngClass]="statsLoading ? 'fa-spinner fa-spin' : 'fa-sync-alt'"></i>
                    </button>
                </div>

                <div class="dc-stats-error" *ngIf="!containerStats">
                    <i class="fas fa-exclamation-triangle"></i>
                    Could not load stats. The container may have stopped or Docker stats are unavailable.
                </div>

                <div class="dc-stats-grid" *ngIf="containerStats">

                    <!-- CPU Usage -->
                    <div class="dc-stat-card">
                        <div class="dc-stat-card-title">
                            <i class="fas fa-microchip dc-stat-icon-cpu"></i> CPU Usage
                        </div>
                        <div class="dc-stat-row">
                            <span class="dc-stat-label">Current</span>
                            <span class="dc-stat-value dc-stat-cpu">{{ containerStats.cpuPercent }}</span>
                        </div>
                        <div class="dc-progress-track">
                            <div class="dc-progress-fill dc-progress-cpu"
                                 [style.width]="parsePercent(containerStats.cpuPercent) + '%'"></div>
                        </div>
                    </div>

                    <!-- Memory Usage -->
                    <div class="dc-stat-card">
                        <div class="dc-stat-card-title">
                            <i class="fas fa-memory dc-stat-icon-mem"></i> Memory Usage
                        </div>
                        <div class="dc-stat-row">
                            <span class="dc-stat-label">Used / Limit</span>
                            <span class="dc-stat-value dc-stat-mem">{{ containerStats.memUsage }}</span>
                        </div>
                        <div class="dc-stat-row">
                            <span class="dc-stat-label">Percentage</span>
                            <span class="dc-stat-value dc-stat-mem">{{ containerStats.memPercent }}</span>
                        </div>
                        <div class="dc-progress-track">
                            <div class="dc-progress-fill dc-progress-mem"
                                 [style.width]="parsePercent(containerStats.memPercent) + '%'"></div>
                        </div>
                    </div>

                    <!-- Network I/O -->
                    <div class="dc-stat-card">
                        <div class="dc-stat-card-title">
                            <i class="fas fa-network-wired dc-stat-icon-net"></i> Network I/O
                        </div>
                        <div class="dc-stat-row">
                            <span class="dc-stat-label">Input</span>
                            <span class="dc-stat-value dc-stat-net-in">{{ splitIO(containerStats.netIO, 0) }}</span>
                        </div>
                        <div class="dc-stat-row">
                            <span class="dc-stat-label">Output</span>
                            <span class="dc-stat-value dc-stat-net-out">{{ splitIO(containerStats.netIO, 1) }}</span>
                        </div>
                    </div>

                    <!-- Block I/O -->
                    <div class="dc-stat-card">
                        <div class="dc-stat-card-title">
                            <i class="fas fa-hdd dc-stat-icon-blk"></i> Block I/O
                        </div>
                        <div class="dc-stat-row">
                            <span class="dc-stat-label">Read</span>
                            <span class="dc-stat-value dc-stat-blk-read">{{ splitIO(containerStats.blockIO, 0) }}</span>
                        </div>
                        <div class="dc-stat-row">
                            <span class="dc-stat-label">Write</span>
                            <span class="dc-stat-value dc-stat-blk-write">{{ splitIO(containerStats.blockIO, 1) }}</span>
                        </div>
                        <div class="dc-stat-row">
                            <span class="dc-stat-label">PIDs</span>
                            <span class="dc-stat-value dc-stat-pids">{{ containerStats.pids }}</span>
                        </div>
                    </div>

                    <!-- Container Information -->
                    <div class="dc-stat-card dc-stat-card-full">
                        <div class="dc-stat-card-title">
                            <i class="fas fa-info-circle dc-stat-icon-info"></i> Container Information
                        </div>
                        <div class="dc-stat-info-row">
                            <span class="dc-stat-label">Name</span>
                            <span class="dc-stat-value">{{ displayName(selectedContainer?.names) }}</span>
                            <span class="dc-stat-label">ID</span>
                            <span class="dc-stat-value dc-mono">{{ selectedContainer?.id | slice:0:12 }}</span>
                            <span class="dc-stat-label">State</span>
                            <span class="dc-state-badge" [ngClass]="'badge-' + selectedContainer?.state">{{ selectedContainer?.state }}</span>
                        </div>
                        <div class="dc-stat-info-row">
                            <span class="dc-stat-label">Image</span>
                            <span class="dc-stat-value">{{ selectedContainer?.image }}</span>
                            <span class="dc-stat-label">Ports</span>
                            <span class="dc-stat-value">{{ formatPorts(selectedContainer?.ports) || 'No ports' }}</span>
                            <span class="dc-stat-label">Created</span>
                            <span class="dc-stat-value">{{ formatDate(selectedContainer?.created) }}</span>
                        </div>
                    </div>

                </div>
            </ng-container>

            <!-- ══════════════ LOGS VIEW ══════════════════════════════════ -->
            <ng-container *ngIf="activeView === 'logs'">

                <!-- Top: container name + nav -->
                <div class="dc-logs-toolbar">
                    <button class="dc-back-btn" (click)="backToContainers()">
                        <i class="fas fa-arrow-left"></i> Back
                    </button>
                    <span class="dc-logs-title" *ngIf="selectedContainer">
                        <i class="fas fa-scroll"></i>
                        {{ displayName(selectedContainer.names) }}
                    </span>
                    <span class="dc-state-badge"
                          [ngClass]="selectedContainer?.state ? 'badge-' + selectedContainer.state : ''"
                          *ngIf="selectedContainer?.state">
                        {{ selectedContainer.state }}
                    </span>
                </div>

                <!-- Controls bar — single row, no wrap -->
                <div class="dc-logs-controls">

                    <span class="dc-ctrl-label">Lines</span>
                    <div class="dc-select-wrap">
                        <select class="dc-select" [(ngModel)]="logsTail" (ngModelChange)="reloadLogs()">
                            <option [ngValue]="50">Last 50</option>
                            <option [ngValue]="100">Last 100</option>
                            <option [ngValue]="300">Last 300</option>
                            <option [ngValue]="500">Last 500</option>
                            <option [ngValue]="1000">Last 1000</option>
                            <option [ngValue]="0">All</option>
                        </select>
                        <i class="fas fa-chevron-down dc-select-arrow"></i>
                    </div>

                    <div class="dc-ctrl-divider"></div>

                    <span class="dc-ctrl-label">Timestamps</span>
                    <button class="dc-toggle" [ngClass]="{'on': logsTimestamps}" (click)="toggleTimestamps()">
                        <span class="dc-toggle-thumb"></span>
                        <span class="dc-toggle-label">{{ logsTimestamps ? 'On' : 'Off' }}</span>
                    </button>

                    <div class="dc-ctrl-divider"></div>

                    <span class="dc-ctrl-label">Auto Refresh</span>
                    <button class="dc-toggle" [ngClass]="{'on': logsAutoRefresh}" (click)="toggleAutoRefresh()">
                        <span class="dc-toggle-thumb"></span>
                        <span class="dc-toggle-label">{{ logsAutoRefresh ? 'On' : 'Off' }}</span>
                    </button>
                    <div class="dc-select-wrap" *ngIf="logsAutoRefresh">
                        <select class="dc-select dc-select-sm" [(ngModel)]="logsRefreshInterval" (ngModelChange)="restartAutoRefresh()">
                            <option [ngValue]="3">3s</option>
                            <option [ngValue]="5">5s</option>
                            <option [ngValue]="10">10s</option>
                            <option [ngValue]="30">30s</option>
                            <option [ngValue]="60">60s</option>
                        </select>
                        <i class="fas fa-chevron-down dc-select-arrow"></i>
                    </div>

                    <div class="flex-spacer"></div>

                    <button class="dc-icon-btn" (click)="reloadLogs()" [disabled]="logsLoading" title="Reload logs">
                        <i class="fas" [ngClass]="logsLoading ? 'fa-spinner fa-spin' : 'fa-sync-alt'"></i>
                    </button>
                    <button class="dc-icon-btn" (click)="downloadLogs()" [disabled]="!containerLogs" title="Download logs">
                        <i class="fas fa-download"></i>
                    </button>

                </div>

                <!-- Filter bar -->
                <div class="dc-logs-filter-bar">
                    <i class="fas fa-filter dc-filter-icon"></i>
                    <input class="dc-logs-filter-input" type="text" placeholder="Filter logs..."
                           [(ngModel)]="logsFilter">
                </div>

                <pre class="dc-logs" #logsEl>{{ filteredLogs }}</pre>
            </ng-container>

        </div>
    `,
    styles: [`
        /* ── Tabby dynamic CSS vars (set via applyTheme → document.documentElement.style.setProperty) ──
           --body-bg              always: processed terminal bg
           --theme-bg             terminal background  (when theme followsColorScheme)
           --theme-bg-more        slightly lighter bg  (panels, topbar)
           --theme-bg-more-2      even lighter         (hover, card bg)
           --theme-bg-less        slightly darker bg   (input bg)
           --theme-fg             terminal foreground  — matches the terminal colour scheme
           --theme-fg-more        brighter fg          (headings / names)
           --theme-fg-less        dimmer fg            (muted labels)
           --theme-fg-less-2      very dim             (placeholders)
           Docker brand accent: #4caf50 (green) / #2496ed (blue) — kept fixed
        ────────────────────────────────────────────────────────────────────── */

        /* ── Layout ─────────────────────────────────────────── */
        :host { display: flex; flex-direction: column; height: 100%; overflow: hidden; background: var(--theme-bg, #131d27); }
        .dc-root { display: flex; flex-direction: column; height: 100%; background: var(--theme-bg, #131d27); color: var(--theme-fg, #cccccc); font-size: 12px; overflow: hidden; }

        /* ── Top bar ─────────────────────────────────────────── */
        .dc-topbar { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: var(--theme-bg-more, #1d2d3d); border-bottom: 1px solid rgba(255,255,255,0.08); flex-shrink: 0; gap: 12px; }
        .dc-topbar-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .dc-topbar-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .dc-docker-icon { font-size: 20px; color: #2496ed; flex-shrink: 0; }
        .dc-topbar-title { min-width: 0; }
        .dc-breadcrumb { font-size: 14px; font-weight: 600; color: var(--theme-fg-more, #e8e8e8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dc-version { font-size: 11px; color: #81c784; background: rgba(76,175,80,0.12); border: 1px solid rgba(76,175,80,0.25); padding: 2px 8px; border-radius: 10px; white-space: nowrap; flex-shrink: 0; }

        /* ── View tabs ───────────────────────────────────────── */
        .dc-view-tabs { display: flex; gap: 0; background: var(--theme-bg-more, #1d2d3d); border-bottom: 1px solid rgba(255,255,255,0.08); flex-shrink: 0; }
        .dc-view-tabs button { padding: 8px 18px; background: transparent; border: none; border-bottom: 2px solid transparent; color: var(--theme-fg-less, rgba(204,204,204,0.65)); cursor: pointer; font-size: 12px; font-weight: 500; display: flex; align-items: center; gap: 6px; transition: all 0.15s; }
        .dc-view-tabs button:hover { color: #a5d6a7; background: rgba(76,175,80,0.05); }
        .dc-view-tabs button.active { color: #81c784; border-bottom-color: #4caf50; }
        .dc-count { background: rgba(76,175,80,0.15); color: #81c784; border: 1px solid rgba(76,175,80,0.25); padding: 0px 6px; border-radius: 10px; font-size: 10px; font-weight: 600; }

        /* ── Error bar ───────────────────────────────────────── */
        .dc-error { padding: 8px 16px; background: rgba(220,53,69,0.15); border-bottom: 1px solid rgba(220,53,69,0.3); color: #f87171; font-size: 11px; flex-shrink: 0; }

        /* ── Toolbar (search + filter) ───────────────────────── */
        .dc-toolbar { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: var(--theme-bg-more, #1d2d3d); border-bottom: 1px solid rgba(255,255,255,0.08); flex-shrink: 0; }
        .dc-search { position: relative; flex: 1; }
        .dc-search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--theme-fg-less, rgba(204,204,204,0.5)); font-size: 12px; pointer-events: none; }
        .dc-search-input { width: 100%; padding: 7px 10px 7px 30px; background: var(--theme-bg-less, #0d1520); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: var(--theme-fg, #cccccc); font-size: 12px; outline: none; box-sizing: border-box; transition: border-color 0.15s; }
        .dc-search-input:focus { border-color: #4caf50; }
        .dc-search-input::placeholder { color: var(--theme-fg-less-2, rgba(204,204,204,0.4)); }

        /* Filter button + dropdown */
        .dc-filter-wrap { position: relative; flex-shrink: 0; }
        .dc-filter-btn { display: flex; align-items: center; gap: 6px; padding: 7px 12px; background: var(--theme-bg-less, #0d1520); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: var(--theme-fg, #cccccc); font-size: 12px; cursor: pointer; white-space: nowrap; transition: border-color 0.15s; }
        .dc-filter-btn:hover { border-color: #4caf50; }
        .dc-chevron { font-size: 9px; opacity: 0.6; }
        .dc-filter-menu { position: absolute; right: 0; top: calc(100% + 4px); background: var(--theme-bg-more, #1d2d3d); border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; min-width: 160px; z-index: 100; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.5); }
        .dc-filter-menu button { width: 100%; text-align: left; padding: 7px 14px; background: transparent; border: none; color: var(--theme-fg, #cccccc); font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; }
        .dc-filter-menu button:hover, .dc-filter-menu button.active { background: rgba(76,175,80,0.1); color: var(--theme-fg-more, #e8e8e8); }
        .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .dot-running { background: #4ade80; }
        .dot-exited { background: var(--theme-fg-less, rgba(204,204,204,0.5)); }
        .dot-paused { background: #fbbf24; }

        /* ── Loading bar ─────────────────────────────────────── */
        .dc-loading-bar { padding: 20px; display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--theme-fg-less, rgba(204,204,204,0.6)); font-size: 12px; flex-shrink: 0; }

        /* ── Empty state ─────────────────────────────────────── */
        .dc-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; gap: 14px; color: var(--theme-fg-less, rgba(204,204,204,0.5)); padding: 40px; }
        .dc-empty i { opacity: 0.4; }
        .dc-empty p { margin: 0; font-size: 13px; }

        /* ── Cards grid ──────────────────────────────────────── */
        .dc-grid { flex: 1; overflow-y: auto; padding: 16px; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; align-content: start; }
        .dc-card { background: var(--theme-bg-more, #1d2d3d); border: 1px solid rgba(76,175,80,0.18); border-radius: 8px; padding: 14px; display: flex; flex-direction: column; gap: 10px; transition: border-color 0.15s, box-shadow 0.15s; }
        .dc-card:hover { border-color: rgba(76,175,80,0.4); box-shadow: 0 2px 12px rgba(0,0,0,0.4); }
        .dc-card.state-running { border-color: rgba(76,175,80,0.28); }
        .dc-card.state-running:hover { border-color: rgba(76,175,80,0.5); }
        .dc-image-card { border-color: rgba(36,150,237,0.2); }
        .dc-image-card:hover { border-color: rgba(36,150,237,0.45); }

        /* Card header */
        .dc-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
        .dc-card-name { font-size: 14px; font-weight: 700; color: var(--theme-fg-more, #e8e8e8); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
        .dc-tag { color: #81c784; font-weight: 400; }

        /* State badges */
        .dc-state-badge { padding: 2px 9px; border-radius: 12px; font-size: 10px; font-weight: 600; text-transform: lowercase; white-space: nowrap; flex-shrink: 0; }
        .badge-running { background: rgba(34,197,94,0.18); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); }
        .badge-exited { background: rgba(255,255,255,0.06); color: var(--theme-fg-less, rgba(204,204,204,0.6)); border: 1px solid rgba(255,255,255,0.12); }
        .badge-paused { background: rgba(234,179,8,0.15); color: #fbbf24; border: 1px solid rgba(234,179,8,0.25); }
        .badge-restarting { background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); }

        /* Card fields */
        .dc-card-fields { display: flex; flex-direction: column; gap: 4px; }
        .dc-field { display: flex; align-items: baseline; gap: 6px; font-size: 11px; line-height: 1.5; min-width: 0; }
        .dc-field-label { color: rgba(76,175,80,0.7); font-weight: 600; min-width: 46px; flex-shrink: 0; }
        .dc-field-value { color: var(--theme-fg, #cccccc); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
        .dc-ports { white-space: normal; word-break: break-all; }
        .dc-mono { font-family: 'Menlo', 'Monaco', 'Consolas', monospace; font-size: 10.5px; color: #81c784; }

        /* Card actions */
        .dc-card-actions { display: flex; gap: 5px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.07); }
        .dc-act-btn { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; background: transparent; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: #81c784; cursor: pointer; font-size: 11px; transition: all 0.12s; flex-shrink: 0; }
        .dc-act-btn:hover:not([disabled]) { background: rgba(76,175,80,0.12); border-color: rgba(76,175,80,0.5); color: #c8e6c9; }
        .dc-act-btn[disabled] { opacity: 0.25; cursor: not-allowed; }
        .dc-act-danger { color: #f87171; border-color: rgba(248,113,113,0.2); }
        .dc-act-danger:hover:not([disabled]) { background: rgba(248,113,113,0.15) !important; border-color: rgba(248,113,113,0.45) !important; color: #fca5a5 !important; }

        /* ── Logs view ───────────────────────────────────────── */
        .dc-logs-toolbar { display: flex; align-items: center; gap: 10px; padding: 8px 16px; background: var(--theme-bg-more, #1d2d3d); border-bottom: 1px solid rgba(255,255,255,0.08); flex-shrink: 0; }
        .dc-back-btn { display: flex; align-items: center; gap: 6px; padding: 5px 10px; background: transparent; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: #81c784; cursor: pointer; font-size: 11px; white-space: nowrap; transition: all 0.12s; }
        .dc-back-btn:hover { background: rgba(76,175,80,0.1); border-color: #4caf50; }
        .dc-logs-title { font-size: 13px; font-weight: 600; color: var(--theme-fg-more, #e8e8e8); display: flex; align-items: center; gap: 6px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .flex-spacer { flex: 1; }
        .dc-icon-btn { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; background: transparent; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: var(--theme-fg-less, rgba(204,204,204,0.6)); cursor: pointer; font-size: 12px; flex-shrink: 0; transition: all 0.12s; }
        .dc-icon-btn:hover:not([disabled]) { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.25); color: var(--theme-fg-more, #e8e8e8); }
        .dc-icon-btn[disabled] { opacity: 0.35; cursor: not-allowed; }

        /* Controls bar — always single row */
        .dc-logs-controls { display: flex; align-items: center; gap: 8px; padding: 7px 16px; background: var(--theme-bg-more, #1d2d3d); border-bottom: 1px solid rgba(255,255,255,0.08); flex-shrink: 0; flex-wrap: nowrap; overflow-x: auto; min-height: 40px; }
        .dc-ctrl-label { font-size: 10px; font-weight: 600; color: var(--theme-fg-less, rgba(204,204,204,0.6)); text-transform: uppercase; letter-spacing: 0.3px; white-space: nowrap; flex-shrink: 0; }
        .dc-ctrl-divider { width: 1px; height: 18px; background: rgba(255,255,255,0.1); flex-shrink: 0; margin: 0 4px; }

        /* Select */
        .dc-select-wrap { position: relative; display: flex; align-items: center; }
        .dc-select { appearance: none; padding: 5px 26px 5px 10px; background: var(--theme-bg-less, #0d1520); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: var(--theme-fg, #cccccc); font-size: 12px; cursor: pointer; outline: none; }
        .dc-select:hover { border-color: rgba(255,255,255,0.25); }
        .dc-select-sm { padding: 5px 20px 5px 8px; font-size: 11px; }
        .dc-select-arrow { position: absolute; right: 7px; font-size: 9px; color: var(--theme-fg-less, rgba(204,204,204,0.5)); pointer-events: none; }

        /* Toggle */
        .dc-toggle { display: flex; align-items: center; gap: 8px; padding: 5px 10px; background: var(--theme-bg-less, #0d1520); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; cursor: pointer; transition: all 0.15s; }
        .dc-toggle.on { background: rgba(76,175,80,0.1); border-color: rgba(76,175,80,0.35); }
        .dc-toggle-thumb { width: 28px; height: 14px; background: rgba(255,255,255,0.15); border-radius: 7px; position: relative; flex-shrink: 0; transition: background 0.15s; }
        .dc-toggle.on .dc-toggle-thumb { background: #4caf50; }
        .dc-toggle-thumb::after { content: ''; position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; background: var(--theme-fg-less, rgba(204,204,204,0.6)); border-radius: 50%; transition: transform 0.15s; }
        .dc-toggle.on .dc-toggle-thumb::after { transform: translateX(14px); background: #fff; }
        .dc-toggle-label { font-size: 12px; color: var(--theme-fg-less, rgba(204,204,204,0.6)); white-space: nowrap; }
        .dc-toggle.on .dc-toggle-label { color: #81c784; }

        /* Filter bar */
        .dc-logs-filter-bar { display: flex; align-items: center; padding: 7px 16px; background: var(--theme-bg, #131d27); border-bottom: 1px solid rgba(255,255,255,0.07); flex-shrink: 0; }
        .dc-filter-icon { color: var(--theme-fg-less, rgba(204,204,204,0.5)); font-size: 11px; margin-right: 8px; flex-shrink: 0; }
        .dc-logs-filter-input { flex: 1; background: transparent; border: none; color: var(--theme-fg, #cccccc); font-size: 12px; outline: none; }
        .dc-logs-filter-input::placeholder { color: var(--theme-fg-less-2, rgba(204,204,204,0.4)); }

        .dc-logs { flex: 1; margin: 0; padding: 12px 16px; font-family: 'Menlo', 'Monaco', 'Consolas', monospace; font-size: 11px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; overflow-y: auto; color: var(--theme-fg, #cccccc); background: transparent; }

        /* ── Stats view ──────────────────────────────────────── */
        .dc-stats-error { padding: 30px 20px; display: flex; align-items: center; justify-content: center; gap: 8px; color: #f87171; font-size: 12px; }
        .dc-autorefresh-badge { display: flex; align-items: center; gap: 4px; font-size: 11px; opacity: 0.6; padding: 0 6px; white-space: nowrap; }
        .dc-pulse { font-size: 8px; color: var(--theme-green, #4ade80); animation: dc-pulse-anim 1.5s ease-in-out infinite; }
        @keyframes dc-pulse-anim { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.3; transform: scale(0.7); } }
        .dc-stats-grid { flex: 1; overflow-y: auto; padding: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-content: start; }
        .dc-stat-card { background: var(--theme-bg-more, #1d2d3d); border: 1px solid rgba(76,175,80,0.18); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
        .dc-stat-card-full { grid-column: 1 / -1; }
        .dc-stat-card-title { font-size: 12px; font-weight: 600; color: var(--theme-fg, #cccccc); display: flex; align-items: center; gap: 7px; }
        .dc-stat-icon-cpu { color: #60a5fa; }
        .dc-stat-icon-mem { color: #c084fc; }
        .dc-stat-icon-net { color: #34d399; }
        .dc-stat-icon-blk { color: #fb923c; }
        .dc-stat-icon-info { color: #81c784; }
        .dc-stat-row { display: flex; align-items: baseline; justify-content: space-between; font-size: 11px; gap: 8px; }
        .dc-stat-label { color: rgba(76,175,80,0.65); min-width: 60px; flex-shrink: 0; }
        .dc-stat-value { font-size: 12px; font-weight: 500; text-align: right; }
        .dc-stat-cpu { color: #93c5fd; }
        .dc-stat-mem { color: #d8b4fe; }
        .dc-stat-net-in { color: #4ade80; }
        .dc-stat-net-out { color: #34d399; }
        .dc-stat-blk-read { color: #fb923c; }
        .dc-stat-blk-write { color: #f97316; }
        .dc-stat-pids { color: #fbbf24; }
        .dc-progress-track { height: 3px; background: rgba(76,175,80,0.1); border-radius: 2px; overflow: hidden; margin-top: 2px; }
        .dc-progress-fill { height: 100%; border-radius: 2px; transition: width 0.4s ease; min-width: 2px; }
        .dc-progress-cpu { background: linear-gradient(90deg, #3b82f6, #60a5fa); }
        .dc-progress-mem { background: linear-gradient(90deg, #7c3aed, #c084fc); }
        .dc-stat-info-row { display: flex; align-items: baseline; gap: 16px; font-size: 11px; flex-wrap: wrap; }
        .dc-stat-info-row .dc-stat-label { color: rgba(76,175,80,0.65); }
        .dc-stat-info-row .dc-stat-value { color: var(--theme-fg, #cccccc); }
    `],
})
export class DockerConsoleTabComponent extends BaseTabComponent implements OnInit, OnDestroy {
    @ViewChild('logsEl') logsEl?: ElementRef<HTMLPreElement>

    /** SSH session from the parent SSH tab — passed via AppService.openNewTab inputs. */
    @Input() sshSession: any
    /** Optional host label shown in the tab title. */
    @Input() hostLabel = ''

    activeView: ActiveView = 'containers'
    loading = false
    errorMessage = ''
    busy: string | null = null
    dockerVersion = ''

    containers: DockerContainer[] = []
    images: DockerImage[] = []

    searchQuery = ''
    imageSearchQuery = ''
    filterState: FilterState = 'all'
    filterMenuOpen = false

    selectedContainer: DockerContainer | null = null
    containerLogs = ''
    logsLoading = false
    logsFilter = ''
    logsTail = 100
    logsTimestamps = false
    logsAutoRefresh = true
    logsRefreshInterval = 3
    private logsRefreshTimer: any = null

    containerStats: DockerStats | null = null
    statsLoading = false
    private statsRefreshTimer: any = null
    private statsRefreshing = false
    readonly statsRefreshIntervalMs = 5000

    constructor(
        private myInjector: Injector,
        private docker: RemoteDockerService,
        private notify: NotificationsService,
        private cdr: ChangeDetectorRef,
        private app: AppService,
    ) {
        // The devDependency typings declare `constructor()`, but the runtime
        // BaseTabComponent requires an Injector argument.  The mismatch is a
        // known packaging quirk of Tabby's plugin API — suppressed deliberately.
        // @ts-ignore
        super(myInjector)
    }

    ngOnInit (): void {
        this.setTitle(`Docker — ${this.hostLabel || 'console'}`)
        this.refresh()
        this.loadDockerVersion()
    }

    private async loadDockerVersion (): Promise<void> {
        try {
            this.dockerVersion = await this.docker.getDockerVersion(this.sshSession)
            this.cdr.markForCheck()
        } catch {
            // silently ignore
        }
    }

    setView (view: ActiveView): void {
        this.stopStatsRefresh()
        this.stopAutoRefresh()
        this.activeView = view
        this.filterMenuOpen = false
        if (view !== 'logs') {
            this.refresh()
        }
    }

    onSearch (): void {
        this.filterMenuOpen = false
    }

    toggleFilterMenu (): void {
        this.filterMenuOpen = !this.filterMenuOpen
    }

    setFilter (state: FilterState): void {
        this.filterState = state
        this.filterMenuOpen = false
        this.cdr.markForCheck()
    }

    filterLabel (): string {
        if (this.filterState === 'all') {
            return `All (${this.containers.length})`
        }
        return `${this.filterState.charAt(0).toUpperCase() + this.filterState.slice(1)} (${this.countByState(this.filterState)})`
    }

    countByState (state: string): number {
        return this.containers.filter(c => c.state.toLowerCase() === state).length
    }

    get filteredContainers (): DockerContainer[] {
        let list = this.containers
        if (this.filterState !== 'all') {
            list = list.filter(c => c.state.toLowerCase() === this.filterState)
        }
        const q = this.searchQuery.toLowerCase().trim()
        if (q) {
            list = list.filter(c =>
                this.displayName(c.names).toLowerCase().includes(q) ||
                c.image.toLowerCase().includes(q) ||
                c.id.toLowerCase().includes(q),
            )
        }
        return list
    }

    get filteredImages (): DockerImage[] {
        const q = this.imageSearchQuery.toLowerCase().trim()
        if (!q) {
            return this.images
        }
        return this.images.filter(img =>
            img.repository.toLowerCase().includes(q) ||
            img.tag.toLowerCase().includes(q) ||
            img.id.toLowerCase().includes(q),
        )
    }

    get filteredLogs (): string {
        if (!this.logsFilter.trim()) {
            return this.containerLogs || '(no output)'
        }
        const q = this.logsFilter.toLowerCase()
        return this.containerLogs
            .split('\n')
            .filter(line => line.toLowerCase().includes(q))
            .join('\n') || '(no matching lines)'
    }

    displayName (names: string): string {
        return (names || '').replace(/^\//, '').split(',')[0]
    }

    formatPorts (ports: string): string {
        if (!ports || ports === '' || ports === 'No ports') {
            return 'No ports'
        }
        return ports
            .split(',')
            .map(p => p.trim())
            .filter(Boolean)
            .join('\n')
    }

    /**
     * Parses a percentage string like "12.34%" into a clamped 0-100 number.
     * Used for progress bar widths.
     */
    parsePercent (value: string): number {
        const n = parseFloat((value ?? '0').replace('%', ''))
        return isNaN(n) ? 0 : Math.min(100, Math.max(0, n))
    }

    /**
     * Splits an I/O string like "484MB / 195MB" by "/" and returns the Nth part.
     */
    splitIO (value: string, index: number): string {
        if (!value) {
            return '—'
        }
        const parts = value.split('/').map(s => s.trim())
        return parts[index] ?? '—'
    }

    formatDate(raw: string): string {
        if (!raw) {
            return '—'
        }
        try {
            const d = new Date(raw)
            if (isNaN(d.getTime())) {
                return raw
            }
            return d.toLocaleString(undefined, {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit',
            })
        } catch {
            return raw
        }
    }

    async refresh (): Promise<void> {
        this.loading = true
        this.errorMessage = ''
        this.filterMenuOpen = false
        try {
            if (this.activeView === 'images') {
                this.images = await this.docker.listImages(this.sshSession)
            } else {
                this.containers = await this.docker.listContainers(this.sshSession)
            }
        } catch (e: any) {
            this.errorMessage = e?.message ?? String(e)
        } finally {
            this.loading = false
            this.cdr.markForCheck()
        }
    }

    async startContainer(c: DockerContainer): Promise<void> {
        this.busy = c.id
        try {
            await this.docker.startContainer(this.sshSession, c.id)
            await this.refresh()
        } catch (e: any) {
            this.notify.error(e?.message ?? String(e))
        } finally {
            this.busy = null
            this.cdr.markForCheck()
        }
    }

    async stopContainer(c: DockerContainer): Promise<void> {
        this.busy = c.id
        try {
            await this.docker.stopContainer(this.sshSession, c.id)
            await this.refresh()
        } catch (e: any) {
            this.notify.error(e?.message ?? String(e))
        } finally {
            this.busy = null
            this.cdr.markForCheck()
        }
    }

    async restartContainer(c: DockerContainer): Promise<void> {
        this.busy = c.id
        try {
            await this.docker.restartContainer(this.sshSession, c.id)
            await this.refresh()
        } catch (e: any) {
            this.notify.error(e?.message ?? String(e))
        } finally {
            this.busy = null
            this.cdr.markForCheck()
        }
    }

    async removeContainer(c: DockerContainer): Promise<void> {
        this.busy = c.id
        try {
            await this.docker.removeContainer(this.sshSession, c.id)
            await this.refresh()
        } catch (e: any) {
            this.notify.error(e?.message ?? String(e))
        } finally {
            this.busy = null
            this.cdr.markForCheck()
        }
    }

    async removeImage(img: DockerImage): Promise<void> {
        this.busy = img.id
        try {
            await this.docker.removeImage(this.sshSession, img.id)
            await this.refresh()
        } catch (e: any) {
            this.notify.error(e?.message ?? String(e))
        } finally {
            this.busy = null
            this.cdr.markForCheck()
        }
    }

    async viewLogs (c: DockerContainer): Promise<void> {
        this.stopAutoRefresh()
        this.selectedContainer = c
        this.activeView = 'logs'
        this.logsFilter = ''
        await this.reloadLogs()
        if (this.logsAutoRefresh) {
            this.startAutoRefresh()
        }
    }

    async reloadLogs (): Promise<void> {
        if (!this.selectedContainer || !this.sshSession) {
            return
        }
        if (this.logsLoading) {
            return
        }
        this.logsLoading = true
        // Keep old content visible while loading (no flicker)
        this.cdr.markForCheck()
        try {
            const tail = this.logsTail === 0 ? 99999 : this.logsTail
            const tsFlag = this.logsTimestamps ? '--timestamps' : ''
            this.containerLogs = await this.docker.getContainerLogs(
                this.sshSession,
                this.selectedContainer.id,
                tail,
                tsFlag,
            )
        } catch (e: any) {
            this.containerLogs = `Error: ${e?.message ?? e}`
        } finally {
            this.logsLoading = false
            this.cdr.markForCheck()
            // Scroll to bottom after content updates
            setTimeout(() => this.scrollLogsToBottom(), 30)
        }
    }

    private scrollLogsToBottom (): void {
        const el = this.logsEl?.nativeElement ?? document.querySelector('.dc-logs')
        if (el) {
            el.scrollTop = el.scrollHeight
        }
    }

    toggleTimestamps (): void {
        this.logsTimestamps = !this.logsTimestamps
        this.reloadLogs()
    }

    toggleAutoRefresh (): void {
        this.logsAutoRefresh = !this.logsAutoRefresh
        if (this.logsAutoRefresh) {
            this.startAutoRefresh()
        } else {
            this.stopAutoRefresh()
        }
        this.cdr.markForCheck()
    }

    restartAutoRefresh (): void {
        if (this.logsAutoRefresh) {
            this.stopAutoRefresh()
            this.startAutoRefresh()
        }
    }

    private startAutoRefresh (): void {
        this.stopAutoRefresh()
        this.logsRefreshTimer = setInterval(() => {
            if (this.activeView === 'logs' && !this.logsLoading) {
                this.reloadLogs()
            }
        }, this.logsRefreshInterval * 1000)
    }

    private stopAutoRefresh (): void {
        if (this.logsRefreshTimer !== null) {
            clearInterval(this.logsRefreshTimer)
            this.logsRefreshTimer = null
        }
    }

    downloadLogs (): void {
        if (!this.containerLogs || !this.selectedContainer) {
            return
        }
        const name = this.displayName(this.selectedContainer.names)
        const ts = new Date().toISOString().replace(/[:.]/g, '-')
        const filename = `${name}-${ts}.log`
        const blob = new Blob([this.containerLogs], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
    }

    async viewStats (c: DockerContainer): Promise<void> {
        this.stopStatsRefresh()
        // Clear stats only when switching to a DIFFERENT container to avoid flash.
        if (this.selectedContainer?.id !== c.id) {
            this.containerStats = null
        }
        this.selectedContainer = c
        this.activeView = 'stats'
        await this.reloadStats()
        this.startStatsRefresh()
    }

    async reloadStats (): Promise<void> {
        if (!this.selectedContainer || !this.sshSession) {
            return
        }
        // Guard: skip if a previous request is still in flight
        if (this.statsRefreshing) {
            return
        }
        this.statsRefreshing = true
        this.statsLoading = true
        this.cdr.markForCheck()
        try {
            const fresh = await this.docker.getContainerStats(this.sshSession, this.selectedContainer.id)
            if (this.containerStats && fresh) {
                // Patch values in-place: Angular updates only the changed text nodes,
                // the DOM structure (cards, progress bars) is never destroyed.
                Object.assign(this.containerStats, fresh)
            } else {
                this.containerStats = fresh
            }
        } catch (e: any) {
            this.notify.error(`Stats error: ${e?.message}`)
        } finally {
            this.statsLoading = false
            this.statsRefreshing = false
            // Single markForCheck at the end — never triggers *ngIf destruction mid-cycle.
            this.cdr.markForCheck()
        }
    }

    private startStatsRefresh (): void {
        this.stopStatsRefresh()
        this.statsRefreshTimer = setInterval(async () => {
            if (this.activeView === 'stats' && this.selectedContainer) {
                await this.reloadStats()
            }
        }, this.statsRefreshIntervalMs)
    }

    private stopStatsRefresh (): void {
        if (this.statsRefreshTimer !== null) {
            clearInterval(this.statsRefreshTimer)
            this.statsRefreshTimer = null
        }
    }

    backToContainers(): void {
        this.stopAutoRefresh()
        this.stopStatsRefresh()
        this.activeView = 'containers'
        this.selectedContainer = null
        this.cdr.markForCheck()
    }

    ngOnDestroy (): void {
        this.stopAutoRefresh()
        this.stopStatsRefresh()
    }

    async openExec (c: DockerContainer): Promise<void> {
        const sshSession = this.sshSession
        if (!sshSession?.ssh) {
            this.notify.error('SSH session not available')
            return
        }
        const profile = sshSession.profile
        if (!profile) {
            this.notify.error('SSH profile not available')
            return
        }
        try {
            // Detect the best available shell inside the container (prefer bash, fallback sh).
            let shell = 'sh'
            try {
                const r = await this.docker.execCommand(sshSession, `docker exec ${c.id} which bash 2>/dev/null`)
                if (r.trim()) { shell = 'bash' }
            } catch {}

            const containerName = this.displayName(c.names)
            const execCmd = `docker exec -it ${c.id} ${shell}`

            // ── Monkey-patch approach ────────────────────────────────────────────────
            // LoginScriptProcessor-based injection fails because ConfigProxy silently
            // drops the custom `scripts` field from profile.options.
            //
            // Instead, we temporarily replace sshSession.openShellChannel with a
            // version that opens a PTY exec channel running `docker exec -it <id> <shell>`
            // instead of a regular interactive shell.  The replacement restores itself
            // after the first invocation so no other tab is affected.
            //
            // When a new multiplexed SSH tab is opened (via openNewTabForProfile), its
            // SSHShellSession.start() calls `this.ssh.openShellChannel()` where
            // `this.ssh` IS our sshSession — so the patch is picked up transparently.
            // ────────────────────────────────────────────────────────────────────────
            const originalOpenShellChannel = sshSession.openShellChannel.bind(sshSession)

            sshSession.openShellChannel = async (_options: any) => {
                // Restore immediately so only this one tab is affected.
                sshSession.openShellChannel = originalOpenShellChannel

                const sshClient = sshSession.ssh
                const rawCh = await sshClient.openSessionChannel()
                const ch = await sshClient.activateChannel(rawCh)
                await ch.requestPTY('xterm-256color', {
                    columns: 80,
                    rows: 24,
                    pixHeight: 0,
                    pixWidth: 0,
                })
                await ch.requestExec(execCmd)
                return ch
            }

            const { ProfilesService } = await import('tabby-core') as any
            const profiles: any = this.myInjector.get(ProfilesService)
            const execProfile = { ...profile, name: `${profile.name ?? ''} → ${containerName}` }

            try {
                await profiles.openNewTabForProfile(execProfile)
            } catch (e: any) {
                // Restore original on error so the SSH session is not broken.
                sshSession.openShellChannel = originalOpenShellChannel
                throw e
            }
        } catch (e: any) {
            this.notify.error(`Could not open exec tab: ${e?.message}`)
        }
    }
}
