import assert from 'node:assert/strict';
import test from 'node:test';

const fluxLanguage = process.env.GOS_FLUX_TEST_MODULE
    ? await import(process.env.GOS_FLUX_TEST_MODULE)
    : await import('../dist/widgets/fluxLanguage.js');
const {parseFluxProgram, renderFluxTemplate, resolveFluxValue, validateFluxTemplate} = fluxLanguage;
const {FluxSession} = await import('../dist/widgets/fluxWidget.js');

const sources = `version: 1
sources:
  weather:
    type: http
    url: https://weather.example.test/current
    refresh: 120
`;

test('Flux YAML declarations produce validated data sources and desktop views', () => {
    const template = `version: 1
desktop:
  - type: text
    text: "{{data.weather.temperature}}"
dock:
  - type: icon
    name: weather-symbolic
`;
    const program = parseFluxProgram(sources, template);
    assert.deepEqual(program.sources.weather, {
        url: 'https://weather.example.test/current',
        refresh: 120,
        timeout: 10,
    });
    assert.equal(program.views.desktop[0].text, '{{data.weather.temperature}}');
    assert.equal(program.views.dock[0].name, 'weather-symbolic');
});

test('Flux supports bounded Python-style source declarations and rejects executable syntax', () => {
    const python = `version = 1
refresh = 120
source("weather", url="https://weather.example.test/current", refresh=refresh)
`;
    assert.equal(parseFluxProgram(python, 'version: 1\ndesktop:\n  - type: text\n    text: Ready\n')
        .sources.weather.refresh, 120);
    assert.throws(() => parseFluxProgram('version = 1\nimport os\n',
        'version: 1\ndesktop:\n  - type: text\n    text: Ready\n'));
});

test('Flux templates render scalar values and nested lists without interpreting markup', () => {
    const context = {data: {weather: {city: '<Paris>', items: [{name: 'Rain'}, {name: 'Sun'}]}}};
    assert.equal(renderFluxTemplate('{{data.weather.city}}', context), '<Paris>');
    assert.equal(renderFluxTemplate('{{&data.weather.city}}', context), '<Paris>');
    assert.equal(renderFluxTemplate('{{#data.weather.items}}{{name}};{{/data.weather.items}}', context), 'Rain;Sun;');
    assert.equal(renderFluxTemplate('{{item.name}}', {item: {name: 'Current'}}), 'Current');
});

test('Flux template resolution rejects prototype paths and safely handles absent properties', () => {
    const context = {data: {weather: {temperature: 20}}};
    assert.equal(resolveFluxValue(context, 'data.weather.temperature'), 20);
    assert.equal(resolveFluxValue({item: {name: 'Current'}}, 'item.name'), 'Current');
    assert.equal(resolveFluxValue(context, 'data.weather.missing'), undefined);
    assert.equal(resolveFluxValue(context, 'data.weather.constructor'), undefined);
    assert.equal(resolveFluxValue({data: {weather: null}}, 'data.weather.temperature'), undefined);
    assert.equal(resolveFluxValue({data: {weather: 7}}, 'data.weather.temperature'), undefined);
    assert.throws(() => validateFluxTemplate('{{data.weather.constructor}}'));
    assert.throws(() => renderFluxTemplate('{{data.weather.__proto__}}', context));
});

test('Flux source and node references must be declared and within resource limits', () => {
    const missingSource = `version: 1
desktop:
  - type: text
    text: "{{data.unknown.value}}"
`;
    assert.throws(() => parseFluxProgram(sources, missingSource));
    const tooManySources = `version: 1
sources:
  a: {type: http, url: "https://a.example.test"}
  b: {type: http, url: "https://b.example.test"}
  c: {type: http, url: "https://c.example.test"}
  d: {type: http, url: "https://d.example.test"}
  e: {type: http, url: "https://e.example.test"}
`;
    assert.throws(() => parseFluxProgram(tooManySources,
        'version: 1\ndesktop:\n  - type: text\n    text: Ready\n'));
});

