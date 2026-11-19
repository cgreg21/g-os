import {cpSync, mkdirSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {buildSync} from 'esbuild';
import {generateConfiguration} from './generate-config.mjs';

generateConfiguration();
rmSync('dist/schemas', {recursive: true, force: true});
mkdirSync('dist/schemas', {recursive: true});
for (const file of ['metadata.json', 'stylesheet.css', 'config.json'])
    cpSync(file, `dist/${file}`);
cpSync('icons', 'dist/icons', {recursive: true});
cpSync('schemas', 'dist/schemas', {
    recursive: true,
    filter: path => !path.endsWith('gschemas.compiled'),
});
cpSync('widgets', 'dist/widgets', {
    recursive: true,
    filter: path => !path.endsWith('/widget.js'),
});
buildSync({entryPoints: ['src/widgets/fluxLanguage.ts'], outfile: 'dist/widgets/fluxLanguage.js',
    bundle: true, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], target: 'es2022', sourcemap: true});
rmSync('dist/widgets/fluxPython.js', {force: true});
rmSync('dist/widgets/fluxPython.js.map', {force: true});
mkdirSync('dist/debug', {recursive: true});
cpSync('src/debug/debugRuntime.js', 'dist/debug/debugRuntime.js');
mkdirSync('dist/licenses', {recursive: true});
cpSync('node_modules/yaml/LICENSE', 'dist/licenses/yaml-LICENSE');
cpSync('node_modules/mustache/LICENSE', 'dist/licenses/mustache-LICENSE');
for (const name of ['python', 'common', 'highlight', 'lr'])
    cpSync(`node_modules/@lezer/${name}/LICENSE`, `dist/licenses/lezer-${name}-LICENSE`);
cpSync('node_modules/json5/LICENSE.md', 'dist/licenses/json5-LICENSE');
for (const directory of ['schemas', 'dist/schemas']) {
    const result = spawnSync('glib-compile-schemas', ['--strict', directory], {stdio: 'inherit'});
    if (result.error)
        throw result.error;
    if (result.status !== 0)
        process.exit(result.status ?? 1);
}