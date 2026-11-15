export function create(context) {
    const {api, config} = context;
    const dock = context.target === 'dock';
    const view = api.card(config.title || 'Notes', 'accessories-text-editor-symbolic');
    if (dock) {
        const value = context.square ? api.icon('accessories-text-editor-symbolic', context.iconSize) : api.label('');
        view.body.add_child(value);
        const update = () => { if (!context.square) value.text = api.getState().text?.split('\n')[0] || 'Note vide'; };
        api.watchState(update);
        update();
        return {...view, update};
    }
    const entry = api.entry('Votre note...', api.getState().text || '', {multiline: true, height: 136});
    entry.clutter_text.max_length = 4000;
    view.body.add_child(entry);
    api.connect(entry.clutter_text, 'text-changed', () => api.saveState({text: entry.get_text().slice(0, 4000)}));
    const update = () => {
        const text = api.getState().text || '';
        if (entry.get_text() !== text)
            entry.set_text(text);
    };
    api.watchState(update);
    const clear = api.button('edit-clear-symbolic', 'Effacer la note', () => entry.set_text(''));
    view.body.add_child(clear);
    return {...view, entry, clear, update};
}