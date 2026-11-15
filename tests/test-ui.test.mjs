import assert from 'node:assert/strict';
import test from 'node:test';
import {nativeReportIssues, progressForLine, renderDashboard} from '../scripts/test-ui.mjs';

function withTerminalSize(columns, rows, action) {
    const previousColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
    const previousRows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
    Object.defineProperty(process.stdout, 'columns', {configurable: true, value: columns});
    Object.defineProperty(process.stdout, 'rows', {configurable: true, value: rows});
    try {
        return action();
    } finally {
        if (previousColumns)
            Object.defineProperty(process.stdout, 'columns', previousColumns);
        else
            delete process.stdout.columns;
        if (previousRows)
            Object.defineProperty(process.stdout, 'rows', previousRows);
        else
            delete process.stdout.rows;
    }
}

test('test dashboard renders scenario, execution and live progress panels', () => {
    const now = Date.now();
    const screen = renderDashboard(1, [], {
        run: {selection: 'dock', tests: [{id: 'dock', status: 'passed'}]},
        current: {
            title: 'Dock : positions, tailles et clics',
            stage: 'GNOME Shell isolé',
            startedAt: now,
            progressText: 'Cas 1/12',
            passed: 1,
            failed: 0,
            total: 12,
            lastLines: [],
            logPath: '/tmp/dock.log',
        },
        lastRun: null,
    });

    assert.match(screen, /G-OS  \/  TEST LAB/);
    assert.match(screen, /SCÉNARIOS/);
    assert.match(screen, /EXÉCUTION/);
    assert.match(screen, /Cas 1\/12/);
    assert.match(screen, /JOURNAL EN DIRECT/);
});

test('test dashboard fits narrow, short and wide terminal sizes', () => {
    const state = {
        run: {selection: 'all', tests: []},
        current: {
            title: 'Bureau : grille et placement des icônes',
            stage: 'GNOME Shell isolé',
            startedAt: Date.now(),
            progressText: '81 configurations · 0 défaut(s)',
            passed: 81,
            failed: 0,
            total: 81,
            lastLines: ['Desktop layout audit: 81 configurations, 0 with findings'],
            logPath: '/tmp/g-os/test-runs/layout/desktop-layout-audit.log',
        },
        lastRun: null,
    };
    for (const [columns, rows] of [
        [24, 17], [40, 24], [91, 17], [92, 17], [100, 24], [100, 12], [20, 8], [2, 2], [1, 1],
    ]) {
        const screen = withTerminalSize(columns, rows, () => renderDashboard(5, [], state));
        const lines = screen.split('\n');
        assert.ok(lines.length <= rows, `${columns}x${rows} rendered ${lines.length} rows`);
        if (columns >= 24 && rows >= 17)
            assert.equal(lines.length, rows, `${columns}x${rows} should fill the terminal height`);
        assert.ok(lines.every(line => line.length <= columns),
            `${columns}x${rows} contains a line wider than the terminal`);
    }
});

test('Dock interaction progress counts completed configurations and reports findings', () => {
    assert.deepEqual(progressForLine('dock', 'Exploratory Dock 1/64/400: no issue detected', 0, 0), {
        passed: 1,
        failed: 0,
        total: 12,
        text: 'Cas 1/12 · gauche · 64 px · 400 %',
    });
    assert.deepEqual(progressForLine('dock', 'Exploratory Dock 2/32/180: hit-target-0.2, activation-0.2', 1, 0), {
        passed: 2,
        failed: 1,
        total: 12,
        text: 'Cas 2/12 · droite · 32 px · 180 % · 2 défaut(s)',
    });
});

test('unit test progress tracks pass, failure and reported total', () => {
    assert.equal(progressForLine('unit', '✔ widget settings', 3, 0).passed, 4);
    assert.equal(progressForLine('unit', '✖ broken behavior', 3, 0).failed, 1);
    assert.equal(progressForLine('unit', 'ℹ tests 32', 3, 0).total, 32);
});

