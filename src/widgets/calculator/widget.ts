export function create(context) {
    const {api} = context;
    const dock = context.target === 'dock';
    const view = api.card('Calculatrice', 'accessories-calculator-symbolic');
    const result = context.square && dock ? api.icon('accessories-calculator-symbolic', context.iconSize) : api.label('');
    view.body.add_child(result);
    let entry;
    let serial = 0;
    let closed = false;
    const update = () => { if (!(context.square && dock)) result.text = api.getState().result || '0'; };
    const calculate = () => {
        const expression = entry.get_text().trim();
        if (!expression)
            return;
        const request = ++serial;
        result.text = 'Calcul...';
        api.solve(expression).then(value => {
            if (!closed && request === serial)
                api.saveState({expression, result: value});
        }).catch(error => {
            if (!closed && request === serial)
                result.text = error.message;
        });
    };
    if (!dock) {
        entry = api.entry('Exemple : 2 + 3 * 4', api.getState().expression || '');
        view.body.add_child(entry);
        api.connect(entry.clutter_text, 'activate', calculate);
        const buttons = api.box({});
        buttons.add_child(api.button('accessories-calculator-symbolic', 'Calculer', calculate));
        buttons.add_child(api.button('edit-clear-symbolic', 'Effacer', () => {
            serial++;
            entry.set_text('');
            api.saveState({expression: '', result: '0'});
        }));
        view.body.add_child(buttons);
    }
    api.watchState(update);
    api.onCleanup(() => { closed = true; serial++; });
    update();
    return {...view, entry, result, calculate, update};
}