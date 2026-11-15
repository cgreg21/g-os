export function create(context) {
    const {api} = context;
    const dock = context.target === 'dock';
    const view = api.card('Chronometre', 'appointment-soon-symbolic');
    const value = context.square && dock ? api.icon('appointment-soon-symbolic', context.iconSize)
        : api.label('', {style_class: 'g-os-utility-value'});
    view.body.add_child(value);
    const elapsed = state => (state.elapsed || 0) + (state.running ? api.wallTime() - state.startedAt : 0);
    const toggle = () => {
        const state = api.getState();
        api.saveState({elapsed: elapsed(state), running: !state.running, startedAt: api.wallTime()});
    };
    const lap = () => {
        const state = api.getState();
        api.saveState({laps: [...(state.laps || []), elapsed(state)].slice(-5),
            lapCount: (state.lapCount ?? state.laps?.length ?? 0) + 1});
    };
    let play;
    let laps;
    if (!dock) {
        const controls = api.box({});
        play = api.button('media-playback-start-symbolic', 'Demarrer ou mettre en pause', toggle);
        controls.add_child(play);
        controls.add_child(api.button('list-add-symbolic', 'Enregistrer un tour', lap));
        controls.add_child(api.button('view-refresh-symbolic', 'Reinitialiser le chronometre', () =>
            api.saveState({elapsed: 0, running: false, laps: [], lapCount: 0})));
        view.body.add_child(controls);
        laps = api.box({vertical: true});
        view.body.add_child(laps);
    }
    const update = () => {
        const state = api.getState();
        if (!(context.square && dock))
            value.text = api.formatDuration(elapsed(state));
        if (play)
            play.get_child().icon_name = state.running ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        if (laps) {
            laps.destroy_all_children();
            const visible = (state.laps || []).slice(-3);
            const first = (state.lapCount ?? state.laps?.length ?? 0) - visible.length + 1;
            visible.forEach((time, index) => laps.add_child(api.label(`Tour ${first + index} : ${api.formatDuration(time)}`)));
        }
    };
    api.watchState(update);
    api.every(1000, update);
    update();
    return {...view, value, toggle, lap, update};
}