test('GNOME desktop scenarios report interaction and layout progress', () => {
    assert.deepEqual(progressForLine('reachability',
        'Large magnification fits and stays pointer-reachable at dock position 2, size 64'), {
        passed: 1,
        failed: 0,
        total: 9,
        text: 'Cas 1/9 · droite · 64 px',
    });
    assert.deepEqual(progressForLine('hit-testing',
        'Dock hit-test audit: 6 configurations, 30 transparent clicks, 0 click-throughs, 0 with findings'), {
        passed: 6,
        failed: 0,
        total: 6,
        text: '6 configurations · 30 clics transparents · 0 transmis · 0 défaut(s)',
    });
    assert.deepEqual(progressForLine('appearance', 'Dock appearance audit: 70 cases, 2 with findings'), {
        passed: 68,
        failed: 2,
        total: 70,
        text: '70 options visuelles · 2 défaut(s)',
    });
    assert.deepEqual(progressForLine('desktop',
        'Desktop interaction audit: 16 checks, 2 with findings'), {
        passed: 14,
        failed: 2,
        total: 16,
        text: '16 vérifications · 2 défaut(s)',
    });
    assert.deepEqual(progressForLine('layout',
        'Desktop layout audit: 81 configurations, 3 with findings'), {
        passed: 78,
        failed: 3,
        total: 81,
        text: '81 configurations · 3 défaut(s)',
    });
    assert.deepEqual(progressForLine('widgets', 'Dock widget full-content fitting passes 54 native cases'), {
        passed: 54,
        failed: 0,
        total: 54,
        text: '54 configurations vérifiées',
    });
    assert.deepEqual(progressForLine('panel', 'Native panel controls: 8 popups, 1 with findings, audio=true'), {
        passed: 7,
        failed: 1,
        total: 8,
        text: '8 menus · 1 défaut(s)',
    });
    assert.deepEqual(progressForLine('notifications',
        'Native notification controls: handler=true, distinct positions=9, panel=[]'), {
        passed: 9,
        failed: 0,
        total: 9,
        text: '9/9 positions distinctes',
    });
    assert.deepEqual(progressForLine('margins', 'Native Dock margin audit: 18 cases, 2 with findings'), {
        passed: 16,
        failed: 2,
        total: 18,
        text: '18 cas · 2 défaut(s)',
    });
    assert.deepEqual(progressForLine('options', 'Native settings audit: 114 keys, 2 with findings'), {
        passed: 112,
        failed: 2,
        total: 114,
        text: '114 clés GSettings · 2 défaut(s)',
    });
    assert.deepEqual(progressForLine('daily', 'Daily usage: 8 steps, 1 with findings'), {
        passed: 7,
        failed: 1,
        total: 8,
        text: '8 étapes · 1 défaut(s)',
    });
});

