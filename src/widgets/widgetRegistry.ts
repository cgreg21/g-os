import {validateSimpleWidget} from './simpleWidget.js';

export const WIDGET_API_VERSION = 1;
export const WIDGET_GRID_SIZE = 32;
export const WIDGET_APPEARANCE_FIELDS = [
    {key: 'background-style', title: 'Fond du widget', type: 'select', choices: ['auto', 'solid', 'dynamic', 'transparent'], default: 'auto'},
    {key: 'background-color', title: 'Couleur du fond', type: 'color', default: '#3978c880'},
    {key: 'shadow', title: 'Ombre', type: 'select', choices: ['none', 'soft', 'strong'], default: 'soft'},
];

export function readWidgetState(text, id) {
    try {
        const stored = JSON.parse(text);
        const value = stored[id];
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
        return {};
    }
}

export function writeWidgetState(text, id, changes) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes))
        throw new Error('Etat de widget invalide');
    const value = {...readWidgetState(text, id), ...changes};
    if (JSON.stringify(value).length > 16384)
        throw new Error('Etat du widget trop volumineux');
    let stored;
    try { stored = JSON.parse(text); } catch { stored = {}; }
    if (!stored || typeof stored !== 'object' || Array.isArray(stored))
        stored = {};
    return JSON.stringify({...stored, [id]: value});
}

export function widgetAssetPath(path) {
    if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') ||
        path.split('/').some(part => !part || part === '.' || part === '..'))
        throw new Error('Chemin de ressource de widget invalide');
    return path;
}

export function validateWidgetDescription(value) {
    const simple = value?.language === 'simple';
    const flux = value?.language === 'flux';
    if (!value || value.apiVersion !== WIDGET_API_VERSION ||
        typeof value.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value.id) ||
        typeof value.name !== 'string' || !value.name.trim() ||
        (!simple && !flux && (value.entry !== 'widget.js' || value.language !== undefined)) ||
        (simple && value.entry !== undefined) ||
        (flux && (value.entry !== 'widget.flux' || value.template !== 'template.flux')) ||
        !Array.isArray(value.targets) || value.targets.length === 0 ||
        value.targets.some(target => !['desktop', 'dock'].includes(target)))
        throw new Error('Description de widget invalide ou API incompatible');
    if (simple)
        validateSimpleWidget(value);
    if (flux && value.icon !== undefined && (typeof value.icon !== 'string' ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value.icon)))
        throw new Error('Icone Flux invalide');
    if ((!simple && !flux) || value.preview !== undefined)
        widgetAssetPath(value.preview);
    if (value.minimum && ['width', 'height'].some(key => !Number.isInteger(value.minimum[key]) ||
        value.minimum[key] < 1 || value.minimum[key] > 320))
        throw new Error('Taille minimale de widget invalide');
    if (value.css)
        widgetAssetPath(value.css);
    const configuration = value.configuration ?? [];
    if (!Array.isArray(configuration) || configuration.length > 128)
        throw new Error('La configuration du widget doit etre une liste');
    const keys = new Set(WIDGET_APPEARANCE_FIELDS.map(field => field.key));
    for (const field of configuration) {
        if (!field || typeof field.key !== 'string' || !/^[a-z][a-z0-9-]*$/.test(field.key) ||
            keys.has(field.key) || typeof field.title !== 'string' ||
            !['switch', 'number', 'text', 'select', 'color'].includes(field.type))
            throw new Error('Champ de configuration invalide');
        keys.add(field.key);
        if (field.type === 'select' && (!Array.isArray(field.choices) || field.choices.length === 0 ||
            field.choices.some(choice => typeof choice !== 'string')))
            throw new Error('Choix de configuration invalides');
        if (field.type === 'number' && (!Number.isFinite(field.min) || !Number.isFinite(field.max) || field.min > field.max))
            throw new Error('Limites numeriques invalides');
    }
    return {...value, name: value.name.trim(), configuration};
}

