import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import System from 'system';
import {requestFluxJson} from '../dist/widgets/fluxHttp.js';
import {parseFluxProgram, renderFluxTemplate} from '../dist/widgets/fluxLanguage.js';

const server = new Soup.Server();
let redirected = 0;
server.add_handler(null, (_server, message, path) => {
    if (path === '/slow') {
        message.pause();
        return;
    }
    if (path === '/redirect') {
        message.set_status(302, null);
        message.get_response_headers().append('Location', '/redirected');
        return;
    }
    if (path === '/redirected')
        redirected++;
    const body = path === '/large' ? 'x'.repeat(262145) : path === '/invalid' ? 'non-json' : '{"value":42}';
    message.set_status(path === '/missing' ? 404 : 200, null);
    message.set_response('application/json', Soup.MemoryUse.COPY, new TextEncoder().encode(body));
});
server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
const base = server.get_uris()[0].to_string();
const environment = {Gio, GLib, Soup};

async function rejects(path, expected, timeout = 3) {
    try {
        await requestFluxJson(environment, base + path, timeout).promise;
        throw new Error(`Request ${path} unexpectedly succeeded`);
    } catch (error) {
        if (!String(error.message).includes(expected))
            throw error;
    }
}

async function run() {
    const example = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('examples').get_child('flux-weather');
    const read = name => new TextDecoder().decode(example.get_child(name).load_contents(null)[1]);
    const program = parseFluxProgram(read('widget.flux'), read('template.flux'));
    if (!program.sources.weather || renderFluxTemplate('{{data.weather.value}}', {data: {weather: {value: 42}}}) !== '42')
        throw new Error('Flux parser or template did not work in GJS');
    const value = await requestFluxJson(environment, base + 'json', 3).promise;
    if (value.value !== 42)
        throw new Error('HTTP JSON result was not decoded');
    await rejects('invalid', 'non JSON');
    await rejects('missing', '404');
    await rejects('large', 'volumineuse');
    await rejects('redirect', '302');
    await rejects('slow', 'Delai', 1);
    if (redirected !== 0)
        throw new Error('HTTP redirect was followed');
    for (const url of ['file:///etc/passwd', 'http://user:password@127.0.0.1/']) {
        try {
            await requestFluxJson(environment, url, 3).promise;
            throw new Error('Unsafe URL unexpectedly succeeded');
        } catch (error) {
            if (!error.message.includes('URL HTTP Flux invalide'))
                throw error;
        }
    }
    const pending = requestFluxJson(environment, base + 'json', 3);
    pending.cancel();
    try {
        await pending.promise;
        throw new Error('Cancelled request unexpectedly succeeded');
    } catch (error) {
        if (error.message === 'Cancelled request unexpectedly succeeded')
            throw error;
    }
    print('Native Flux HTTP validates JSON, size, errors, redirects and cancellation');
}

const loop = new GLib.MainLoop(null, false);
run().then(() => loop.quit()).catch(error => {
    printerr(error.stack);
    System.exit(1);
});
loop.run();
server.disconnect();