test('native reports turn interaction, animation and settings findings into failures', () => {
    const dockCases = Array.from({length: 12}, () => ({issues: []}));
    dockCases[0] = {position: 1, size: 64, maximum: 400, issues: ['hit-target-0.2']};
    assert.deepEqual(nativeReportIssues('dock', {cases: dockCases}), ['1/64/400: hit-target-0.2']);
    const motionCases = Array.from({length: 30}, () => ({issues: []}));
    motionCases[0] = {position: 0, mode: 3, duration: 400, issues: ['hover-state-not-reset']};
    assert.deepEqual(nativeReportIssues('motion', motionCases), ['0/3/400: hover-state-not-reset']);
    assert.deepEqual(nativeReportIssues('motion', []), ['audit d\'animation incomplet (0/30 cas)']);
    assert.deepEqual(nativeReportIssues('hit-testing', {
        windowReady: true,
        transparentClicks: 3,
        clickThroughs: 1,
        cases: [{position: 0, size: 32, samples: [{}, {}], issues: ['click-through-to-window-0']}],
    }), [
        'audit des clics transparents incomplet (1/6 configurations)',
        'échantillons transparents insuffisants (3/18)',
        '1 clic(s) transmis à la fenêtre sous le Dock',
        '0/32: moins de 3 échantillons',
        '0/32: click-through-to-window-0',
    ]);
    assert.deepEqual(nativeReportIssues('appearance', {
        appearanceCases: Array.from({length: 64}, () => ({issues: []})),
        metricsCases: Array.from({length: 6}, () => ({issues: []})),
    }), []);
    assert.deepEqual(nativeReportIssues('appearance', {appearanceCases: [], metricsCases: []}), [
        'audit d\'apparence incomplet (0/64 combinaisons)',
        'audit des dimensions incomplet (0/6 cas)',
    ]);
    assert.deepEqual(nativeReportIssues('reachability', {log: {verifiedCases: [
        'large-magnification', 'background-hover-boundary', 'three-dock-positions', 'three-icon-sizes',
        'magnified-application-tooltip', 'magnified-application-click', 'expanded-button-hit-targets',
        'live-magnification-settings',
        ...Array.from({length: 9}, (_, index) => `case:${Math.floor(index / 3)}/${[24, 40, 64][index % 3]}`),
    ]}}), []);
    assert.deepEqual(nativeReportIssues('reachability', {log: {verifiedCases: []}}), [
        'portée du pointeur non vérifiée : large-magnification',
        'portée du pointeur non vérifiée : background-hover-boundary',
        'portée du pointeur non vérifiée : three-dock-positions',
        'portée du pointeur non vérifiée : three-icon-sizes',
        'portée du pointeur non vérifiée : magnified-application-tooltip',
        'portée du pointeur non vérifiée : magnified-application-click',
        'portée du pointeur non vérifiée : expanded-button-hit-targets',
        'portée du pointeur non vérifiée : live-magnification-settings',
        'audit de portée incomplet (0/9 tailles et positions)',
    ]);
    assert.deepEqual(nativeReportIssues('settings', {
        cases: Array.from({length: 24}, () => ({issues: []})).with(0,
            {position: 2, height: 48, size: 64, animation: 4, issues: ['dock-outside-monitor']}),
        liveCases: Array.from({length: 12}, (_, index) => ({buttonsPreserved: index !== 0})),
        cycles: Array.from({length: 3}, (_, index) => ({cycle: index, remainingPanels: Number(index === 1), titleValid: true})),
    }), [
        '2/48/64/4: dock-outside-monitor',
        'mise à jour live 1: boutons du Dock reconstruits',
        'cycle 2: nettoyage ou panneau invalide',
    ]);
});

