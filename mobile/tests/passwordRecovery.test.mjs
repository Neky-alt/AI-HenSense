import './register.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
const { createPasswordRecovery, parseRecoveryUrl, PASSWORD_RESET_REDIRECT } = await import('../src/lib/passwordRecovery.ts');
const session = { user: { id: 'recovery-user' } };
const link = `${PASSWORD_RESET_REDIRECT}#type=recovery&access_token=access&refresh_token=refresh`;
function setup(overrides = {}) {
  const calls = [], states = [];
  const auth = {
    async setSession(tokens) { calls.push(['setSession', tokens]); return { data: { session }, error: null }; },
    async getSession() { return { data: { session }, error: null }; },
    async updateUser(input) { calls.push(['updateUser', input]); return { error: null }; },
    async signOut(input) { calls.push(['signOut', input]); return { error: null }; },
    async resetPasswordForEmail(email, options) { calls.push(['email', email, options]); return { error: null }; },
    ...overrides,
  };
  return { controller: createPasswordRecovery(auth, state => states.push(state)), calls, states };
}
test('reset email uses exact approved mobile redirect', async () => {
  const { controller, calls } = setup(); await controller.sendEmail('user@example.com');
  assert.deepEqual(calls, [['email', 'user@example.com', { redirectTo: 'hensense://reset-password' }]]);
});
test('cold-start and running-app duplicate delivery establishes one session', async () => {
  const { controller, calls, states } = setup();
  await Promise.all([controller.handleUrl(link), controller.handleUrl(link)]);
  assert.equal(calls.length, 1); assert.deepEqual(states.map(s => s.status), ['processing', 'ready']);
});
test('no submission until setSession resolves, including PASSWORD_RECOVERY during processing', async () => {
  let complete; const { controller, calls } = setup({ setSession: () => new Promise(resolve => { complete = resolve; }) });
  const processing = controller.handleUrl(link); await Promise.resolve();
  controller.onAuthEvent('PASSWORD_RECOVERY', session);
  assert.equal(controller.state.status, 'processing');
  await assert.rejects(controller.updatePassword('new-password'), /valid password reset/);
  complete({ data: { session }, error: null }); await processing;
  await controller.updatePassword('new-password');
  assert.deepEqual(calls, [['updateUser', { password: 'new-password' }], ['signOut', { scope: 'local' }]]);
  assert.equal(controller.state.status, 'idle');
});
test('ordinary session events never enable recovery; PASSWORD_RECOVERY does', () => {
  const { controller } = setup(); controller.onAuthEvent('SIGNED_IN', session);
  assert.equal(controller.state.status, 'idle'); controller.onAuthEvent('PASSWORD_RECOVERY', null);
  assert.equal(controller.state.status, 'idle'); controller.onAuthEvent('PASSWORD_RECOVERY', session);
  assert.equal(controller.state.status, 'ready'); controller.onAuthEvent('SIGNED_OUT', null);
  assert.equal(controller.state.status, 'error');
});
for (const suffix of ['', '#type=recovery&access_token=a', '#error_code=otp_expired&error_description=Link+expired', '?type=recovery&refresh_token=r']) {
  test(`invalid/expired callback is visible and blocks updates: ${suffix}`, async () => {
    const { controller, calls } = setup(); await controller.handleUrl(PASSWORD_RESET_REDIRECT + suffix);
    assert.equal(controller.state.status, 'error'); assert.ok(controller.state.error);
    await assert.rejects(controller.updatePassword('new-password')); assert.equal(calls.length, 0);
  });
}
for (const result of [{ data: { session: null }, error: null }, { data: { session: null }, error: new Error('Token expired') }, 'throw']) {
  test(`setSession failure never leaves ready state: ${JSON.stringify(result)}`, async () => {
    const { controller } = setup({ async setSession() { if (result === 'throw') throw new Error('Network unavailable'); return result; } });
    await controller.handleUrl(link); assert.equal(controller.state.status, 'error');
    await assert.rejects(controller.updatePassword('new-password'));
  });
}
test('unrelated links ignored; query and fragment callback formats supported', () => {
  assert.equal(parseRecoveryUrl('https://example.com/#type=recovery&access_token=a&refresh_token=r'), null);
  assert.equal(parseRecoveryUrl('hensense://other#type=recovery&access_token=a&refresh_token=r'), null);
  assert.equal(parseRecoveryUrl('bad-url'), null);
  assert.deepEqual(parseRecoveryUrl(link.replace('#', '?')).tokens, { access_token: 'access', refresh_token: 'refresh' });
});
test('new link recovers after expired link and stale in-flight response cannot make it ready', async () => {
  let complete; let count = 0;
  const { controller } = setup({ async setSession() { count++; if (count === 1) return new Promise(resolve => { complete = resolve; }); return { data: { session }, error: null }; } });
  const old = controller.handleUrl(link); await Promise.resolve();
  const expired = controller.handleUrl(PASSWORD_RESET_REDIRECT + '#error=otp_expired');
  complete({ data: { session }, error: null }); await Promise.all([old, expired]);
  assert.equal(controller.state.status, 'error');
  await controller.handleUrl(link.replace('access_token=access', 'access_token=new-access'));
  assert.equal(controller.state.status, 'ready');
});
test('different or absent current session cannot change password', async () => {
  for (const next of [null, { user: { id: 'other-user' } }]) {
    const { controller, calls } = setup({ async getSession() { return { data: { session: next }, error: null }; } });
    await controller.handleUrl(link); await assert.rejects(controller.updatePassword('new-password'));
    assert.equal(calls.some(c => c[0] === 'updateUser'), false); assert.equal(controller.state.status, 'error');
  }
});
test('Supabase update error propagates and allows retry without signing out', async () => {
  const { controller, calls } = setup({ async updateUser() { throw new Error('Password rejected'); } });
  await controller.handleUrl(link); await assert.rejects(controller.updatePassword('new-password'), /Password rejected/);
  assert.equal(controller.state.status, 'ready'); assert.equal(calls.some(c => c[0] === 'signOut'), false);
});
test('sign out failure is visible and never reported as complete', async () => {
  const { controller } = setup({ async signOut() { return { error: new Error('Sign out failed') }; } });
  await controller.handleUrl(link); await assert.rejects(controller.updatePassword('new-password'), /Sign out failed/);
  assert.equal(controller.state.status, 'error'); assert.match(controller.state.error, /Password updated/);
});
test('duplicate submit cannot update twice and completed link is not reprocessed', async () => {
  const { controller, calls } = setup(); await controller.handleUrl(link);
  const first = controller.updatePassword('new-password');
  await assert.rejects(controller.updatePassword('new-password')); await first;
  await controller.handleUrl(link); assert.equal(controller.state.status, 'idle');
  assert.equal(calls.filter(c => c[0] === 'updateUser').length, 1);
});

