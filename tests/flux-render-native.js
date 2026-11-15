import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {parseFluxProgram} from '../dist/widgets/fluxLanguage.js';
import {createFluxWidget} from '../dist/widgets/fluxWidget.js';

export const METRICS = {};

export async function run() {
    const source = 'version = 1\nsource("weather", url="https://example.com/data")\n';
    const template = [
        'version: 1',
        'desktop:',
        '  - type: repeat',
        '    items: data.weather.items',
        '    children:',
        '      - type: text',
        '        text: "{{item.name}}"',
    ].join('\n');
    const program = parseFluxProgram(source, template);
    let update;
    const session = {program, data: {weather: {items: Array.from({length: 20}, (_, index) => ({name: `Ville ${index}`}))}},
        status: {}, errors: {}, subscribe: callback => { update = callback; return () => {}; }, refresh() {}};
    const api = {
        card: () => {
            const actor = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, width: 240, height: 150});
            const body = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true});
            actor.add_child(body);
            return {actor, body, dragHandle: actor};
        },
        box: properties => {
            const {vertical, ...layoutProperties} = properties;
            return new St.BoxLayout({...layoutProperties,
                ...(vertical === undefined ? {} : {orientation: vertical
                    ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL})});
        },
        list: () => {
            const content = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
            const actor = new St.ScrollView({child: content, clip_to_allocation: true, x_expand: true, y_expand: true,
                hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC});
            return {actor, content};
        },
        label: (text, properties = {}) => new St.Label({text, ...properties}),
        icon: (name, size) => new St.Icon({icon_name: name, icon_size: size}),
        button: () => new St.Button(),
        clockTimeText: () => '12:30',
        watchClock() {},
    };
    const view = createFluxWidget({name: 'Liste'}, {api, target: 'desktop', config: {}}, session);
    Main.layoutManager.addTopChrome(view.actor);
    view.actor.set_position(100, 100);
    try {
        await Scripting.waitLeisure();
        const scroll = view.body.get_first_child();
        if (!(scroll instanceof St.ScrollView) || !scroll.clip_to_allocation)
            throw new Error('Flux repeat is not a clipped scroll view');
        const adjustment = scroll.vadjustment;
        if (adjustment.upper <= adjustment.page_size)
            throw new Error('Long Flux list is not scrollable');
        adjustment.value = adjustment.upper - adjustment.page_size;
        if (adjustment.value <= 0)
            throw new Error('Flux list did not scroll');
        const content = scroll.get_child();
        if (content.get_children().length !== 20)
            throw new Error('Flux list did not create its components');
        session.data.weather.items = [{name: 'Mise a jour'}];
        update();
        await Scripting.waitLeisure();
        if (content.get_children().length !== 1 || content.get_first_child().text !== 'Mise a jour')
            throw new Error('Flux list did not replace old components');
        print('Native Flux repeat scrolls and replaces its components');
    } finally {
        Main.layoutManager.removeChrome(view.actor);
        view.destroy();
        view.actor.destroy();
    }
}