test('Flux rendering bounds output and rejects unsupported template syntax', () => {
    assert.equal(renderFluxTemplate('{{data.weather.value}}', {
        data: {weather: {value: 'x'.repeat(3000)}},
    }).length, 2048);
    assert.equal(renderFluxTemplate('{{data.weather.value}}x', {
        data: {weather: {value: 'x'.repeat(3000)}},
    }).length, 2048);
    assert.throws(() => renderFluxTemplate('{{> partial}}', {}));
    assert.throws(() => validateFluxTemplate('{{{{raw}}}}'));
});

test('Flux validates every node kind, nested views, references and repeat item scope', () => {
    const template = JSON.stringify({
        version: 1,
        desktop: [
            {type: 'text', text: 'Temp: {{data.weather.temperature}}', style: 'title',
                when: 'status.weather'},
            {type: 'text', text: '{{#data.weather.items}}{{name}}{{/data.weather.items}}'},
            {type: 'icon', name: 'weather-sunny'},
            {type: 'row', children: [{type: 'text', text: '{{config.theme}}'}]},
            {type: 'column', children: [{type: 'icon', name: 'weather-cloudy'}]},
            {type: 'repeat', items: 'data.weather.items', children: [
                {type: 'text', text: '{{item.name}}', when: 'item.visible'},
            ]},
            {type: 'button', text: 'Refresh {{error.weather}}', name: 'view-refresh', source: 'weather'},
        ],
        dock: [{type: 'text', text: '{{time}}', style: 'secondary'}],
        square: [{type: 'text', text: 'Ready'}],
    });
    const program = parseFluxProgram(sources, template);

    assert.equal(program.views.desktop.length, 7);
    assert.equal(program.views.desktop[5].children[0].when, 'item.visible');
    assert.equal(program.views.desktop[6].source, 'weather');
    assert.equal(program.views.dock[0].style, 'secondary');
    assert.equal(program.views.square[0].text, 'Ready');
});

test('Flux rejects invalid source declarations and source timing limits', () => {
    const validTemplate = JSON.stringify({version: 1, desktop: [{type: 'text', text: 'Ready'}]});
    const invalidSources = [
        {weather: {type: 'file', url: 'https://weather.example.test'}},
        {weather: {type: 'http', url: 'ftp://weather.example.test'}},
        {weather: {type: 'http', url: 'https://weather.example.test/{value}'}},
        {weather: {type: 'http', url: 'https://weather.example.test', refresh: 59}},
        {weather: {type: 'http', url: 'https://weather.example.test', refresh: 86401}},
        {weather: {type: 'http', url: 'https://weather.example.test', timeout: 0}},
        {weather: {type: 'http', url: 'https://weather.example.test', timeout: 31}},
        {weather: {type: 'http', url: 'https://weather.example.test', extra: true}},
        JSON.parse('{"__proto__":{"type":"http","url":"https://weather.example.test"}}'),
    ];
    for (const rawSources of invalidSources) {
        assert.throws(() => parseFluxProgram(JSON.stringify({version: 1, sources: rawSources}), validTemplate));
    }
    assert.throws(() => parseFluxProgram('x'.repeat(65537), validTemplate), /trop volumineux/);
    assert.throws(() => parseFluxProgram('version: [', validTemplate), /Syntaxe Flux invalide/);
    assert.throws(() => parseFluxProgram('version: 1\nversion: 1', validTemplate), /Syntaxe Flux invalide/);
    assert.throws(() => parseFluxProgram('null', validTemplate), /Objet Flux invalide/);
    assert.throws(() => parseFluxProgram('version: 1', null), /trop volumineux/);
    assert.throws(() => parseFluxProgram('version: 2', validTemplate), /Version Flux invalide/);
    assert.throws(() => parseFluxProgram('version: 1', '[]'), /Objet Flux invalide/);
    assert.throws(() => validateFluxTemplate('x'.repeat(1025)), /invalide/);
});