export function widgetConfiguration(description, stored = {}) {
    return Object.fromEntries([...description.configuration, ...WIDGET_APPEARANCE_FIELDS].map(field => {
        let value = stored[field.key] ?? field.default;
        if (field.type === 'switch')
            value = typeof value === 'boolean' ? value : Boolean(field.default);
        else if (field.type === 'number')
            value = Math.max(field.min, Math.min(field.max, Number.isFinite(value) ? value : field.min));
        else if (field.type === 'select')
            value = field.choices.includes(value) ? value : field.choices[0];
        else if (field.type === 'color')
            value = typeof value === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value) ? value : '#ffffff';
        else
            value = typeof value === 'string' ? value.slice(0, 1024) : '';
        return [field.key, value];
    }));
}

export function readWidgetInstances(text) {
    try {
        const values = typeof text === 'string' ? JSON.parse(text) : text;
        if (!Array.isArray(values))
            return [];
        const ids = new Set();
        return values.slice(0, 256).filter(instance => {
            if (!instance || typeof instance.id !== 'string' || instance.id.length > 128 || ids.has(instance.id) ||
                typeof instance.widget !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(instance.widget) ||
                !['desktop', 'dock'].includes(instance.target) || typeof instance.monitor !== 'string')
                return false;
            ids.add(instance.id);
            return true;
        }).map(instance => ({
            ...instance,
            monitor: instance.target === 'dock' ? '*' : instance.monitor,
            column: Math.max(0, Math.min(1024, Math.round(Number(instance.column) || 0))),
            row: Math.max(0, Math.min(1024, Math.round(Number(instance.row) || 0))),
            columns: Math.max(1, Math.min(40, Math.round(Number(instance.columns) || 7))),
            rows: Math.max(1, Math.min(40, Math.round(Number(instance.rows) || 4))),
            locked: Boolean(instance.locked),
            foreground: Boolean(instance.foreground),
            enabled: instance.enabled !== false,
            dockSize: instance.dockSize === 1 ? 1 : 0,
            config: instance.config && typeof instance.config === 'object' && !Array.isArray(instance.config) ? instance.config : {},
        }));
    } catch {
        return [];
    }
}

export function widgetGridPlacement(instance, area, grid = WIDGET_GRID_SIZE) {
    const cell = Math.max(8, Math.min(128, Math.round(Number(grid) || WIDGET_GRID_SIZE)));
    const width = Math.min(area.width, instance.columns * cell);
    const height = Math.min(area.height, instance.rows * cell);
    return {
        x: area.x + Math.min(instance.column * cell, Math.max(0, area.width - width)),
        y: area.y + Math.min(instance.row * cell, Math.max(0, area.height - height)),
        width,
        height,
    };
}

export function widgetMonitorId(monitor) {
    return typeof monitor.connector === 'string' && monitor.connector ? monitor.connector : `monitor-${monitor.index}`;
}

export function widgetMinimumSize(instance, description, grid) {
    if (instance.target !== 'desktop' || instance.legacy)
        return instance;
    const cell = Math.max(8, Math.min(128, Number(grid) || 32));
    return {...instance,
        columns: Math.max(instance.columns, Math.ceil((description?.minimum?.width ?? 96) / cell)),
        rows: Math.max(instance.rows, Math.ceil((description?.minimum?.height ?? 64) / cell)),
    };
}

export function nextWidgetGridCell(instances, monitor, columns, rows, grid, width, height) {
    const cell = Math.max(8, Math.min(128, Number(grid) || 32));
    const columnCount = Math.max(1, Math.min(1024, Math.floor(width / cell)));
    const rowCount = Math.max(1, Math.min(1024, Math.floor(height / cell)));
    const spanX = Math.min(columns, columnCount);
    const spanY = Math.min(rows, rowCount);
    const occupied = instances.filter(instance => instance.enabled !== false && instance.target === 'desktop' && instance.monitor === monitor);
    for (let row = 0; row <= rowCount - spanY; row++) {
        for (let column = 0; column <= columnCount - spanX; column++) {
            if (occupied.every(instance => column + spanX <= instance.column || column >= instance.column + instance.columns ||
                row + spanY <= instance.row || row >= instance.row + instance.rows))
                return {column, row};
        }
    }
    return null;
}

