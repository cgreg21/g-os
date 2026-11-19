export interface AppFolder {
    id: string;
    name: string;
    apps: string[];
    icon: string;
    view: number;
}

interface FolderSettings {
    get_string?(key: string): string;
    is_writable(key: string): boolean;
    set_string(key: string, value: string): boolean;
    get_value(key: string): {deep_unpack(): Record<string, Record<string, number>>};
}

interface FolderViewOption {
    default: number;
    min: number;
    max: number;
    title: string;
    filesOnly?: boolean;
    choices?: string[];
}

export function readAppFolders(settings: FolderSettings): AppFolder[] {
    try {
        const value = JSON.parse(settings.get_string?.('dock-app-folders') ?? '[]');
        if (!Array.isArray(value))
            return [];
        const ids = new Set<string>();
        const applications = new Set<string>();
        const folders: AppFolder[] = [];
        for (const folder of value) {
            if (!folder || typeof folder.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(folder.id) ||
                typeof folder.name !== 'string' || !Array.isArray(folder.apps) || ids.has(folder.id))
                continue;

            ids.add(folder.id);
            const apps: string[] = [];
            for (const app of folder.apps) {
                if (typeof app !== 'string' || !app.endsWith('.desktop') || applications.has(app))
                    continue;

                applications.add(app);
                apps.push(app);
            }

            folders.push({
                id: folder.id,
                name: folder.name.trim() || 'Applications',
                apps,
                icon: typeof folder.icon === 'string' ? folder.icon : '',
                view: folder.view === 0 || folder.view === 1 ? folder.view : -1,
            });
        }
        return folders;
    } catch {
        return [];
    }
}

export function writeAppFolders(settings: FolderSettings, folders: AppFolder[]): boolean {
    if (!settings.is_writable('dock-app-folders'))
        return false;
    return settings.set_string('dock-app-folders', JSON.stringify(folders));
}

const FOLDER_SORT_CHOICES = ['Nom : A à Z', 'Nom : Z à A', 'Taille croissante', 'Taille décroissante',
    'Date : plus anciennes d’abord', 'Date : plus récentes d’abord'];

export const FOLDER_VIEW_OPTIONS: Record<string, Record<string, FolderViewOption>> = {
    pile: {
        'text-size': {default: 12, min: 8, max: 32, title: 'Taille du texte (px)'},
        'icon-size': {default: 48, min: 16, max: 96, title: 'Taille des icônes (px)'},
        'spacing': {default: 6, min: 0, max: 48, title: 'Espace entre les icônes (px)'},
        'max-files': {default: 9, min: 1, max: 100, title: 'Nombre maximal de fichiers', filesOnly: true},
        'sort-order': {default: 0, min: 0, max: 5, title: 'Tri', choices: FOLDER_SORT_CHOICES, filesOnly: true},
    },
    grille: {
        'text-size': {default: 10, min: 8, max: 32, title: 'Taille du texte (px)'},
        'icon-size': {default: 36, min: 16, max: 96, title: 'Taille des icônes (px)'},
        'horizontal-spacing': {default: 8, min: 0, max: 48, title: 'Espace horizontal (px)'},
        'vertical-spacing': {default: 8, min: 0, max: 48, title: 'Espace vertical (px)'},
        'columns': {default: 4, min: 1, max: 10, title: 'Nombre de colonnes'},
        'rows': {default: 6, min: 1, max: 12, title: 'Nombre de lignes', filesOnly: true},
        'sort-order': {default: 0, min: 0, max: 5, title: 'Tri', choices: FOLDER_SORT_CHOICES, filesOnly: true},
    },
};

export function folderViewOptions(settings: FolderSettings, view: string, folderKey: string | null = null): Record<string, number> {
    const options = FOLDER_VIEW_OPTIONS[view];
    if (!options)
        return {};

    let raw: unknown;
    try {
        raw = settings.get_value('dock-view-options').deep_unpack();
    } catch {
        raw = {};
    }
    const stored = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw as Record<string, unknown> : {};
    const isRecord = (value: unknown): value is Record<string, unknown> =>
        Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    const defaults = isRecord(stored[view]) ? stored[view] : {};
    const overrideValue = folderKey ? stored[`${folderKey}:${view}`] : null;
    const overrides = isRecord(overrideValue) ? overrideValue : {};

    return Object.fromEntries(Object.entries(options).map(([key, spec]) => {
        const isValid = (value: unknown): value is number =>
            typeof value === 'number' && Number.isInteger(value) &&
            value >= spec.min && value <= spec.max;
        let value = isValid(defaults[key]) ? defaults[key] : spec.default;
        if (isValid(overrides[key]))
            value = overrides[key];
        return [key, value];
    }));
}