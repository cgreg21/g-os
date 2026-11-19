import assert from 'node:assert/strict';
import test from 'node:test';
import {
    duplicateWidgetInstance,
    effectiveWidgetInstances,
    migrateWidgetDockOrder,
    nextWidgetGridCell,
    readWidgetInstances,
    readWidgetState,
    validateWidgetDescription,
    widgetAssetPath,
    widgetConfiguration,
    widgetGridPlacement,
    widgetMinimumSize,
    widgetMonitorId,
    WidgetRegistry,
    writeWidgetState,
} from '../dist/widgets/widgetRegistry.js';
import {formatBytes, formatDuration, parseSystemStats} from '../dist/widgets/widgetUtilities.js';
import {createSimpleWidget, validateSimpleWidget} from '../dist/widgets/simpleWidget.js';
import {WidgetRuntime} from '../dist/widgets/widgetRuntime.js';

const manifest = {
    apiVersion: 1,
    id: 'counter',
    name: ' Counter ',
    entry: 'widget.js',
    preview: 'preview.png',
    targets: ['desktop', 'dock'],
    configuration: [
        {key: 'limit', title: 'Limit', type: 'number', min: 1, max: 10, default: 5},
        {key: 'mode', title: 'Mode', type: 'select', choices: ['normal', 'compact'], default: 'normal'},
    ],
};

test('widget manifests validate their API, identifiers, targets and relative assets', () => {
    assert.equal(validateWidgetDescription(manifest).name, 'Counter');
    assert.deepEqual(validateWidgetDescription({...manifest, minimum: {width: 64, height: 96}}).minimum,
        {width: 64, height: 96});
    for (const minimum of [{width: 0, height: 64}, {width: 64, height: 321}, {width: 1.5, height: 64}])
        assert.throws(() => validateWidgetDescription({...manifest, minimum}));
    assert.throws(() => validateWidgetDescription({...manifest, apiVersion: 2}));
    assert.throws(() => validateWidgetDescription({...manifest, id: '../counter'}));
    assert.throws(() => validateWidgetDescription({...manifest, targets: ['shell']}));
    for (const path of ['/absolute.png', '../secret', 'assets\\icon.png', 'assets//icon.png'])
        assert.throws(() => widgetAssetPath(path));
    assert.equal(widgetAssetPath('assets/icon.png'), 'assets/icon.png');

    const simple = {apiVersion: 1, id: 'simple', name: 'Simple', language: 'simple',
        targets: ['desktop'], elements: [{type: 'text', text: 'Ready'}]};
    assert.equal(validateWidgetDescription(simple).language, 'simple');
    assert.throws(() => validateWidgetDescription({...simple, entry: 'widget.js'}));
    const flux = {apiVersion: 1, id: 'weather', name: 'Weather', language: 'flux',
        entry: 'widget.flux', template: 'template.flux', css: 'weather.css', icon: 'weather-symbolic',
        targets: ['dock'], configuration: []};
    assert.equal(validateWidgetDescription(flux).icon, 'weather-symbolic');
    assert.throws(() => validateWidgetDescription({...flux, entry: 'widget.js'}));
    assert.throws(() => validateWidgetDescription({...flux, template: 'other.flux'}));
    assert.throws(() => validateWidgetDescription({...flux, icon: '../unsafe'}));
    assert.throws(() => validateWidgetDescription({...manifest, css: '../style.css'}));
});