test('Flux rejects malformed views, nodes, fields, paths and resource limits', () => {
    const sourceFile = JSON.stringify({version: 1, sources: {weather: {
        type: 'http', url: 'https://weather.example.test',
    }}});
    const badTemplates = [
        {version: 2, desktop: [{type: 'text', text: 'Ready'}]},
        {version: 1, desktop: [{type: 'unknown'}]},
        {version: 1, desktop: [{type: 'text', text: 'Ready', extra: true}]},
        {version: 1, desktop: [{type: 'text'}]},
        {version: 1, desktop: [{type: 'text', text: 'Ready', style: 'huge'}]},
        {version: 1, desktop: [{type: 'icon', name: '../unsafe'}]},
        {version: 1, desktop: [{type: 'repeat', items: 'data.unknown.items', children: [
            {type: 'text', text: '{{item.name}}'},
        ]}]},
        {version: 1, desktop: [{type: 'repeat', items: 'not-a-path', children: [
            {type: 'text', text: '{{item.name}}'},
        ]}]},
        {version: 1, desktop: [{type: 'repeat', items: 'data.weather.items', children: [
            {type: 'text', text: '{{item.constructor}}'},
        ]}]},
        {version: 1, desktop: [{type: 'button', text: 'Go', name: 'go', source: 'missing'}]},
        {version: 1, desktop: [{type: 'text', text: '{{data.unknown.value}}'}]},
        {version: 1, desktop: [{type: 'text', text: 'Ready', when: 'data.missing.visible'}]},
        {version: 1, desktop: [{type: 'row', children: []}]},
        {version: 1, desktop: Array.from({length: 65}, () => ({type: 'text', text: 'x'}))},
        {version: 1, desktop: [{type: 'row', children: [{type: 'row', children: [
            {type: 'row', children: [{type: 'row', children: [
                {type: 'row', children: [{type: 'text', text: 'x'}]},
            ]}]},
        ]}]}]},
    ];
    for (const template of badTemplates)
        assert.throws(() => parseFluxProgram(sourceFile, JSON.stringify(template)));
    assert.throws(() => parseFluxProgram(sourceFile, JSON.stringify({version: 1, extra: true,
        desktop: [{type: 'text', text: 'x'}]})), /Champ Flux inconnu/);
    assert.throws(() => parseFluxProgram(sourceFile, JSON.stringify({version: 1,
        desktop: [{type: 'button', text: 'Go', name: 'go', source: 'weather', when: 'item.name'}]})));
    assert.throws(() => parseFluxProgram(sourceFile, JSON.stringify({version: 1,
        desktop: [{type: 'text', text: '{{data.weather.constructor}}'}]})));
});

test('Flux templates cover truthy and inverted sections, relative paths and literal markup', () => {
    const context = {
        data: {weather: {items: [{name: 'Rain'}, {name: 'Sun'}], empty: []}},
        config: {enabled: true, label: '<safe>'},
    };
    assert.equal(renderFluxTemplate('{{#data.weather.items}}{{name}}/{{.}};{{/data.weather.items}}', context),
        'Rain/;Sun/;');
    assert.equal(renderFluxTemplate('{{^data.weather.empty}}empty{{/data.weather.empty}}', context), 'empty');
    assert.equal(renderFluxTemplate('{{#config.enabled}}on{{/config.enabled}}', context), 'on');
    assert.equal(renderFluxTemplate('{{^config.enabled}}off{{/config.enabled}}', context), '');
    assert.equal(renderFluxTemplate('{{! ignored }}visible', context), 'visible');
    assert.equal(renderFluxTemplate('{{#data.weather.items}}{{config.enabled}}{{/data.weather.items}}', context),
        'truetrue');
    assert.equal(renderFluxTemplate('{{#data.weather.items}}x{{/data.weather.items}}',
        {data: {weather: {items: Array.from({length: 101}, () => ({}))}}}).length, 100);
    assert.equal(renderFluxTemplate('{{config.label}}|{{&config.label}}', context),
        '<safe>|<safe>');
    assert.equal(renderFluxTemplate('{{status.weather}}/{{error.weather}}/{{time}}',
        {status: {weather: false}, error: {weather: 'offline'}, time: 'now'}),
    'false/offline/now');
    assert.equal(renderFluxTemplate('{{data.weather.unknown}}', context), '');
    assert.equal(renderFluxTemplate('{{data.weather.value}}', {}), '');
    assert.throws(() => validateFluxTemplate('{{#data.weather.items}}x'));
    assert.throws(() => validateFluxTemplate('{{item.name}}'));
    assert.doesNotThrow(() => validateFluxTemplate('{{item.name}}', true));
    const nested = '{{#data.weather.items}}'.repeat(9) + 'x' +
        '{{/data.weather.items}}'.repeat(9);
    assert.throws(() => validateFluxTemplate(nested), /trop imbriquees/);
    const commentLoop = '{{#data.weather.items}}' + '{{!x}}'.repeat(41) +
        '{{/data.weather.items}}';
    assert.equal(renderFluxTemplate(commentLoop, {
        data: {weather: {items: Array.from({length: 100}, () => ({}))}},
    }), '');
    assert.throws(() => validateFluxTemplate(null));
});

