import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {XMLBuilder} from 'fast-xml-parser';

export function generateConfiguration(root = process.cwd()) {
    const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
    if (!config.extension?.uuid || config.extension['settings-schema'] !== config.settings?.id)
        throw new Error('Extension metadata and settings schema must agree in config.json');
    const keys = Object.entries(config.settings.keys).map(([name, definition]) => {
        if (!definition.type || !Object.hasOwn(definition, 'default'))
            throw new Error(`Missing type or default for ${name}`);
        if (definition.type === 'b' && typeof definition.default !== 'boolean' ||
            definition.type === 'i' && !Number.isInteger(definition.default) ||
            definition.type === 's' && typeof definition.default !== 'string')
            throw new Error(`Invalid default type for ${name}`);
        if (definition.range && (definition.default < definition.range.min || definition.default > definition.range.max))
            throw new Error(`Default outside the allowed range for ${name}`);
        return {
            '@_name': name,
            '@_type': definition.type,
            ...(definition.range ? {range: {'@_min': definition.range.min, '@_max': definition.range.max}} : {}),
            default: JSON.stringify(definition.default),
            summary: definition.summary,
            ...(definition.description ? {description: definition.description} : {}),
        };
    });
    const builder = new XMLBuilder({ignoreAttributes: false, format: true, suppressEmptyNode: true});
    const schema = builder.build({schemalist: {schema: {
        '@_id': config.settings.id,
        '@_path': config.settings.path,
        key: keys,
    }}});
    mkdirSync(join(root, 'schemas'), {recursive: true});
    writeFileSync(join(root, 'metadata.json'), `${JSON.stringify(config.extension, null, 2)}\n`);
    writeFileSync(join(root, 'schemas', `${config.settings.id}.gschema.xml`), `<?xml version="1.0" encoding="UTF-8"?>\n${schema}`);
    return config;
}