test('widget settings are normalized against field bounds and allowed choices', () => {
    const description = validateWidgetDescription(manifest);
    assert.deepEqual(widgetConfiguration(description, {
        limit: 99,
        mode: 'unknown',
        'background-color': '#123456',
        shadow: 'strong',
    }), {
        limit: 10,
        mode: 'normal',
        'background-style': 'auto',
        'background-color': '#123456',
        shadow: 'strong',
    });
    const textManifest = validateWidgetDescription({...manifest, configuration: [
        {key: 'caption', title: 'Caption', type: 'text', default: ''},
    ]});
    assert.equal(widgetConfiguration(textManifest, {caption: 'x'.repeat(1100)}).caption.length, 1024);
    assert.equal(widgetConfiguration(textManifest, {caption: 42}).caption, '');
    const typedManifest = validateWidgetDescription({...manifest, configuration: [
        {key: 'active', title: 'Active', type: 'switch', default: true},
        {key: 'amount', title: 'Amount', type: 'number', min: 2, max: 8},
        {key: 'shade', title: 'Shade', type: 'color'},
    ]});
    assert.deepEqual(widgetConfiguration(typedManifest, {
        active: 'false', amount: Number.NaN, shade: 'red',
    }), {
        active: true, amount: 2, shade: '#ffffff',
        'background-style': 'auto', 'background-color': '#3978c880', shadow: 'soft',
    });
    for (const configuration of [
        'invalid',
        [{key: 'background-style', title: 'Duplicate', type: 'text'}],
        [{key: 'bad key', title: 'Invalid', type: 'text'}],
        [{key: 'field', title: 3, type: 'text'}],
        [{key: 'field', title: 'Field', type: 'unknown'}],
        [{key: 'field', title: 'Field', type: 'select', choices: []}],
        [{key: 'field', title: 'Field', type: 'select', choices: ['ok', 1]}],
        [{key: 'field', title: 'Field', type: 'number', min: 10, max: 1}],
        Array.from({length: 129}, (_, index) => ({key: `field-${index}`, title: 'Field', type: 'text'})),
    ])
        assert.throws(() => validateWidgetDescription({...manifest, configuration}));
});

test('registry creates only registered widgets on supported surfaces', () => {
    const registry = new WidgetRegistry();
    registry.register(manifest, context => ({limit: context.config.limit, target: context.target}));
    assert.deepEqual(registry.create('counter', {
        target: 'dock',
        instance: {config: {limit: 100}},
    }), {limit: 10, target: 'dock'});
    assert.throws(() => registry.create('missing', {target: 'desktop', instance: {config: {}}}));
    assert.throws(() => registry.create('counter', {target: 'unsupported', instance: {config: {}}}));
    assert.throws(() => registry.register(manifest, () => null));
    assert.throws(() => registry.register({...manifest, id: 'no-create'}, null));
});

test('widget state updates preserve other instances and enforce size limits', () => {
    const original = JSON.stringify({first: {count: 1}, second: {note: 'keep'}});
    assert.deepEqual(readWidgetState(original, 'first'), {count: 1});
    assert.deepEqual(readWidgetState(original, 'missing'), {});
    const updated = writeWidgetState(original, 'first', {count: 2});
    assert.deepEqual(JSON.parse(updated), {first: {count: 2}, second: {note: 'keep'}});
    assert.deepEqual(readWidgetState('{', 'first'), {});
    assert.deepEqual(JSON.parse(writeWidgetState('{', 'new', {count: 1})), {new: {count: 1}});
    assert.throws(() => writeWidgetState(original, 'first', []));
    assert.throws(() => writeWidgetState(original, 'first', {text: 'x'.repeat(17000)}));
    assert.deepEqual(JSON.parse(writeWidgetState('[]', 'first', {count: 2})), {first: {count: 2}});
});

test('widget instances reject invalid identities and normalize layout and target fields', () => {
    assert.deepEqual(readWidgetInstances(JSON.stringify([
        {id: 'one', widget: 'counter', target: 'desktop', monitor: 'DP-1',
            column: -2, row: 3.6, columns: 60, rows: 0, config: []},
        {id: 'one', widget: 'counter', target: 'dock', monitor: '*'},
        {id: 'bad', widget: 'counter', target: 'unknown', monitor: '*'},
        {id: 'two', widget: 'counter', target: 'dock', monitor: 'DP-2', dockSize: 1},
    ])), [
        {id: 'one', widget: 'counter', target: 'desktop', monitor: 'DP-1',
            column: 0, row: 4, columns: 40, rows: 4, locked: false, foreground: false,
            enabled: true, dockSize: 0, config: {}},
        {id: 'two', widget: 'counter', target: 'dock', monitor: '*',
            column: 0, row: 0, columns: 7, rows: 4, locked: false, foreground: false,
            enabled: true, dockSize: 1, config: {}},
    ]);
    assert.deepEqual(readWidgetInstances('not json'), []);
    assert.deepEqual(readWidgetInstances(null), []);
    assert.deepEqual(readWidgetInstances(JSON.stringify([{id: 'object-config', widget: 'counter',
        target: 'desktop', monitor: 'DP-1', config: {title: 'Counter'}}]))[0].config, {title: 'Counter'});
});