test('Flux Python declarations evaluate bounded expressions and reject unsupported syntax', () => {
    const program = parseFluxProgram(`version = 1
base = 2
refresh = (base + 2) * 30
timeout = +3
url = "https://" + 'weather.example.test'
source("weather", url=url, refresh=refresh, timeout=timeout)
`, 'version: 1\ndesktop:\n  - type: text\n    text: Ready\n');
    assert.deepEqual(program.sources.weather, {
        url: 'https://weather.example.test', refresh: 120, timeout: 3,
    });
    const invalid = [
        'version = 1\nversion = 1\n',
        'version = 1\nsource("x", url="https://x.test", url="https://y.test")\n',
        'version = 1\nsource("x", path="https://x.test")\n',
        'version = 1\nsource("x", url=unknown)\n',
        'version = 1\nsource("x", url="https://x.test", refresh=1 / 0)\n',
        'version = 1\nvalue = - "text"\n',
        'version = 1\nvalue = [1, 2]\n',
        'version = 1\nimport os\n',
        'version = 1\nsource("x", url="https://x.test")\nsource("x", url="https://x.test")\n',
        'version = 1\nsource("x", url="https://x.test", refresh=refresh)\n',
    ];
    for (const source of invalid)
        assert.throws(() => parseFluxProgram(source, 'version: 1\ndesktop:\n  - type: text\n    text: Ready\n'));
});

test('Flux Python evaluates arithmetic and enforces declaration and expression limits', () => {
    const program = parseFluxProgram(`version = 1
positive = +3
negative = -2
product = 2.5 * 48
refresh = product - 0
timeout = 240 / 120
source("weather", url="https://" + 'weather.example.test', refresh=refresh, timeout=timeout)
`, 'version: 1\ndesktop:\n  - type: text\n    text: Ready\n');
    assert.deepEqual(program.sources.weather, {
        url: 'https://weather.example.test', refresh: 120, timeout: 2,
    });

    const invalid = [
        'version = 1\nsource()\n',
        'version = 1\nsource(42, url="https://x.test")\n',
        'version = 1\nsource("x", url)\n',
        'version = 1\nsource = 1\n',
        'version = 1\nprint("not allowed")\n',
        'version = 1\nvalue = """multiline"""\n',
        'version = 1\ninvalid = "a" + 1\n',
        'version = 1\ninvalid = "x" * 2\n',
        `version = 1\ninvalid = "${'x'.repeat(2049)}"\n`,
        `version = 1\ninvalid = ${'('.repeat(17)}1${')'.repeat(17)}\n`,
        'version = 1\ninvalid = 1e3\n',
        `version = 1\n${Array.from({length: 128}, (_, index) => `value${index} = ${index}`).join('\n')}\n`,
    ];
    for (const source of invalid)
        assert.throws(() => parseFluxProgram(source, 'version: 1\ndesktop:\n  - type: text\n    text: Ready\n'));
    assert.throws(() => parseFluxProgram(
        'source("weather", url="https://weather.example.test")\n',
        'version: 1\ndesktop:\n  - type: text\n    text: Ready\n'));
    assert.throws(() => parseFluxProgram(
        'version = 2\nsource("weather", url="https://weather.example.test")\n',
        'version: 1\ndesktop:\n  - type: text\n    text: Ready\n'));
    assert.throws(() => parseFluxProgram(
        `version = 1\n${' '.repeat(65530)}`,
        'version: 1\ndesktop:\n  - type: text\n    text: Ready\n'));
    assert.throws(() => parseFluxProgram(
        'version =\n',
        'version: 1\ndesktop:\n  - type: text\n    text: Ready\n'));
});

