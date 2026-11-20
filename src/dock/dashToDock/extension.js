// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {DockManager} from './docking.js';
import {Clutter, Gio, Meta} from './dependencies/gi.js';
import {Main} from './dependencies/shell/ui.js';
import {Extension} from './dependencies/shell/extensions/extension.js';
import {Preset, getBuiltInRecipe} from './flourish/lib/motion/catalog.js';
import {DockIntegration as FlourishDockIntegration} from './flourish/lib/runtime/dockIntegration.js';

// We export this so it can be accessed by other extensions
export let dockManager;

export default class DashToDockExtension extends Extension.Extension {

    _createFlourishRecipe() {
        const recipe = getBuiltInRecipe(Preset.BALANCED);
        recipe.hover.enabled = this._flourishSettings.get_boolean('magnification-enabled');
        recipe.hover.scale = this._flourishSettings.get_double('magnification-scale');
        recipe.hover.lift = this._flourishSettings.get_double('magnification-lift');
        recipe.hover.duration = this._flourishSettings.get_int('magnification-duration');
        recipe.hover.reach = this._flourishSettings.get_int('magnification-reach');
        recipe.hover.dynamicSpacing =
            this._flourishSettings.get_boolean('magnification-dynamic-spacing');
        recipe.press.enabled = false;
        recipe.launch.enabled = false;
        recipe.attention.enabled = false;
        return recipe;
    }

    _applyFlourishSettings() {
        if (this._flourishSettings && this._flourishDockIntegration)
            this._flourishDockIntegration.setRecipe(this._createFlourishRecipe());
    }

    _enableFlourishMagnification() {
        const laters = global.compositor.get_laters();
        this._flourishScheduler = {
            schedule: callback => laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
                callback();
                return false;
            }),
            cancel: id => laters.remove(id),
        };

        this._flourishSettings = new Gio.Settings({
            schema_id: 'org.gnome.shell.extensions.dash-to-dock',
        });
        this._flourishDockIntegration = new FlourishDockIntegration({
            scheduler: this._flourishScheduler,
        });
        this._flourishDockIntegration.enable(this._createFlourishRecipe());
        this._flourishSettings.connectObject(
            'changed::magnification-enabled', () => this._applyFlourishSettings(),
            'changed::magnification-scale', () => this._applyFlourishSettings(),
            'changed::magnification-lift', () => this._applyFlourishSettings(),
            'changed::magnification-duration', () => this._applyFlourishSettings(),
            'changed::magnification-reach', () => this._applyFlourishSettings(),
            'changed::magnification-dynamic-spacing', () => this._applyFlourishSettings(),
            this);

        global.stage.connectObject(
            'motion-event', (_stage, event) => {
                const [x, y] = event.get_coords();
                const pen = event.get_device_tool() !== null;
                this._flourishDockIntegration?.onPointerMotion(x, y, pen);
                return Clutter.EVENT_PROPAGATE;
            },
            'event', (_stage, event) => {
                if (event.type() === Clutter.EventType.PROXIMITY_OUT)
                    this._flourishDockIntegration?.penLeft();
                return Clutter.EVENT_PROPAGATE;
            }, this);

        const holdPointer = held =>
            this._flourishDockIntegration?.holdPointer(Main.overview, held);
        Main.overview.connectObject(
            'item-drag-begin', () => holdPointer(true),
            'item-drag-end', () => holdPointer(false), this);
    }

    _disableFlourishMagnification() {
        global.stage.disconnectObject(this);
        Main.overview.disconnectObject(this);
        this._flourishSettings?.disconnectObject(this);
        this._flourishSettings = null;
        this._flourishDockIntegration?.disable();
        this._flourishDockIntegration = null;
        this._flourishScheduler = null;
    }

    enable() {
        // TODO: Remove this when upstream will disable extensions on shutdown
        // See: https://gitlab.gnome.org/GNOME/gnome-shell/-/merge_requests/4214
        this._shutdownID = global.connect('shutdown', () => this.disable());
        dockManager = new DockManager(this);
        this._enableFlourishMagnification();
    }

    disable() {
        global.disconnect(this._shutdownID);
        delete this._shutdownID;
        this._disableFlourishMagnification();
        dockManager?.destroy();
        dockManager = null;
    }
}