test('widget grid placement clamps bounds and free-cell search avoids overlaps', () => {
    const area = {x: 100, y: 50, width: 320, height: 192};
    assert.deepEqual(widgetGridPlacement({column: 99, row: 99, columns: 3, rows: 2}, area), {
        x: 324, y: 178, width: 96, height: 64,
    });
    assert.deepEqual(widgetGridPlacement({column: 0, row: 0, columns: 1, rows: 1},
        {x: 0, y: 0, width: 320, height: 192}, 0), {x: 0, y: 0, width: 32, height: 32});
    const occupied = [{enabled: true, target: 'desktop', monitor: 'DP-1', column: 0, row: 0, columns: 2, rows: 1}];
    assert.deepEqual(nextWidgetGridCell(occupied, 'DP-1', 1, 1, 32, 96, 64), {column: 2, row: 0});
    assert.equal(nextWidgetGridCell([...occupied,
        {enabled: true, target: 'desktop', monitor: 'DP-1', column: 2, row: 0, columns: 1, rows: 1},
        {enabled: true, target: 'desktop', monitor: 'DP-1', column: 0, row: 1, columns: 3, rows: 1}],
    'DP-1', 1, 1, 32, 96, 64), null);
});

test('widget duplication deep-copies configuration and places desktop copies in a free cell', () => {
    const source = {id: 'original', widget: 'counter', target: 'desktop', monitor: 'DP-1',
        column: 0, row: 0, columns: 1, rows: 1, config: {nested: {value: 1}}, locked: true};
    const duplicate = duplicateWidgetInstance(source, [source], [{id: 'DP-1', width: 96, height: 64}], 32, 'copy');
    assert.deepEqual(duplicate, {...source, id: 'copy', column: 1, row: 0, locked: false, enabled: true});
    assert.notEqual(duplicate.config, source.config);
    assert.notEqual(duplicate.config.nested, source.config.nested);
    assert.equal(duplicateWidgetInstance(source, [source], [], 32, 'copy'), null);
    assert.equal(duplicateWidgetInstance(source, [
        {...source, column: 0, row: 0, columns: 3, rows: 2},
    ], [{id: 'DP-1', width: 96, height: 64}], 32, 'full'), null);
    assert.deepEqual(duplicateWidgetInstance({...source, target: 'dock'}, [], [], 32, 'dock-copy'),
        {...source, target: 'dock', id: 'dock-copy', locked: false, enabled: true});
});

test('legacy widget instances use monitor ids and desktop minimum sizes', () => {
    assert.equal(widgetMonitorId({connector: 'DP-1', index: 0}), 'DP-1');
    assert.equal(widgetMonitorId({connector: '', index: 2}), 'monitor-2');
    const desktop = {target: 'desktop', columns: 1, rows: 1};
    assert.deepEqual(widgetMinimumSize(desktop, {minimum: {width: 160, height: 128}}, 32),
        {...desktop, columns: 5, rows: 4});
    const dock = {target: 'dock', columns: 1, rows: 1};
    assert.equal(widgetMinimumSize(dock, {minimum: {width: 320, height: 320}}, 32), dock);
    const legacy = {...desktop, legacy: true};
    assert.equal(widgetMinimumSize(legacy, {minimum: {width: 320, height: 320}}, 32), legacy);
});

