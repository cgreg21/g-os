import assert from 'node:assert/strict';
import test from 'node:test';
import {isGlobalMenuActionEnabled} from '../dist/panel/globalMenu.js';

function createActionGroup({enabled = true, parameter = null} = {}) {
    return {
        has_action: action => action === 'open',
        get_action_enabled: () => enabled,
        get_action_parameter_type: () => parameter,
    };
}

test('global menu enables only actions with a compatible target parameter', () => {
    const parameter = {name: 's'};
    const group = createActionGroup({parameter});
    const validTarget = {is_of_type: type => type === parameter};
    const invalidTarget = {is_of_type: () => false};

    assert.equal(isGlobalMenuActionEnabled(group, 'open', validTarget), true);
    assert.equal(isGlobalMenuActionEnabled(group, 'open', invalidTarget), false);
    assert.equal(isGlobalMenuActionEnabled(group, 'open', null), false);
});

test('global menu rejects unexpected targets and unavailable actions', () => {
    const group = createActionGroup();

    assert.equal(isGlobalMenuActionEnabled(group, 'open', null), true);
    assert.equal(isGlobalMenuActionEnabled(group, 'open', {}), false);
    assert.equal(isGlobalMenuActionEnabled(group, 'missing', null), false);
    assert.equal(isGlobalMenuActionEnabled(createActionGroup({enabled: false}), 'open', null), false);
    assert.equal(isGlobalMenuActionEnabled(null, 'open', null), false);
});
