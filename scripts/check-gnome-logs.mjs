#!/usr/bin/env node

import {readdir, readFile, stat, writeFile} from 'node:fs/promises';
import {join, relative, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const expectedScenarios = [
    'unit', 'dock', 'motion', 'hit-testing', 'appearance', 'reachability',
    'settings', 'desktop', 'layout', 'widgets', 'panel', 'notifications',
    'margins', 'options', 'daily',
];

const fatalPatterns = [
    {name: 'GJS JavaScript error', pattern: /\bJS ERROR:/},
    {name: 'Unhandled promise rejection', pattern: /\b(?:UnhandledPromiseRejection|Unhandled promise rejection)\b/i},
    {name: 'GJS critical', pattern: /\bGjs-CRITICAL\b/},
    {name: 'GLib/GObject/GTK/Clutter/St/Mutter critical',
        pattern: /\b(?:GLib|GObject|Gtk|Gdk|Clutter|St|Meta|Mutter|GNOME Shell)-CRITICAL\b/},
    {name: 'Native crash', pattern: /\b(?:Segmentation fault|Aborted \(core dumped\)|core dumped)\b/i},
];

const warningPattern = /\b(?:Gjs|GLib|GObject|Gtk|Gdk|Clutter|St|Meta|Mutter|GNOME Shell)-WARNING\b|\bJS WARNING:/;

export function scanGnomeLogText(content, file = '<memory>') {
    const findings = [];
    const warnings = [];
    for (const [index, line] of content.split(/\r?\n/).entries()) {
        for (const rule of fatalPatterns) {
            if (rule.pattern.test(line)) {
                findings.push({file, line: index + 1, rule: rule.name, text: line.trim()});
                break;
            }
        }
        if (warningPattern.test(line))
            warnings.push({file, line: index + 1, text: line.trim()});
    }
    return {findings, warnings};
}

export function validateRunSummary(summary) {
    const issues = [];
    if (summary.selection !== 'all')
        issues.push(`Expected the full scenario selection "all", got ${summary.selection ?? 'missing'}`);
    if (summary.status !== 'passed')
        issues.push(`Full regression suite status is ${summary.status ?? 'missing'}`);
    const tests = Array.isArray(summary.tests) ? summary.tests : [];
    const ids = tests.map(item => item.id);
    for (const id of expectedScenarios) {
        if (!ids.includes(id))
            issues.push(`Missing scenario result: ${id}`);
    }
    for (const id of ids) {
        if (!expectedScenarios.includes(id))
            issues.push(`Unexpected scenario result: ${id}`);
    }
    if (new Set(ids).size !== ids.length)
        issues.push('Duplicate scenario results detected');
    for (const item of tests) {
        if (item.status !== 'passed')
            issues.push(`Scenario ${item.id ?? '<unknown>'} status is ${item.status ?? 'missing'}`);
    }
    if (tests.length !== expectedScenarios.length)
        issues.push(`Expected ${expectedScenarios.length} scenario results, got ${tests.length}`);
    return issues;
}

async function walk(directory) {
    const entries = await readdir(directory, {withFileTypes: true});
    const files = [];
    for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory())
            files.push(...await walk(path));
        else if (entry.isFile())
            files.push(path);
    }
    return files;
}

async function main() {
    const args = process.argv.slice(2);
    const requireAll = args.includes('--require-all');
    const rootArg = args.find(arg => !arg.startsWith('--'));
    if (!rootArg)
        throw new Error('Usage: node scripts/check-gnome-logs.mjs <test-runs-directory> [--require-all]');
    const root = resolve(rootArg);
    const rootInfo = await stat(root);
    if (!rootInfo.isDirectory())
        throw new Error(`GNOME test-run path is not a directory: ${root}`);
    const files = await walk(root);
    const logs = files.filter(path => path.endsWith('.log'));
    const summaries = files.filter(path => path.endsWith('summary.json'));
    const findings = [];
    const warnings = [];
    for (const path of logs) {
        const result = scanGnomeLogText(await readFile(path, 'utf8'), relative(root, path));
        findings.push(...result.findings);
        warnings.push(...result.warnings);
    }
    const summaryIssues = [];
    if (requireAll) {
        if (summaries.length !== 1)
            summaryIssues.push(`Expected exactly one full-suite summary, found ${summaries.length}`);
        for (const path of summaries) {
            try {
                summaryIssues.push(...validateRunSummary(JSON.parse(await readFile(path, 'utf8'))));
            } catch (error) {
                summaryIssues.push(`Invalid summary ${relative(root, path)}: ${error.message}`);
            }
        }
        if (logs.length < expectedScenarios.length)
            summaryIssues.push(`Expected at least ${expectedScenarios.length} scenario logs, found ${logs.length}`);
    }
    const report = {
        root,
        logCount: logs.length,
        warningCount: warnings.length,
        warnings,
        fatalFindingCount: findings.length,
        findings,
        summaryCount: summaries.length,
        summaryIssues,
    };
    const reportPath = process.env.G_OS_GNOME_LOG_REPORT;
    if (reportPath)
        await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`GNOME log audit: ${logs.length} logs, ${warnings.length} warnings recorded, ${findings.length} fatal findings`);
    for (const warning of warnings.slice(0, 20))
        console.warn(`WARNING ${warning.file}:${warning.line}: ${warning.text}`);
    for (const finding of findings)
        console.error(`ERROR ${finding.file}:${finding.line} [${finding.rule}]: ${finding.text}`);
    for (const issue of summaryIssues)
        console.error(`ERROR summary: ${issue}`);
    if (!logs.length)
        console.error('ERROR: no GNOME test logs were found');
    if (findings.length || summaryIssues.length || !logs.length)
        process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    main().catch(error => {
        console.error(error.stack ?? error.message);
        process.exitCode = 1;
    });
}
