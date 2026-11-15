import {parseDocument} from 'yaml';
import Mustache from 'mustache';
import {parseFluxPython} from './fluxPython.js';

export interface FluxSource {
    url: string;
    refresh: number;
    timeout: number;
}

export interface FluxNode {
    type: 'text' | 'icon' | 'row' | 'column' | 'button' | 'repeat';
    text?: string;
    name?: string;
    style?: 'normal' | 'title' | 'secondary';
    when?: string;
    children?: FluxNode[];
    source?: string;
    items?: string;
}

export interface FluxProgram {
    sources: Record<string, FluxSource>;
    views: {desktop: FluxNode[]; dock?: FluxNode[]; square?: FluxNode[]};
}

const keyPattern = /^[a-z][a-z0-9-]{0,63}$/;
const pathPattern = /^(?:data\.[a-z][a-z0-9-]*(?:\.[a-zA-Z0-9_-]+)*|(?:status|error|config)\.[a-z][a-z0-9-]*|time)$/;
const itemPathPattern = /^item(?:\.[a-zA-Z0-9_-]+)*$/;
const relativePathPattern = /^(?:\.|[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)$/;
const forbidden = new Set(['constructor', 'prototype', '__proto__']);

function parseYaml(text: string): unknown {
    if (typeof text !== 'string' || text.length > 65536)
        throw new Error('Fichier Flux trop volumineux');
    const document = parseDocument(text, {uniqueKeys: true, strict: true});
    if (document.errors.length > 0)
        throw new Error(`Syntaxe Flux invalide : ${document.errors[0].message}`);
    return document.toJS({maxAliasCount: 0});
}

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Objet Flux invalide');
    return value as Record<string, unknown>;
}

function checkKeys(value: Record<string, unknown>, allowed: string[]): void {
    const invalid = Object.keys(value).find(key => !allowed.includes(key));
    if (invalid)
        throw new Error(`Champ Flux inconnu : ${invalid}`);
}

function validPath(path: string, allowItem = false): boolean {
    return (pathPattern.test(path) || (allowItem && itemPathPattern.test(path))) &&
        path.split('.').every(part => !forbidden.has(part));
}

function sectionTokens(token: Mustache.TemplateSpans[number]): Mustache.TemplateSpans {
    return token.length > 4 && Array.isArray(token[4]) ? token[4] : [];
}

export function validateFluxTemplate(template: string, allowItem = false): void {
    if (typeof template !== 'string' || template.length > 1024)
        throw new Error('Texte de template Flux invalide');
    const visit = (tokens: Mustache.TemplateSpans, depth: number) => {
        if (depth > 8)
            throw new Error('Sections Mustache trop imbriquees');
        for (const token of tokens) {
            if (token[0] === 'text' || token[0] === '!')
                continue;
            const name = token[1];
            const validRelative = depth > 0 && relativePathPattern.test(name) &&
                name.split('.').every(part => !forbidden.has(part));
            if (!['name', '&', '#', '^'].includes(token[0]) || (!validPath(name, allowItem) && !validRelative))
                throw new Error(`Variable de template Flux invalide : ${name}`);
            if (token[0] === '#' || token[0] === '^')
                visit(sectionTokens(token), depth + 1);
        }
    };
    visit(Mustache.parse(template), 0);
}

export function resolveFluxValue(data: unknown, path: string): unknown {
    const allowItem = data !== null && typeof data === 'object' && Object.hasOwn(data, 'item');
    if (!validPath(path, allowItem))
        return undefined;
    let value = data;
    for (const key of path.split('.')) {
        if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key))
            return undefined;
        value = (value as Record<string, unknown>)[key];
    }
    return value;
}

export function renderFluxTemplate(template: string, context: unknown): string {
    const allowItem = context !== null && typeof context === 'object' && Object.hasOwn(context, 'item');
    validateFluxTemplate(template, allowItem);
    const scopes: unknown[] = [context];
    let output = '';
    let operations = 0;
    const resolve = (path: string): unknown => {
        if (path === '.') return scopes[scopes.length - 1];
        const parts = path.split('.');
        for (let index = scopes.length - 1; index >= 0; index--) {
            let value = scopes[index];
            if (value === null || typeof value !== 'object' || !Object.hasOwn(value, parts[0]))
                continue;
            for (const part of parts) {
                if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part))
                    return undefined;
                value = (value as Record<string, unknown>)[part];
            }
            return value;
        }
        return undefined;
    };
    const append = (value: string) => { output += value.slice(0, 2048 - output.length); };
    const render = (tokens: Mustache.TemplateSpans) => {
        for (const token of tokens) {
            if (++operations > 4096 || output.length >= 2048)
                return;
            if (token[0] === 'text') {
                append(token[1]);
                continue;
            }
            if (token[0] === '!') continue;
            const value = resolve(token[1]);
            if (token[0] === 'name' || token[0] === '&') {
                if (['string', 'number', 'boolean'].includes(typeof value)) append(String(value));
                continue;
            }
            const truthy = Array.isArray(value) ? value.length > 0 : Boolean(value);
            if (token[0] === '^' && !truthy) render(sectionTokens(token));
            if (token[0] !== '#' || !truthy) continue;
            for (const item of (Array.isArray(value) ? value.slice(0, 100) : [value])) {
                if (operations > 4096 || output.length >= 2048) break;
                scopes.push(item);
                render(sectionTokens(token));
                scopes.pop();
            }
        }
    };
    render(Mustache.parse(template));
    return output;
}

