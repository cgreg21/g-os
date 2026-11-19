import {requestFluxJson, type FluxHttpEnvironment, type FluxHttpRequest} from './fluxHttp.js';
import {renderFluxTemplate, resolveFluxValue, type FluxNode, type FluxProgram} from './fluxLanguage.js';

interface FluxEnvironment extends FluxHttpEnvironment {
    GLib: any;
}

interface FluxContext {
    target: 'desktop' | 'dock';
    square?: boolean;
    iconSize?: number;
    config: Record<string, unknown>;
    api: {
        card(title: string, icon: string): {actor: unknown; body: {y_expand?: boolean; add_child(actor: unknown): void}; dragHandle: unknown};
        box(properties: Record<string, unknown>): {visible: boolean; add_child(actor: unknown): void; destroy_all_children(): void};
        list(): {actor: {visible: boolean}; content: {add_child(actor: unknown): void; destroy_all_children(): void}};
        label(text: string, properties?: Record<string, unknown>): {text: string; visible: boolean};
        icon(name: string, size?: number): {visible: boolean};
        button(icon: string, title: string | (() => string), callback: () => void): {visible: boolean};
        clockTimeText(): string;
        watchClock(callback: () => void): void;
    };
}

export class FluxSession {
    readonly data: Record<string, unknown> = Object.create(null);
    readonly status: Record<string, string> = Object.create(null);
    readonly errors: Record<string, string> = Object.create(null);
    private listeners = new Set<() => void>();
    private requests = new Map<string, FluxHttpRequest>();
    private timers: number[] = [];
    private stopped = false;
    private started = false;

    constructor(readonly program: FluxProgram, private environment: FluxEnvironment) {}