test('effective widget instances handle managed data and legacy per-monitor settings', () => {
    const monitors = [
        {index: 0, connector: 'DP-1'},
        {index: 1, connector: ''},
    ];
    const values = {
        'widgets-managed': false,
        'desktop-widget-clock': true,
        'desktop-widget-media': true,
        'dock-widget-calendar': true,
        'dock-widget-media': true,
    };
    let desktopWidth = 160;
    const settings = {
        get_boolean: key => Boolean(values[key]),
        get_string: () => JSON.stringify([{id: 'managed', widget: 'clock', target: 'dock', monitor: '*'}]),
        get_int: key => ({
            'widget-grid-size': 0,
            'desktop-widget-clock-x': 64,
            'desktop-widget-clock-y': 96,
            'desktop-widget-media-x': 32,
            'desktop-widget-media-y': 0,
        })[key] ?? (key === 'desktop-widget-width' ? desktopWidth : 0),
        get_value: () => ({deep_unpack: () => ({clock: 1, calendar: 0, media: 1})}),
    };

    values['widgets-managed'] = true;
    assert.equal(effectiveWidgetInstances(settings, monitors)[0].id, 'managed');
    values['widgets-managed'] = false;
    const instances = effectiveWidgetInstances(settings, monitors);
    assert.equal(instances.length, 6);
    assert.deepEqual(instances[0], {
        id: 'clock:0', widget: 'clock', target: 'desktop', monitor: 'DP-1',
        column: 2, row: 3, columns: 5, rows: 4, enabled: true, locked: false,
        foreground: false, dockSize: 1, config: {}, legacy: true,
    });
    assert.equal(instances.at(-1).id, 'dock-media');
    assert.equal(instances.at(-1).monitor, '*');
    assert.equal(instances.at(-1).dockSize, 1);
    desktopWidth = 0;
    assert.equal(effectiveWidgetInstances(settings, monitors)[0].columns, 7);
});

test('legacy Dock widget order expands only entries that have managed instances', () => {
    const instances = [
        {id: 'clock-1', target: 'dock', widget: 'clock'},
        {id: 'clock-2', target: 'dock', widget: 'clock'},
        {id: 'notes', target: 'desktop', widget: 'notes'},
    ];
    assert.deepEqual(migrateWidgetDockOrder(['app:a', 'widget:clock', 'widget:notes'],
        instances), ['app:a', 'widget-instance:clock-1', 'widget-instance:clock-2', 'widget:notes']);
});

test('system utilities format time, bytes and parsed Linux resource counters', () => {
    assert.equal(formatDuration(0), '00:00');
    assert.equal(formatDuration(3_661_000), '1:01:01');
    assert.equal(formatDuration(-1000), '00:00');
    assert.equal(formatBytes(1024), '1.0 Kio');
    assert.equal(formatBytes(0), '0 o');
    assert.deepEqual(parseSystemStats(
        'cpu 10 2 3 40 5 1 1 0\ncpu0 0',
        'MemTotal: 1000 kB\nMemAvailable: 250 kB\n',
        '123.5 0',
        '0.25 0.30 0.40 1/2 99',
    ), {
        cpuTotal: 62,
        cpuIdle: 45,
        memoryTotal: 1024000,
        memoryUsed: 768000,
        uptime: 123.5,
        load: 0.25,
    });
    assert.deepEqual(parseSystemStats('cpu 1 bad 3', 'MemFree: invalid kB\n', 'bad', 'bad'), {
        cpuTotal: 4, cpuIdle: 0, memoryTotal: 0, memoryUsed: 0, uptime: 0, load: 0,
    });
    assert.deepEqual(parseSystemStats('cpu 1 2 3 4 5', '', '1', '0.5'), {
        cpuTotal: 15, cpuIdle: 9, memoryTotal: 0, memoryUsed: 0, uptime: 1, load: 0.5,
    });
});

test('simple widget schemas reject unsafe state and malformed actions', () => {
    const valid = {language: 'simple', name: 'Counter', elements: [
        {type: 'text', text: '{{state.count}}'},
        {type: 'button', text: '+', action: {type: 'increment', key: 'count'}},
    ], state: {count: 0}};
    assert.doesNotThrow(() => validateSimpleWidget(valid));
    assert.throws(() => validateSimpleWidget({...valid, state: {constructor: 'unsafe'}}));
    assert.throws(() => validateSimpleWidget({...valid, elements: [{type: 'button', text: '+',
        action: {type: 'increment', key: 'count', amount: 10001}}]}));
    for (const value of [null, Infinity, 'x'.repeat(513)])
        assert.throws(() => validateSimpleWidget({...valid, elements: [{type: 'button', text: '=',
            action: {type: 'set', key: 'count', value}}]}));
    assert.doesNotThrow(() => validateSimpleWidget({...valid, elements: [{type: 'button', text: '=',
        action: {type: 'set', key: 'count', value: true}}]}));
});

