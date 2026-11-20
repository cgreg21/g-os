// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {DockManager} from './docking.js';
import {Clutter, Meta} from './dependencies/gi.js';
import {Main} from './dependencies/shell/ui.js';
import {Extension} from './dependencies/shell/extensions/extension.js';
import {Preset, getBuiltInRecipe} from './flourish/lib/motion/catalog.js';
import {DockIntegration as FlourishDockIntegration} from './flourish/lib/runtime/dockIntegration.js';

// We export this so it can be accessed by other extensions
export let dockManager;

export default class DashToDockExtension extends Extension.Extension {

    _enableFlourishMagnification() {
        const laters = global.compositor.get_laters();
        this._flourishScheduler = {
            schedule: callback => laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
                callback();
                return false;
            }),
            cancel: id => laters.remove(id),
        };

        const recipe = getBuiltInRecipe(Preset.EXPRESSIVE);
        recipe.hover.scale = 1.35;
        recipe.hover.lift = 6;
        recipe.hover.reach = 2;
        recipe.hover.dynamicSpacing = true;
        recipe.attention.enabled = false;
        recipe.press.enabled = false;
        recipe.launch.enabled = false;

        this._flourishDockIntegration = new FlourishDockIntegration({
            scheduler: this._flourishScheduler,
        });
        this._flourishDockIntegration.enable(recipe);

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
