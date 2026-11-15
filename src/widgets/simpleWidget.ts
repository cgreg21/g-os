export interface SimpleWidgetElement {
    type: 'text' | 'clock' | 'button';
    text?: string;
    icon?: string;
    action?: {type: 'increment' | 'toggle' | 'set'; key: string; value?: string | number | boolean; amount?: number};
}

export interface SimpleWidgetDescription {
    language: 'simple';
    name: string;
    icon?: string;
    elements: SimpleWidgetElement[];
    dock?: SimpleWidgetElement[];
    square?: SimpleWidgetElement[];
    state?: Record<string, string | number | boolean>;
}

const stateKey = /^[a-z][a-z0-9-]{0,63}$/;
const reservedKeys = new Set(['constructor', 'prototype']);

export function validateSimpleWidget(value: SimpleWidgetDescription): void {
    if (value.icon !== undefined && (typeof value.icon !== 'string' || value.icon.length > 128))
        throw new Error('Icone de widget simple invalide');
    if (value.state !== undefined) {
        if (!value.state || typeof value.state !== 'object' || Array.isArray(value.state) ||
            Object.keys(value.state).length > 32)
            throw new Error('Etat initial de widget simple invalide');
        for (const [key, initial] of Object.entries(value.state)) {
            if (!stateKey.test(key) || reservedKeys.has(key) ||
                (typeof initial !== 'string' && typeof initial !== 'number' && typeof initial !== 'boolean') ||
                (typeof initial === 'string' && initial.length > 512) ||
                (typeof initial === 'number' && !Number.isFinite(initial)))
                throw new Error('Etat initial de widget simple invalide');
        }
    }
    for (const [index, elements] of [value.elements, value.dock, value.square].entries()) {
        if (index > 0 && elements === undefined)
            continue;
        if (!Array.isArray(elements) || elements.length < 1 || elements.length > 16)
            throw new Error('Une vue de widget simple doit contenir de 1 a 16 elements');
        for (const element of elements) {
            if (!element || !['text', 'clock', 'button'].includes(element.type))
                throw new Error('Type d\'element de widget simple invalide');
            if (element.type !== 'clock' && (typeof element.text !== 'string' || element.text.length > 512))
                throw new Error('Texte de widget simple invalide');
            if (element.icon !== undefined && (typeof element.icon !== 'string' || element.icon.length > 128))
                throw new Error('Icone de widget simple invalide');
            if (element.type !== 'button')
                continue;
            const action = element.action;
            if (!action || !['increment', 'toggle', 'set'].includes(action.type) ||
                typeof action.key !== 'string' || !stateKey.test(action.key) || reservedKeys.has(action.key))
                throw new Error('Action de widget simple invalide');
            if (action.type === 'increment' && action.amount !== undefined &&
                (typeof action.amount !== 'number' || !Number.isFinite(action.amount) || Math.abs(action.amount) > 10000))
                throw new Error('Pas de compteur invalide');
            if (action.type === 'set' && (typeof action.value !== 'string' &&
                typeof action.value !== 'number' && typeof action.value !== 'boolean' ||
                typeof action.value === 'number' && !Number.isFinite(action.value) ||
                typeof action.value === 'string' && action.value.length > 512))
                throw new Error('Valeur d\'action invalide');
        }
    }
}

interface SimpleWidgetContext {
    target: 'desktop' | 'dock';
    square?: boolean;
    iconSize?: number;
    config: Record<string, unknown>;
    api: {
        card(title: string, icon: string): {actor: {accessible_name?: string}; body: {add_child(actor: unknown): void}; dragHandle: unknown};
        label(text: string): {text: string};
        icon(name: string, size?: number): unknown;
        button(icon: string, title: string, callback: () => void): unknown;
        getState(): Record<string, unknown>;
        saveState(changes: Record<string, string | number | boolean>): void;
        watchState(callback: () => void): void;
        clockTimeText(): string;
        watchClock(callback: () => void): void;
    };
}

export function createSimpleWidget(description: SimpleWidgetDescription, context: SimpleWidgetContext) {
    const {api, config, target, square} = context;
    const view = api.card(description.name, description.icon || 'applications-utilities-symbolic');
    const elements = target === 'desktop' ? description.elements
        : square ? description.square ?? description.dock ?? description.elements
            : description.dock ?? description.elements;
    const labels: Array<{actor: {text: string}; template: string}> = [];
    const state = () => ({...description.state, ...api.getState()});
    const format = (template: string) => template.replace(/\{\{\s*(time|state\.[a-z][a-z0-9-]*|config\.[a-z][a-z0-9-]*)\s*\}\}/g,
        (_match, variable: string) => {
            if (variable === 'time')
                return api.clockTimeText();
            const [source, key] = variable.split('.');
            if (reservedKeys.has(key))
                return '';
            const value = source === 'state' ? state()[key] : config[key];
            return ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : '';
        }).slice(0, 2048);
    const update = () => {
        for (const label of labels)
            label.actor.text = format(label.template);
    };
    for (const element of elements) {
        if (element.type === 'button') {
            if (target !== 'desktop')
                continue;
            const action = element.action!;
            const button = api.button(element.icon || 'list-add-symbolic', format(element.text!), () => {
                const current = state()[action.key];
                let next: string | number | boolean;
                if (action.type === 'increment') {
                    const count = typeof current === 'number' && Number.isFinite(current) ? current : 0;
                    next = Math.max(-1e9, Math.min(1e9, count + (action.amount ?? 1)));
                } else if (action.type === 'toggle') {
                    next = !current;
                } else {
                    next = action.value!;
                }
                api.saveState({[action.key]: next});
            });
            view.body.add_child(button);
        } else {
            const label = api.label('');
            view.body.add_child(label);
            labels.push({actor: label, template: element.type === 'clock' ? '{{time}}' : element.text!});
        }
    }
    if (labels.length === 0 && target === 'dock')
        view.body.add_child(api.icon(description.icon || 'applications-utilities-symbolic', context.iconSize));
    if (labels.some(label => /\{\{\s*time\s*\}\}/.test(label.template)))
        api.watchClock(update);
    if (labels.some(label => /\{\{\s*state\./.test(label.template)))
        api.watchState(update);
    update();
    return {...view, update};
}