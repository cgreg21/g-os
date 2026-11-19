import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import {CleanupManager} from '../core/cleanupManager.js';

export function withDockActivity(Base) {
    return class extends Base {
        _watchNotificationSource(source) {
            if (!this._notificationSources.has(source)) {
                const cleanup = new CleanupManager();
                for (const signal of ['notify::count', 'notify::unseen-count'])
                    cleanup.addSignal(source, source.connect(signal, () => this._updateNotificationCounts()));
                this._notificationSources.set(source, cleanup);
            }
            this._updateNotificationCounts();
        }

        _startLauncherTracking() {
            this._dbusSubscriptions = [
                Gio.DBus.session.signal_subscribe(null, 'com.canonical.Unity.LauncherEntry',
                    'Update', null, null, Gio.DBusSignalFlags.NONE,
                    (connection, sender, path, iface, signal, parameters) => this._onLauncherUpdate(sender, parameters)),
                Gio.DBus.session.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
                    'NameOwnerChanged', '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
                    (connection, sender, path, iface, signal, parameters) => {
                        const [name, previous, current] = parameters.deep_unpack() as string[];
                        if (name.startsWith(':') && previous && !current && this._launcherEntries.delete(name))
                            this._queueTransferIndicatorUpdate();
                    }),
            ];
            this._unityOwner = Gio.bus_own_name_on_connection(Gio.DBus.session,
                'com.canonical.Unity', Gio.BusNameOwnerFlags.NONE, null, null);
        }

        _onLauncherUpdate(sender, parameters) {
            if (parameters.get_type_string() !== '(sa{sv})')
                return;
            const [appUri, properties] = parameters.deep_unpack();
            let appId;
            try {
                const uri = GLib.Uri.parse(appUri, GLib.UriFlags.NONE);
                if (uri.get_scheme() !== 'application')
                    return;
                appId = uri.get_host();
            } catch {
                return;
            }
            if (!appId?.endsWith('.desktop'))
                return;
            const progress = properties.progress?.unpack();
            const visible = properties['progress-visible']?.unpack();
            if (typeof visible !== 'boolean' && !(typeof progress === 'number' && Number.isFinite(progress)))
                return;
            let entries = this._launcherEntries.get(sender);
            if (!entries) {
                entries = new Map();
                this._launcherEntries.set(sender, entries);
            }
            const entry = entries.get(appId) ?? {progress: 0, visible: false};
            const previousProgress = entry.progress;
            const previousVisible = entry.visible;
            if (typeof progress === 'number' && Number.isFinite(progress))
                entry.progress = Math.max(0, Math.min(1, progress));
            if (typeof visible === 'boolean')
                entry.visible = visible;
            if (entry.progress === previousProgress && entry.visible === previousVisible)
                return;
            entry.revision = ++this._activityRevision;
            entries.set(appId, entry);
            if (entry.visible || previousVisible)
                this._queueTransferIndicatorUpdate();
        }

        _queueTransferIndicatorUpdate() {
            if (this._transferIndicatorSource)
                return;
            this._transferIndicatorSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._transferIndicatorSource = 0;
                if (this._settings)
                    this._updateTransferIndicators();
                return GLib.SOURCE_REMOVE;
            });
        }

        _updateTransferIndicators() {
            if (this._transferIndicatorSource) {
                GLib.source_remove(this._transferIndicatorSource);
                this._transferIndicatorSource = 0;
            }
            const active = new Map();
            for (const entries of this._launcherEntries.values()) {
                for (const [appId, entry] of entries) {
                    if (entry.visible && (!active.has(appId) || entry.revision > active.get(appId).revision))
                        active.set(appId, entry);
                }
            }
            this._activeTransfers = active;
            const totalText = active.size === 1
                ? `${Math.round(active.values().next().value.progress * 100)} %`
                : `${active.size} applis`;
            const totalAccessibleName = `${active.size} applications signalent une progression`;
            for (const label of [this._transferLabel, ...this._screens.map(screen => screen.transferLabel)]) {
                if (!label)
                    continue;
                if (label.text !== totalText)
                    label.text = totalText;
                const visible = active.size > 0;
                if (label.visible !== visible)
                    label.visible = visible;
                if (label.accessible_name !== totalAccessibleName)
                    label.accessible_name = totalAccessibleName;
            }
            for (const screen of this._screens) {
                for (const button of screen.appButtons ?? []) {
                    const entry = active.get(button.app.get_id());
                    const visible = Boolean(entry);
                    const progress = entry?.progress ?? 0;
                    const accessibleName = entry
                        ? `Progression : ${Math.round(entry.progress * 100)} pour cent` : '';
                    let changed = false;
                    if (button.progressBar.visible !== visible) {
                        button.progressBar.visible = visible;
                        changed = true;
                        if (visible)
                            this._positionTransferProgress(button);
                    }
                    if (button.progressFill.scale_x !== progress) {
                        button.progressFill.scale_x = progress;
                        changed = true;
                    }
                    if (button.progressBar.accessible_name !== accessibleName) {
                        button.progressBar.accessible_name = accessibleName;
                        changed = true;
                    }
                    if (changed) {
                        const appAccessibleName = this._appDescription(button.app, screen);
                        if (button.accessible_name !== appAccessibleName)
                            button.accessible_name = appAccessibleName;
                        if (button.hover || button.has_key_focus())
                            button.updateDockTooltip?.();
                    }
                }
            }
        }

        _unwatchNotificationSource(source) {
            const cleanup = this._notificationSources.get(source);
            if (cleanup) {
                this._notificationSources.delete(source);
                cleanup.clear();
            }
        }

        _updateNotificationCounts(appsNeedingAttention = null) {
            const counts = new Map();
            const attentionApps = appsNeedingAttention ?? this._attentionApps ??
                new Set([...this._attentionWindows.values()].map(entry => entry.app));
            const descriptions = new Map();
            for (const source of this._notificationSources.keys()) {
                const count = source.count;
                const appId = source.app?.get_id() ?? source.policy?.id;
                if (appId && appId !== 'generic') {
                    const id = appId.endsWith('.desktop') ? appId : `${appId}.desktop`;
                    counts.set(id, (counts.get(id) ?? 0) + count);
                }
            }
            for (const screen of this._screens) {
                for (const button of screen.appButtons ?? []) {
                    const count = counts.get(button.app.get_id()) ?? 0;
                    const badgeText = count > 99 ? '99+' : String(count);
                    if (button.notificationBadge.text !== badgeText)
                        button.notificationBadge.text = badgeText;
                    const badgeVisible = count > 0;
                    if (button.notificationBadge.visible !== badgeVisible)
                        button.notificationBadge.visible = badgeVisible;
                    if (!descriptions.has(button.app))
                        descriptions.set(button.app, this._appDescription(button.app, screen, attentionApps));
                    const appDescription = descriptions.get(button.app);
                    const accessibleName = count > 0
                        ? `${appDescription}, ${count} notifications`
                        : appDescription;
                    if (button.accessible_name !== accessibleName)
                        button.accessible_name = accessibleName;
                }
            }
            this._updatePanelNotifications?.();
        }

        _syncWorkspaceSignals(workspace) {
            if (this._observedWorkspace === workspace)
                return;
            this._workspaceCleanup?.clear();
            this._workspaceCleanup = null;
            this._observedWorkspace = workspace;
            if (workspace) {
                const cleanup = new CleanupManager();
                for (const signal of ['window-added', 'window-removed'])
                    cleanup.addSignal(workspace, workspace.connect(signal, () => this._queueDockRebuild()));
                this._workspaceCleanup = cleanup;
            }
        }

        _syncRunningAppSignals(apps) {
            const active = new Set(apps);
            for (const [app, cleanup] of this._runningAppSignals) {
                if (!active.has(app)) {
                    this._runningAppSignals.delete(app);
                    cleanup.clear();
                }
            }
            for (const app of apps) {
                if (!this._runningAppSignals.has(app)) {
                    const cleanup = new CleanupManager();
                    cleanup.addSignal(app, app.connect('windows-changed', () => this._queueDockRebuild()));
                    this._runningAppSignals.set(app, cleanup);
                }
            }
        }

        _trackAttentionWindow(window) {
            if (!window || window.skip_taskbar || window.has_focus() ||
                (!window.demands_attention && !window.urgent))
                return;
            const app = Shell.WindowTracker.get_default().get_window_app(window);
            if (!app)
                return;
            if (!this._attentionWindows.has(window)) {
                const sync = () => {
                    if (window.has_focus() || (!window.demands_attention && !window.urgent))
                        this._forgetAttentionWindow(window);
                };
                const cleanup = new CleanupManager();
                cleanup.addSignal(window, window.connect('notify::demands-attention', sync));
                cleanup.addSignal(window, window.connect('notify::urgent', sync));
                cleanup.addSignal(window, window.connect('focus', () => this._forgetAttentionWindow(window)));
                cleanup.addSignal(window, window.connect('unmanaged', () => this._forgetAttentionWindow(window)));
                this._attentionWindows.set(window, {app, cleanup});
            }
            this._updateAttentionIndicators();
        }

        _forgetAttentionWindow(window) {
            const entry = this._attentionWindows.get(window);
            if (!entry)
                return;
            this._attentionWindows.delete(window);
            entry.cleanup.clear();
            this._updateAttentionIndicators();
        }

        _appNeedsAttention(app) {
            return this._attentionApps?.has(app) ??
                [...this._attentionWindows.values()].some(entry => entry.app === app);
        }

        _updateAttentionIndicators() {
            const appsNeedingAttention = new Set([...this._attentionWindows.values()].map(entry => entry.app));
            this._attentionApps = appsNeedingAttention;
            for (const screen of this._screens) {
                for (const button of screen.appButtons ?? []) {
                    const needsAttention = appsNeedingAttention.has(button.app);
                    if (button._dockNeedsAttention === needsAttention)
                        continue;
                    button._dockNeedsAttention = needsAttention;
                    if (needsAttention)
                        button.add_style_pseudo_class('needs-attention');
                    else
                        button.remove_style_pseudo_class('needs-attention');
                }
            }
            this._updateNotificationCounts(appsNeedingAttention);
        }

        _windowsForDock(app, screen) {
            const workspace = this._settings.get_boolean('dock-current-workspace')
                ? global.workspace_manager.get_active_workspace() : null;
            return app.get_windows().filter(window => !window.skip_taskbar &&
                (!workspace || window.located_on_workspace(workspace)));
        }

        _appDescription(app, screen, appsNeedingAttention = null) {
            const states = [];
            if (app.state === Shell.AppState.STARTING)
                states.push('démarrage en cours');
            if (appsNeedingAttention ? appsNeedingAttention.has(app) : this._appNeedsAttention(app))
                states.push('demande votre attention');
            if (screen) {
                const count = this._windowsForDock(app, screen).length;
                if (count > 1)
                    states.push(`${count} fenêtres`);
            }
            const transfer = this._activeTransfers.get(app.get_id());
            if (transfer)
                states.push(`progression ${Math.round(transfer.progress * 100)} %`);
            return states.length ? `${app.get_name()} : ${states.join(', ')}` : app.get_name();
        }

        _queueDockRebuild() {
            if (this._dockRebuildSource)
                return;
            this._dockRebuildSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._dockRebuildSource = 0;
                this._rebuildDock();
                return GLib.SOURCE_REMOVE;
            });
        }

        _finishDockMenu(screen) {
            if (screen.rebuildPending && !screen.disposed)
                this._queueDockRebuild();
        }

        _captureDockFocus() {
            const actor = global.stage.get_key_focus();
            if (!actor)
                return null;
            for (const screen of this._screens) {
                if (!screen.dock?.contains(actor))
                    continue;
                const buttons = screen.dock.get_children().filter(button => button.dockFocusKey);
                const index = buttons.findIndex(button => button === actor || button.contains(actor));
                if (index >= 0)
                    return {actor, monitor: screen.monitor.index, key: buttons[index].dockFocusKey, index};
            }
            return null;
        }

        _restoreDockFocus(focus) {
            if (!focus)
                return;
            const screen = this._screens.find(candidate => candidate.monitor.index === focus.monitor && candidate.dock);
            if (!screen || screen.disposed || screen.monitor.inFullscreen)
                return;
            const current = global.stage.get_key_focus();
            if (current && current !== focus.actor && !screen.dockContainer.contains(current))
                return;
            const buttons = screen.dock.get_children().filter(button => button.dockFocusKey);
            const target = buttons.find(button => button.dockFocusKey === focus.key) ??
                buttons[Math.min(focus.index, buttons.length - 1)];
            if (target) {
                this._revealDock(screen);
                target.grab_key_focus();
            }
        }

        _handleAppStateChanged(app) {
            if (!app || app.state === Shell.AppState.STOPPED || !this._favorites.isFavorite(app.get_id())) {
                this._queueDockRebuild();
                return;
            }
            const buttons = this._screens.flatMap(screen => (screen.appButtons ?? [])
                .filter(button => button.app === app).map(button => [screen, button]));
            if (buttons.length === 0) {
                this._queueDockRebuild();
                return;
            }
            const starting = app.state === Shell.AppState.STARTING;
            for (const [screen, button] of buttons) {
                if (starting)
                    button.add_style_pseudo_class('starting');
                else
                    button.remove_style_pseudo_class('starting');
                button.accessible_name = this._appDescription(app, screen);
                if (button.hover || button.has_key_focus())
                    button.updateDockTooltip?.();
            }
            this._updateNotificationCounts();
        }

    };
}
