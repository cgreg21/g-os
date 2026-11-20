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
const dashToDockSource = 'src/dock/dashToDock';
const dashToDockTarget = 'dist/dash-to-dock@micxgx.gmail.com';
rmSync(dashToDockTarget, {recursive: true, force: true});
cpSync(dashToDockSource, dashToDockTarget, {recursive: true});
const dashToDockStylesheet = spawnSync('sassc', ['--omit-map-comment',
    `${dashToDockSource}/_stylesheet.scss`, `${dashToDockTarget}/stylesheet.css`], {stdio: 'inherit'});
if (dashToDockStylesheet.error)
    throw dashToDockStylesheet.error;
if (dashToDockStylesheet.status !== 0)
    process.exit(dashToDockStylesheet.status ?? 1);
const dashToDockSchema = spawnSync('glib-compile-schemas', [`${dashToDockTarget}/schemas`], {stdio: 'inherit'});
if (dashToDockSchema.error)
    throw dashToDockSchema.error;
if (dashToDockSchema.status !== 0)
    process.exit(dashToDockSchema.status ?? 1);
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