test('desktop interaction and layout reports detect missing checks and findings', () => {
    const report = {
        singleClickSelects: true,
        controlAdds: true,
        controlRemoves: true,
        doubleClickOpensOnce: true,
        rectangleSelects: true,
        rectangleRemoved: true,
        fileCopied: true,
        folderCopied: true,
        fileMoved: true,
        folderCreated: true,
        renamed: true,
        backgroundOpensByPointer: true,
        multipleMenu: ['Ouvrir les éléments sélectionnés'],
        fileMenu: ['Renommer…', 'Propriétés'],
        folderMenu: ['Coller'],
        backgroundActions: ['Tout sélectionner'],
    };
    assert.deepEqual(nativeReportIssues('desktop', report), []);
    assert.deepEqual(nativeReportIssues('desktop', {...report, fileMoved: false}), [
        'déplacement du fichier non vérifié',
    ]);

    const layoutCases = Array.from({length: 81}, () => ({issues: []}));
    layoutCases[0] = {cell: 64, iconSize: 24, labelPosition: 0, alignment: 0,
        issues: ['icons-share-same-position']};
    assert.deepEqual(nativeReportIssues('layout', layoutCases), [
        '64/24/0/0: icons-share-same-position',
    ]);
    assert.deepEqual(nativeReportIssues('layout', []), ['audit de grille incomplet (0/81 cas)']);

    const widgetCases = Array.from({length: 54}, () => ({overflowing: []}));
    widgetCases[0] = {position: 0, size: 24, format: 0, widget: 'clock', overflowing: [{}]};
    assert.deepEqual(nativeReportIssues('widgets', widgetCases), [
        '0/24/0/clock: contenu débordant',
    ]);
    assert.deepEqual(nativeReportIssues('widgets', []), ['audit des widgets incomplet (0/54 cas)']);

    assert.deepEqual(nativeReportIssues('panel', {cases: [
        {height: 24, kind: 'sound', issues: []},
        {height: 48, kind: 'network', issues: ['popup-not-visible-or-outside-monitor']},
    ]}), ['48/network: popup-not-visible-or-outside-monitor']);
    assert.deepEqual(nativeReportIssues('panel', {cases: []}), [
        'menus du panneau absents pour la hauteur 24',
        'menus du panneau absents pour la hauteur 48',
    ]);

    assert.deepEqual(nativeReportIssues('notifications', {
        cases: Array.from({length: 9}, (_, position) => ({position, mapped: true})),
        panelControls: [{visible: false, controls: [false]}, {visible: true, controls: [true]}],
        listed: true,
        cleared: true,
        hiddenWhenEmpty: true,
        hiddenAfterClear: true,
        hasPositionHandler: true,
        distinctPositions: 9,
    }), []);
    assert.deepEqual(nativeReportIssues('notifications', {
        cases: [],
        panelControls: [],
        distinctPositions: 0,
    }), [
        'positions de notification incomplètes (0/9)',
        'positions distinctes insuffisantes (0/9)',
        'gestionnaire de position absent',
        'notification absente du menu',
        'effacement de la notification non vérifié',
        'bouton de notification visible alors que la liste est vide',
        'états de visibilité du panneau incomplets',
    ]);

    const marginCases = Array.from({length: 18}, () => ({issues: []}));
    marginCases[0] = {position: 0, hover: 4, edgeMargin: 24, windowMargin: 0,
        issues: ['first-and-second-maximization-differ']};
    assert.deepEqual(nativeReportIssues('margins', marginCases), [
        '0/4/24/0: first-and-second-maximization-differ',
    ]);
    assert.deepEqual(nativeReportIssues('margins', []), ['audit des marges incomplet (0/18 cas)']);

    const settingCases = ['panel-show-clock', 'widget-manager-request'].map(key => ({
        key, writable: true, readBack: true, restored: true, runtimeHealthy: true, issues: [],
    }));
    assert.deepEqual(nativeReportIssues('options', {
        schemaKeyCount: 2,
        testedKeys: settingCases.map(testCase => testCase.key),
        cases: settingCases,
        cleanupIssues: [],
    }), []);
    assert.deepEqual(nativeReportIssues('options', {
        schemaKeyCount: 2,
        testedKeys: ['panel-show-clock'],
        cases: [settingCases[0], {...settingCases[1], restored: false, issues: ['restore-failed']}],
        cleanupIssues: ['widget-manager-request: final value mismatch'],
    }), [
        'liste des clés GSettings incomplète ou dupliquée',
        'widget-manager-request: aller-retour, restauration ou runtime invalide',
        'widget-manager-request: restore-failed',
        'restauration finale: widget-manager-request: final value mismatch',
    ]);
    assert.deepEqual(nativeReportIssues('daily', {
        steps: Array.from({length: 8}, (_, index) => ({id: `daily-${index}`, passed: true, issues: []})),
    }), []);
    assert.deepEqual(nativeReportIssues('daily', {steps: [
        {id: 'open-app-grid', passed: false, issues: ['timed out']},
    ]}), [
        'parcours quotidien incomplet (1/8 étapes)',
        'open-app-grid: étape non vérifiée',
        'open-app-grid: timed out',
    ]);
});
