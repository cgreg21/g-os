import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join, relative} from 'node:path';

const root = 'dist';
const required = ['extension.js', 'prefs.js'];
const failures = [];

function walk(directory) {
    return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
    });
}

for (const name of required) {
    const javascript = join(root, name);
    const mapPath = `${javascript}.map`;
    if (!existsSync(javascript)) {
        failures.push(`Missing compiled entry point: ${javascript}`);
        continue;
    }
    if (!existsSync(mapPath)) {
        failures.push(`Missing source map: ${mapPath}`);
        continue;
    }
    const map = JSON.parse(readFileSync(mapPath, 'utf8'));
    if (map.version !== 3 || !Array.isArray(map.sources) || !Array.isArray(map.sourcesContent))
        failures.push(`Invalid or incomplete source map: ${mapPath}`);
    if (!map.sources.some(source => source.endsWith('.ts')))
        failures.push(`Source map does not point to TypeScript: ${mapPath}`);
    if (!map.sourcesContent.some(source => typeof source === 'string' && source.length > 0))
        failures.push(`Source map does not embed source content: ${mapPath}`);
}

const maps = walk(root).filter(path => path.endsWith('.js.map'));
for (const mapPath of maps) {
    const javascript = mapPath.slice(0, -4);
    if (!existsSync(javascript))
        failures.push(`Orphan source map: ${relative(root, mapPath)}`);
}

if (failures.length > 0) {
    console.error('Debugger artifact validation failed:');
    for (const failure of failures)
        console.error(`  - ${failure}`);
    process.exitCode = 1;
} else {
    console.log(`Validated ${maps.length} JavaScript source maps, including TypeScript entry points.`);
}
