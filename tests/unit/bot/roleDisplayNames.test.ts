import { describe, expect, it } from 'vitest';

import { getRoleLabel } from '../../../src/domain/game/types.js';
import { renderRolePanel } from '../../../src/bot/views/ephemeralPanelView.js';
import { renderFinalView } from '../../../src/bot/views/finalView.js';
import { renderProstituteNightControl } from '../../../src/bot/views/phaseView.js';

const roleDisplayNames = { prostitute: 'Путана' };

describe('configured role display names', () => {
  it('renders the configured name in private and public role views', () => {
    expect(getRoleLabel('PROSTITUTE', roleDisplayNames)).toBe('Путана');
    expect(renderRolePanel({ role: 'PROSTITUTE', roleDisplayNames }).text).toContain('ПУТАНА');
    expect(renderProstituteNightControl(roleDisplayNames).text).toContain('Путана');
    expect(renderFinalView({
      winningFaction: 'PEACEFUL',
      roleDisplayNames,
      players: [{ displayName: 'Алиса', role: 'PROSTITUTE' }],
    })).toContain('Алиса — Путана');
  });
});
