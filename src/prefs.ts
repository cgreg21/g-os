import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {readAppFolders, writeAppFolders, FOLDER_VIEW_OPTIONS, folderViewOptions} from './shared/appFolders.js';

export default class GOsPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        const controls = new Map<string, Gtk.Widget>();
        const bindControl = (key, widget, property) => {
            settings.bind(key, widget, property,
                Gio.SettingsBindFlags.DEFAULT | Gio.SettingsBindFlags.NO_SENSITIVITY);
            controls.set(key, widget);
        };
        window.search_enabled = true;
        const dockPage = new Adw.PreferencesPage({title: 'Dock', icon_name: 'preferences-desktop-display-symbolic'});
        const shortcutsPage = new Adw.PreferencesPage({title: 'Raccourcis', icon_name: 'preferences-desktop-keyboard-symbolic'});
        const desktopPage = new Adw.PreferencesPage({title: 'Barre et fenêtres', icon_name: 'preferences-system-windows-symbolic'});
        const widgetsPage = new Adw.PreferencesPage({title: 'Widgets', icon_name: 'preferences-desktop-wallpaper-symbolic'});
        window.add(dockPage);
        window.add(shortcutsPage);
        window.add(desktopPage);
        window.add(widgetsPage);
        const dock = new Adw.PreferencesGroup({title: 'Disposition'});
        const behavior = new Adw.PreferencesGroup({title: 'Comportement'});
        const animations = new Adw.PreferencesGroup({title: 'Animations'});
        const applications = new Adw.PreferencesGroup({title: 'Applications'});
        const dockFolders = new Adw.PreferencesGroup({title: 'Dossiers du Dock'});
        const appFolders = new Adw.PreferencesGroup({title: 'Dossiers d’applications'});
        const viewDefaults = new Adw.PreferencesGroup({title: 'Options par défaut des vues'});
        const shortcutVisibility = new Adw.PreferencesGroup({title: 'Affichage'});
        const shortcuts = new Adw.PreferencesGroup({title: 'Raccourcis du Dock'});
        const dockLocations = new Adw.PreferencesGroup({title: 'Emplacements du Dock'});
        const desktopIcons = new Adw.PreferencesGroup({title: 'Icônes du bureau'});
        const desktopWidgets = new Adw.PreferencesGroup({title: 'Bureau'});
        const dockWidgets = new Adw.PreferencesGroup({title: 'Widgets du Dock'});
        const panel = new Adw.PreferencesGroup({title: 'Barre supérieure'});
        dockPage.add(dock);
        dockPage.add(behavior);
        dockPage.add(animations);
        dockPage.add(applications);
        dockPage.add(dockFolders);
        dockPage.add(appFolders);
        dockPage.add(viewDefaults);
        dockPage.add(dockLocations);
        const appFolderSignals = this._setupAppFolderPreferences(window, settings, appFolders);
        const viewOptionSignals = this._setupFolderViewDefaults(settings, viewDefaults);
        const launcherIconCleanup = [
            this._setupLauncherIconPreferences(window, settings, panel, 'panel', 'Icône de la topbar'),
            this._setupLauncherIconPreferences(window, settings, dock, 'dock', 'Icône des applications du Dock'),
        ];
        shortcutsPage.add(shortcutVisibility);
        shortcutsPage.add(shortcuts);
        desktopPage.add(panel);
        desktopPage.add(desktopIcons);
        widgetsPage.add(desktopWidgets);
        widgetsPage.add(dockWidgets);
        const widgetManagerActions: [Adw.PreferencesGroup, string, string][] = [
            [desktopWidgets, 'desktop', 'Configuration des widgets du bureau'],
            [dockWidgets, 'dock', 'Gestion des widgets du Dock'],
        ];
        for (const [group, target, title] of widgetManagerActions) {
            const row = new Adw.ActionRow({title});
            const button = new Gtk.Button({icon_name: 'preferences-system-symbolic', tooltip_text: title,
                valign: Gtk.Align.CENTER});
            row.add_suffix(button);
            button.connect('clicked', () => this._launchWidgetManager(window, settings, target));
            group.add(row);
        }
        settings.bind('show-dock-shortcuts', shortcuts, 'sensitive', Gio.SettingsBindFlags.GET);

        const windows = new Adw.PreferencesGroup({title: 'Fenêtres'});
        desktopPage.add(windows);
        const buttons = new Adw.SwitchRow({
            title: 'Boutons de fenêtre à gauche',
            subtitle: 'Fermer, réduire, agrandir. Les applications avec leurs propres décorations peuvent ignorer ce réglage.',
        });
        windows.add(buttons);
        bindControl('window-buttons-left', buttons, 'active');
        for (const [key, title] of [
            ['coverflow-enabled', 'Cover Flow des fenêtres avec Alt+Tab'],
            ['coverflow-current-workspace-only', 'Cover Flow limité à l’espace courant'],
        ]) {
            const row = new Adw.SwitchRow({title});
            windows.add(row);
            bindControl(key, row, 'active');
        }
        const coverflowDuration = Adw.SpinRow.new_with_range(0, 500, 20);
        coverflowDuration.title = 'Durée de transition du Cover Flow (ms)';
        windows.add(coverflowDuration);
        bindControl('coverflow-animation-duration', coverflowDuration, 'value');

        const search = new Adw.PreferencesGroup({title: 'Recherche'});
        desktopPage.add(search);
        const spotlight = new Adw.SwitchRow({
            title: 'Recherche avec Super+Espace',
            subtitle: 'Peut entrer en conflit avec le changement de disposition clavier de GNOME.',
        });
        search.add(spotlight);
        bindControl('enable-spotlight', spotlight, 'active');

        const switches: [Adw.PreferencesGroup, string, string][] = [
            [dock, 'show-dock', 'Afficher le Dock'],
            [dock, 'dock-show-border', 'Afficher la bordure du Dock'],
            [dock, 'dock-show-shadow', 'Afficher l’ombre du Dock'],
            [behavior, 'reserve-dock-space', 'Empêcher les fenêtres de passer sous le Dock'],
            [behavior, 'dock-autohide', 'Masquer automatiquement le Dock'],
            [behavior, 'dock-hide-when-covered', 'Masquer le Dock sous les fenêtres'],
            [behavior, 'dock-window-previews', 'Aperçus des fenêtres au survol'],
            [animations, 'dock-maximize-slide', 'Coller le Dock au bord quand une fenêtre est maximisée'],
            [animations, 'dock-launch-animation', 'Animer le lancement des applications'],
            [behavior, 'dock-cycle-windows', 'Parcourir les fenêtres de l’application active au clic'],
            [applications, 'show-running-apps', 'Afficher les applications ouvertes'],
            [applications, 'dock-current-workspace', 'Limiter les applications ouvertes à l’espace courant'],
            [shortcutVisibility, 'show-dock-shortcuts', 'Afficher les raccourcis du Dock'],
            [shortcuts, 'shortcut-overview', 'Fenêtres et espaces de travail'],
            [shortcuts, 'shortcut-desktop', 'Bureau'],
            [shortcuts, 'shortcut-files', 'Fichiers'],
            [shortcuts, 'shortcut-downloads', 'Téléchargements'],
            [shortcuts, 'shortcut-trash', 'Corbeille'],
            [panel, 'panel-style', 'Utiliser le thème GNOME Shell pour la barre supérieure'],
            [panel, 'show-active-app', 'Afficher le nom de l’application active'],
            [panel, 'panel-show-clock', 'Afficher l’horloge'],
            [panel, 'panel-show-search', 'Afficher le bouton de recherche'],
            [panel, 'panel-show-preferences', 'Afficher le bouton de préférences'],
            [panel, 'panel-show-notifications', 'Afficher les notifications'],
            [panel, 'global-menu-enabled', 'Afficher le menu global des applications compatibles'],
            [panel, 'global-menu-dbus-enabled', 'DBusMenu pour les applications X11 / XWayland'],
            [panel, 'panel-show-wifi', 'Afficher le bouton Wi-Fi'],
            [panel, 'panel-show-bluetooth', 'Afficher le bouton Bluetooth'],
            [panel, 'panel-show-sound', 'Afficher le bouton Son'],
            [panel, 'panel-show-brightness', 'Afficher le bouton de luminosité'],
            [panel, 'panel-show-battery', 'Afficher le bouton Batterie'],
            [panel, 'panel-show-battery-level', 'Afficher le pourcentage de batterie'],
            [desktopWidgets, 'desktop-widget-clock', 'Horloge'],
            [desktopWidgets, 'desktop-widget-calendar', 'Calendrier'],
            [desktopWidgets, 'desktop-widget-media', 'Lecteur média'],
            [dockWidgets, 'dock-widget-clock', 'Horloge'],
            [dockWidgets, 'dock-widget-calendar', 'Date'],
            [dockWidgets, 'dock-widget-media', 'Lecteur média'],
        ];
        for (const [group, key, title] of switches) {
            const row = new Adw.SwitchRow({title});
            group.add(row);
            bindControl(key, row, 'active');
        }
        for (const [key, title] of [
            ['dock-icons-show-home', 'Dossier personnel'],
            ['dock-icons-show-removable', 'Périphériques USB et amovibles'],
            ['dock-icons-show-network', 'Partages réseau'],
        ]) {
            const row = new Adw.SwitchRow({title});
            dockLocations.add(row);
            bindControl(key, row, 'active');
        }
        for (const [key, title] of [
            ['desktop-icons-show-folder', 'Contenu du dossier Bureau du système'],
            ['desktop-icons-show-home', 'Dossier personnel'],
            ['desktop-icons-show-removable', 'Périphériques USB et amovibles'],
            ['desktop-icons-show-network', 'Partages réseau'],
        ]) {
            const row = new Adw.SwitchRow({title});
            desktopIcons.add(row);
            bindControl(key, row, 'active');
        }
        const desktopGridSize = Adw.SpinRow.new_with_range(64, 256, 8);
        desktopGridSize.title = 'Taille de la grille des icônes (px)';
        bindControl('desktop-icons-grid-size', desktopGridSize, 'value');
        desktopIcons.add(desktopGridSize);
        const desktopIconSize = Adw.SpinRow.new_with_range(24, 96, 4);
        desktopIconSize.title = 'Taille des icônes (px)';
        bindControl('desktop-icons-size', desktopIconSize, 'value');
        desktopIcons.add(desktopIconSize);
        const desktopAlignment = new Adw.ComboRow({title: 'Alignement automatique',
            model: Gtk.StringList.new(['Gauche, depuis le haut', 'Droite, depuis le haut', 'Libre'])});
        bindControl('desktop-icons-alignment', desktopAlignment, 'selected');
        desktopIcons.add(desktopAlignment);
        const desktopLabelPosition = new Adw.ComboRow({title: 'Position des libellés',
            model: Gtk.StringList.new(['À gauche', 'À droite', 'En bas'])});
        bindControl('desktop-icons-label-position', desktopLabelPosition, 'selected');
        desktopIcons.add(desktopLabelPosition);
        const panelHeight = Adw.SpinRow.new_with_range(24, 48, 1);
        const notificationPosition = new Adw.ComboRow({
            title: 'Position des notifications GNOME',
            model: Gtk.StringList.new(['Haut centre', 'Haut gauche', 'Haut droite',
                'Milieu gauche', 'Centre', 'Milieu droite', 'Bas gauche', 'Bas centre', 'Bas droite']),
        });
        bindControl('notification-position', notificationPosition, 'selected');
        panel.add(notificationPosition);
        panelHeight.title = 'Hauteur de la barre (px)';
        bindControl('panel-height', panelHeight, 'value');
        panel.add(panelHeight);
        const panelPadding: [string, string, number][] = [
            ['panel-padding-horizontal', 'Padding horizontal (px)', 32],
            ['panel-padding-vertical', 'Padding vertical (px)', 12],
        ];
        for (const [key, title, maximum] of panelPadding) {
            const row = Adw.SpinRow.new_with_range(0, maximum, 1);
            row.title = title;
            bindControl(key, row, 'value');
            panel.add(row);
        }
        for (const [key, title] of [
            ['panel-icon-padding', 'Padding intérieur des boutons (px)'],
            ['panel-item-spacing', 'Espacement entre les éléments (px)'],
        ]) {
            const row = Adw.SpinRow.new_with_range(0, 24, 1);
            row.title = title;
            bindControl(key, row, 'value');
            panel.add(row);
        }
        const widgetWidth = Adw.SpinRow.new_with_range(120, 360, 10);
        widgetWidth.title = 'Largeur des widgets';
        bindControl('desktop-widget-width', widgetWidth, 'value');
        desktopWidgets.add(widgetWidth);

        const size = Adw.SpinRow.new_with_range(24, 64, 1);
        const position = new Adw.ComboRow({
            title: 'Position du Dock',
            model: Gtk.StringList.new(['En bas', 'À gauche', 'À droite']),
        });
        bindControl('dock-position', position, 'selected');
        dock.add(position);
        size.title = 'Taille des icônes';
        bindControl('icon-size', size, 'value');
        dock.add(size);
        const hoverAnimation = new Adw.ComboRow({
            title: 'Animation au survol',
            model: Gtk.StringList.new(['Aucune', 'Agrandir', 'Soulever', 'Rebond', 'Magnification']),
        });
        bindControl('dock-hover-animation', hoverAnimation, 'selected');
        animations.add(hoverAnimation);
        const magnificationIcons = Adw.SpinRow.new_with_range(1, 8, 1);
        magnificationIcons.title = 'Icônes agrandies de chaque côté';
        bindControl('dock-magnify-icons', magnificationIcons, 'value');
        animations.add(magnificationIcons);
        const magnificationMaximum = Adw.SpinRow.new_with_range(100, 400, 10);
        magnificationMaximum.title = 'Agrandissement maximal (%)';
        bindControl('dock-magnify-max', magnificationMaximum, 'value');
        animations.add(magnificationMaximum);
        const slideCurve = new Adw.ComboRow({
            title: 'Courbe des slides du Dock',
            model: Gtk.StringList.new(['Comportement actuel', 'Linéaire', 'Progressive', 'Vive']),
        });
        bindControl('dock-slide-curve', slideCurve, 'selected');
        animations.add(slideCurve);
        const launchMode = new Adw.ComboRow({
            title: 'Animation au lancement',
            model: Gtk.StringList.new(['Comportement actuel', 'Rebond', 'Animation GNOME']),
        });
        bindControl('dock-launch-mode', launchMode, 'selected');
        animations.add(launchMode);
        const animationDurations: [string, string, number, number, number][] = [
            ['dock-slide-duration', 'Durée du masquage et de l’apparition (ms)', 0, 1000, 20],
            ['dock-hover-duration', 'Durée du survol (ms)', 50, 1000, 10],
            ['dock-hover-strength', 'Intensité du survol (%)', 25, 100, 5],
            ['dock-launch-duration', 'Durée du rebond au lancement (ms)', 100, 2000, 20],
            ['dock-launch-strength', 'Intensité du rebond au lancement (%)', 25, 100, 5],
        ];
        for (const [key, title, minimum, maximum, step] of animationDurations) {
            const row = Adw.SpinRow.new_with_range(minimum, maximum, step);
            row.title = title;
            bindControl(key, row, 'value');
            animations.add(row);
        }
        const iconPadding = Adw.SpinRow.new_with_range(0, 12, 1);
        iconPadding.title = 'Marge des icônes (px)';
        bindControl('dock-icon-padding', iconPadding, 'value');
        dock.add(iconPadding);
        const backgroundStyle = new Adw.ComboRow({
            title: 'Fond du Dock',
            model: Gtk.StringList.new(['Thème actuel', 'Discret', 'Opaque', 'Transparent']),
        });
        bindControl('dock-background-style', backgroundStyle, 'selected');
        dock.add(backgroundStyle);
        const dockRadius = Adw.SpinRow.new_with_range(0, 48, 1);
        dockRadius.title = 'Rayon des coins du Dock (px)';
        bindControl('dock-border-radius', dockRadius, 'value');
        dock.add(dockRadius);
        const dockMargins: [string, string, number][] = [
            ['dock-edge-margin', 'Distance au bord de l’écran (px)', 48],
            ['dock-window-margin', 'Distance entre le Dock et les fenêtres (px)', 48],
            ['dock-item-spacing', 'Espacement des éléments (px)', 20],
            ['dock-padding-horizontal', 'Marge intérieure gauche et droite (px)', 48],
        ];
        for (const [key, title, maximum] of dockMargins) {
            const row = Adw.SpinRow.new_with_range(0, maximum, 1);
            row.title = title;
            bindControl(key, row, 'value');
            dock.add(row);
        }
        for (const [key, title] of [
            ['dock-padding-top', 'Marge intérieure haute du Dock (px)'],
            ['dock-padding-bottom', 'Marge intérieure basse du Dock (px)'],
        ]) {
            const row = Adw.SpinRow.new_with_range(0, 48, 1);
            row.title = title;
            bindControl(key, row, 'value');
            dock.add(row);
        }
        const folderView = new Adw.ComboRow({
            title: 'Ouverture par défaut des dossiers',
            model: Gtk.StringList.new(['Pile', 'Grille']),
        });
        bindControl('dock-folder-view', folderView, 'selected');
        dockFolders.add(folderView);

        const addFolderRow = new Adw.ActionRow({title: 'Ajouter un dossier'});
        const addFolderButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            tooltip_text: 'Ajouter un dossier au Dock',
            valign: Gtk.Align.CENTER,
        });
        addFolderButton.add_css_class('flat');
        addFolderRow.add_suffix(addFolderButton);
        dockFolders.add(addFolderRow);

        const folderDrop = Gtk.DropTarget.new(Gdk.FileList.$gtype, Gdk.DragAction.COPY);
        folderDrop.connect('drop', (target, fileList) => {
            if (!settings.is_writable('dock-folders'))
                return false;
            this._addDroppedFolders(settings, (fileList as Gdk.FileList).get_files()).catch(() => {});
            return true;
        });
        dockPage.add_controller(folderDrop);

        const folderRows = new Map<string, Adw.ComboRow>();
        const updateFolderRows = () => {
            const folders = settings.get_strv('dock-folders');
            const views = settings.get_value('dock-folder-views').deep_unpack() as Record<string, number>;
            for (const [uri, row] of folderRows) {
                if (!folders.includes(uri)) {
                    dockFolders.remove(row);
                    folderRows.delete(uri);
                }
            }
            for (const uri of folders) {
                const selected = views[uri] === 0 || views[uri] === 1 ? views[uri] + 1 : 0;
                if (folderRows.has(uri)) {
                    folderRows.get(uri).selected = selected;
                    continue;
                }
                const file = Gio.File.new_for_uri(uri);
                const row = new Adw.ComboRow({
                    title: file.get_basename() || uri,
                    subtitle: uri,
                    model: Gtk.StringList.new(['Par défaut', 'Pile', 'Grille']),
                    selected,
                });
                row.connect('notify::selected', () => {
                    if (!settings.is_writable('dock-folder-views'))
                        return;
                    const current = settings.get_value('dock-folder-views').deep_unpack() as Record<string, number>;
                    const view = row.selected - 1;
                    if (view === -1) {
                        if (!(uri in current))
                            return;
                        delete current[uri];
                    } else {
                        if (current[uri] === view)
                            return;
                        current[uri] = view;
                    }
                    settings.set_value('dock-folder-views', new GLib.Variant('a{si}', current));
                });
                const remove = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    tooltip_text: 'Retirer ce dossier du Dock',
                    valign: Gtk.Align.CENTER,
                });
                remove.add_css_class('flat');
                row.add_suffix(remove);
                const optionsButton = new Gtk.Button({icon_name: 'preferences-system-symbolic',
                    tooltip_text: 'Options de la pile et de la grille', valign: Gtk.Align.CENTER});
                optionsButton.add_css_class('flat');
                row.add_suffix(optionsButton);
                optionsButton.connect('clicked', () => this._editFolderViewOptions(window, settings,
                    `folder:${uri}`, file.get_basename() || uri, true));
                remove.connect('clicked', () => {
                    settings.set_strv('dock-folders', settings.get_strv('dock-folders')
                        .filter(folder => folder !== uri));
                });
                dockFolders.add(row);
                folderRows.set(uri, row);
            }
            dockFolders.remove(addFolderRow);
            dockFolders.add(addFolderRow);
        };
        updateFolderRows();
        const folderSignal = settings.connect('changed::dock-folders', updateFolderRows);
        addFolderButton.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({title: 'Ajouter un dossier au Dock'});
            dialog.select_folder(window, null, (source, result) => {
                try {
                    const uri = source.select_folder_finish(result).get_uri();
                    const folders = settings.get_strv('dock-folders');
                    if (!folders.includes(uri))
                        settings.set_strv('dock-folders', [...folders, uri]);
                } catch {
                    // Closing the chooser leaves the folder list unchanged.
                }
            });
        });
        const delay = Adw.SpinRow.new_with_range(100, 2000, 50);
        delay.title = 'Délai de masquage (ms)';
        bindControl('dock-hide-delay', delay, 'value');
        behavior.add(delay);
        const previewDelay = Adw.SpinRow.new_with_range(100, 3000, 50);
        previewDelay.title = 'Délai des aperçus de fenêtres (ms)';
        bindControl('dock-window-preview-delay', previewDelay, 'value');
        behavior.add(previewDelay);
        const maximizeSlideDuration = Adw.SpinRow.new_with_range(100, 800, 20);
        maximizeSlideDuration.title = 'Durée du slide au maximisé (ms)';
        bindControl('dock-maximize-slide-duration', maximizeSlideDuration, 'value');
        animations.add(maximizeSlideDuration);

        const dependencies = new Map<string, string[]>([
            ['coverflow-current-workspace-only', ['coverflow-enabled']],
            ['coverflow-animation-duration', ['coverflow-enabled']],
            ['dock-window-previews', ['show-dock']],
            ['dock-window-preview-delay', ['show-dock', 'dock-window-previews']],
            ['global-menu-dbus-enabled', ['global-menu-enabled']],
            ...['reserve-dock-space', 'dock-position', 'icon-size', 'dock-icon-padding', 'dock-border-radius',
                'dock-edge-margin', 'dock-item-spacing', 'dock-padding-top',
                'dock-show-border', 'dock-show-shadow',
                'dock-background-style', 'dock-padding-horizontal',
                'dock-padding-bottom', 'dock-hover-animation', 'dock-autohide', 'dock-hide-when-covered',
                'dock-cycle-windows', 'show-running-apps', 'show-dock-shortcuts']
                .map((key): [string, string[]] => [key, ['show-dock']]),
            ['dock-maximize-slide', ['show-dock', 'reserve-dock-space']],
            ['dock-window-margin', ['show-dock', 'reserve-dock-space']],
            ['dock-maximize-slide-duration', ['show-dock', 'reserve-dock-space', 'dock-maximize-slide']],
            ...['dock-slide-duration', 'dock-slide-curve', 'dock-hover-duration', 'dock-hover-strength', 'dock-magnify-icons',
                'dock-magnify-max', 'dock-launch-animation']
                .map((key): [string, string[]] => [key, ['show-dock']]),
            ...['dock-launch-mode', 'dock-launch-duration', 'dock-launch-strength']
                .map((key): [string, string[]] => [key, ['show-dock', 'dock-launch-animation']]),
            ['dock-current-workspace', ['show-dock', 'show-running-apps']],
            ...['shortcut-overview', 'shortcut-desktop', 'shortcut-files', 'shortcut-downloads', 'shortcut-trash']
                .map((key): [string, string[]] => [key, ['show-dock', 'show-dock-shortcuts']]),
            ...['dock-icons-show-home', 'dock-icons-show-removable', 'dock-icons-show-network']
                .map((key): [string, string[]] => [key, ['show-dock']]),
            ...['dock-widget-clock', 'dock-widget-calendar', 'dock-widget-media']
                .map((key): [string, string[]] => [key, ['show-dock']]),
            ['dock-hide-delay', ['show-dock', 'dock-autohide']],
        ]);
        const updateSensitivity = () => {
            for (const [key, widget] of controls) {
                widget.sensitive = settings.is_writable(key) &&
                    (dependencies.get(key) ?? []).every(required => settings.get_boolean(required));
                if (key === 'dock-hover-duration')
                    widget.sensitive &&= settings.get_int('dock-hover-animation') !== 0;
                if (key === 'dock-hover-strength')
                    widget.sensitive &&= settings.get_int('dock-hover-animation') > 0 &&
                        settings.get_int('dock-hover-animation') < 4;
                if (['dock-magnify-icons', 'dock-magnify-max'].includes(key))
                    widget.sensitive &&= settings.get_int('dock-hover-animation') === 4;
                if (['dock-launch-duration', 'dock-launch-strength'].includes(key)) {
                    const launchMode = settings.get_int('dock-launch-mode');
                    widget.sensitive &&= launchMode === 1 ||
                        (launchMode === 0 && settings.get_int('dock-hover-animation') === 3);
                }
                if (['desktop-widget-clock', 'desktop-widget-calendar', 'desktop-widget-media', 'desktop-widget-width',
                    'dock-widget-clock', 'dock-widget-calendar', 'dock-widget-media'].includes(key))
                    widget.sensitive &&= !settings.get_boolean('widgets-managed');
            }
            for (const row of folderRows.values())
                row.sensitive = settings.is_writable('dock-folder-views') && settings.get_boolean('show-dock');
        };
        updateSensitivity();
        const signalIds = [
            ...appFolderSignals,
            ...viewOptionSignals,
            folderSignal,
            settings.connect('changed::dock-folder-views', updateFolderRows),
            settings.connect('changed', updateSensitivity),
            settings.connect('writable-changed', updateSensitivity),
        ];
        const consumeWidgetRequest = () => {
            const request = settings.get_string?.('widget-manager-request');
            if (!request)
                return;
            settings.set_string('widget-manager-request', '');
            try {
                const value = JSON.parse(request);
                if (['desktop', 'dock'].includes(value.target))
                    this._launchWidgetManager(window, settings, value.target, value.monitor);
            } catch {}
        };
        signalIds.push(settings.connect('changed::widget-manager-request', consumeWidgetRequest));
        consumeWidgetRequest();
        window.connect('close-request', () => {
            for (const id of signalIds.splice(0))
                settings.disconnect(id);
            for (const cleanup of launcherIconCleanup.splice(0))
                cleanup();
            return false;
        });

        const maintenance = new Adw.PreferencesGroup({title: 'Maintenance'});
        desktopPage.add(maintenance);
        const resetRow = new Adw.ActionRow({title: 'Réglages de l’extension'});
        const resetButton = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            tooltip_text: 'Rétablir les réglages par défaut',
            valign: Gtk.Align.CENTER,
        });
        resetButton.add_css_class('flat');
        resetRow.add_suffix(resetButton);
        maintenance.add(resetRow);
        resetButton.connect('clicked', () => {
            const dialog = new Adw.AlertDialog({
                heading: 'Rétablir les réglages ?',
                body: 'Vos choix seront remplacés par les valeurs par défaut de l’extension.',
                default_response: 'cancel',
                close_response: 'cancel',
            });
            dialog.add_response('cancel', 'Annuler');
            dialog.add_response('reset', 'Rétablir');
            dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.connect('response', (alert, response) => {
                if (response === 'reset')
                    this._resetSettings(settings);
            });
            dialog.present(window);
        });
    }

    _setupLauncherIconPreferences(window, settings, group, target, title) {
        const nameKey = `${target}-launcher-icon-name`;
        const fileKey = `${target}-launcher-icon-file`;
        const theme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
        const row = new Adw.ActionRow({title});
        const selector = new Gtk.DropDown({enable_search: true, valign: Gtk.Align.CENTER, width_request: 220});
        const preview = Gtk.Image.new_from_icon_name('start-here-symbolic');
        preview.pixel_size = 24;
        preview.valign = Gtk.Align.CENTER;
        const browse = new Gtk.Button({icon_name: 'folder-open-symbolic',
            tooltip_text: `Parcourir une image pour ${title.toLowerCase()}`, valign: Gtk.Align.CENTER});
        const reset = new Gtk.Button({icon_name: 'edit-undo-symbolic',
            tooltip_text: 'Rétablir le logo GNOME', valign: Gtk.Align.CENTER});
        for (const button of [browse, reset])
            button.add_css_class('flat');
        row.add_suffix(selector);
        row.add_suffix(preview);
        row.add_suffix(browse);
        row.add_suffix(reset);
        group.add(row);
        let names = [];
        let updating = false;
        let closed = false;
        let request = null;
        const refresh = () => {
            updating = true;
            const name = settings.get_string?.(nameKey) || 'gnome-logo-symbolic';
            const file = settings.get_string?.(fileKey) || '';
            const availableNames = ['gnome-logo-symbolic', ...[...new Set([...theme.get_icon_names(), name])]
                .filter(icon => icon !== 'gnome-logo-symbolic').sort((first, second) => first.localeCompare(second))];
            if (availableNames.length !== names.length || availableNames.some((icon, index) => icon !== names[index])) {
                names = availableNames;
                selector.model = Gtk.StringList.new(names);
            }
            const selected = names.indexOf(name);
            if (selector.selected !== selected)
                selector.selected = selected;
            selector.tooltip_text = name;
            row.subtitle = file ? `Image : ${file}` : '';
            row.sensitive = settings.is_writable(nameKey) && settings.is_writable(fileKey);
            browse.sensitive = settings.is_writable(fileKey);
            reset.sensitive = row.sensitive;
            if (file)
                preview.set_from_file(file);
            else if (name === 'gnome-logo-symbolic' && this.path)
                preview.set_from_file(`${this.path}/icons/gnome-logo-symbolic.svg`);
            else
                preview.set_from_icon_name(name === 'gnome-logo-symbolic' ? 'start-here-symbolic' : name);
            updating = false;
        };
        selector.connect('notify::selected', () => {
            if (updating || !row.sensitive || !names[selector.selected])
                return;
            settings.set_string(nameKey, names[selector.selected]);
            settings.set_string(fileKey, '');
        });
        browse.connect('clicked', () => {
            if (!settings.is_writable(fileKey))
                return;
            request?.cancel();
            request = new Gio.Cancellable();
            const filter = new Gtk.FileFilter({name: 'Images'});
            filter.add_mime_type('image/*');
            const chooser = new Gtk.FileDialog({title, default_filter: filter});
            chooser.open(window, request, (dialog, result) => {
                try {
                    const file = dialog.open_finish(result).get_path();
                    if (!closed && file && settings.is_writable(fileKey))
                        settings.set_string(fileKey, file);
                } catch {}
            });
        });
        reset.connect('clicked', () => {
            if (!reset.sensitive)
                return;
            settings.set_string(fileKey, '');
            settings.set_string(nameKey, 'gnome-logo-symbolic');
        });
        const signals = [settings.connect(`changed::${nameKey}`, refresh),
            settings.connect(`changed::${fileKey}`, refresh), settings.connect('writable-changed', refresh)];
        const themeSignal = theme.connect('changed', refresh);
        refresh();
        return () => {
            closed = true;
            request?.cancel();
            for (const id of signals)
                settings.disconnect(id);
            theme.disconnect(themeSignal);
        };
    }

    _saveAppFolder(settings, folder) {
        const folders = readAppFolders(settings);
        const index = folders.findIndex(item => item.id === folder.id);
        const members = new Set(folder.apps);
        for (const item of folders)
            item.apps = item.apps.filter(id => !members.has(id));
        if (index >= 0)
            folders[index] = folder;
        else
            folders.push(folder);
        return writeAppFolders(settings, folders);
    }

    _setupAppFolderPreferences(window, settings, group) {
        const addRow = new Adw.ActionRow({title: 'Nouveau dossier d’applications'});
        const addButton = new Gtk.Button({icon_name: 'folder-new-symbolic',
            tooltip_text: 'Créer un dossier d’applications', valign: Gtk.Align.CENTER});
        addButton.add_css_class('flat');
        addRow.add_suffix(addButton);
        addButton.connect('clicked', () => this._editAppFolder(window, settings));
        const rows = new Map();
        const update = () => {
            for (const row of rows.values())
                group.remove(row);
            rows.clear();
            for (const folder of readAppFolders(settings)) {
                const row = new Adw.ActionRow({title: folder.name,
                    subtitle: `${folder.apps.length} application${folder.apps.length === 1 ? '' : 's'}`});
                const edit = new Gtk.Button({icon_name: 'document-edit-symbolic',
                    tooltip_text: 'Modifier ce dossier', valign: Gtk.Align.CENTER});
                const remove = new Gtk.Button({icon_name: 'list-remove-symbolic',
                    tooltip_text: 'Dissoudre ce dossier', valign: Gtk.Align.CENTER});
                const options = new Gtk.Button({icon_name: 'preferences-system-symbolic',
                    tooltip_text: 'Options de la pile et de la grille', valign: Gtk.Align.CENTER});
                for (const button of [edit, remove, options]) {
                    button.add_css_class('flat');
                    row.add_suffix(button);
                }
                edit.connect('clicked', () => this._editAppFolder(window, settings, folder.id));
                options.connect('clicked', () => this._editFolderViewOptions(window, settings,
                    `app-folder:${folder.id}`, folder.name, false));
                remove.connect('clicked', () => writeAppFolders(settings,
                    readAppFolders(settings).filter(item => item.id !== folder.id)));
                group.add(row);
                rows.set(folder.id, row);
            }
            group.remove(addRow);
            group.add(addRow);
            group.sensitive = settings.is_writable('dock-app-folders');
        };
        group.add(addRow);
        update();
        const drop = Gtk.DropTarget.new(Gdk.FileList.$gtype, Gdk.DragAction.COPY);
        drop.connect('drop', (target, fileList) => {
            if (!settings.is_writable('dock-app-folders'))
                return false;
            const apps = (fileList as Gdk.FileList).get_files().filter(file => file.get_basename()?.endsWith('.desktop'))
                .map(file => GioUnix.DesktopAppInfo.new_from_filename(file.get_path()))
                .filter(Boolean).map(info => info.get_id()).filter(Boolean);
            if (apps.length === 0)
                return false;
            return this._saveAppFolder(settings, {id: GLib.uuid_string_random(), name: 'Applications',
                apps: [...new Set(apps)], icon: '', view: -1});
        });
        group.add_controller(drop);
        return [settings.connect('changed::dock-app-folders', update), settings.connect('writable-changed', update)];
    }

    _launchWidgetManager(window, settings, target, monitor = null) {
        return import('./widgets/widgetManager.js').then(module => {
            window._widgetManagerDialog?.close();
            window._widgetManagerDialog = module.openWidgetManager(window, settings, target, monitor);
            return window._widgetManagerDialog;
        }).catch(error => {
            const dialog = new Adw.AlertDialog({heading: 'Gestionnaire de widgets indisponible', body: error.message});
            dialog.add_response('close', 'Fermer');
            dialog.present(window);
        });
    }

    _setupFolderViewDefaults(settings, group) {
        const rows = new Map();
        const viewTitles: ['pile' | 'grille', string][] = [['pile', 'Pile'], ['grille', 'Grille']];
        for (const [view, title] of viewTitles) {
            const section = new Adw.ExpanderRow({title});
            const values = folderViewOptions(settings, view);
            for (const [key, spec] of Object.entries(FOLDER_VIEW_OPTIONS[view])) {
                const property = spec.choices ? 'selected' : 'value';
                const row = spec.choices ? new Adw.ComboRow({model: Gtk.StringList.new(spec.choices)})
                    : Adw.SpinRow.new_with_range(spec.min, spec.max, 1);
                row.title = spec.filesOnly ? `${spec.title} (dossiers de fichiers)` : spec.title;
                row[property] = values[key];
                (row.connect as (signal: string, callback: () => void) => number)(`notify::${property}`, () => {
                    if (!settings.is_writable('dock-view-options'))
                        return;
                    const stored = settings.get_value('dock-view-options').deep_unpack();
                    const value = Math.round(row[property]);
                    if (stored[view]?.[key] === value)
                        return;
                    stored[view] = {...stored[view], [key]: value};
                    settings.set_value('dock-view-options', new GLib.Variant('a{sa{si}}', stored));
                });
                section.add_row(row);
                rows.set(`${view}:${key}`, row);
            }
            group.add(section);
        }
        const update = () => {
            group.sensitive = settings.is_writable('dock-view-options') && settings.get_boolean('show-dock');
            for (const [view, specs] of Object.entries(FOLDER_VIEW_OPTIONS)) {
                const values = folderViewOptions(settings, view);
                for (const [key, spec] of Object.entries(specs)) {
                    const row = rows.get(`${view}:${key}`);
                    const property = spec.choices ? 'selected' : 'value';
                    if (row[property] !== values[key])
                        row[property] = values[key];
                }
            }
        };
        update();
        return [settings.connect('changed::dock-view-options', update), settings.connect('writable-changed', update),
            settings.connect('changed::show-dock', update)];
    }

    _editFolderViewOptions(window, settings, folderKey, title, isFileFolder) {
        if (!settings.is_writable('dock-view-options'))
            return;
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12});
        const rows = new Map();
        for (const [view, label] of [['pile', 'Pile'], ['grille', 'Grille']]) {
            const section = new Adw.PreferencesGroup({title: label});
            const values = folderViewOptions(settings, view, folderKey);
            for (const [key, spec] of Object.entries(FOLDER_VIEW_OPTIONS[view])) {
                if (spec.filesOnly && !isFileFolder)
                    continue;
                const row = spec.choices ? new Adw.ComboRow({model: Gtk.StringList.new(spec.choices)})
                    : Adw.SpinRow.new_with_range(spec.min, spec.max, 1);
                row.title = spec.title;
                row[spec.choices ? 'selected' : 'value'] = values[key];
                section.add(row);
                rows.set(`${view}:${key}`, row);
            }
            box.append(section);
        }
        const scroll = new Gtk.ScrolledWindow({child: box, min_content_height: 240, max_content_height: 500,
            propagate_natural_height: true, hscrollbar_policy: Gtk.PolicyType.NEVER});
        const dialog = new Adw.AlertDialog({heading: `Options : ${title}`, extra_child: scroll,
            default_response: 'save', close_response: 'cancel'});
        dialog.add_response('cancel', 'Annuler');
        dialog.add_response('reset', 'Valeurs par défaut');
        dialog.add_response('save', 'Enregistrer');
        dialog.set_response_appearance('save', Adw.ResponseAppearance.SUGGESTED);
        dialog.connect('response', (alert, response) => {
            if (!settings.is_writable('dock-view-options') || !['save', 'reset'].includes(response))
                return;
            const stored = settings.get_value('dock-view-options').deep_unpack();
            for (const view of ['pile', 'grille']) {
                const key = `${folderKey}:${view}`;
                if (response === 'reset') {
                    delete stored[key];
                } else {
                    stored[key] = Object.fromEntries([...rows].filter(([name]) => name.startsWith(`${view}:`))
                        .map(([name, row]) => {
                            const option = name.slice(view.length + 1);
                            const property = FOLDER_VIEW_OPTIONS[view][option].choices ? 'selected' : 'value';
                            return [option, Math.round(row[property])];
                        }));
                }
            }
            settings.set_value('dock-view-options', new GLib.Variant('a{sa{si}}', stored));
        });
        dialog.present(window);
    }

    _editAppFolder(window, settings, id = null) {
        if (!settings.is_writable('dock-app-folders'))
            return;
        const existing = readAppFolders(settings).find(folder => folder.id === id);
        if (id && !existing)
            return;
        const folder = existing ?? {id: GLib.uuid_string_random(), name: 'Applications', apps: [], icon: '', view: -1};
        const selected = new Set(folder.apps);
        let icon = folder.icon;
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12});
        const name = new Adw.EntryRow({title: 'Nom du dossier', text: folder.name});
        const view = new Adw.ComboRow({title: 'Ouverture',
            model: Gtk.StringList.new(['Par défaut', 'Pile', 'Grille']), selected: folder.view + 1});
        const iconRow = new Adw.ActionRow({title: icon ? 'Icône personnalisée' : 'Aperçu 2x2'});
        const chooseIcon = new Gtk.Button({icon_name: 'folder-pictures-symbolic',
            tooltip_text: 'Choisir une image pour ce dossier', valign: Gtk.Align.CENTER});
        const resetIcon = new Gtk.Button({icon_name: 'view-grid-symbolic',
            tooltip_text: 'Utiliser les quatre premières icônes en aperçu 2x2', valign: Gtk.Align.CENTER});
        for (const button of [chooseIcon, resetIcon]) {
            button.add_css_class('flat');
            iconRow.add_suffix(button);
        }
        chooseIcon.connect('clicked', () => {
            const filter = new Gtk.FileFilter({name: 'Images'});
            filter.add_mime_type('image/*');
            const chooser = new Gtk.FileDialog({title: 'Icône du dossier', default_filter: filter});
            chooser.open(window, null, (source, result) => {
                try {
                    icon = source.open_finish(result).get_uri();
                    iconRow.title = 'Icône personnalisée';
                } catch {}
            });
        });
        resetIcon.connect('clicked', () => { icon = ''; iconRow.title = 'Aperçu 2x2'; });
        const search = new Gtk.SearchEntry({placeholder_text: 'Rechercher une application'});
        const list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE});
        const applicationRows = [];
        const infos = Gio.AppInfo.get_all().filter(info => info.get_id()?.endsWith('.desktop') && info.should_show())
            .sort((first, second) => first.get_display_name().localeCompare(second.get_display_name()));
        for (const info of infos) {
            const content = new Gtk.Box({spacing: 10, margin_top: 6, margin_bottom: 6, margin_start: 6, margin_end: 6});
            const image = Gtk.Image.new_from_gicon(info.get_icon());
            image.pixel_size = 24;
            const check = new Gtk.CheckButton({label: info.get_display_name(), active: selected.has(info.get_id()), hexpand: true});
            check.connect('toggled', () => {
                if (check.active)
                    selected.add(info.get_id());
                else
                    selected.delete(info.get_id());
            });
            content.append(image);
            content.append(check);
            const row = new Gtk.ListBoxRow({child: content});
            list.append(row);
            applicationRows.push({row, name: info.get_display_name().toLocaleLowerCase()});
        }
        search.connect('search-changed', () => {
            const query = search.text.toLocaleLowerCase();
            for (const item of applicationRows)
                item.row.visible = item.name.includes(query);
        });
        for (const widget of [name, view, iconRow, search,
            new Gtk.ScrolledWindow({child: list, min_content_height: 220, max_content_height: 360,
                propagate_natural_height: true, hscrollbar_policy: Gtk.PolicyType.NEVER})])
            box.append(widget);
        const dialog = new Adw.AlertDialog({heading: existing ? 'Modifier le dossier' : 'Nouveau dossier d’applications',
            extra_child: box, default_response: 'save', close_response: 'cancel'});
        dialog.add_response('cancel', 'Annuler');
        dialog.add_response('save', existing ? 'Enregistrer' : 'Créer');
        dialog.set_response_appearance('save', Adw.ResponseAppearance.SUGGESTED);
        const updateSave = () => dialog.set_response_enabled('save', name.text.trim().length > 0 &&
            settings.is_writable('dock-app-folders'));
        name.connect('notify::text', updateSave);
        updateSave();
        dialog.connect('response', (alert, response) => {
            if (response === 'save' && name.text.trim())
                this._saveAppFolder(settings, {id: folder.id, name: name.text.trim(),
                    apps: [...selected], icon, view: view.selected - 1});
        });
        dialog.present(window);
    }

    async _addDroppedFolders(settings, files) {
        const uris = await Promise.all(files.map(file => new Promise(resolve => {
            file.query_info_async('standard::type', Gio.FileQueryInfoFlags.NONE, 0, null,
                (source, result) => {
                    try {
                        const info = source.query_info_finish(result);
                        resolve(info.get_file_type() === Gio.FileType.DIRECTORY ? file.get_uri() : null);
                    } catch {
                        resolve(null);
                    }
                });
        })));
        if (!settings.is_writable('dock-folders'))
            return;
        const folders = settings.get_strv('dock-folders');
        const updated = [...new Set([...folders, ...uris.filter(uri => uri !== null)])];
        if (updated.length !== folders.length)
            settings.set_strv('dock-folders', updated);
    }

    _resetSettings(settings) {
        const defaults = Gio.Settings.new_full(settings.settings_schema, null, null);
        defaults.delay();
        for (const key of settings.settings_schema.list_keys()) {
            if (key !== 'window-button-layout-backup' && defaults.is_writable(key))
                defaults.reset(key);
        }
        defaults.apply();
    }
}