test('Flux applies defaults when a YAML source omits source options', () => {
    const program = parseFluxProgram('version: 1\n', 'version: 1\ndesktop:\n  - type: text\n    text: Ready\n');
    assert.equal(Object.keys(program.sources).length, 0);
    const withSource = parseFluxProgram(`version: 1
sources:
  weather:
    type: http
    url: http://weather.example.test
`, 'version: 1\ndesktop:\n  - type: text\n    text: Ready\n');
    assert.deepEqual(withSource.sources.weather, {
        url: 'http://weather.example.test', refresh: 300, timeout: 10,
    });
});


test('Flux session stops before scheduling work when a listener destroys it during startup', () => {
    let timers = 0;
    let requests = 0;
    const environment = {
        GLib: {
            PRIORITY_DEFAULT: 0,
            SOURCE_REMOVE: false,
            SOURCE_CONTINUE: true,
            timeout_add: () => { timers++; return timers; },
            source_remove: () => {},
            UriFlags: {NONE: 0},
            Uri: {parse: () => ({get_scheme: () => 'https', get_host: () => 'weather.example.test',
                get_userinfo: () => null})},
        },
        Gio: {Cancellable: class {}},
        Soup: {Session: class { constructor() { requests++; } }},
    };
    const session = new FluxSession({sources: {
        weather: {url: 'https://weather.example.test/current', timeout: 5, refresh: 120},
    }}, environment);
    session.subscribe(() => session.destroy());

    session.start();

    assert.equal(session.stopped, true);
    assert.equal(timers, 0);
    assert.equal(requests, 0);
});


test('Flux session isolates listener failures so other views still update', () => {
    const session = new FluxSession({sources: {}}, {GLib: {}});
    let updates = 0;
    session.subscribe(() => { throw new Error('broken view'); });
    session.subscribe(() => { updates++; });

    assert.doesNotThrow(() => session.notify());
    assert.equal(updates, 1);
    session.destroy();
});


test('Flux session does not retain subscriptions created after disposal', () => {
    const session = new FluxSession({sources: {}}, {GLib: {}});
    session.destroy();
    let updates = 0;
    const unsubscribe = session.subscribe(() => { updates++; });

    assert.doesNotThrow(() => unsubscribe());
    assert.doesNotThrow(() => session.notify());
    assert.equal(updates, 0);
});

test('Flux notifications defer new listeners and skip listeners removed mid-dispatch', () => {
    const session = new FluxSession({sources: {}}, {GLib: {}});
    const calls = [];
    let removePending;
    session.subscribe(() => {
        calls.push('first');
        session.subscribe(() => calls.push('late'));
        removePending();
    });
    removePending = session.subscribe(() => calls.push('removed'));

    session.notify();
    assert.deepEqual(calls, ['first']);

    session.notify();
    assert.deepEqual(calls, ['first', 'first', 'late']);
    session.destroy();
});

test('Flux subscriptions with the same callback have independent lifetimes', () => {
    const session = new FluxSession({sources: {}}, {GLib: {}});
    let updates = 0;
    const listener = () => { updates++; };
    const unsubscribeFirst = session.subscribe(listener);
    const unsubscribeSecond = session.subscribe(listener);

    unsubscribeFirst();
    session.notify();
    assert.equal(updates, 1);

    unsubscribeSecond();
    session.notify();
    assert.equal(updates, 1);
    session.destroy();
});


test('Flux refresh prevents a listener from recursively starting the same request', () => {
    let requests = 0;
    const environment = {
        Gio: {Cancellable: class { cancel() {} }},
        GLib: {
            PRIORITY_DEFAULT: 0,
            SOURCE_REMOVE: false,
            timeout_add: () => 1,
            source_remove: () => {},
            UriFlags: {NONE: 0},
            Uri: {parse: () => ({get_scheme: () => 'https', get_host: () => 'weather.example.test',
                get_userinfo: () => null})},
        },
        Soup: {
            MessageFlags: {NO_REDIRECT: 0},
            Message: {new: () => ({set_flags() {}})},
            Session: class {
                constructor() { requests++; }
                send_async() {}
                abort() {}
            },
        },
    };
    const session = new FluxSession({sources: {
        weather: {url: 'https://weather.example.test/current', timeout: 5, refresh: 120},
    }}, environment);
    session.subscribe(() => session.refresh('weather'));

    session.refresh('weather');

    assert.equal(requests, 1);
    assert.equal(session.requests.size, 1);
    session.destroy();
});
