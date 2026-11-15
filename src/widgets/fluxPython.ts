import {parser} from '@lezer/python';
import type {SyntaxNode} from '@lezer/common';
import JSON5 from 'json5';

type FluxLiteral = string | number;

export function parseFluxPython(text: string): {version: number; sources: Record<string, unknown>} {
    if (typeof text !== 'string' || text.length > 65536)
        throw new Error('Fichier Flux trop volumineux');
    const tree = parser.parse(text);
    let invalid = false;
    tree.iterate({enter: node => { if (node.type.isError) invalid = true; }});
    if (invalid)
        throw new Error('Syntaxe Flux Python invalide');
    const constants: Record<string, FluxLiteral> = Object.create(null);
    const sources: Record<string, unknown> = Object.create(null);
    const textOf = (node: SyntaxNode) => text.slice(node.from, node.to);
    const children = (node: SyntaxNode) => {
        const values: SyntaxNode[] = [];
        for (let child = node.firstChild; child; child = child.nextSibling)
            if (child.name !== 'Comment') values.push(child);
        return values;
    };
    const expression = (node: SyntaxNode, depth = 0): FluxLiteral => {
        if (depth > 16)
            throw new Error('Expression Flux trop imbriquee');
        if (node.name === 'String') {
            const raw = textOf(node);
            if (!/^(['"])(?!\1\1)/.test(raw) || /[\r\n]/.test(raw))
                throw new Error('Chaine Flux invalide');
            const value: unknown = JSON5.parse(raw);
            if (typeof value !== 'string' || value.length > 2048)
                throw new Error('Chaine Flux invalide');
            return value;
        }
        if (node.name === 'Number') {
            const raw = textOf(node);
            if (!/^\d+(?:\.\d+)?$/.test(raw))
                throw new Error('Nombre Flux invalide');
            const value = Number(raw);
            if (!Number.isFinite(value)) throw new Error('Nombre Flux invalide');
            return value;
        }
        if (node.name === 'VariableName') {
            const name = textOf(node);
            if (!Object.hasOwn(constants, name)) throw new Error(`Constante Flux inconnue : ${name}`);
            return constants[name];
        }
        const nodes = children(node);
        if (node.name === 'ParenthesizedExpression' && nodes.length === 3)
            return expression(nodes[1], depth + 1);
        if (node.name === 'UnaryExpression' && nodes.length === 2) {
            const value = expression(nodes[1], depth + 1);
            const operator = textOf(nodes[0]);
            if (typeof value !== 'number' || !['+', '-'].includes(operator))
                throw new Error('Operateur Flux invalide');
            return operator === '-' ? -value : value;
        }
        if (node.name === 'BinaryExpression' && nodes.length === 3) {
            const left = expression(nodes[0], depth + 1);
            const right = expression(nodes[2], depth + 1);
            const operator = textOf(nodes[1]);
            if (operator === '+' && typeof left === 'string' && typeof right === 'string') {
                const value = left + right;
                if (value.length > 2048) throw new Error('Chaine Flux trop longue');
                return value;
            }
            if (typeof left !== 'number' || typeof right !== 'number' || !['+', '-', '*', '/'].includes(operator))
                throw new Error('Operateur Flux invalide');
            const value = operator === '+' ? left + right : operator === '-' ? left - right
                : operator === '*' ? left * right : left / right;
            if (!Number.isFinite(value)) throw new Error('Resultat Flux invalide');
            return value;
        }
        throw new Error(`Expression Flux interdite : ${node.name}`);
    };
    const statements = children(tree.topNode);
    if (statements.length > 128)
        throw new Error('Trop de declarations Flux');
    for (const statement of statements) {
        const nodes = children(statement);
        if (statement.name === 'AssignStatement' && nodes.length === 3 && nodes[0].name === 'VariableName' &&
            textOf(nodes[1]) === '=') {
            const name = textOf(nodes[0]);
            if (!/^[a-z][a-z0-9_]{0,63}$/.test(name) || ['source', 'constructor', 'prototype', '__proto__'].includes(name) ||
                Object.hasOwn(constants, name))
                throw new Error(`Constante Flux invalide ou dupliquee : ${name}`);
            constants[name] = expression(nodes[2]);
            continue;
        }
        if (statement.name !== 'ExpressionStatement' || nodes.length !== 1 || nodes[0].name !== 'CallExpression')
            throw new Error(`Instruction Flux interdite : ${statement.name}`);
        const call = children(nodes[0]);
        if (call.length !== 2 || call[0].name !== 'VariableName' || textOf(call[0]) !== 'source' || call[1].name !== 'ArgList')
            throw new Error('Seule la declaration source(...) est autorisee');
        const argumentsList = children(call[1]).filter(node => !['(', ')', ','].includes(node.name));
        if (argumentsList.length < 1)
            throw new Error('Nom de source Flux manquant');
        const name = expression(argumentsList[0]);
        if (typeof name !== 'string' || Object.hasOwn(sources, name))
            throw new Error('Nom de source Flux invalide ou duplique');
        const source: Record<string, FluxLiteral> = {type: 'http'};
        for (let index = 1; index < argumentsList.length; index += 3) {
            const [key, assignment, value] = argumentsList.slice(index, index + 3);
            if (!key || !assignment || !value || key.name !== 'VariableName' || textOf(assignment) !== '=')
                throw new Error('Parametre de source Flux invalide');
            const property = textOf(key);
            if (!['url', 'refresh', 'timeout'].includes(property) || Object.hasOwn(source, property))
                throw new Error(`Parametre Flux inconnu ou duplique : ${property}`);
            source[property] = expression(value);
        }
        sources[name] = source;
    }
    if (constants.version !== 1)
        throw new Error('Version Flux invalide');
    return {version: 1, sources};
}