test('native cold-start and warm listeners route to the same recovery flow and clean up', async () => {
  const { listenForPasswordRecovery } = await import('../src/lib/passwordRecovery.ts');
  for (const cold of [true, false]) {
    let receive, removed = false;
    const { controller, calls } = setup();
    const binding = listenForPasswordRecovery({
      async getInitialURL() { return cold ? link : null; },
      addEventListener(type, callback) { assert.equal(type, 'url'); receive = callback; return { remove() { removed = true; } }; },
    }, controller);
    await binding.ready;
    if (!cold) { receive({ url: link }); await controller.handleUrl(link); }
    assert.equal(controller.state.status, 'ready');
    receive({ url: link }); await controller.handleUrl(link);
    assert.equal(calls.length, 1);
    binding.remove(); assert.equal(removed, true);
    receive({ url: PASSWORD_RESET_REDIRECT }); assert.equal(controller.state.status, 'ready');
  }
});
test('new warm callback takes priority over a delayed stale initial URL', async () => {
  const { listenForPasswordRecovery } = await import('../src/lib/passwordRecovery.ts');
  let receive, initial;
  const { controller } = setup();
  const binding = listenForPasswordRecovery({
    getInitialURL() { return new Promise(resolve => { initial = resolve; }); },
    addEventListener(type, callback) { receive = callback; return { remove() {} }; },
  }, controller);
  receive({ url: link }); await controller.handleUrl(link);
  initial(PASSWORD_RESET_REDIRECT + '#error=expired'); await binding.ready;
  assert.equal(controller.state.status, 'ready'); binding.remove();
});
test('initial URL failure surfaces a recoverable error', async () => {
  const { listenForPasswordRecovery } = await import('../src/lib/passwordRecovery.ts');
  const { controller } = setup();
  const binding = listenForPasswordRecovery({
    async getInitialURL() { throw new Error('Unable to open recovery link'); },
    addEventListener() { return { remove() {} }; },
  }, controller);
  await binding.ready; assert.equal(controller.state.status, 'error'); binding.remove();
});
test('returned updateUser error and thrown signOut error are handled', async () => {
  const update = setup({ async updateUser() { return { error: new Error('Weak password') }; } });
  await update.controller.handleUrl(link);
  await assert.rejects(update.controller.updatePassword('new-password'), /Weak password/);
  assert.equal(update.controller.state.status, 'ready');
  const logout = setup({ async signOut() { throw new Error('Network failure'); } });
  await logout.controller.handleUrl(link);
  await assert.rejects(logout.controller.updatePassword('new-password'), /Network failure/);
  assert.equal(logout.controller.state.status, 'error');
});
