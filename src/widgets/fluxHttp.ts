export interface FluxHttpEnvironment {
    Gio: any;
    GLib: any;
    Soup: any;
}

export interface FluxHttpRequest {
    promise: Promise<unknown>;
    cancel(): void;
}

export function requestFluxJson(environment: FluxHttpEnvironment, url: string, timeout: number): FluxHttpRequest {
    const {Gio, GLib, Soup} = environment;
    const cancellable = new Gio.Cancellable();
    let timer = 0;
    let timedOut = false;
    let session: any = null;
    let stream: any = null;
    const promise = (async () => {
        try {
            const uri = GLib.Uri.parse(url, GLib.UriFlags.NONE);
            if (!['http', 'https'].includes(uri.get_scheme()?.toLowerCase()) || !uri.get_host() || uri.get_userinfo())
                throw new Error('URL HTTP Flux invalide');
            session = new Soup.Session();
            const message = Soup.Message.new('GET', url);
            if (!message)
                throw new Error('URL HTTP Flux invalide');
            message.set_flags(Soup.MessageFlags.NO_REDIRECT);
            timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeout * 1000, () => {
                timer = 0;
                timedOut = true;
                cancellable.cancel();
                return GLib.SOURCE_REMOVE;
            });
            stream = await new Promise((resolve, reject) => {
                session.send_async(message, GLib.PRIORITY_DEFAULT, cancellable, (sender: any, result: any) => {
                    try { resolve(sender.send_finish(result)); } catch (error) { reject(error); }
                });
            });
            if (message.get_status() < 200 || message.get_status() >= 300)
                throw new Error(`Reponse HTTP ${message.get_status()}`);
            const chunks: Uint8Array[] = [];
            let size = 0;
            while (true) {
                const chunk = await new Promise<Uint8Array>((resolve, reject) => {
                    stream.read_bytes_async(Math.min(32768, 262145 - size), GLib.PRIORITY_DEFAULT, cancellable,
                        (input: any, result: any) => {
                            try { resolve(input.read_bytes_finish(result).get_data()); } catch (error) { reject(error); }
                        });
                });
                if (!chunk || chunk.length === 0)
                    break;
                size += chunk.length;
                if (size > 262144)
                    throw new Error('Reponse HTTP Flux trop volumineuse');
                chunks.push(chunk);
            }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.length;
            }
            try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
            catch { throw new Error('Reponse HTTP Flux non JSON'); }
        } catch (error) {
            if (timedOut)
                throw new Error('Delai HTTP Flux depasse');
            throw error;
        } finally {
            if (timer)
                GLib.source_remove(timer);
            try { stream?.close(null); } catch {}
            session?.abort();
        }
    })();
    return {promise, cancel: () => cancellable.cancel()};
}