export function parseFluxProgram(sourceText: string, templateText: string): FluxProgram {
    const pythonSyntax = /^\s*(?:#[^\n]*\n\s*)*(?:version\s*=|source\s*\()/.test(sourceText);
    const sourceFile = object(pythonSyntax ? parseFluxPython(sourceText) : parseYaml(sourceText));
    const templateFile = object(parseYaml(templateText));
    checkKeys(sourceFile, ['version', 'sources']);
    checkKeys(templateFile, ['version', 'desktop', 'dock', 'square']);
    if (sourceFile.version !== 1 || templateFile.version !== 1)
        throw new Error('Version Flux invalide');
    const rawSources = object(sourceFile.sources ?? {});
    if (Object.keys(rawSources).length > 4)
        throw new Error('Quatre sources Flux au maximum');
    const sources: Record<string, FluxSource> = Object.create(null);
    for (const [name, raw] of Object.entries(rawSources)) {
        const source = object(raw);
        checkKeys(source, ['type', 'url', 'refresh', 'timeout']);
        if (!keyPattern.test(name) || forbidden.has(name) || source.type !== 'http' ||
            typeof source.url !== 'string' || source.url.length > 2048 ||
            !/^https?:\/\/[^\s]+$/i.test(source.url) || /[{}]/.test(source.url))
            throw new Error('Source HTTP Flux invalide');
        const refresh = source.refresh ?? 300;
        const timeout = source.timeout ?? 10;
        if (!Number.isInteger(refresh) || (refresh as number) < 60 || (refresh as number) > 86400 ||
            !Number.isInteger(timeout) || (timeout as number) < 1 || (timeout as number) > 30)
            throw new Error('Delai HTTP Flux invalide');
        sources[name] = {url: source.url, refresh: refresh as number, timeout: timeout as number};
    }
    let total = 0;
    const validateReference = (path: string) => {
        const [root, name] = path.split('.');
        if (['data', 'status', 'error'].includes(root) && !Object.hasOwn(sources, name))
            throw new Error(`Source Flux inconnue : ${name}`);
    };
    const parseNodes = (value: unknown, depth: number, allowItem = false): FluxNode[] => {
        if (!Array.isArray(value) || value.length < 1 || depth > 4)
            throw new Error('Vue Flux invalide');
        return value.map(raw => {
            if (++total > 64)
                throw new Error('Trop d\'elements Flux');
            const node = object(raw);
            if (!['text', 'icon', 'row', 'column', 'button', 'repeat'].includes(node.type as string))
                throw new Error('Type d\'element Flux invalide');
            const fields: Record<string, string[]> = {
                text: ['type', 'text', 'style', 'when'], icon: ['type', 'name', 'when'],
                row: ['type', 'children', 'when'], column: ['type', 'children', 'when'],
                repeat: ['type', 'items', 'children', 'when'],
                button: ['type', 'text', 'name', 'source', 'when'],
            };
            checkKeys(node, fields[node.type as string]);
            if (node.when !== undefined && (typeof node.when !== 'string' || !validPath(node.when, allowItem)))
                throw new Error('Condition Flux invalide');
            if (typeof node.when === 'string') validateReference(node.when);
            if (node.style !== undefined && !['normal', 'title', 'secondary'].includes(node.style as string))
                throw new Error('Style Flux invalide');
            const result: FluxNode = {type: node.type as FluxNode['type']};
            if (typeof node.when === 'string') result.when = node.when;
            if (typeof node.style === 'string') result.style = node.style as FluxNode['style'];
            if (node.type === 'text' || node.type === 'button') {
                if (typeof node.text !== 'string') throw new Error('Texte Flux manquant');
                validateFluxTemplate(node.text, allowItem);
                const validateTokens = (tokens: Mustache.TemplateSpans) => {
                    for (const token of tokens) {
                        if (['name', '&', '#', '^'].includes(token[0]) && validPath(token[1]))
                            validateReference(token[1]);
                        if (token[0] === '#' || token[0] === '^')
                            validateTokens(sectionTokens(token));
                    }
                };
                validateTokens(Mustache.parse(node.text));
                result.text = node.text;
            }
            if (node.type === 'icon' || node.type === 'button') {
                if (typeof node.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(node.name))
                    throw new Error('Icone Flux invalide');
                result.name = node.name;
            }
            if (node.type === 'repeat') {
                if (typeof node.items !== 'string' || !validPath(node.items, allowItem))
                    throw new Error('Liste Flux invalide');
                validateReference(node.items);
                result.items = node.items;
            }
            if (node.type === 'row' || node.type === 'column' || node.type === 'repeat')
                result.children = parseNodes(node.children, depth + 1, allowItem || node.type === 'repeat');
            if (node.type === 'button') {
                if (typeof node.source !== 'string' || !Object.hasOwn(sources, node.source))
                    throw new Error('Source du bouton Flux inconnue');
                result.source = node.source;
            }
            return result;
        });
    };
    const views: FluxProgram['views'] = {desktop: parseNodes(templateFile.desktop, 0)};
    if (templateFile.dock !== undefined) views.dock = parseNodes(templateFile.dock, 0);
    if (templateFile.square !== undefined) views.square = parseNodes(templateFile.square, 0);
    return {sources, views};
}