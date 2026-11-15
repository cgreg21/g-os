export function create(context) {
    const {api, config} = context;
    const dock = context.target === 'dock';
    const view = api.card('Minuteur', 'alarm-symbolic');
    const value = context.square && dock ? api.icon('alarm-symbolic', context.iconSize)
        : api.label('', {style_class: 'g-os-utility-value'});
    view.body.add_child(value);
    const duration = config.minutes * 60000;
    const remaining = state => state.running ? Math.max(0, state.deadline - api.wallTime()) : state.remaining ?? duration;
    const toggle = () => {
        const state = api.getState();
        const rest = remaining(state);
        if (state.running)
            api.saveState({running: false, remaining: rest});
        else {
            const time = rest > 0 ? rest : duration;
            api.saveState({running: true, remaining: time, deadline: api.wallTime() + time, finished: false});
        }
    };
    let play;
    if (!dock) {
        const controls = api.box({});
        play = api.button('media-playback-start-symbolic', 'Demarrer ou mettre en pause', toggle);
        controls.add_child(play);
        controls.add_child(api.button('view-refresh-symbolic', 'Reinitialiser le minuteur', () =>
            api.saveState({running: false, remaining: duration, finished: false})));
        view.body.add_child(controls);
    }
    const update = () => {
        let state = api.getState();
        if (state.running && remaining(state) === 0) {
            api.saveState({running: false, remaining: 0, finished: true});
            if (config.notify)
                api.notify('Minuteur termine');
            state = api.getState();
        }
        if (!(context.square && dock))
            value.text = state.finished ? 'Termine' : api.formatDuration(remaining(state));
        if (play)
            play.get_child().icon_name = state.running ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
    };
    api.watchState(update);
    api.every(1000, update);
    update();
    return {...view, value, toggle, update};
}