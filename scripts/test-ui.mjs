#!/usr/bin/env node

import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {StringDecoder} from 'node:string_decoder';
import blessed from 'blessed';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionId = 'g-os@greg.local';
const visualScript = join(root, 'tests', 'gnome-visual.js');
const cacheRoot = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'),
    'g-os-extension', 'test-runs');
const testDefinitions = [
    {id: 'unit', title: 'Suite complète (build + tests unitaires)', native: false},
    {id: 'dock', title: 'Dock : positions, tailles, souris et clics (12 cas)', native: true},
    {id: 'motion', title: 'Animations de survol et reprises rapides (30 cas)', native: true},
    {id: 'hit-testing', title: 'Dock : zones transparentes et clics transmis (6 configurations)', native: true},
    {id: 'appearance', title: 'Dock : apparence et options visuelles (70 cas)', native: true},
    {id: 'reachability', title: 'Dock : portée du pointeur selon la taille (9 cas)', native: true},
    {id: 'settings', title: 'Réglages et reconstructions (24 configurations)', native: true},
    {id: 'desktop', title: 'Bureau : clics, sélection et opérations fichiers', native: true},
    {id: 'layout', title: 'Bureau : grille et placement des icônes (81 cas)', native: true},
    {id: 'widgets', title: 'Widgets du Dock : ajustement et orientation (54 cas)', native: true},
    {id: 'panel', title: 'Panneau : menus natifs et dimensions', native: true},
    {id: 'notifications', title: 'Notifications : positions et commandes (9 positions)', native: true},
    {id: 'margins', title: 'Dock : marges et doubles maximisations (18 cas)', native: true},
    {id: 'options', title: 'Réglages : audit des clés GSettings utilisateur et internes', native: true},
    {id: 'daily', title: 'Parcours quotidien : Dock, applications, panneau et notifications', native: true},
];
const allDefinition = {id: 'all', title: 'Tout lancer (suite complète + tests GNOME)', native: true};
const testById = new Map(testDefinitions.map(test => [test.id, test]));

export function progressForLine(testId, line, passed = 0, failed = 0) {
    if (testId === 'unit') {
        if (line.startsWith('✔'))
            passed++;
        if (line.startsWith('✖'))
            failed++;
        const total = line.match(/^ℹ tests (\d+)$/);
        return {passed, failed, total: total ? Number(total[1]) : null,
            text: total ? `${passed}/${total[1]} tests terminés` : `${passed} tests terminés`};
    }

    const dock = line.match(/^Exploratory Dock (\d+)\/(\d+)\/(\d+): (.*)$/);
    if (dock) {
        const completed = passed + 1;
        const issues = dock[4] === 'no issue detected' ? 0 : dock[4].split(',').length;
        return {passed: completed, failed: failed + Number(issues > 0), total: 12,
            text: `Cas ${completed}/12 · ${dock[1] === '0' ? 'bas' : dock[1] === '1' ? 'gauche' : 'droite'} · ` +
                `${dock[2]} px · ${dock[3]} %${issues ? ` · ${issues} défaut(s)` : ''}`};
    }

    const motion = line.match(/^Dock motion audit: (\d+) cases, (\d+) with findings/);
    if (motion)
        return {passed: Number(motion[1]) - Number(motion[2]), failed: Number(motion[2]), total: Number(motion[1]),
            text: `${motion[1]} configurations · ${motion[2]} défaut(s)`};

    const hitTesting = line.match(/^Dock hit-test audit: (\d+) configurations, (\d+) transparent clicks, (\d+) click-throughs, (\d+) with findings/);
    if (hitTesting)
        return {passed: Number(hitTesting[1]) - Number(hitTesting[4]), failed: Number(hitTesting[4]),
            total: Number(hitTesting[1]), text: `${hitTesting[1]} configurations · ${hitTesting[2]} clics transparents · ` +
                `${hitTesting[3]} transmis · ${hitTesting[4]} défaut(s)`};

    const appearance = line.match(/^Dock appearance audit: (\d+) cases, (\d+) with findings/);
    if (appearance)
        return {passed: Number(appearance[1]) - Number(appearance[2]), failed: Number(appearance[2]),
            total: Number(appearance[1]), text: `${appearance[1]} options visuelles · ${appearance[2]} défaut(s)`};

    const reachability = line.match(/^Large magnification fits and stays pointer-reachable at dock position (\d+), size (\d+)/);
    if (reachability) {
        const completed = passed + 1;
        return {passed: completed, failed, total: 9,
            text: `Cas ${completed}/9 · ${['bas', 'gauche', 'droite'][Number(reachability[1])]} · ${reachability[2]} px`};
    }

    const settings = line.match(/^Native state stress: (\d+) configurations, (\d+) with findings/);
    if (settings)
        return {passed: Number(settings[1]) - Number(settings[2]), failed: Number(settings[2]), total: Number(settings[1]),
            text: `${settings[1]} configurations · ${settings[2]} défaut(s)`};

    const layout = line.match(/^Desktop layout audit: (\d+) configurations, (\d+) with findings/);
    if (layout)
        return {passed: Number(layout[1]) - Number(layout[2]), failed: Number(layout[2]), total: Number(layout[1]),
            text: `${layout[1]} configurations · ${layout[2]} défaut(s)`};

    const desktop = line.match(/^Desktop interaction audit: (\d+) checks, (\d+) with findings/);
    if (desktop)
        return {passed: Number(desktop[1]) - Number(desktop[2]), failed: Number(desktop[2]), total: Number(desktop[1]),
            text: `${desktop[1]} vérifications · ${desktop[2]} défaut(s)`};

    const widgets = line.match(/^Dock widget full-content fitting passes (\d+) native cases/);
    if (widgets)
        return {passed: Number(widgets[1]), failed: 0, total: Number(widgets[1]),
            text: `${widgets[1]} configurations vérifiées`};

    const panel = line.match(/^Native panel controls: (\d+) popups, (\d+) with findings/);
    if (panel)
        return {passed: Number(panel[1]) - Number(panel[2]), failed: Number(panel[2]), total: Number(panel[1]),
            text: `${panel[1]} menus · ${panel[2]} défaut(s)`};

    const notifications = line.match(/^Native notification controls: handler=(true|false), distinct positions=(\d+),/);
    if (notifications) {
        const passed = notifications[1] === 'true' && Number(notifications[2]) === 9 ? 9 : 0;
        return {passed, failed: 9 - passed, total: 9, text: `${passed}/9 positions distinctes`};
    }

    const margins = line.match(/^Native Dock margin audit: (\d+) cases, (\d+) with findings/);
    if (margins)
        return {passed: Number(margins[1]) - Number(margins[2]), failed: Number(margins[2]), total: Number(margins[1]),
            text: `${margins[1]} cas · ${margins[2]} défaut(s)`};

    const options = line.match(/^Native settings audit: (\d+) keys, (\d+) with findings/);
    if (options)
        return {passed: Number(options[1]) - Number(options[2]), failed: Number(options[2]), total: Number(options[1]),
            text: `${options[1]} clés GSettings · ${options[2]} défaut(s)`};

    const daily = line.match(/^Daily usage: (\d+) steps, (\d+) with findings/);
    if (daily)
        return {passed: Number(daily[1]) - Number(daily[2]), failed: Number(daily[2]), total: Number(daily[1]),
            text: `${daily[1]} étapes · ${daily[2]} défaut(s)`};

    return {passed, failed, total: null, text: passed ? `${passed} étapes terminées` : 'Initialisation GNOME…'};
}

