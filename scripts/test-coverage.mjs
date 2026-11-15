#!/usr/bin/env node

import {spawnSync} from 'node:child_process';
import {mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const temporaryDirectory = await mkdtemp(join(root, 'dist', '.coverage-source-'));

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {cwd: root, stdio: 'inherit', ...options});
    if (result.error)
        throw result.error;
    return result.status ?? 1;
}

try {
    await writeFile(join(temporaryDirectory, 'package.json'), '{"type":"module"}');
    const outputDirectory = join(temporaryDirectory, 'compiled');
    const compiler = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
    const compileStatus = run(process.execPath, [
        compiler, '-p', 'tsconfig.json', '--outDir', outputDirectory,
    ]);
    if (compileStatus !== 0) {
        process.exitCode = compileStatus;
    } else {
        const testFiles = (await readdir(join(root, 'tests')))
            .filter(file => file.endsWith('.test.mjs'))
            .sort()
            .map(file => join('tests', file));
        const coverageIncludes = [
            join(root, 'dist', '**', '*.js'),
            join(outputDirectory, '**', '*.js'),
        ];
        const testStatus = run(process.execPath, [
            '--experimental-test-coverage',
            ...coverageIncludes.map(pattern => `--test-coverage-include=${pattern}`),
            '--test-coverage-lines=100',
            '--test-coverage-functions=100',
            '--test-concurrency=1',
            '--test',
            ...testFiles,
        ], {
            env: {
                ...process.env,
                GOS_FLUX_TEST_MODULE: pathToFileURL(join(outputDirectory, 'widgets', 'fluxLanguage.js')).href,
            },
        });
        if (testStatus !== 0)
            process.exitCode = testStatus;
    }
} finally {
    await rm(temporaryDirectory, {recursive: true, force: true});
}
