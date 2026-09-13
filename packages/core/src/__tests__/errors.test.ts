import { describe, it, expect } from 'vitest';
import { ANS_LINKS, REGISTER_FIX, ERROR_CODES, ERROR_STATUS, teachingError, AnsError, isErrorCode, HELP_LINK_HEADER } from '../errors';

describe('errors', () => {
  it('links and fix block', () => {
    expect(ANS_LINKS).toEqual({
      docs: 'https://ans-registry.org/skill.md',
      register: 'https://ans-registry.org/register',
      skill: 'https://ans-registry.org/skill.md',
      verify: 'https://api.ans-registry.org/v1/verify/',
      mcp: 'npx -y ans-mcp',
    });
    expect(REGISTER_FIX.command).toBe('npx -y ans-mcp register --name "<name>"');
    expect(REGISTER_FIX.url).toBe(ANS_LINKS.register);
    expect(REGISTER_FIX.docs).toBe(ANS_LINKS.docs);
    expect(HELP_LINK_HEADER).toBe('<https://ans-registry.org/skill.md>; rel="help"');
  });

  it('every code has a status and the policy codes are 428 and 403', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    for (const c of ERROR_CODES) expect(ERROR_STATUS[c]).toBeGreaterThanOrEqual(400);
    expect(ERROR_STATUS.registration_required).toBe(428);
    expect(ERROR_STATUS.trust_below_minimum).toBe(403);
    expect(ERROR_STATUS.insufficient_credit).toBe(402);
    expect(isErrorCode('no_offer')).toBe(true);
    expect(isErrorCode('nope')).toBe(false);
  });

  it('builds envelopes', () => {
    expect(teachingError('not_found', 'gone', 'req_1')).toEqual({ error: 'not_found', message: 'gone', requestId: 'req_1' });
    const e = new AnsError('registration_required', 'register first', { fix: REGISTER_FIX, details: { required: 40 } });
    expect(e.status).toBe(428);
    expect(e.toEnvelope('req_2')).toEqual({
      error: 'registration_required',
      message: 'register first',
      requestId: 'req_2',
      fix: REGISTER_FIX,
      details: { required: 40 },
    });
  });
});