test('simple widget schemas reject invalid views, state values and button actions', () => {
    const valid = {language: 'simple', name: 'Counter',
        elements: [{type: 'text', text: 'Ready'}]};
    const invalid = [
        {...valid, icon: 42},
        {...valid, state: []},
        {...valid, state: Object.fromEntries(Array.from({length: 33}, (_, index) => [`n${index}`, index]))},
        {...valid, state: {count: Infinity}},
        {...valid, state: {caption: 'x'.repeat(513)}},
        {...valid, elements: []},
        {...valid, elements: Array.from({length: 17}, () => ({type: 'clock'}))},
        {...valid, elements: [null]},
        {...valid, elements: [{type: 'unknown'}]},
        {...valid, elements: [{type: 'text'}]},
        {...valid, elements: [{type: 'text', text: 'x'.repeat(513)}]},
        {...valid, elements: [{type: 'clock', icon: 'x'.repeat(129)}]},
        {...valid, elements: [{type: 'button', text: '+', action: {type: 'other', key: 'count'}}]},
        {...valid, elements: [{type: 'button', text: '+', action: {type: 'toggle', key: 'bad key'}}]},
        {...valid, elements: [{type: 'button', text: '+', action: {type: 'increment', key: 'count', amount: Infinity}}]},
        {...valid, elements: [{type: 'button', text: '+', action: {type: 'set', key: 'count', value: {}}}]},
    ];
    for (const value of invalid)
        assert.throws(() => validateSimpleWidget(value));
    assert.doesNotThrow(() => validateSimpleWidget({...valid,
        dock: [{type: 'clock'}], square: [{type: 'text', text: 'Square'}]}));
});

test('simple widgets render config and state and persist bounded button actions', () => {
    const labels = [];
    const buttons = [];
    const saved = {};
    let stateListener;
    const api = {
        card: () => ({body: {add_child() {}}, actor: {}, dragHandle: {}}),
        label: () => { const label = {text: ''}; labels.push(label); return label; },
        icon: () => ({}),
        button: (_icon, title, callback) => { const button = {title, callback}; buttons.push(button); return button; },
        getState: () => saved,
        saveState: changes => { Object.assign(saved, changes); stateListener?.(); },
        watchState: callback => { stateListener = callback; },
        clockTimeText: () => '12:34',
        watchClock() {},
    };
    const widget = createSimpleWidget({
        language: 'simple',
        name: 'Counter',
        state: {count: 0},
        elements: [
            {type: 'text', text: '{{config.title}}: {{state.count}}'},
            {type: 'button', text: 'Add', action: {type: 'increment', key: 'count', amount: 2}},
        ],
    }, {api, config: {title: 'Items'}, target: 'desktop'});
    assert.equal(labels[0].text, 'Items: 0');
    buttons[0].callback();
    assert.deepEqual(saved, {count: 2});
    assert.equal(labels[0].text, 'Items: 2');
    widget.update();
    assert.equal(labels[0].text, 'Items: 2');
});

