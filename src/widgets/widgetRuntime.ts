import {WidgetRegistry, effectiveWidgetInstances, readWidgetInstances, readWidgetState, writeWidgetState, widgetAssetPath, widgetConfiguration, widgetGridPlacement, widgetMinimumSize, widgetMonitorId} from './widgetRegistry.js';
import {formatDuration, formatBytes, parseSystemStats} from './widgetUtilities.js';
import {errorMessage} from '../shared/errorMessage.js';
import {createSimpleWidget} from './simpleWidget.js';
import {FluxSession, createFluxWidget} from './fluxWidget.js';
import {registerShadowDragSource} from '../shared/interaction/shadowDragSource.js';

function widgetColor(value, strength = 1) {
    const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})([\da-f]{2})?$/i.exec(value ?? '');
    const channels = match ? match.slice(1, 4).map(channel => Number.parseInt(channel, 16)) : [57, 120, 200];
    const alpha = (match?.[4] ? Number.parseInt(match[4], 16) / 255 : 1) * Math.max(0, Math.min(1, strength));
    return `rgba(${channels.join(', ')}, ${alpha.toFixed(3)})`;
}

export class WidgetRuntime {
    [key: string]: any;
    fitDockContent(body, width, height, x, y) {
        let source = 0;
        let disposed = false;
        const fit = () => {
            if (disposed)
                return;
            body.scale_x = 1;
            body.scale_y = 1;
            body.set_size(-1, -1);
            const [minimumWidth] = body.get_preferred_width(-1);
            const referenceWidth = Math.max(width * 40 / height, minimumWidth);
            body.set_size(referenceWidth, -1);
            const [, naturalHeight] = body.get_preferred_height(referenceWidth);
            const scale = Math.min(1, height / Math.max(40, naturalHeight), width / Math.max(1, minimumWidth));
            const logicalWidth = width / scale;
            const logicalHeight = height / scale;
            body.set_size(logicalWidth, logicalHeight);
            body.scale_x = scale;
            body.scale_y = scale;
            body.set_position(x + (width - logicalWidth) / 2, y + (height - logicalHeight) / 2);
        };
        const queueFit = () => {
            if (!source && !disposed)
                source = this.env.GLib.idle_add(this.env.GLib.PRIORITY_DEFAULT_IDLE, () => {
                    source = 0;
                    fit();
                    return this.env.GLib.SOURCE_REMOVE;
                });
        };
        body.connect('style-changed', queueFit);
        body.connect('notify::mapped', () => body.mapped && fit());
        body.connect('destroy', () => {
            disposed = true;
            if (source)
                this.env.GLib.source_remove(source);
            source = 0;
        });
        queueFit();
    }

    constructor(host, environment, catalog, builtins) {
        this.host = host;
        this.env = environment;
        this.catalog = catalog;
        this.builtins = builtins;
        this.registry = new WidgetRegistry();
        this.desktop = new Map();
        this.grids = [];
        this.styles = new Map();
        this.errors = {};
        this.generation = 0;
        this.dropTargets = [];
        this.fluxSessions = new Map();
        for (const actor of [environment.Main.layoutManager._backgroundGroup, environment.Main.uiGroup].filter(Boolean)) {
            const previous = actor._delegate;
            const delegate = Object.create(previous ?? null);
            delegate.handleDragOver = (source, ...args) => source?.widgetDesktopPlacement
                ? environment.DND.DragMotionResult.MOVE_DROP
                : previous?.handleDragOver?.(source, ...args) ?? environment.DND.DragMotionResult.CONTINUE;
            delegate.acceptDrop = (source, ...args) => source?.widgetDesktopPlacement
                ? true : previous?.acceptDrop?.(source, ...args) ?? false;
            actor._delegate = delegate;
            this.dropTargets.push({actor, previous, delegate});
        }
        this.reloadCatalog();
    }

    get instances() {
        const grid = this.host._settings.get_int('widget-grid-size');
        return effectiveWidgetInstances(this.host._settings, this.env.Main.layoutManager.monitors)
            .map(instance => widgetMinimumSize(instance, this.registry.entries.get(instance.widget)?.description, grid));
    }

    report(id, error) {
        this.errors[id] = error.message ?? String(error);
        const value = JSON.stringify(this.errors);
        if (this.host._settings?.get_string('widget-errors') !== value &&
            this.host._settings?.is_writable('widget-errors'))
            this.host._settings.set_string('widget-errors', value);
    }