export function nativeReportIssues(testId, report) {
    const issues = [];
    if (testId === 'dock') {
        if ((report.cases ?? []).length !== 12)
            issues.push(`matrice Dock incomplète (${(report.cases ?? []).length}/12 cas)`);
        for (const testCase of report.cases ?? []) {
            for (const issue of testCase.issues ?? [])
                issues.push(`${testCase.position}/${testCase.size}/${testCase.maximum}: ${issue}`);
        }
    } else if (testId === 'motion') {
        if (!Array.isArray(report) || report.length !== 30)
            issues.push(`audit d'animation incomplet (${report.length ?? 0}/30 cas)`);
        for (const testCase of report ?? []) {
            for (const issue of testCase.issues ?? [])
                issues.push(`${testCase.position}/${testCase.mode}/${testCase.duration}: ${issue}`);
        }
    } else if (testId === 'hit-testing') {
        const cases = report.cases ?? [];
        if (cases.length !== 6)
            issues.push(`audit des clics transparents incomplet (${cases.length}/6 configurations)`);
        if (!report.windowReady)
            issues.push('fenêtre de contrôle des clics absente');
        if (report.transparentClicks < 18)
            issues.push(`échantillons transparents insuffisants (${report.transparentClicks ?? 0}/18)`);
        if (report.clickThroughs !== 0)
            issues.push(`${report.clickThroughs} clic(s) transmis à la fenêtre sous le Dock`);
        for (const testCase of cases) {
            if ((testCase.samples ?? []).length < 3)
                issues.push(`${testCase.position}/${testCase.size}: moins de 3 échantillons`);
            for (const issue of testCase.issues ?? [])
                issues.push(`${testCase.position}/${testCase.size}: ${issue}`);
        }
    } else if (testId === 'appearance') {
        if ((report.appearanceCases ?? []).length !== 64)
            issues.push(`audit d'apparence incomplet (${(report.appearanceCases ?? []).length}/64 combinaisons)`);
        if ((report.metricsCases ?? []).length !== 6)
            issues.push(`audit des dimensions incomplet (${(report.metricsCases ?? []).length}/6 cas)`);
        for (const testCase of [...(report.appearanceCases ?? []), ...(report.metricsCases ?? [])]) {
            for (const issue of testCase.issues ?? [])
                issues.push(`${testCase.radius ?? testCase.position}/${testCase.background ?? testCase.animation}: ${issue}`);
        }
    } else if (testId === 'reachability') {
        const verified = report.log?.verifiedCases ?? [];
        for (const required of ['large-magnification', 'background-hover-boundary', 'three-dock-positions',
            'three-icon-sizes', 'magnified-application-tooltip', 'magnified-application-click',
            'expanded-button-hit-targets', 'live-magnification-settings']) {
            if (!verified.includes(required))
                issues.push(`portée du pointeur non vérifiée : ${required}`);
        }
        const cases = verified.filter(item => item.startsWith('case:'));
        if (cases.length !== 9)
            issues.push(`audit de portée incomplet (${cases.length}/9 tailles et positions)`);
    } else if (testId === 'settings') {
        if ((report.cases ?? []).length !== 24)
            issues.push(`stress des réglages incomplet (${(report.cases ?? []).length}/24 configurations)`);
        if ((report.liveCases ?? []).length !== 12)
            issues.push(`mises à jour live incomplètes (${(report.liveCases ?? []).length}/12)`);
        if ((report.cycles ?? []).length !== 3)
            issues.push(`cycles d'activation incomplets (${(report.cycles ?? []).length}/3)`);
        for (const testCase of report.cases ?? []) {
            for (const issue of testCase.issues ?? [])
                issues.push(`${testCase.position}/${testCase.height}/${testCase.size}/${testCase.animation}: ${issue}`);
        }
        for (const [index, testCase] of (report.liveCases ?? []).entries()) {
            if (!testCase.buttonsPreserved)
                issues.push(`mise à jour live ${index + 1}: boutons du Dock reconstruits`);
        }
        for (const testCase of report.cycles ?? []) {
            if (testCase.remainingPanels !== 0 || !testCase.titleValid)
                issues.push(`cycle ${testCase.cycle + 1}: nettoyage ou panneau invalide`);
        }
    } else if (testId === 'desktop') {
        const checks = [
            ['sélection au clic simple', report.singleClickSelects],
            ['ajout Ctrl à la sélection', report.controlAdds],
            ['retrait Ctrl de la sélection', report.controlRemoves],
            ['ouverture au double clic', report.doubleClickOpensOnce],
            ['sélection rectangulaire', report.rectangleSelects],
            ['nettoyage de la sélection rectangulaire', report.rectangleRemoved],
            ['copie du fichier', report.fileCopied],
            ['copie du dossier', report.folderCopied],
            ['déplacement du fichier', report.fileMoved],
            ['création du dossier', report.folderCreated],
            ['renommage', report.renamed],
            ['menu contextuel du bureau', report.backgroundOpensByPointer],
            ['actions de sélection multiple', report.multipleMenu?.includes('Ouvrir les éléments sélectionnés') &&
                !report.multipleMenu.includes('Renommer…')],
            ['actions du menu fichier', report.fileMenu?.includes('Renommer…') && report.fileMenu.includes('Propriétés')],
            ['action Coller du menu dossier', report.folderMenu?.includes('Coller')],
            ['action Tout sélectionner du bureau', report.backgroundActions?.includes('Tout sélectionner')],
        ];
        for (const [label, passed] of checks) {
            if (!passed)
                issues.push(`${label} non vérifié`);
        }
    } else if (testId === 'layout') {
        if (!Array.isArray(report) || report.length !== 81)
            issues.push(`audit de grille incomplet (${report.length ?? 0}/81 cas)`);
        for (const testCase of report ?? []) {
            for (const issue of testCase.issues ?? [])
                issues.push(`${testCase.cell}/${testCase.iconSize}/${testCase.labelPosition}/${testCase.alignment}: ${issue}`);
        }
    } else if (testId === 'widgets') {
        if (!Array.isArray(report) || report.length !== 54)
            issues.push(`audit des widgets incomplet (${report.length ?? 0}/54 cas)`);
        for (const testCase of report ?? []) {
            if (testCase.overflowing?.length)
                issues.push(`${testCase.position}/${testCase.size}/${testCase.format}/${testCase.widget}: contenu débordant`);
        }
    } else if (testId === 'panel') {
        const cases = report.cases ?? [];
        for (const height of [24, 48]) {
            if (!cases.some(testCase => testCase.height === height))
                issues.push(`menus du panneau absents pour la hauteur ${height}`);
        }
        for (const testCase of cases) {
            for (const issue of testCase.issues ?? [])
                issues.push(`${testCase.height}/${testCase.kind}: ${issue}`);
        }
    } else if (testId === 'notifications') {
        const cases = report.cases ?? [];
        if (cases.length !== 9)
            issues.push(`positions de notification incomplètes (${cases.length}/9)`);
        if (report.distinctPositions !== 9)
            issues.push(`positions distinctes insuffisantes (${report.distinctPositions ?? 0}/9)`);
        if (!report.hasPositionHandler)
            issues.push('gestionnaire de position absent');
        if (!report.listed)
            issues.push('notification absente du menu');
        if (!report.cleared)
            issues.push('effacement de la notification non vérifié');
        if (!report.hiddenWhenEmpty || !report.hiddenAfterClear)
            issues.push('bouton de notification visible alors que la liste est vide');
        for (const testCase of cases) {
            if (!testCase.mapped)
                issues.push(`bannière non affichée à la position ${testCase.position}`);
        }
        for (const panelState of report.panelControls ?? []) {
            if (panelState.controls.some(visible => visible !== panelState.visible))
                issues.push(`visibilité du bouton incohérente (réglage ${panelState.visible})`);
        }
        if (!report.panelControls?.some(panelState => panelState.visible === false) ||
            !report.panelControls?.some(panelState => panelState.visible === true))
            issues.push('états de visibilité du panneau incomplets');
    } else if (testId === 'margins') {
        if (!Array.isArray(report) || report.length !== 18)
            issues.push(`audit des marges incomplet (${report.length ?? 0}/18 cas)`);
        for (const testCase of report ?? []) {
            for (const issue of testCase.issues ?? [])
                issues.push(`${testCase.position}/${testCase.hover}/${testCase.edgeMargin}/${testCase.windowMargin}: ${issue}`);
        }
    } else if (testId === 'options') {
        const cases = report.cases ?? [];
        const testedKeys = report.testedKeys ?? [];
        const caseKeys = cases.map(testCase => testCase.key);
        if (!report.schemaKeyCount || cases.length !== report.schemaKeyCount)
            issues.push(`audit GSettings incomplet (${cases.length}/${report.schemaKeyCount ?? 0} clés)`);
        if (testedKeys.length !== report.schemaKeyCount ||
            new Set(testedKeys).size !== testedKeys.length ||
            caseKeys.length !== testedKeys.length ||
            new Set(caseKeys).size !== caseKeys.length ||
            cases.some(testCase => !testedKeys.includes(testCase.key)))
            issues.push('liste des clés GSettings incomplète ou dupliquée');
        for (const testCase of cases) {
            if (!testCase.writable)
                issues.push(`${testCase.key}: clé non modifiable dans la session de test`);
            if (!testCase.readBack || !testCase.restored || !testCase.runtimeHealthy)
                issues.push(`${testCase.key}: aller-retour, restauration ou runtime invalide`);
            for (const issue of testCase.issues ?? [])
                issues.push(`${testCase.key}: ${issue}`);
        }
        for (const key of report.cleanupIssues ?? [])
            issues.push(`restauration finale: ${key}`);
    } else if (testId === 'daily') {
        const steps = report.steps ?? [];
        if (steps.length !== 8)
            issues.push(`parcours quotidien incomplet (${steps.length}/8 étapes)`);
        for (const step of steps) {
            if (!step.passed && !step.skipped)
                issues.push(`${step.id}: étape non vérifiée`);
            if (step.skipped && !step.skipReason)
                issues.push(`${step.id}: étape ignorée sans raison`);
            for (const issue of step.issues ?? [])
                issues.push(`${step.id}: ${issue}`);
        }
    }
    return issues;
}