test('simple widgets support clock updates, toggle/set actions and dock icon fallback', () => {
    const labels = [];
    const buttons = [];
    const children = [];
    const saved = {enabled: false, value: 'initial'};
    let clockListener;
    let stateListener;
    let clock = '10:00';
    const api = {
        card: title => ({title, body: {add_child: child => children.push(child)}, actor: {}, dragHandle: {}}),
        label: () => { const label = {text: ''}; labels.push(label); return label; },
        icon: (name, size) => ({name, size}),
        button: (_icon, title, callback) => { const button = {title, callback}; buttons.push(button); return button; },
        getState: () => saved,
        saveState: changes => { Object.assign(saved, changes); stateListener?.(); },
        watchState: callback => { stateListener = callback; },
        clockTimeText: () => clock,
        watchClock: callback => { clockListener = callback; },
    };
    const widget = createSimpleWidget({
        language: 'simple',
        name: 'Actions',
        icon: 'view-app-grid',
        state: {enabled: false},
        elements: [
            {type: 'clock'},
            {type: 'text', text: '{{config.title}}: {{state.enabled}}'},
            {type: 'button', text: 'Toggle', action: {type: 'toggle', key: 'enabled'}},
            {type: 'button', text: 'Set', action: {type: 'set', key: 'value', value: 7}},
        ],
        dock: [{type: 'button', text: 'Ignored', action: {type: 'toggle', key: 'enabled'}}],
        square: [{type: 'text', text: 'Square'}],
    }, {api, config: {title: 'Status'}, target: 'desktop'});

    assert.equal(labels[0].text, '10:00');
    assert.equal(labels[1].text, 'Status: false');
    clock = '10:01';
    clockListener();
    assert.equal(labels[0].text, '10:01');
    buttons.find(button => button.title === 'Toggle').callback();
    assert.equal(labels[1].text, 'Status: true');
    buttons.find(button => button.title === 'Set').callback();
    assert.equal(saved.value, 7);
    assert.equal(widget.title, 'Actions');

    const dockWidget = createSimpleWidget({
        language: 'simple', name: 'Dock', icon: 'dock-icon',
        elements: [{type: 'text', text: 'Desktop'}],
        dock: [{type: 'button', text: 'Ignored', action: {type: 'toggle', key: 'enabled'}}],
        square: [{type: 'text', text: 'Square'}],
    }, {api, config: {}, target: 'dock', iconSize: 24});
    assert.equal(dockWidget.title, 'Dock');
    assert.deepEqual(children.at(-1), {name: 'dock-icon', size: 24});
    const squareWidget = createSimpleWidget({
        language: 'simple', name: 'Square', elements: [{type: 'text', text: 'Desktop'}],
        dock: [{type: 'text', text: 'Dock'}], square: [{type: 'text', text: 'Square'}],
    }, {api, config: {}, target: 'dock', square: true});
    assert.equal(labels.at(-1).text, 'Square');
    assert.equal(squareWidget.title, 'Square');
});

test('simple widget templates and surface fallbacks handle missing or non-scalar values', () => {
    const labels = [];
    const buttons = [];
    const children = [];
    const saved = {count: 'not-a-number', nested: {value: 1}};
    let updateState;
    const api = {
        card: title => ({title, body: {add_child: child => children.push(child)}, actor: {}, dragHandle: {}}),
        label: () => { const label = {text: ''}; labels.push(label); return label; },
        icon: (name, size) => ({name, size}),
        button: (_icon, title, callback) => { const button = {title, callback}; buttons.push(button); return button; },
        getState: () => saved,
        saveState: changes => { Object.assign(saved, changes); updateState?.(); },
        watchState: callback => { updateState = callback; },
        clockTimeText: () => 'now',
        watchClock() {},
    };
    createSimpleWidget({
        language: 'simple', name: 'Fallback',
        elements: [{type: 'text', text: '{{state.constructor}}/{{state.nested}}/{{config.object}}'},
            {type: 'button', text: '+', action: {type: 'increment', key: 'count', amount: 0}}],
        dock: [{type: 'text', text: 'Dock'}],
    }, {api, config: {object: {value: 1}}, target: 'desktop'});
    assert.equal(labels[0].text, '//');
    buttons.at(-1).callback();
    assert.equal(saved.count, 0);

    const dockFallback = createSimpleWidget({
        language: 'simple', name: 'Dock fallback', elements: [{type: 'text', text: 'Desktop'}],
    }, {api, config: {}, target: 'dock'});
    assert.equal(labels.at(-1).text, 'Desktop');
    const squareFallback = createSimpleWidget({
        language: 'simple', name: 'Square fallback', elements: [{type: 'text', text: 'Desktop'}],
        dock: [{type: 'text', text: 'Dock'}],
    }, {api, config: {}, target: 'dock', square: true});
    assert.equal(labels.at(-1).text, 'Dock');
    assert.equal(dockFallback.title, 'Dock fallback');
    assert.equal(squareFallback.title, 'Square fallback');
});


test('widget runtime ignores state and configuration writes after instance disposal', () => {
    const writes = [];
    const updates = [];
    const settings = {
        get_string: () => '{}',
        is_writable: () => true,
        set_string: (...args) => writes.push(args),
    };
    const runtime = Object.create(WidgetRuntime.prototype);
    runtime.env = {St: {}, Gio: {}, GLib: {}, Clutter: {}};
    runtime.host = {_settings: settings};
    runtime.registry = {entries: new Map([['test', {description: {configuration: []}}]])};
    runtime.updateInstance = (...args) => updates.push(args);
    const instance = {id: 'instance', widget: 'test', config: {}};
    const context = runtime.context(instance, {}, {}, []);

    context.context.api.saveState({count: 1});
    context.context.api.saveConfig({title: 'active'});
    assert.equal(writes.length, 1);
    assert.equal(updates.length, 1);

    context.dispose();
    context.context.api.saveState({count: 2});
    context.context.api.saveConfig({title: 'stale'});
    assert.equal(writes.length, 1);
    assert.equal(updates.length, 1);
});

