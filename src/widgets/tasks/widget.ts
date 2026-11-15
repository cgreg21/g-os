export function create(context) {
    const {api, config} = context;
    const dock = context.target === 'dock';
    const view = api.card('Taches', 'view-list-symbolic');
    const read = () => (api.getState().items || []).slice(0, 32);
    const summary = context.square && dock ? api.icon('view-list-symbolic', context.iconSize) : api.label('');
    view.body.add_child(summary);
    let list;
    let entry;
    let start = 0;
    const save = items => api.saveState({items});
    if (!dock) {
        entry = api.entry('Nouvelle tache');
        const add = () => {
            const text = entry.get_text().trim().slice(0, 160);
            const items = read();
            if (!text || items.length >= 32)
                return;
            save([...items, {text, done: false}]);
            entry.set_text('');
        };
        const input = api.box({});
        input.add_child(entry);
        input.add_child(api.button('list-add-symbolic', 'Ajouter la tache', add));
        api.connect(entry.clutter_text, 'activate', add);
        view.body.add_child(input);
        list = api.box({vertical: true});
        view.body.add_child(list);
        const navigation = api.box({});
        navigation.add_child(api.button('go-previous-symbolic', 'Page precedente', () => { start = Math.max(0, start - 4); update(); }));
        navigation.add_child(api.button('go-next-symbolic', 'Page suivante', () => { start += 4; update(); }));
        navigation.add_child(api.button('edit-clear-symbolic', 'Retirer les taches terminees', () => save(read().filter(item => !item.done))));
        view.body.add_child(navigation);
    }
    const update = () => {
        const items = read();
        if (!(context.square && dock))
            summary.text = `${items.filter(item => item.done).length}/${items.length} terminees`;
        if (!list)
            return;
        list.destroy_all_children();
        const visible = items.map((item, index) => ({item, index})).filter(({item}) => config['show-done'] || !item.done);
        start = Math.min(start, Math.max(0, Math.floor((visible.length - 1) / 4) * 4));
        for (const {item, index} of visible.slice(start, start + 4)) {
            const row = api.box({});
            row.add_child(api.button(item.done ? 'checkbox-checked-symbolic' : 'checkbox-symbolic',
                item.done ? 'Marquer a faire' : 'Terminer la tache', () => save(items.map((value, rank) => rank === index ? {...value, done: !value.done} : value))));
            row.add_child(api.label(item.text, {x_expand: true}));
            row.add_child(api.button('user-trash-symbolic', 'Retirer la tache', () => save(items.filter((value, rank) => rank !== index))));
            list.add_child(row);
        }
        if (visible.length === 0)
            list.add_child(api.label('Aucune tache'));
    };
    api.watchState(update);
    update();
    return {...view, entry, update};
}