    reloadCatalog() {
        const generation = ++this.generation;
        this.registry = new WidgetRegistry();
        this.errors = {};
        if (this.host._settings.is_writable('widget-errors'))
            this.host._settings.set_string('widget-errors', '{}');
        const {entries, errors} = this.catalog(this.host.dir);
        const liveStyles = new Set(entries.filter(entry => entry.directory && entry.description.css)
            .map(entry => entry.directory.resolve_relative_path(entry.description.css).get_uri()));
        if (this.styles.size > 0) {
            const theme = this.env.St.ThemeContext.get_for_stage(this.env.stage).get_theme();
            for (const [uri, file] of this.styles) {
                if (!liveStyles.has(uri)) {
                    theme.unload_stylesheet(file);
                    this.styles.delete(uri);
                }
            }
        }
        for (const error of errors)
            this.report(error.id, error.message);
        for (const entry of entries) {
            const {description, directory, builtin} = entry;
            if (description.language === 'simple') {
                this.registry.register(description, context => createSimpleWidget(description, context), directory);
            } else if (description.language === 'flux') {
                this.registry.register(description, context => {
                    let shared = this.fluxSessions.get(context.instance.id);
                    if (!shared || shared.program !== description.fluxProgram) {
                        shared = {program: description.fluxProgram,
                            session: new FluxSession(description.fluxProgram, this.env), references: 0};
                        this.fluxSessions.set(context.instance.id, shared);
                    }
                    shared.references++;
                    try {
                        const view = createFluxWidget(description, context, shared.session);
                        const release = view.destroy;
                        view.destroy = () => {
                            release();
                            if (--shared.references === 0) {
                                shared.session.destroy();
                                if (this.fluxSessions.get(context.instance.id) === shared)
                                    this.fluxSessions.delete(context.instance.id);
                            }
                        };
                        shared.session.start();
                        return view;
                    } catch (error) {
                        if (--shared.references === 0) {
                            shared.session.destroy();
                            if (this.fluxSessions.get(context.instance.id) === shared)
                                this.fluxSessions.delete(context.instance.id);
                        }
                        throw error;
                    }
                }, directory);
            } else if (builtin && this.builtins[description.id]) {
                this.registry.register(description, this.builtins[description.id], directory);
            } else {
                this.registry.register(description, () => { throw new Error('Chargement du widget'); }, directory);
                import(directory.get_child(description.entry).get_uri()).then(module => {
                    if (generation !== this.generation || !this.host._settings)
                        return;
                    if (typeof module.create !== 'function')
                        throw new Error('widget.js doit exporter create(context)');
                    this.registry.entries.get(description.id).create = module.create;
                    delete this.errors[description.id];
                    this.host._applySettings();
                }).catch(error => {
                    if (generation === this.generation && this.host._settings)
                        this.report(description.id, error);
                });
            }
        }
    }

    publishMonitors() {
        const {Main} = this.env;
        const monitors = Main.layoutManager.monitors.map(monitor => {
            const area = Main.layoutManager.getWorkAreaForMonitor?.(monitor.index) ?? monitor;
            return {
                id: widgetMonitorId(monitor), index: monitor.index, width: monitor.width, height: monitor.height,
                name: monitor.connector || `Ecran ${monitor.index + 1}`, x: monitor.x, y: monitor.y,
                workArea: {x: area.x, y: area.y, width: area.width, height: area.height},
            };
        });
        const value = JSON.stringify(monitors);
        if (this.host._settings.is_writable('widget-monitors') && this.host._settings.get_string('widget-monitors') !== value)
            this.host._settings.set_string('widget-monitors', value);
    }

    areaSignature() {
        const layout = this.env.Main.layoutManager;
        return layout.monitors.map(monitor => {
            const area = layout.getWorkAreaForMonitor?.(monitor.index) ?? monitor;
            return `${widgetMonitorId(monitor)}:${area.x},${area.y},${area.width},${area.height}`;
        }).join(';');
    }

    syncWorkAreas() {
        const signature = this.areaSignature();
        if (signature === this.workAreaSignature)
            return;
        this.publishMonitors();
        this.syncDesktop();
    }

    loadStyle(entry) {
        if (!entry.directory || !entry.description.css)
            return;
        const file = entry.directory.resolve_relative_path(widgetAssetPath(entry.description.css));
        const uri = file.get_uri();
        if (this.styles.has(uri))
            return;
        this.env.St.ThemeContext.get_for_stage(this.env.stage).get_theme().load_stylesheet(file);
        this.styles.set(uri, file);
    }