test('widget cleanup callbacks registered after disposal run immediately', () => {
    const runtime = Object.create(WidgetRuntime.prototype);
    runtime.env = {St: {}, Gio: {}, GLib: {}, Clutter: {}};
    runtime.host = {_settings: {get_string: () => '{}', is_writable: () => false}};
    runtime.registry = {entries: new Map([['test', {description: {configuration: []}}]])};
    const cleanup = [];
    const context = runtime.context({id: 'instance', widget: 'test', config: {}}, {}, {}, cleanup);
    let calls = 0;

    context.context.api.onCleanup(() => calls++);
    context.dispose();
    context.context.api.onCleanup(() => calls++);
    assert.equal(calls, 1);

    for (const dispose of cleanup.reverse())
        dispose();
    assert.equal(calls, 2);
});

test('widget runtime blocks media creation and host actions after disposal', () => {
    let mediaCreates = 0;
    let hostActions = 0;
    const runtime = Object.create(WidgetRuntime.prototype);
    runtime.env = {St: {}, Gio: {}, GLib: {}, Clutter: {}, Main: {notify: () => hostActions++}};
    runtime.host = {
        _settings: {get_string: () => '{}', is_writable: () => false},
        _createMediaView: () => { mediaCreates++; return {}; },
        _syncMediaPlayers() {},
        _mediaAction: () => hostActions++,
        _openWidgetManager: () => hostActions++,
        _addDockWidget: () => { hostActions++; return {}; },
    };
    runtime.registry = {entries: new Map([['test', {description: {configuration: []}}]])};
    const context = runtime.context({id: 'instance', widget: 'test', config: {}}, {}, {}, []);
    context.dispose();

    assert.equal(context.context.api.createMediaView({}), null);
    assert.equal(context.context.api.mediaAction('play'), false);
    assert.equal(context.context.api.openConfiguration(), false);
    assert.equal(context.context.api.createDockBuiltin('clock', {}), null);
    assert.equal(context.context.api.notify('title'), false);
    assert.equal(mediaCreates, 0);
    assert.equal(hostActions, 0);
});

test('widget runtime ignores signal and timer callbacks after instance disposal', () => {
    let signalCallback;
    const timerCallbacks = [];
    const removedIds = [];
    let disconnected = false;
    let calls = 0;
    const runtime = Object.create(WidgetRuntime.prototype);
    runtime.env = {
        GLib: {
            PRIORITY_DEFAULT: 0,
            SOURCE_REMOVE: false,
            SOURCE_CONTINUE: true,
            timeout_add: (_priority, _interval, callback) => {
                timerCallbacks.push(callback);
                return 7 + timerCallbacks.length - 1;
            },
            source_remove: id => { removedIds.push(id); },
        },
        St: {},
        Gio: {},
        Clutter: {},
    };
    runtime.host = {};
    runtime.registry = {entries: new Map([['test', {description: {configuration: []}}]])};
    const instance = {id: 'instance', widget: 'test', config: {}};
    const cleanup = [];
    const context = runtime.context(instance, {}, {}, cleanup);
    const emitter = {
        connect: (_signal, callback) => { signalCallback = callback; return 3; },
        disconnect: id => { assert.equal(id, 3); disconnected = true; },
    };

    context.context.api.connect(emitter, 'changed', () => calls++);
    context.context.api.every(1000, () => calls++);
    context.context.api.every(1000, () => calls++);
    signalCallback();
    timerCallbacks[0]();
    timerCallbacks[1]();
    assert.equal(calls, 3);

    context.dispose();
    assert.equal(timerCallbacks[0](), false);
    for (const dispose of cleanup.reverse())
        dispose();

    assert.equal(disconnected, true);
    assert.deepEqual(removedIds, [8]);
    signalCallback();
    assert.equal(timerCallbacks[0](), false);
    assert.equal(timerCallbacks[1](), false);
    assert.equal(calls, 3);
});
