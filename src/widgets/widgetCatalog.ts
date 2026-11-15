import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {validateWidgetDescription, widgetAssetPath} from './widgetRegistry.js';
import {parseFluxProgram} from './fluxLanguage.js';
import {errorMessage} from '../shared/errorMessage.js';

export function userWidgetDirectory() {
    return Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_data_dir(), 'g-os', 'widgets']));
}

export function readWidgetDescription(directory) {
    const manifest = directory.get_child('widget.json');
    if (manifest.query_info('standard::size', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null).get_size() > 1024 * 1024)
        throw new Error('Le descriptif depasse 1 Mio');
    const [, bytes] = manifest.load_contents(null);
    const description = validateWidgetDescription(JSON.parse(new TextDecoder().decode(bytes)));
    for (const asset of [description.entry, description.language === 'flux' ? description.template : null,
        description.preview, description.css].filter(Boolean)) {
        const file = directory.resolve_relative_path(widgetAssetPath(asset));
        if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) !== Gio.FileType.REGULAR)
            throw new Error(`Ressource manquante ou non reguliere : ${asset}`);
    }
    if (description.language === 'flux') {
        const read = path => {
            const file = directory.resolve_relative_path(path);
            if (file.query_info('standard::size', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null).get_size() > 65536)
                throw new Error('Fichier Flux trop volumineux');
            const [, content] = file.load_contents(null);
            return new TextDecoder('utf-8', {fatal: true}).decode(content);
        };
        description.fluxProgram = parseFluxProgram(read(description.entry), read(description.template));
        for (const source of Object.values(description.fluxProgram.sources) as Array<{url: string}>) {
            const uri = GLib.Uri.parse(source.url, GLib.UriFlags.NONE);
            if (!['http', 'https'].includes(uri.get_scheme()?.toLowerCase()) || !uri.get_host() || uri.get_userinfo())
                throw new Error('URL HTTP Flux invalide');
        }
    }
    return description;
}

export function readWidgetCatalog(extensionDirectory) {
    const entries = [];
    const errors = [];
    const ids = new Set();
    for (const [root, builtin] of [[extensionDirectory.get_child('widgets'), true], [userWidgetDirectory(), false]]) {
        if (!root.query_exists(null))
            continue;
        let enumerator;
        try {
            enumerator = root.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
            let info;
            while ((info = enumerator.next_file(null))) {
                if (info.get_file_type() !== Gio.FileType.DIRECTORY)
                    continue;
                const directory = root.get_child(info.get_name());
                try {
                    const description = readWidgetDescription(directory);
                    if (description.id !== info.get_name())
                        throw new Error('Le nom du dossier doit correspondre a son identifiant');
                    if (ids.has(description.id))
                        throw new Error('Identifiant de widget deja utilise');
                    ids.add(description.id);
                    entries.push({description, directory, builtin});
                } catch (error) {
                    errors.push({id: info.get_name(), message: errorMessage(error)});
                }
            }
        } catch (error) {
            errors.push({id: root.get_basename(), message: errorMessage(error)});
        } finally {
            enumerator?.close(null);
        }
    }
    return {entries, errors};
}

export function importWidgetDirectory(source, existingIds = []) {
    if (source.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) !== Gio.FileType.DIRECTORY)
        throw new Error('Selectionnez un dossier de widget, pas un lien symbolique');
    const description = readWidgetDescription(source);
    if (existingIds.includes(description.id))
        throw new Error('Identifiant de widget deja installe');
    const root = userWidgetDirectory();
    if (!root.query_exists(null))
        root.make_directory_with_parents(null);
    const destination = root.get_child(description.id);
    if (destination.query_exists(null))
        throw new Error('Ce widget existe deja. Choisissez un nouvel identifiant pour une nouvelle version.');
    const assets = [];
    let total = 0;
    const inspect = (directory, prefix = '') => {
        const enumerator = directory.enumerate_children('standard::name,standard::type,standard::size',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        try {
            let info;
            while ((info = enumerator.next_file(null))) {
                const path = widgetAssetPath(`${prefix}${info.get_name()}`);
                if (assets.length >= 512)
                    throw new Error('Le paquet contient trop de ressources');
                if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                    assets.push({path, directory: true});
                    inspect(directory.get_child(info.get_name()), `${path}/`);
                } else if (info.get_file_type() === Gio.FileType.REGULAR) {
                    total += info.get_size();
                    if (total > 32 * 1024 * 1024)
                        throw new Error('Le paquet depasse 32 Mio');
                    assets.push({path, directory: false});
                } else {
                    throw new Error('Les liens et fichiers speciaux ne sont pas autorises');
                }
            }
        } finally {
            enumerator.close(null);
        }
    };
    inspect(source);
    destination.make_directory(null);
    try {
        for (const asset of assets) {
            const target = destination.resolve_relative_path(asset.path);
            if (asset.directory)
                target.make_directory(null);
            else
                source.resolve_relative_path(asset.path).copy(target, Gio.FileCopyFlags.NOFOLLOW_SYMLINKS, null, null);
        }
    } catch (error) {
        for (const asset of assets.reverse()) {
            try { destination.resolve_relative_path(asset.path).delete(null); } catch {}
        }
        try { destination.delete(null); } catch {}
        throw error;
    }
    return description;
}

export function removeImportedWidget(id) {
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(id))
        throw new Error('Identifiant de widget invalide');
    const directory = userWidgetDirectory().get_child(id);
    if (directory.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) !== Gio.FileType.DIRECTORY)
        throw new Error('Dossier de widget importe introuvable');
    const remove = folder => {
        const enumerator = folder.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        try {
            let info;
            while ((info = enumerator.next_file(null))) {
                const child = folder.get_child(info.get_name());
                if (info.get_file_type() === Gio.FileType.DIRECTORY)
                    remove(child);
                else
                    child.delete(null);
            }
        } finally {
            enumerator.close(null);
        }
        folder.delete(null);
    };
    remove(directory);
}