/** Attach a scroll view's content only after GNOME has mapped the view on stage. */
export function setChildWhenMapped(actor, child) {
    let signal = 0;
    const attach = () => {
        if (!actor.is_mapped())
            return;
        if (signal) {
            actor.disconnect(signal);
            signal = 0;
        }
        actor.set_child(child);
    };
    signal = actor.connect('notify::mapped', attach);
    attach();
}