export function duplicateWidgetInstance(instance, instances, monitors, grid, id) {
    const duplicate = {...instance, id, config: JSON.parse(JSON.stringify(instance.config ?? {})),
        locked: false, enabled: true};
    if (duplicate.target !== 'desktop')
        return duplicate;
    const monitor = monitors.find(value => value.id === duplicate.monitor);
    const area = monitor?.workArea ?? monitor;
    if (!area || !Number.isFinite(area.width) || !Number.isFinite(area.height))
        return null;
    const cell = nextWidgetGridCell(instances, duplicate.monitor, duplicate.columns, duplicate.rows,
        grid, area.width, area.height);
    return cell ? {...duplicate, ...cell} : null;
}

export function effectiveWidgetInstances(settings, monitors) {
    if (settings.get_boolean('widgets-managed'))
        return readWidgetInstances(settings.get_string('widget-instances'));
    const instances = [];
    const grid = settings.get_int('widget-grid-size') || WIDGET_GRID_SIZE;
    for (const target of ['desktop', 'dock']) {
        const targetMonitors = target === 'desktop' ? monitors : monitors.slice(0, 1);
        for (const monitor of targetMonitors) {
            for (const widget of ['clock', 'calendar', 'media']) {
                if (!settings.get_boolean(`${target === 'desktop' ? 'desktop' : 'dock'}-widget-${widget}`))
                    continue;
                instances.push({
                    id: target === 'desktop' ? `${widget}:${monitor.index}` : `dock-${widget}`,
                    widget, target, monitor: target === 'desktop' ? widgetMonitorId(monitor) : '*',
                    column: target === 'desktop' ? Math.round(settings.get_int(`desktop-widget-${widget}-x`) / grid) : 0,
                    row: target === 'desktop' ? Math.round(settings.get_int(`desktop-widget-${widget}-y`) / grid) : 0,
                    columns: Math.max(1, Math.ceil((settings.get_int('desktop-widget-width') || 220) / grid)),
                    rows: widget === 'clock' ? 4 : 5,
                    enabled: true, locked: false, foreground: false,
                    dockSize: settings.get_value('dock-widget-sizes').deep_unpack()[widget] === 1 ? 1 : 0,
                    config: {}, legacy: true,
                });
            }
        }
    }
    return instances;
}

export function migrateWidgetDockOrder(order, instances) {
    return order.flatMap(key => {
        if (!key.startsWith('widget:'))
            return [key];
        const widget = key.slice('widget:'.length);
        const matching = instances.filter(instance => instance.target === 'dock' && instance.widget === widget);
        return matching.length > 0 ? matching.map(instance => `widget-instance:${instance.id}`) : [key];
    });
}

export class WidgetRegistry {
    entries: Map<string, any>;
    constructor() {
        this.entries = new Map();
    }

    register(description, create, directory = null) {
        const manifest = validateWidgetDescription(description);
        if (typeof create !== 'function')
            throw new Error('widget.js doit exporter create(context)');
        if (this.entries.has(manifest.id))
            throw new Error(`Widget deja enregistre : ${manifest.id}`);
        this.entries.set(manifest.id, {description: manifest, create, directory});
        return manifest;
    }

    create(id, context) {
        const entry = this.entries.get(id);
        if (!entry || !entry.description.targets.includes(context.target))
            throw new Error(`Widget indisponible pour cette surface : ${id}`);
        return entry.create({...context, config: widgetConfiguration(entry.description, context.instance.config)});
    }
}