    subscribe(callback: () => void): () => void {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    start(): void {
        if (this.started || this.stopped)
            return;
        this.started = true;
        const {GLib} = this.environment;
        for (const [name, source] of Object.entries(this.program.sources)) {
            if (this.stopped)
                return;
            this.refresh(name);
            if (this.stopped)
                return;
            this.timers.push(GLib.timeout_add(GLib.PRIORITY_DEFAULT, source.refresh * 1000, () => {
                this.refresh(name);
                return this.stopped ? GLib.SOURCE_REMOVE : GLib.SOURCE_CONTINUE;
            }));
        }
    }

    refresh(name: string): void {
        const source = this.program.sources[name];
        if (this.stopped || !source || this.requests.has(name))
            return;
        this.status[name] = 'loading';
        this.errors[name] = '';
        this.notify();
        if (this.stopped)
            return;
        const request = requestFluxJson(this.environment, source.url, source.timeout);
        this.requests.set(name, request);
        request.promise.then(value => {
            if (this.stopped) return;
            this.data[name] = value;
            this.status[name] = 'ready';
        }).catch(error => {
            if (this.stopped) return;
            this.status[name] = 'error';
            const message = error instanceof Error ? error.message : '';
            this.errors[name] = /^(?:Reponse HTTP \d+|Reponse HTTP Flux trop volumineuse|Reponse HTTP Flux non JSON|Delai HTTP Flux depasse|URL HTTP Flux invalide)$/.test(message)
                ? message : 'Connexion HTTP impossible';
        }).finally(() => {
            this.requests.delete(name);
            if (!this.stopped) this.notify();
        });
    }

    private notify(): void {
        for (const listener of this.listeners) {
            try {
                listener();
            } catch {
                // One broken view must not prevent other views from receiving updates.
            }
        }
    }

    destroy(): void {
        if (this.stopped)
            return;
        this.stopped = true;
        for (const timer of this.timers)
            this.environment.GLib.source_remove(timer);
        this.timers = [];
        for (const request of this.requests.values())
            request.cancel();
        this.requests.clear();
        this.listeners.clear();
    }
}

export function createFluxWidget(description: {name: string; icon?: string}, context: FluxContext, session: FluxSession) {
    const {api, target, square, config} = context;
    const view = api.card(description.name, description.icon || 'applications-utilities-symbolic');
    view.body.y_expand = true;
    const nodes = target === 'desktop' ? session.program.views.desktop
        : square ? session.program.views.square ?? session.program.views.dock ?? session.program.views.desktop
            : session.program.views.dock ?? session.program.views.desktop;
    type Actor = {visible: boolean; text?: string; accessible_name?: string;
        add_child?(actor: unknown): void; destroy_all_children?(): void};
    type Scope = {hasItem: boolean; item?: unknown};
    interface Binding {actor: Actor; node: FluxNode; scope: Scope; children: Binding[]; items?: unknown;
        content?: {add_child(actor: unknown): void; destroy_all_children(): void}}
    let actorCount = 0;
    const values = (scope: Scope) => ({data: session.data, status: session.status, error: session.errors,
        config, time: api.clockTimeText(), ...(scope.hasItem ? {item: scope.item} : {})});
    const renderNode = (node: FluxNode, scope: Scope): Binding | null => {
        if (node.type === 'button' && target !== 'desktop')
            return null;
        if (actorCount >= 128)
            return null;
        let actor: Actor;
        const children: Binding[] = [];
        if (node.type === 'text') {
            const style = node.style === 'title' ? 'g-os-utility-title'
                : node.style === 'secondary' ? 'g-os-desktop-widget-date' : '';
            actor = api.label('', {style_class: style});
        } else if (node.type === 'icon') {
            actor = api.icon(node.name!, target === 'dock' ? context.iconSize : 24);
        } else if (node.type === 'button') {
            actor = api.button(node.name!, () => renderFluxTemplate(node.text!, values(scope)), () => session.refresh(node.source!));
        } else if (node.type === 'repeat') {
            const list = api.list();
            actorCount++;
            return {actor: list.actor, node, scope, children, content: list.content};
        } else {
            actor = api.box({vertical: node.type === 'column', style_class: 'g-os-utility-body'});
            actorCount++;
            for (const child of node.children!) {
                const binding = renderNode(child, scope);
                if (binding) {
                    children.push(binding);
                    actor.add_child!(binding.actor);
                }
            }
            return {actor, node, scope, children};
        }
        actorCount++;
        return {actor, node, scope, children};
    };
    const bindings: Binding[] = [];
    for (const node of nodes) {
        const binding = renderNode(node, {hasItem: false});
        if (binding) {
            bindings.push(binding);
            view.body.add_child(binding.actor);
        }
    }
    const countBindings = (entries: Binding[]): number => entries.reduce((sum, entry) =>
        sum + 1 + countBindings(entry.children), 0);
    const updateNode = (binding: Binding) => {
        const {actor, node, scope} = binding;
        const current = values(scope);
        if (node.when) actor.visible = Boolean(resolveFluxValue(current, node.when));
        if (node.type === 'text') actor.text = renderFluxTemplate(node.text!, current);
        if (node.type === 'button') actor.accessible_name = renderFluxTemplate(node.text!, current);
        if (node.type === 'repeat') {
            const items = resolveFluxValue(current, node.items!);
            if (items !== binding.items) {
                actorCount -= countBindings(binding.children);
                binding.content!.destroy_all_children();
                binding.children = [];
                binding.items = items;
                if (Array.isArray(items)) {
                    for (const item of items.slice(0, 32)) {
                        for (const child of node.children!) {
                            const next = renderNode(child, {hasItem: true, item});
                            if (next) {
                                binding.children.push(next);
                                binding.content!.add_child(next.actor);
                            }
                        }
                    }
                }
            }
        }
        for (const child of binding.children)
            updateNode(child);
    };
    const update = () => {
        for (const binding of bindings)
            updateNode(binding);
    };
    const unsubscribe = session.subscribe(update);
    const usesClock = (entries: FluxNode[]): boolean => entries.some(node =>
        /\{\{\{?\s*[#^&]?\s*time\s*\}\}\}?/.test(node.text ?? '') || node.when === 'time' || usesClock(node.children ?? []));
    if (usesClock(nodes))
        api.watchClock(update);
    update();
    return {...view, update, destroy: unsubscribe};
}