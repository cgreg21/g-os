import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const PROTOCOL_VERSION = 1;
const RUNTIME_VERSION = '0.1.0';
const MAX_MESSAGE_BYTES = 16 * 1024;

function snapshotStage(stage, {maxDepth = 12, maxNodes = 500} = {}) {
    if (!stage)
        return {root: null, truncated: false};
    const depthLimit = Math.max(0, Math.min(Number.isInteger(maxDepth) ? maxDepth : 12, 32));
    const nodeLimit = Math.max(1, Math.min(Number.isInteger(maxNodes) ? maxNodes : 500, 2000));
    let nextId = 1;
    let truncated = false;
    const visit = (actor, depth) => {
        if (nextId > nodeLimit) {
            truncated = true;
            return null;
        }
        const id = nextId++;
        let allocation = null;
        try {
            if (actor.has_allocation()) {
                const box = actor.get_allocation_box();
                allocation = {x: box.x1, y: box.y1, width: box.x2 - box.x1, height: box.y2 - box.y1};
            }
        } catch {}
        let children = [];
        let childCount = 0;
        try {
            const actors = actor.get_children();
            childCount = actors.length;
            if (depth >= depthLimit) {
                if (childCount > 0) truncated = true;
            } else {
                for (const child of actors) {
                    const result = visit(child, depth + 1);
                    if (result) children.push(result);
                    else break;
                }
            }
        } catch {
            truncated = true;
        }
        let name = null;
        try { name = actor.get_name() ?? null; } catch {}
        let visible = false;
        let mapped = false;
        try { visible = actor.is_visible(); } catch {}
        try { mapped = actor.is_mapped(); } catch {}
        return {id, typeName: actor.constructor?.name ?? 'Clutter.Actor', name, visible, mapped, childCount, allocation, children};
    };
    return {root: visit(stage, 0), truncated};
}

export class DebugRuntime {
    constructor({socketPath, token, stageProvider = () => global.stage}) {
        this.socketPath = socketPath;
        this._token = token;
        this._stageProvider = stageProvider;
        this._connection = null;
        this._input = null;
        this._output = null;
        this._cancellable = new Gio.Cancellable();
        this._closed = false;
        this.connected = false;
    }

    async connect() {
        const client = new Gio.SocketClient();
        const address = Gio.UnixSocketAddress.new(this.socketPath);
        this._connection = await new Promise((resolve, reject) => {
            client.connect_async(address, this._cancellable, (source, result) => {
                try { resolve(source.connect_finish(result)); } catch (error) { reject(error); }
            });
        });
        this._input = new Gio.DataInputStream({base_stream: this._connection.get_input_stream()});
        this._output = this._connection.get_output_stream();
        await this._writeLine({type: 'hello', protocolVersion: PROTOCOL_VERSION, adapterVersion: RUNTIME_VERSION, token: this._token});
        const response = await this._readLine();
        if (!response || response.type !== 'hello' || response.protocolVersion !== PROTOCOL_VERSION)
            throw new Error(response?.message ?? 'G-Os debug handshake failed');
        this.connected = true;
        void this._readLoop();
        return response;
    }

    async _writeLine(message) {
        const bytes = new TextEncoder().encode(JSON.stringify(message) + '\n');
        await new Promise((resolve, reject) => {
            this._output.write_all_async(bytes, GLib.PRIORITY_DEFAULT, this._cancellable, (stream, result) => {
                try { stream.write_all_finish(result); resolve(); } catch (error) { reject(error); }
            });
        });
    }

    async _readLine() {
        const [line] = await new Promise((resolve, reject) => {
            this._input.read_line_async(GLib.PRIORITY_DEFAULT, this._cancellable, (stream, result) => {
                try { resolve(stream.read_line_finish_utf8(result)); } catch (error) { reject(error); }
            });
        });
        if (line === null) return null;
        if (new TextEncoder().encode(line).length > MAX_MESSAGE_BYTES)
            throw new Error('G-Os debug message exceeds 16 KiB');
        try { return JSON.parse(line); } catch { throw new Error('Invalid G-Os debug message'); }
    }

    async _readLoop() {
        try {
            while (!this._closed) {
                const message = await this._readLine();
                if (message === null) break;
                if (message.type === 'ping' && Number.isSafeInteger(message.id)) {
                    await this._writeLine({type: 'pong', id: message.id});
                } else if (message.type === 'inspectStage' && Number.isSafeInteger(message.id)) {
                    try {
                        await this._writeLine({type: 'stageSnapshot', id: message.id, ...snapshotStage(this._stageProvider(), {
                            maxDepth: message.maxDepth, maxNodes: message.maxNodes,
                        })});
                    } catch (error) {
                        await this._writeLine({type: 'error', id: message.id, code: 'INSPECTION_FAILED',
                            message: error instanceof Error ? error.message : String(error)});
                    }
                } else if (message.type === 'shutdown') {
                    this.close();
                    return;
                }
            }
        } catch (error) {
            if (!this._closed)
                logError(error, '[G-Os Debug] Runtime transport failed');
        } finally {
            this.close();
        }
    }

    close() {
        if (this._closed) return;
        this._closed = true;
        this.connected = false;
        this._cancellable.cancel();
        try { this._connection?.close(null); } catch {}
        this._connection = null;
        this._input = null;
        this._output = null;
    }
}

export async function connectDebugRuntime(options) {
    const runtime = new DebugRuntime(options);
    try {
        await runtime.connect();
        return {runtime};
    } catch (error) {
        runtime.close();
        throw error;
    }
}