function stripAnsi(value) {
    return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

function formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function timestampId(date = new Date()) {
    return date.toISOString().replaceAll(/[:.]/g, '-');
}

async function loadHistory() {
    const path = join(cacheRoot, 'history.json');
    try {
        return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw new Error(`Impossible de lire l'historique des tests (${path}): ${error.message}`);
    }
}

async function writeSummary(run) {
    await writeFile(join(run.directory, 'summary.json'), `${JSON.stringify({
        id: run.id,
        selection: run.selection,
        startedAt: run.startedAt,
        endedAt: run.endedAt ?? null,
        status: run.status,
        tests: run.tests,
    }, null, 2)}\n`);
}

function saveHistory(history, run) {
    const next = [{
        id: run.id,
        selection: run.selection,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        status: run.status,
        tests: run.tests.map(({id, status, durationMs}) => ({id, status, durationMs})),
        directory: run.directory,
    }, ...history.filter(item => item.id !== run.id)].slice(0, 20);
    return writeFile(join(cacheRoot, 'history.json'), `${JSON.stringify(next, null, 2)}\n`);
}

function createTestRun(command, args, options) {
    return new Promise(resolvePromise => {
        const decoder = new StringDecoder('utf8');
        const log = createWriteStream(options.logPath);
        let lineBuffer = '';
        let child;
        let finished = false;
        try {
            child = spawn(command, args, {
                cwd: root,
                env: options.env ?? process.env,
                detached: process.platform !== 'win32',
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (error) {
            log.end();
            resolvePromise({status: 'failed', exitCode: null, signal: null, error: error.message});
            return;
        }

        options.setChild(child);
        const consume = chunk => {
            const text = decoder.write(chunk);
            log.write(text);
            lineBuffer += text;
            const lines = lineBuffer.split(/\r?\n/);
            lineBuffer = lines.pop() ?? '';
            for (const line of lines)
                options.onLine(line);
        };
        child.stdout.on('data', consume);
        child.stderr.on('data', consume);
        child.once('error', error => {
            if (finished)
                return;
            finished = true;
            log.end();
            options.setChild(null);
            resolvePromise({status: 'failed', exitCode: null, signal: null, error: error.message});
        });
        child.once('close', (exitCode, signal) => {
            if (finished)
                return;
            finished = true;
            const remaining = decoder.end();
            if (remaining) {
                log.write(remaining);
                lineBuffer += remaining;
            }
            if (lineBuffer)
                options.onLine(lineBuffer);
            log.end();
            options.setChild(null);
            resolvePromise({status: options.cancelled() ? 'cancelled' : exitCode === 0 ? 'passed' : 'failed',
                exitCode, signal});
        });
    });
}

async function prepareNativeEnvironment(outputDirectory) {
    const tempRoot = await mkdtemp(join(tmpdir(), 'g-os-test-ui-'));
    const configHome = join(tempRoot, 'config');
    const dataHome = join(tempRoot, 'data');
    const cacheHome = join(tempRoot, 'cache');
    const runtimeHome = join(tempRoot, 'runtime');
    const extensionDirectory = join(dataHome, 'gnome-shell', 'extensions', extensionId);
    await Promise.all([
        mkdir(configHome, {recursive: true}),
        mkdir(cacheHome, {recursive: true}),
        mkdir(runtimeHome, {recursive: true, mode: 0o700}),
        mkdir(dirname(extensionDirectory), {recursive: true}),
        mkdir(outputDirectory, {recursive: true}),
        writeFile(join(tempRoot, 'dconf-profile'), 'user-db:user\n'),
    ]);
    await symlink(join(root, 'dist'), extensionDirectory, 'dir');

    const env = {...process.env,
        DCONF_PROFILE: join(tempRoot, 'dconf-profile'),
        XDG_CONFIG_HOME: configHome,
        XDG_DATA_HOME: dataHome,
        XDG_CACHE_HOME: cacheHome,
        XDG_RUNTIME_DIR: runtimeHome,
        MACOS_VISUAL_OUTPUT: outputDirectory,
        SHELL_PERF_OUTPUT: join(outputDirectory, 'result.json'),
    };
    for (const key of ['G_OS_FEATURE_TEST', 'G_OS_EXPLORATORY_TEST', 'G_OS_INKSCAPE_MENU_TEST',
        'G_OS_GLOBAL_MENU_TEST', 'G_OS_WINDOW_PREVIEW_TEST', 'G_OS_COVERFLOW_TEST',
        'G_OS_MAGNIFICATION_TEST', 'G_OS_DOCK_CONTEXT_TEST', 'G_OS_APP_GRID_FAVORITES_TEST',
        'G_OS_RESERVED_OVERVIEW_TEST', 'G_OS_DOCK_APP_GRID_DROP_TEST'])
        delete env[key];
    return {tempRoot, env};
}

async function readJson(path, description) {
    try {
        return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
        throw new Error(`${description} manquant ou invalide (${path}): ${error.message}`);
    }
}

function nativeArtifacts(testId) {
    if (testId === 'dock')
        return 'exploratory-dock.json';
    if (testId === 'motion')
        return 'dock-motion-audit.json';
    if (testId === 'hit-testing')
        return 'dock-hit-testing.json';
    if (testId === 'appearance')
        return 'dock-appearance.json';
    if (testId === 'reachability')
        return 'result.json';
    if (testId === 'settings')
        return 'state-stress.json';
    if (testId === 'desktop')
        return 'desktop-interactions.json';
    if (testId === 'layout')
        return 'desktop-layout-audit.json';
    if (testId === 'widgets')
        return 'dock-widget-fit.json';
    if (testId === 'panel')
        return 'panel-controls.json';
    if (testId === 'notifications')
        return 'notification-controls.json';
    if (testId === 'options')
        return 'settings-audit.json';
    if (testId === 'daily')
        return 'daily-usage.json';
    return 'dock-margins.json';
}

function nativeFeature(testId) {
    return {
        motion: 'dock-motion-audit',
        'hit-testing': 'dock-hit-testing',
        appearance: 'dock-appearance',
        reachability: 'magnification',
        settings: 'state-stress',
        desktop: 'desktop-interactions',
        layout: 'desktop-layout-audit',
        widgets: 'dock-widget-fit',
        panel: 'panel',
        notifications: 'notifications',
        margins: 'dock-margins',
        options: 'settings-audit',
        daily: 'daily-usage',
    }[testId];
}

async function runNative(test, context) {
    const outputDirectory = join(context.run.directory, test.id);
    const {tempRoot, env} = await prepareNativeEnvironment(outputDirectory);
    const output = join(outputDirectory, nativeArtifacts(test.id));
    const scriptEnv = test.id === 'dock' ? {G_OS_EXPLORATORY_TEST: '1'}
        : {G_OS_FEATURE_TEST: nativeFeature(test.id)};
    Object.assign(env, scriptEnv);
    const scriptArguments = ['--headless', '--force-animations', '--virtual-monitor', '1280x720',
        '--wayland-display', `g-os-test-${process.pid}`, '--automation-script', visualScript];
    const debugShell = process.env.G_OS_GNOME_SHELL_GDB === '1';
    const gdbScript = join(tempRoot, 'gnome-shell.gdb');
    if (debugShell) {
        await writeFile(gdbScript, [
            'set pagination off',
            'set breakpoint pending on',
            'start',
            'break st_scroll_view_get_preferred_height',
            'commands 2',
            'silent',
            'if (void*)clutter_actor_get_stage((void*)$rdi) == 0',
            'printf "DETACHED StScrollView=%p name=%s parent=%p\\n", $rdi, (char*)clutter_actor_get_name((void*)$rdi), (void*)clutter_actor_get_parent((void*)$rdi)',
            'bt 18',
            'quit 1',
            'end',
            'continue',
            'end',
            'continue',
            'thread apply all bt 32',
            'quit 1',
        ].join('\n'));
    }
    const shellCommand = debugShell ? 'gdb' : 'gnome-shell';
    const shellArguments = debugShell
        ? ['--batch', '--quiet', '-x', gdbScript, '--args', 'gnome-shell', ...scriptArguments]
        : ['gnome-shell', ...scriptArguments];
    const commandArguments = ['--', 'bash', '-c',
        `gsettings set org.gnome.shell enabled-extensions "[\\"${extensionId}\\"]" && exec "$@"`,
        '--', shellCommand, ...shellArguments];
    const started = Date.now();
    let result;
    try {
        result = await createTestRun('dbus-run-session', commandArguments, {
            env, logPath: join(context.run.directory, `${test.id}.log`),
            setChild: context.setChild, cancelled: context.cancelled,
            onLine: line => context.onLine(test, line),
        });
        if (result.status === 'passed') {
            const report = await readJson(output, 'Rapport GNOME');
            const nativeReport = await readJson(join(outputDirectory, nativeArtifacts(test.id)), 'Rapport du scénario');
            const issues = nativeReportIssues(test.id, nativeReport);
            result = {...result, status: issues.length ? 'failed' : 'passed',
                checkedCases: test.id === 'dock' ? nativeReport.cases?.length ?? 0
                    : ['motion', 'layout', 'widgets', 'margins'].includes(test.id) ? nativeReport.length
                        : test.id === 'hit-testing' ? nativeReport.cases?.length ?? 0
                            : test.id === 'appearance' ?
                                (nativeReport.appearanceCases?.length ?? 0) + (nativeReport.metricsCases?.length ?? 0)
                                : test.id === 'reachability' ? nativeReport.log?.verifiedCases?.length ?? 0
                                : test.id === 'desktop' ? 16
                                    : test.id === 'options' ? nativeReport.testedKeys?.length ?? 0
                                        : test.id === 'daily' ? nativeReport.steps?.length ?? 0
                                            : nativeReport.cases?.length ?? 0,
                issues, verifiedCases: report.log?.verifiedCases ?? []};
        }
    } catch (error) {
        result = {status: 'failed', exitCode: null, signal: null, error: error.message};
    } finally {
        await rm(tempRoot, {recursive: true, force: true});
    }
    return {...result, durationMs: Date.now() - started, outputDirectory};
}

async function runCommand(test, context, command, args, logName, env = process.env) {
    const started = Date.now();
    const result = await createTestRun(command, args, {
        env, logPath: join(context.run.directory, logName),
        setChild: context.setChild, cancelled: context.cancelled,
        onLine: line => context.onLine(test, line),
    });
    return {...result, durationMs: Date.now() - started};
}

const colorEnabled = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
const paint = (text, code) => colorEnabled ? `\u001b[${code}m${text}\u001b[0m` : text;

function padLine(text, width) {
    const plain = stripAnsi(text);
    const clipped = plain.length > width
        ? width <= 3 ? plain.slice(0, width) : `${plain.slice(0, width - 3)}...`
        : text;
    return clipped + ' '.repeat(Math.max(0, width - Math.min(plain.length, width)));
}

function colorizeLogLine(line) {
    const plain = stripAnsi(line);
    const message = plain.replace(/^›\s*/, '');
    if (/(?:✖|✗|❌|\b(?:failed|failure|error|critical)\b|[1-9]\d*\s+(?:with findings|défaut))/i.test(message))
        return paint(plain, '31');
    if (/\b(?:warning|warn)\b/i.test(message))
        return paint(plain, '33');
    if (/(?:✔|✓|❯|\bpassed\b|\bsuccess\b|no issue detected|0 with findings|0 défaut)/i.test(message))
        return paint(plain, '32');
    if (/^(?:Desktop|Dock|Native|Exploratory)\b/i.test(message))
        return paint(plain, '36');
    return paint(plain, '90');
}

function panel(title, lines, width, color = '36', decorateLine = line => line) {
    const innerWidth = width - 4;
    const titleText = ` ${title} `;
    const top = `┌─${paint(titleText, `1;${color}`)}${'─'.repeat(Math.max(1, width - titleText.length - 3))}┐`;
    const body = lines.map(line => `│ ${decorateLine(padLine(line, innerWidth))} │`);
    return [top, ...body, `└${'─'.repeat(width - 2)}┘`].map(line => paint(line, color)).join('\n');
}

function progressBar(current, width = 24) {
    if (!current.total) {
        const cursor = Math.floor(Date.now() / 180) % width;
        return `${'░'.repeat(cursor)}${paint('█', '36')}${'░'.repeat(width - cursor - 1)}`;
    }
    const ratio = Math.min(1, (current.passed + current.failed) / current.total);
    const filled = Math.round(ratio * width);
    return `${paint('█'.repeat(filled), current.failed ? '31' : '32')}${'░'.repeat(width - filled)}`;
}

function statusMark(status, selected = false) {
    if (selected)
        return paint('▸', '36');
    if (status === 'passed')
        return paint('✓', '32');
    if (status === 'failed')
        return paint('✕', '31');
    if (status === 'cancelled')
        return paint('−', '33');
    return paint('○', '90');
}

function padPanel(panelText, height) {
    const lines = panelText.split('\n');
    const width = stripAnsi(lines[0]).length;
    while (lines.length < height)
        lines.splice(-1, 0, `│${' '.repeat(width - 2)}│`);
    return lines;
}

function joinPanels(left, right, gap = 2) {
    const height = Math.max(left.length, right.length);
    const leftWidth = stripAnsi(left[0]).length;
    const rightWidth = stripAnsi(right[0]).length;
    const blank = ' '.repeat(gap);
    const rows = [];
    for (let index = 0; index < height; index++) {
        const first = left[index] ?? `│${' '.repeat(leftWidth - 2)}│`;
        const second = right[index] ?? `│${' '.repeat(rightWidth - 2)}│`;
        rows.push(`${first}${blank}${second}`);
    }
    return rows.join('\n');
}

function fitPanelLines(lines, height, fill = false) {
    const capacity = Math.max(1, height - 2);
    let fitted = lines;
    if (lines.length > capacity) {
        if (capacity === 1)
            fitted = [`… ${lines.length} lignes masquées`];
        else {
            const hidden = lines.length - capacity + 1;
            fitted = [...lines.slice(0, capacity - 2), `… ${hidden} lignes masquées`, lines.at(-1)];
        }
    }
    return fill ? [...fitted, ...Array(Math.max(0, capacity - fitted.length)).fill('')] : fitted;
}

function compactDashboard(width, height, selection, items, history, state) {
    const current = state.current;
    const activityLimit = Math.max(0, height - 4);
    const activity = current?.lastLines ?? history.slice(0, 3).map(run =>
        `${run.selection} · ${run.status}`);
    const lines = [
        'G-OS / TEST LAB',
        current ? current.title : `Scénario ${selection + 1}/${items.length} : ${items[selection]?.title ?? ''}`,
        current ? `${current.progressText} · ${formatDuration(Date.now() - current.startedAt)}`
            : '↑/↓ choisir · Entrée lancer · q quitter',
        ...(activityLimit ? activity.slice(-activityLimit) : []),
        'q arrêter · journaux conservés',
    ];
    const visible = lines.length <= height ? lines : [...lines.slice(0, height - 1), lines.at(-1)];
    return visible.map(line => padLine(line, width)).join('\n');
}

export function renderDashboard(selection, history, state) {
    const width = Math.max(1, process.stdout.columns || 80);
    const height = Math.max(1, process.stdout.rows || 24);
    const items = [...testDefinitions, allDefinition];
    if (width < 24 || height < 17)
        return compactDashboard(width, height, selection, items, history, state);

    const statuses = new Map((state.run?.tests ?? []).map(test => [test.id, test.status]));
    const suiteLines = items.map((item, index) =>
        `${statusMark(statuses.get(item.id), index === selection)} ${index + 1}  ${item.title}`);

    const current = state.current;
    const elapsed = current ? formatDuration(Date.now() - current.startedAt) : null;
    const summaryLines = current
        ? [`${paint('EN COURS', '1;33')} · ${current.stage}`,
            progressBar(current, Math.max(4, Math.min(24, width - 4))),
            `${current.progressText} · ${elapsed}`,
            `Étape: ${state.run?.tests.length ?? 0}/${state.run?.selection === 'all' ? testDefinitions.length : 1}`,
            `Log: ${current.logPath}`]
        : state.lastRun
            ? [`${paint(state.lastRun.status.toUpperCase(), state.lastRun.status === 'passed' ? '32' : '31')} · ` +
                `${formatDuration(Date.parse(state.lastRun.endedAt) - Date.parse(state.lastRun.startedAt))}`,
                ...state.lastRun.tests.slice(-4).map(test =>
                    `${statusMark(test.status)} ${test.title} · ${formatDuration(test.durationMs ?? 0)}`),
                `Résultats: ${state.lastRun.directory}`]
            : ['En attente de lancement.',
                'Les tests natifs tournent dans une session GNOME isolée.',
                'Les rapports restent disponibles dans le cache local.'];
    const blocks = [panel('G-OS  /  TEST LAB', [
        `${paint('Dock · lancement, animation, réglages et interactions', '1;37')}`,
        current
            ? `${paint('●', '33')}  ${current.title}  ·  ${elapsed}`
            : `${paint('●', '32')}  Environnement prêt  ·  GNOME Shell ${process.env.GNOME_SHELL_VERSION ?? 'natif'}`,
    ], width, '36')];
    const headerHeight = 4;
    const footerHeight = 1;
    const minimumJournalHeight = 3;
    const availablePanelHeight = height - headerHeight - footerHeight - minimumJournalHeight;
    if (width >= 92) {
        const contentHeight = Math.min(Math.max(suiteLines.length + 2, summaryLines.length + 2),
            availablePanelHeight);
        const suiteWidth = Math.floor((width - 2) * 0.46);
        const historyWidth = width - suiteWidth - 2;
        const suitePanel = panel('SCÉNARIOS', fitPanelLines(suiteLines, contentHeight), suiteWidth);
        const historyPanel = panel(current ? 'EXÉCUTION' : 'DERNIÈRE EXÉCUTION',
            fitPanelLines(summaryLines, contentHeight), historyWidth, current ? '33' : '35');
        blocks.push(joinPanels(padPanel(suitePanel, contentHeight), padPanel(historyPanel, contentHeight)));
    } else {
        const totalPanelHeight = Math.min(availablePanelHeight, suiteLines.length + summaryLines.length + 4);
        let suiteHeight = Math.min(suiteLines.length + 2, Math.max(3, Math.round(totalPanelHeight * 0.58)));
        let historyHeight = Math.min(summaryLines.length + 2, totalPanelHeight - suiteHeight);
        if (historyHeight < 3) {
            suiteHeight = Math.max(3, totalPanelHeight - 3);
            historyHeight = totalPanelHeight - suiteHeight;
        }
        blocks.push(panel('SCÉNARIOS', fitPanelLines(suiteLines, suiteHeight), width));
        blocks.push(panel(current ? 'EXÉCUTION' : 'DERNIÈRE EXÉCUTION',
            fitPanelLines(summaryLines, historyHeight), width, current ? '33' : '35'));
    }
    const usedHeight = blocks.reduce((total, block) => total + block.split('\n').length, 0);
    const journalHeight = height - usedHeight - footerHeight;
    const logCapacity = Math.max(1, journalHeight - 2);
    const logLines = current?.lastLines.length
        ? current.lastLines.slice(-logCapacity).map(line => `› ${stripAnsi(line)}`)
        : history.slice(0, logCapacity).map(run =>
            `${statusMark(run.status)} ${run.startedAt.slice(0, 16).replace('T', ' ')} · ${run.selection}`);
    if (journalHeight >= 3)
        blocks.push(panel(current ? 'JOURNAL EN DIRECT' : 'HISTORIQUE RÉCENT',
            fitPanelLines(logLines.length ? logLines : ['Aucune sortie pour le moment.'], journalHeight, true),
            width, '90', colorizeLogLine));
    const help = current
        ? width < 68 ? 'q arrêter · journaux enregistrés' : 'q arrêter proprement  ·  progression et journaux enregistrés'
        : width < 68 ? '↑/↓ choisir · Entrée lancer · q quitter'
            : '↑/↓ naviguer  ·  Entrée lancer  ·  1–9 lancement direct  ·  q quitter';
    blocks.push(paint(padLine(help, width).trimEnd(), '90'));
    return blocks.join('\n');
}

function render(state) {
    if (state.ui) {
        state.ui.refresh();
        return;
    }
    if (!process.stdout.isTTY)
        return;
    process.stdout.write('\u001b[H\u001b[2J');
    process.stdout.write(`${state.screen}\n`);
}

function colorizeBlessedLogLine(line) {
    const plain = stripAnsi(line).replace(/[{}]/g, '');
    const color = /(?:✖|✗|❌|\b(?:failed|failure|error|critical)\b|[1-9]\d*\s+(?:with findings|défaut))/i.test(plain)
        ? 'red'
        : /\b(?:warning|warn)\b/i.test(plain)
            ? 'yellow'
            : /(?:✔|✓|❯|\bpassed\b|\bsuccess\b|no issue detected|0 with findings|0 défaut)/i.test(plain)
                ? 'green'
                : /^(?:Desktop|Dock|Native|Exploratory)\b/i.test(plain) ? 'cyan' : 'white';
    return `{${color}-fg}${plain}{/${color}-fg}`;
}

function createTerminalUi(state, history, items, launchSelected, requestCancel, quit) {
    const screen = blessed.screen({
        smartCSR: true,
        title: 'G-OS Test Lab',
        fullUnicode: true,
        mouse: true,
        terminal: process.env.TERM || 'xterm-256color',
    });
    const header = blessed.box({
        top: 0, left: 0, width: '100%', height: 3,
        content: ' G-OS TEST LAB',
        border: 'line',
        style: {fg: 'white', border: {fg: 'cyan'}, bold: true},
    });
    const scenarios = blessed.list({
        top: 3, left: 0, width: '48%', height: 10,
        label: ' SCÉNARIOS ',
        border: 'line',
        keys: true,
        mouse: true,
        scrollable: true,
        alwaysScroll: true,
        scrollbar: {ch: ' ', style: {bg: 'cyan'}},
        style: {
            fg: 'white',
            border: {fg: 'cyan'},
            selected: {fg: 'black', bg: 'cyan', bold: true},
            item: {fg: 'white'},
        },
    });
    const execution = blessed.box({
        top: 3, left: '48%', width: '52%', height: 10,
        label: ' EXÉCUTION ',
        border: 'line',
        tags: true,
        style: {fg: 'white', border: {fg: 'yellow'}},
        padding: {left: 1, right: 1, top: 1},
    });
    const journal = blessed.box({
        top: 13, left: 0, width: '100%', height: 10,
        label: ' JOURNAL EN DIRECT ',
        border: 'line',
        scrollable: true,
        alwaysScroll: true,
        mouse: true,
        keys: true,
        scrollbar: {ch: ' ', style: {bg: 'gray'}},
        tags: true,
        style: {fg: 'white', border: {fg: 'gray'}},
        padding: {left: 1, right: 1},
    });
    const launchButton = blessed.button({
        top: 0, right: 14, width: 11, height: 3,
        content: ' Lancer ',
        mouse: true,
        clickable: true,
        keys: true,
        shrink: true,
        border: 'line',
        style: {
            fg: 'white', bg: 'green',
            border: {fg: 'green'},
            focus: {fg: 'black', bg: 'white'},
            hover: {fg: 'black', bg: 'white'},
        },
    });
    const stopButton = blessed.button({
        top: 0, right: 1, width: 11, height: 3,
        content: ' Arrêter ',
        mouse: true,
        clickable: true,
        keys: true,
        shrink: true,
        border: 'line',
        style: {
            fg: 'white', bg: 'red',
            border: {fg: 'red'},
            focus: {fg: 'black', bg: 'white'},
            hover: {fg: 'black', bg: 'white'},
        },
        hidden: true,
    });
    const footer = blessed.box({
        bottom: 0, left: 0, width: '100%', height: 1,
        content: ' ↑/↓ choisir · Entrée ou clic sur Lancer · clic scénario pour sélectionner · q quitter ',
        style: {fg: 'gray'},
    });
    screen.append(header);
    screen.append(scenarios);
    screen.append(execution);
    screen.append(journal);
    screen.append(launchButton);
    screen.append(stopButton);
    screen.append(footer);

    let updating = false;
    const resize = () => {
        const width = Math.max(1, screen.width);
        const height = Math.max(1, screen.height);
        const contentTop = Math.min(3, height);
        const contentHeight = Math.max(1, height - contentTop - 1);
        const wide = width >= 92 && height >= 19;
        if (width >= 48 && !state.run) {
            launchButton.show();
        } else {
            launchButton.hide();
        }
        if (width >= 48 && state.run) {
            stopButton.show();
        } else {
            stopButton.hide();
        }
        if (wide) {
            const upperHeight = Math.max(6, Math.floor(contentHeight * 0.48));
            const leftWidth = Math.floor(width * 0.47);
            scenarios.position = {top: contentTop, left: 0, width: leftWidth, height: upperHeight};
            execution.position = {top: contentTop, left: leftWidth, width: width - leftWidth, height: upperHeight};
            journal.position = {top: contentTop + upperHeight, left: 0, width,
                height: Math.max(1, height - contentTop - upperHeight - 1)};
        } else {
            const scenarioHeight = Math.min(Math.max(4, Math.floor(contentHeight * 0.43)),
                Math.max(1, contentHeight - 6));
            const executionHeight = Math.min(5, Math.max(2, contentHeight - scenarioHeight - 2));
            scenarios.position = {top: contentTop, left: 0, width, height: scenarioHeight};
            execution.position = {top: contentTop + scenarioHeight, left: 0, width, height: executionHeight};
            journal.position = {top: contentTop + scenarioHeight + executionHeight, left: 0, width,
                height: Math.max(1, height - contentTop - scenarioHeight - executionHeight - 1)};
        }
        launchButton.position = {top: 0, right: 14, width: 11, height: 3};
        stopButton.position = {top: 0, right: 1, width: 11, height: 3};
        footer.position = {bottom: 0, left: 0, width, height: 1};
        screen.render();
    };

    const refresh = () => {
        updating = true;
        const scenarioItems = items.map((item, index) => {
            const status = (state.run?.tests ?? []).find(test => test.id === item.id)?.status ??
                (state.lastRun?.tests ?? []).find(test => test.id === item.id)?.status;
            const mark = status === 'passed' ? '✓' : status === 'failed' ? '✕'
                : status === 'cancelled' ? '−' : '○';
            return `${mark}  ${index + 1}. ${item.title}`;
        });
        if (scenarioItems.some((item, index) => scenarios.ritems[index] !== item) ||
            scenarios.ritems.length !== scenarioItems.length)
            scenarios.setItems(scenarioItems);
        scenarios.select(Math.min(state.selection, items.length - 1));
        const current = state.current;
        const run = state.run ?? state.lastRun;
        const lines = current
            ? [
                `{yellow-fg}● EN COURS{/yellow-fg} · ${current.stage}`,
                current.title,
                '',
                `${stripAnsi(progressBar(current, 22))}`,
                `${current.progressText} · ${formatDuration(Date.now() - current.startedAt)}`,
                `ÉTAPES : ${state.run?.tests.length ?? 0}/${state.run?.selection === 'all' ? testDefinitions.length : 1}`,
                current.logPath,
            ]
            : run
                ? [
                    `{${run.status === 'passed' ? 'green' : 'red'}-fg}${run.status.toUpperCase()}{/${run.status === 'passed' ? 'green' : 'red'}-fg} · ` +
                        `${formatDuration(Date.parse(run.endedAt ?? new Date().toISOString()) - Date.parse(run.startedAt))}`,
                    ...run.tests.slice(-5).map(test =>
                        `${test.status === 'passed' ? '✓' : test.status === 'failed' ? '✕' : '○'} ${test.title} · ${formatDuration(test.durationMs ?? 0)}`),
                    `Résultats : ${run.directory}`,
                ]
                : [
                    'Prêt à lancer les scénarios.',
                    'Cliquez sur une ligne pour la sélectionner, puis sur Lancer.',
                    'Les scénarios GNOME utilisent un environnement temporaire.',
                    ...history.slice(0, 3).map(item =>
                        `${item.status === 'passed' ? '✓' : item.status === 'failed' ? '✕' : '○'} ${item.selection} · ${item.status}`),
                ];
        if (state.uiError)
            lines.push('', `{red-fg}Erreur : ${state.uiError.replace(/[{}]/g, '')}{/red-fg}`);
        execution.setContent(lines.join('\n'));

        const logLines = current?.lastLines?.length
            ? current.lastLines.slice(-300).map(colorizeBlessedLogLine)
            : history.slice(0, 10).map(item => `${item.selection} · ${item.status} · ${item.startedAt}`);
        journal.setContent(logLines.length ? logLines.join('\n') : 'En attente de sortie des tests…');
        if (current)
            journal.setLabel(' JOURNAL EN DIRECT ');
        else
            journal.setLabel(' HISTORIQUE RÉCENT ');
        if (state.run) {
            launchButton.hide();
            if (screen.width >= 48)
                stopButton.show();
            else
                stopButton.hide();
            footer.setContent(' q arrêter · bouton Arrêter pour interrompre · les journaux sont conservés ');
        } else {
            launchButton.setContent(' Lancer ');
            if (screen.width >= 48)
                launchButton.show();
            stopButton.hide();
            footer.setContent(' ↑/↓ choisir · Entrée ou clic sur Lancer · clic scénario pour sélectionner · q quitter ');
        }
        updating = false;
        screen.render();
    };

    scenarios.on('select item', (_item, index) => {
        if (updating || state.run || !Number.isInteger(index))
            return;
        state.selection = index;
        refresh();
    });
    scenarios.on('action', item => {
        if (item && !state.run)
            launchSelected();
    });
    launchButton.on('press', () => {
        if (!state.run)
            launchSelected();
    });
    stopButton.on('press', requestCancel);
    screen.on('keypress', (_character, key) => {
        if (key?.name === 'q' || (key?.ctrl && key.name === 'c')) {
            if (state.run)
                requestCancel();
            else
                quit();
        }
    });
    screen.on('resize', resize);
    scenarios.focus();
    resize();
    const refreshTimer = setInterval(refresh, 500);
    state.ui = {refresh, destroy: () => {
        clearInterval(refreshTimer);
        screen.destroy();
    }};
    refresh();
    return state.ui;
}

function makeRunContext(state, history) {
    return run => ({
        run,
        setChild: child => { state.child = child; },
        cancelled: () => state.cancelRequested,
        onLine: (test, line) => {
            if (!state.current)
                return;
            state.current.lastLines.push(stripAnsi(line));
            state.current.lastLines = state.current.lastLines.slice(-300);
            const progress = progressForLine(test.id, line, state.current.passed ?? 0, state.current.failed ?? 0);
            Object.assign(state.current, progress);
            if (!process.stdout.isTTY && line.trim())
                console.log(line);
            state.screen = renderDashboard(state.selection, history, state);
            render(state);
        },
    });
}

async function runSelection(selectionId, history, state) {
    const run = {
        id: timestampId(),
        selection: selectionId,
        directory: join(cacheRoot, `run-${timestampId()}`),
        startedAt: new Date().toISOString(),
        status: 'running',
        tests: [],
    };
    state.run = run;
    state.cancelRequested = false;
    await mkdir(run.directory, {recursive: true});
    let built = false;
    const selected = selectionId === 'all' ? testDefinitions : [testById.get(selectionId)];
    for (const test of selected) {
        if (state.cancelRequested)
            break;
        if (test.native && !built) {
            const build = {id: 'build', title: 'Build TypeScript et ressources', native: false};
            state.current = {title: build.title, stage: 'Build', startedAt: Date.now(),
                progressText: 'Compilation…', lastLines: [], logPath: join(run.directory, 'build.log')};
            state.screen = renderDashboard(state.selection, history, state);
            render(state);
            const buildResult = await runCommand(build, state.context(run), 'npm', ['run', 'build'], 'build.log');
            run.tests.push({...build, ...buildResult});
            built = buildResult.status === 'passed';
            await writeSummary(run);
            if (!built)
                break;
        }
        state.current = {title: test.title, stage: test.native ? 'GNOME Shell isolé' : 'Tests unitaires',
            startedAt: Date.now(), progressText: test.native ? 'Initialisation GNOME…' : 'Démarrage…',
            passed: 0, failed: 0, total: null, lastLines: [],
            logPath: join(run.directory, `${test.id}.log`)};
        state.screen = renderDashboard(state.selection, history, state);
        render(state);
        const result = test.native
            ? await runNative(test, state.context(run))
            : await runCommand(test, state.context(run), 'npm', ['test'], 'unit.log');
        run.tests.push({...test, ...result});
        if (!process.stdout.isTTY) {
            const mark = result.status === 'passed' ? '✓' : result.status === 'cancelled' ? '—' : '✗';
            console.log(`${mark} ${test.title} · ${result.status} · ${formatDuration(result.durationMs)}`);
            if (result.issues?.length)
                for (const issue of result.issues)
                    console.log(`  Défaut : ${issue}`);
            if (result.error)
                console.log(`  Erreur : ${result.error}`);
        }
        if (!test.native)
            built = result.status === 'passed';
        await writeSummary(run);
        state.current = null;
        state.screen = renderDashboard(state.selection, history, state);
        render(state);
        if (result.status !== 'passed')
            break;
    }
    run.endedAt = new Date().toISOString();
    run.status = state.cancelRequested ? 'cancelled'
        : run.tests.length && run.tests.every(test => test.status === 'passed') ? 'passed' : 'failed';
    await writeSummary(run);
    await saveHistory(history, run);
    state.lastRun = run;
    state.run = null;
    state.current = null;
    state.screen = renderDashboard(state.selection, history, state);
    render(state);
    if (!process.stdout.isTTY)
        console.log(`Résultats : ${run.status} · ${run.directory}`);
}

function resolveSelection(value) {
    if (value === 'all')
        return value;
    return testById.has(value) ? value : null;
}

function usage() {
    return [
        'Usage: npm run test:ui [-- --run <unit|dock|motion|hit-testing|appearance|reachability|settings|desktop|layout|widgets|panel|notifications|margins|all> | --list | --help]',
        '',
        'Sans option, ouvre le tableau de bord Blessed, pilotable au clavier et à la souris.',
        'Les tests GNOME utilisent un profil DConf',
        'et une installation d’extension temporaires; aucun réglage utilisateur n’est modifié.',
    ].join('\n');
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log(usage());
        return;
    }
    if (args.includes('--list')) {
        for (const test of [...testDefinitions, allDefinition])
            console.log(`${test.id}\t${test.title}`);
        return;
    }
    const runIndex = args.indexOf('--run');
    if (runIndex >= 0) {
        const selection = resolveSelection(args[runIndex + 1]);
        if (!selection) {
            console.error(`Scénario inconnu : ${args[runIndex + 1] ?? ''}\n\n${usage()}`);
            process.exitCode = 2;
            return;
        }
        await mkdir(cacheRoot, {recursive: true});
        const history = await loadHistory();
        const state = {selection: 0, current: null, lastRun: null, context: null};
        state.context = makeRunContext(state, history);
        await runSelection(selection, history, state);
        const failureCount = state.lastRun.tests.filter(test => test.status !== 'passed').length;
        process.exitCode = failureCount ? 1 : 0;
        return;
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.log(usage());
        return;
    }

    await mkdir(cacheRoot, {recursive: true});
    const history = await loadHistory();
    const state = {selection: 0, current: null, lastRun: null, child: null, cancelRequested: false};
    state.context = makeRunContext(state, history);
    const items = [...testDefinitions, allDefinition];
    const launchSelected = () => {
        state.uiError = null;
        const selected = items[state.selection]?.id ?? 'all';
        runSelection(selected, history, state).catch(error => {
            state.current = null;
            state.run = null;
            state.uiError = error.message;
            render(state);
        });
    };
    const requestCancel = () => {
        if (!state.run)
            return;
        state.cancelRequested = true;
        if (state.child?.pid) {
            try {
                process.kill(process.platform === 'win32' ? state.child.pid : -state.child.pid, 'SIGTERM');
            } catch {
                state.child.kill('SIGTERM');
            }
        }
    };
    const quit = () => {
        state.ui?.destroy();
        process.exit(0);
    };
    state.ui = createTerminalUi(state, history, items, launchSelected, requestCancel, quit);
    state.screen = renderDashboard(state.selection, history, state);
    render(state);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
    main().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
