import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const session = await readFile(new URL('../scripts/dev-session.sh', import.meta.url), 'utf8');

test('development session waits for GNOME Shell startup completion before enabling extensions', () => {
    const dbusReady = session.indexOf('if ! wait "$WAIT_PID"; then');
    const startupWait = session.indexOf('until grep -q "GNOME Shell started at" "$SHELL_LOG"');
    const watchStart = session.indexOf('npm run dev:watch');
    assert.ok(dbusReady >= 0);
    assert.ok(startupWait > dbusReady);
    assert.ok(watchStart > startupWait);
    assert.match(session, /gnome-shell --devkit --wayland > >\(tee "\$SHELL_LOG"\) 2>&1 &/);
    assert.match(session, /STARTUP_DEADLINE=\$\(\(SECONDS \+ 45\)\)/);
    assert.match(session, /GNOME Shell exited before startup completed/);
});