    context(instance, monitor, extra, cleanup) {
        const {St, Gio, GLib, Clutter} = this.env;
        const host = this.host;
        const entry = this.registry.entries.get(instance.widget);
        const config = widgetConfiguration(entry.description, instance.config);
        const appearance = config['background-style'];
        let disposed = false;
        const registerCleanup = callback => {
            if (!disposed) {
                cleanup.push(callback);
                return;
            }
            try { callback(); } catch (error) { this.report(instance.id, error); }
        };
        const guarded = callback => (...args) => {
            if (disposed)
                return;
            try { return callback(...args); } catch (error) { this.report(instance.id, error); }
        };
        const pending = new Set<() => void>();
        registerCleanup(() => {
            for (const cancel of pending)
                cancel();
            pending.clear();
        });
        let tooltipScreen = extra.screen;
        const attachTooltip = (button, title) => {
            if (!tooltipScreen) {
                const tooltip = new St.Label({style_class: 'dash-label g-os-dock-tooltip', visible: false});
                this.env.Main.layoutManager.addTopChrome(tooltip);
                tooltipScreen = {position: 0, monitor, tooltip};
                registerCleanup(() => tooltip.destroy());
            }
            host._attachTooltip(tooltipScreen, button, title, {magnify: false, scroll: false});
        };
        const readText = (path: string): Promise<string> => new Promise((resolve, reject) => {
            if (disposed) {
                reject(new Error('Widget detruit'));
                return;
            }
            const file = Gio.File.new_for_path(path);
            const cancellable = new Gio.Cancellable();
            const cancel = () => cancellable.cancel();
            pending.add(cancel);
            file.load_contents_async(cancellable, (source, result) => {
                try { resolve(new TextDecoder().decode(source.load_contents_finish(result)[1])); } catch (error) { reject(error); }
                finally { pending.delete(cancel); }
            });
        });
        const api = {
            version: 1,
            box: properties => {
                const {vertical, ...layoutProperties} = properties;
                return new St.BoxLayout({...layoutProperties,
                    ...(vertical === undefined ? {} : {orientation: vertical
                        ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL})});
            },
            list: () => {
                const content = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'g-os-utility-body'});
                const actor = new St.ScrollView({child: content, clip_to_allocation: true, x_expand: true, y_expand: true,
                    hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC});
                return {actor, content};
            },
            label: (text, properties = {}) => {
                const label = new St.Label({text, ...properties});
                label.clutter_text.ellipsize = this.env.Pango.EllipsizeMode.END;
                return label;
            },
            icon: (name, size = 24) => new St.Icon({icon_name: name, icon_size: size}),
            sparkline: (width = 192, height = 48) => {
                let values = [];
                const actor = new St.DrawingArea({style_class: 'g-os-widget-sparkline', reactive: false, width, height});
                actor.connect('repaint', area => {
                    const context = area.get_context();
                    const [surfaceWidth, surfaceHeight] = area.get_surface_size();
                    if (values.length > 0 && surfaceWidth > 0 && surfaceHeight > 0) {
                        const points = values.map((value, index) => [
                            values.length === 1 ? 0 : index * surfaceWidth / (values.length - 1),
                            surfaceHeight - Math.max(0, Math.min(100, value)) / 100 * (surfaceHeight - 4) - 2,
                        ]);
                        context.moveTo(points[0][0], surfaceHeight);
                        for (const [x, y] of points)
                            context.lineTo(x, y);
                        if (values.length === 1)
                            context.lineTo(surfaceWidth, points[0][1]);
                        context.lineTo(values.length === 1 ? surfaceWidth : points.at(-1)[0], surfaceHeight);
                        context.setSourceRGBA(0.24, 0.63, 0.46, 0.14);
                        context.closePath();
                        context.fill();
                        context.moveTo(points[0][0], points[0][1]);
                        for (const [x, y] of points.slice(1))
                            context.lineTo(x, y);
                        if (values.length === 1)
                            context.lineTo(surfaceWidth, points[0][1]);
                        context.setSourceRGBA(0.20, 0.60, 0.43, 0.95);
                        context.setLineWidth(2.5);
                        context.stroke();
                    }
                    context.$dispose();
                });
                return {actor, setValues: samples => {
                    values = samples.slice(-32);
                    actor.queue_repaint();
                }};
            },
            progressRing: (size = 104) => {
                let value = 0;
                const drawing = new St.DrawingArea({style_class: 'g-os-widget-ring-drawing', reactive: false,
                    width: size, height: size});
                drawing.connect('repaint', area => {
                    const context = area.get_context();
                    const [width, height] = area.get_surface_size();
                    const radius = Math.max(1, Math.min(width, height) * 0.38);
                    const start = -Math.PI / 2;
                    context.setLineWidth(Math.max(5, Math.min(width, height) * 0.1));
                    context.setSourceRGBA(0.48, 0.55, 0.64, 0.2);
                    context.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
                    context.stroke();
                    if (value > 0) {
                        context.setSourceRGBA(0.20, 0.54, 0.95, 0.95);
                        context.arc(width / 2, height / 2, radius, start, start + Math.PI * 2 * value / 100);
                        context.stroke();
                    }
                    context.$dispose();
                });
                const label = new St.Label({text: '0%', style_class: 'g-os-widget-ring-label'});
                const actor = new St.Widget({layout_manager: new Clutter.BinLayout(), style_class: 'g-os-widget-progress-ring',
                    width: size, height: size});
                actor.add_child(drawing);
                actor.add_child(label);
                return {actor, label, setValue: next => {
                    value = Math.max(0, Math.min(100, Number(next) || 0));
                    label.text = `${Math.round(value)}%`;
                    drawing.queue_repaint();
                }};
            },
            button: (icon, title, callback) => {
                const accessibleTitle = typeof title === 'function' ? title() : title;
                const button = new St.Button({style_class: 'g-os-widget-button', can_focus: true,
                    reactive: true, track_hover: true, accessible_name: accessibleTitle,
                    child: new St.Icon({icon_name: icon, icon_size: 16})});
                button.connect('clicked', guarded(callback));
                attachTooltip(button, title);
                return button;
            },
            entry: (hint, text = '', {multiline = false, ...properties} = {}) => {
                const entry = new St.Entry({hint_text: hint, text, style_class: 'g-os-widget-entry',
                    can_focus: true, reactive: true, ...properties});
                entry.clutter_text.set_single_line_mode(!multiline);
                entry.clutter_text.line_wrap = multiline;
                if (multiline)
                    entry.clutter_text.line_wrap_mode = this.env.Pango.WrapMode.WORD_CHAR;
                return entry;
            },
            card: (title, icon = 'applications-utilities-symbolic') => {
                const actor = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: instance.target === 'desktop'
                    ? `g-os-desktop-widget g-os-utility-widget ${instance.widget}-widget` : `g-os-utility-widget g-os-utility-dock ${instance.widget}-widget`});
                const header = new St.BoxLayout({style_class: 'g-os-utility-header'});
                header.add_child(new St.Icon({icon_name: icon, icon_size: 16}));
                const name = new St.Label({text: title, style_class: 'g-os-utility-title'});
                name.clutter_text.ellipsize = this.env.Pango.EllipsizeMode.END;
                header.add_child(name);
                header.visible = instance.target === 'desktop';
                actor.add_child(header);
                const body = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'g-os-utility-body', x_expand: true});
                actor.add_child(body);
                return {actor, body, dragHandle: header};
            },
            formatDuration,
            formatBytes,
            wallTime: () => Date.now(),
            notify: (title, message = '') => !disposed && this.env.Main.notify?.(title, message),
            homeDirectory: () => GLib.get_home_dir(),
            systemStats: async () => {
                const values = await Promise.all(['/proc/stat', '/proc/meminfo', '/proc/uptime', '/proc/loadavg'].map(readText));
                return parseSystemStats(values[0], values[1], values[2], values[3]);
            },
            diskStats: path => new Promise((resolve, reject) => {
                if (disposed) {
                    reject(new Error('Widget detruit'));
                    return;
                }
                const expanded = path === '~' ? GLib.get_home_dir() : path.startsWith('~/')
                    ? GLib.build_filenamev([GLib.get_home_dir(), path.slice(2)]) : path;
                const file = Gio.File.new_for_path(expanded);
                const cancellable = new Gio.Cancellable();
                const cancel = () => cancellable.cancel();
                pending.add(cancel);
                file.query_filesystem_info_async('filesystem::size,filesystem::free', GLib.PRIORITY_DEFAULT, cancellable,
                    (source, result) => {
                        try {
                            const info = source.query_filesystem_info_finish(result);
                            resolve({total: info.get_attribute_uint64('filesystem::size'), free: info.get_attribute_uint64('filesystem::free')});
                        } catch (error) { reject(error); }
                        finally { pending.delete(cancel); }
                    });
            }),
            solve: expression => new Promise((resolve, reject) => {
                if (disposed) {
                    reject(new Error('Widget detruit'));
                    return;
                }
                if (!expression.trim() || expression.length > 512) {
                    reject(new Error('Expression vide ou trop longue'));
                    return;
                }
                let process;
                try {
                    process = Gio.Subprocess.new(['gnome-calculator', '--solve', expression],
                        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
                } catch (error) { reject(error); return; }
                const cancellable = new Gio.Cancellable();
                const cancel = () => { cancellable.cancel(); process.force_exit(); };
                pending.add(cancel);
                process.communicate_utf8_async(null, cancellable, (source, result) => {
                    try {
                        const [, output, error] = source.communicate_utf8_finish(result);
                        if (!source.get_successful())
                            throw new Error(error.trim() || 'Calcul impossible');
                        resolve(output.trim());
                    } catch (error) { reject(error); }
                    finally { pending.delete(cancel); }
                });
            }),
            asset: path => entry.directory.resolve_relative_path(widgetAssetPath(path)).get_uri(),
            fileIcon: path => new Gio.FileIcon({file: Gio.File.new_for_uri(path)}),
            now: () => GLib.DateTime.new_now_local(),
            clockText: () => host._wallClock.clock,
            clockTimeText: () => {
                this.timeClock ??= new this.env.GnomeDesktop.WallClock({time_only: true});
                return this.timeClock.clock;
            },
            watchClock: callback => {
                const clock = host._wallClock;
                const id = clock.connect('notify::clock', guarded(callback));
                registerCleanup(() => clock.disconnect(id));
            },
            onCleanup: callback => registerCleanup(callback),
            connect: (object, signal, callback) => {
                const id = object.connect(signal, guarded(callback));
                registerCleanup(() => object.disconnect(id));
                return id;
            },
            every: (milliseconds, callback) => {
                const onTick = guarded(callback);
                let active = true;
                const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(100, milliseconds), () => {
                    if (disposed) {
                        active = false;
                        return GLib.SOURCE_REMOVE;
                    }
                    onTick();
                    if (disposed) {
                        active = false;
                        return GLib.SOURCE_REMOVE;
                    }
                    return GLib.SOURCE_CONTINUE;
                });
                registerCleanup(() => {
                    if (active) {
                        active = false;
                        GLib.source_remove(id);
                    }
                });
            },
            setDynamicLevel: value => {
                const actor = instance.widgetActor;
                if (disposed || appearance !== 'dynamic' || !actor)
                    return;
                const level = Math.max(0, Math.min(1, Number(value) || 0));
                actor.set_style(`background-color: ${widgetColor(config['background-color'], 0.12 + level * 0.38)};`);
            },
            saveConfig: changes => {
                if (!disposed && host._settings)
                    this.updateInstance(instance, {config: {...instance.config, ...changes}});
            },
            getState: () => host._settings
                ? readWidgetState(host._settings.get_string('widget-state'), instance.id) : {},
            saveState: changes => {
                if (!disposed && host._settings?.is_writable('widget-state'))
                    host._settings.set_string('widget-state', writeWidgetState(host._settings.get_string('widget-state'), instance.id, changes));
            },
            watchState: callback => {
                const settings = host._settings;
                const id = settings.connect('changed::widget-state', guarded(() => callback(readWidgetState(settings.get_string('widget-state'), instance.id))));
                registerCleanup(() => settings.disconnect(id));
            },
            openConfiguration: () => !disposed && host._openWidgetManager(instance.target, instance.monitor),
            createMediaView: properties => {
                if (disposed)
                    return null;
                host._mediaServiceUsers = (host._mediaServiceUsers ?? 0) + 1;
                registerCleanup(() => {
                    host._mediaServiceUsers--;
                    if (!this.destroying && host._settings)
                        host._syncMediaPlayers();
                });
                host._syncMediaPlayers();
                return host._createMediaView(properties);
            },
            mediaState: () => host._mediaState(),
            mediaAction: action => !disposed && host._mediaAction(action),
            createDockBuiltin: (type, context) => disposed ? null : ({actor: host._addDockWidget(context.screen, type,
                context.iconSize, context.iconPadding, instance)}),
        };
        return {
            context: {api, instance, monitor, target: instance.target, ...extra, orientation: Clutter.Orientation},
            dispose: () => { disposed = true; },
        };
    }

    create(instance, monitor, extra = {}) {
        const cleanup = [];
        let widgetContext;
        let result;
        try {
            const entry = this.registry.entries.get(instance.widget);
            if (!entry)
                throw new Error(`Widget non installe : ${instance.widget}`);
            this.loadStyle(entry);
            widgetContext = this.context(instance, monitor, extra, cleanup);
            result = this.registry.create(instance.widget, widgetContext.context);
            if (!result?.actor || typeof result.actor.add_child !== 'function')
                throw new Error('create(context) doit retourner {actor, destroy?}');
            const config = widgetConfiguration(entry.description, instance.config);
            const background = config['background-style'];
            result.actor.add_style_class_name(`g-os-widget-background-${background}`);
            result.actor.add_style_class_name(`g-os-widget-shadow-${config.shadow}`);
            instance.widgetActor = result.actor;
            if (background === 'solid')
                result.actor.set_style(`background-color: ${widgetColor(config['background-color'])};`);
            else if (background === 'transparent')
                result.actor.set_style('background-color: transparent;');
            else if (background === 'dynamic')
                widgetContext.context.api.setDynamicLevel(0.35);
            if (this.errors[instance.id]) {
                delete this.errors[instance.id];
                if (this.host._settings.is_writable('widget-errors'))
                    this.host._settings.set_string('widget-errors', JSON.stringify(this.errors));
            }
        } catch (error) {
            this.report(instance.id, error);
            const actor = new this.env.St.BoxLayout({style_class: 'g-os-desktop-widget g-os-widget-error',
                orientation: this.env.Clutter.Orientation.VERTICAL});
            actor.add_child(new this.env.St.Label({text: `${instance.widget} : ${errorMessage(error)}`}));
            result = {actor};
        }
        result.actor.widgetInstance = instance;
        result.actor.connect('destroy', () => {
            instance.widgetActor = null;
            widgetContext?.dispose();
            try { result.destroy?.(); } catch (error) { this.report(instance.id, error); }
            for (const callback of cleanup.reverse()) {
                try { callback(); } catch (error) { this.report(instance.id, error); }
            }
        });
        return result;
    }

    updateInstance(instance, changes) {
        if (instance.legacy || !this.host._settings.is_writable('widget-instances'))
            return;
        const values = this.instances.map(value => value.id === instance.id ? {...value, ...changes} : value);
        this.host._settings.set_string('widget-instances', JSON.stringify(values));
    }

    removeInstance(instance) {
        const settings = this.host._settings;
        if (instance.legacy) {
            const key = `${instance.target === 'desktop' ? 'desktop' : 'dock'}-widget-${instance.widget}`;
            if (!settings.is_writable(key))
                return false;
            settings.set_boolean(key, false);
            return true;
        }
        if (!settings.is_writable('widget-instances'))
            return false;
        const values = readWidgetInstances(settings.get_string('widget-instances'));
        if (!values.some(value => value.id === instance.id))
            return false;
        settings.set_string('widget-instances', JSON.stringify(values.filter(value => value.id !== instance.id)));
        if (settings.is_writable('widget-state')) {
            let state = {};
            try {
                const stored = JSON.parse(settings.get_string('widget-state'));
                if (stored && typeof stored === 'object' && !Array.isArray(stored))
                    state = stored;
            } catch {}
            if (Object.hasOwn(state, instance.id)) {
                delete state[instance.id];
                settings.set_string('widget-state', JSON.stringify(state));
            }
        }
        return true;
    }

    destroyDesktop() {
        for (const grid of this.grids) {
            this.env.Main.layoutManager._backgroundGroup?.remove_child(grid);
            grid.destroy();
        }
        this.grids = [];
        for (const {actor, foreground} of this.desktop.values()) {
            if (foreground)
                this.env.Main.layoutManager.removeChrome(actor);
            else
                this.env.Main.layoutManager._backgroundGroup?.remove_child(actor);
            actor.destroy();
        }
        this.desktop.clear();
        this.host._desktopWidgets.clear();
    }

    syncDesktop() {
        this.workAreaSignature = this.areaSignature();
        this.destroyDesktop();
        const {Main} = this.env;
        if (this.host._settings.get_boolean('widget-show-grid')) {
            const cell = this.host._settings.get_int('widget-grid-size') || 32;
            for (const monitor of Main.layoutManager.monitors) {
                const area = Main.layoutManager.getWorkAreaForMonitor?.(monitor.index) ?? monitor;
                const grid = new this.env.St.DrawingArea({style_class: 'g-os-widget-grid', reactive: false,
                    width: area.width, height: area.height});
                grid.set_position(area.x, area.y);
                grid.connect('repaint', actor => {
                    const context = actor.get_context();
                    const color = actor.get_theme_node().get_foreground_color();
                    context.setSourceRGBA(color.red / 255, color.green / 255, color.blue / 255, color.alpha / 255);
                    context.setLineWidth(1);
                    for (let column = 0; column <= area.width; column += cell) {
                        context.moveTo(column + 0.5, 0);
                        context.lineTo(column + 0.5, area.height);
                    }
                    for (let row = 0; row <= area.height; row += cell) {
                        context.moveTo(0, row + 0.5);
                        context.lineTo(area.width, row + 0.5);
                    }
                    context.stroke();
                    context.$dispose();
                });
                Main.layoutManager._backgroundGroup.add_child(grid);
                this.grids.push(grid);
            }
        }
        for (const instance of this.instances.filter(value => value.enabled && value.target === 'desktop')) {
            const monitor = Main.layoutManager.monitors.find(value => widgetMonitorId(value) === instance.monitor);
            if (!monitor)
                continue;
            const result = this.create(instance, monitor);
            const actor = result.actor;
            actor.dragHandle = result.dragHandle;
            const area = Main.layoutManager.getWorkAreaForMonitor?.(monitor.index) ?? monitor;
            const grid = this.host._settings.get_int('widget-grid-size') || 32;
            let x;
            let y;
            if (instance.legacy) {
                actor.set_width(this.host._settings.get_int('desktop-widget-width'));
                x = monitor.x + this.host._settings.get_int(`desktop-widget-${instance.widget}-x`);
                y = monitor.y + this.host._settings.get_int(`desktop-widget-${instance.widget}-y`);
            } else {
                const placement = widgetGridPlacement(instance, area, grid);
                actor.set_size(placement.width, placement.height);
                x = placement.x;
                y = placement.y;
            }
            actor.set_position(x, y);
            if (instance.foreground)
                Main.layoutManager.addChrome(actor, {trackFullscreen: true});
            else
                Main.layoutManager._backgroundGroup.add_child(actor);
            this.host._desktopWidgets.set(instance.id, actor);
            this.desktop.set(instance.id, {actor, foreground: instance.foreground, update: result.update});
            if (!instance.locked) {
                if (instance.legacy)
                    this.host._attachDesktopWidgetDrag(actor, monitor, `desktop-widget-${instance.widget}-x`,
                        `desktop-widget-${instance.widget}-y`);
                else
                    const screen = this.host._screens?.find(candidate => candidate.monitor.index === monitor.index);
                    if (screen?.interactionDnd)
                        this.attachGridDrag(screen, result.dragHandle ?? actor, actor, instance, area, grid);
            }
        }
    }

    attachGridDrag(screen, handle, actor, instance, area, grid) {
        handle.reactive = true;
        let origin;
        let pointer;
        let position;
        const finish = cancelled => {
            if (!origin)
                return;
            const saved = origin;
            origin = null;
            if (cancelled) {
                actor.set_position(...saved);
                return;
            }
            this.updateInstance(instance, {column: Math.max(0, Math.round((position[0] - area.x) / grid)),
                row: Math.max(0, Math.round((position[1] - area.y) / grid))});
        };
        registerShadowDragSource({
            controller: screen.interactionDnd,
            actor: handle,
            visualActor: actor,
            St: this.env.St,
            delegate: {
                widgetDesktopPlacement: true,
                widgetInstance: instance,
                getDragActorSource: () => actor,
            },
            callbacks: {
                onBegin: () => {
                    origin = actor.get_position();
                    pointer = this.env.pointer();
                    position = origin;
                },
                onMotion: event => {
                    if (!origin)
                        return;
                    const x = Math.max(area.x, Math.min(origin[0] + event.x - pointer[0], area.x + area.width - actor.width));
                    const y = Math.max(area.y, Math.min(origin[1] + event.y - pointer[1], area.y + area.height - actor.height));
                    position = [Math.round(x), Math.round(y)];
                    actor.set_position(...position);
                },
                onCancelled: () => finish(true),
                onEnd: success => finish(!success),
                onDestroy: () => finish(true),
            },
            lifecycle: screen.lifecycle,
        });
        screen.lifecycle.add(() => finish(true));
    }

    _destroyDockWidget(screen, actor) {
        const menuIndex = screen.shortcutMenus?.indexOf(actor.shortcutMenu) ?? -1;
        if (menuIndex >= 0)
            screen.shortcutMenus.splice(menuIndex, 1);
        if (actor.get_parent?.() === screen.dock)
            screen.dock.remove_child(actor);
        actor.destroy();
    }

    makeDock(screen, iconSize, iconPadding) {
        const existingLegacy = new Map<string, {
            dockWidgetType: string;
            widgetInstance?: {legacy?: boolean};
            _dockWidgetLayoutKey?: string;
            shortcutMenu?: unknown;
            get_parent?: () => unknown;
            destroy(): void;
        }>((screen.dock.get_children() as any[])
            .filter(actor => actor.dockWidgetType && actor.widgetInstance?.legacy)
            .map(actor => [actor.dockWidgetType, actor]));
        for (const instance of this.instances.filter(value => value.enabled && value.target === 'dock')) {
            const layoutKey = `${iconSize}:${iconPadding}:${screen.position}:${instance.dockSize === 1}`;
            let actor = null;
            if (instance.legacy) {
                const existing = existingLegacy.get(instance.widget);
                if (existing) {
                    existingLegacy.delete(instance.widget);
                    if (existing._dockWidgetLayoutKey === layoutKey)
                        actor = existing;
                    else
                        this._destroyDockWidget(screen, existing);
                }
            }
            if (!actor) {
                const result = this.create(instance, screen.monitor,
                    {screen, iconSize, iconPadding, square: instance.dockSize === 1});
                actor = result.actor;
                if (!screen.dock.get_children().includes(actor)) {
                const thickness = iconSize + iconPadding * 2;
                const length = instance.dockSize === 1 ? thickness : Math.round(thickness * 2.5);
                const horizontal = screen.position === 0;
                const body = actor;
                body.set_size(length - iconPadding * 2, iconSize);
                body.clip_to_allocation = true;
                body.set_pivot_point(0.5, 0.5);
                body.rotation_angle_z = horizontal ? 0 : screen.position === 1 ? 90 : -90;
                const viewport = new this.env.St.Widget({layout_manager: new this.env.Clutter.FixedLayout(),
                    width: horizontal ? length : thickness, height: horizontal ? thickness : length});
                viewport.add_child(body);
                body.set_position(horizontal ? iconPadding : (thickness - length + iconPadding * 2) / 2,
                    horizontal ? iconPadding : (length - iconSize) / 2);
                this.fitDockContent(body, length - iconPadding * 2, iconSize,
                    horizontal ? iconPadding : (thickness - length + iconPadding * 2) / 2,
                    horizontal ? iconPadding : (length - iconSize) / 2);
                actor = new this.env.St.Button({child: viewport, reactive: true, can_focus: true,
                    track_hover: true, style_class: 'g-os-dock-widget', accessible_name: instance.widget});
                actor.set_size(screen.position === 0 ? length : thickness, screen.position === 0 ? thickness : length);
                screen.dock.add_child(actor);
                this.host._attachTooltip(screen, actor, () => this.registry.entries.get(instance.widget)?.description.name ?? instance.widget,
                    {magnify: false});
                const entry = this.registry.entries.get(instance.widget);
                this.host._createShortcutMenu(screen, actor, {onOpen: menu => {
                    menu.removeAll();
                    if (entry?.description.targets.includes('desktop')) {
                        const detail = this.create({...instance, target: 'desktop'}, screen.monitor, {panel: true, screen});
                        detail.actor.set_width(Math.max(160, Math.min(320, entry.description.minimum?.width ?? 240)));
                        const item = new this.env.PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
                        item.add_child(detail.actor);
                        menu.addMenuItem(item);
                        menu.addMenuItem(new this.env.PopupMenu.PopupSeparatorMenuItem());
                        menu.addAction('Configurer ce widget', () => this.host._openWidgetManager('dock', instance.monitor));
                    }
                    const remove = menu.addAction('Retirer ce widget', () => {
                        menu.close();
                        this.removeInstance(instance);
                    });
                    const writableKey = instance.legacy
                        ? `${instance.target === 'desktop' ? 'desktop' : 'dock'}-widget-${instance.widget}` : 'widget-instances';
                    remove.setSensitive(this.host._settings.is_writable(writableKey));
                }});
                if (entry?.description.targets.includes('desktop'))
                    actor.connect('clicked', () => actor.shortcutMenu.toggle());
                }
            }
            actor.widgetInstance = instance;
            actor._dockWidgetLayoutKey = layoutKey;
            const description = this.registry.entries.get(instance.widget)?.description;
            actor.widgetConfig = description ? widgetConfiguration(description, instance.config) : {};
            actor.dockWidgetType = instance.widget;
            actor.dockFocusKey = instance.legacy ? `widget:${instance.widget}` : `widget-instance:${instance.id}`;
            actor._delegate ??= {getDragActor: () => new this.env.Clutter.Clone({source: actor}), getDragActorSource: () => actor};
            if (actor.dockWidgetPrimary)
                this.host._updateDockWidget(actor);
        }
        for (const actor of existingLegacy.values())
            this._destroyDockWidget(screen, actor);
    }

    updateDesktop() {
        for (const result of this.desktop.values())
            result.update?.();
    }

    destroy() {
        this.destroying = true;
        for (const shared of this.fluxSessions.values())
            shared.session.destroy();
        this.fluxSessions.clear();
        for (const {actor, previous, delegate} of this.dropTargets) {
            if (actor._delegate === delegate)
                actor._delegate = previous;
        }
        this.dropTargets = [];
        this.generation++;
        this.destroyDesktop();
        this.timeClock?.run_dispose();
        this.timeClock = null;
        const theme = this.env.St.ThemeContext?.get_for_stage(this.env.stage).get_theme();
        for (const file of this.styles.values())
            theme?.unload_stylesheet(file);
        this.styles.clear();
    }
}