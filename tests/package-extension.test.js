const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const requiredFiles = [
  'manifest.json',
  'background.js',
  'sidepanel.html',
  'sidepanel.js',
  'content.js',
  'content-styles.css',
  'knowledge_seed.json',
  'icons/icon-16.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
  'LICENSE'
];
const fixtureVersion = '7.8.9';

function makeFixture(t) {
  // The copy and the caller are separate, with spaces in their paths to exercise quoting.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa package test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'extension source');
  const caller = path.join(temp, 'other working directory');
  fs.mkdirSync(source);
  fs.mkdirSync(caller);
  for (const name of ['package-extension.sh', ...requiredFiles]) {
    const destination = path.join(source, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(projectRoot, name), destination);
  }
  const manifestPath = path.join(source, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.version = fixtureVersion;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // These must not be included even though some are not covered by common exclusions.
  for (const name of ['.env', '.env.local', 'private.key', 'backup.json',
    'icons/private.pem', 'tests/package-secret.js', 'nested/secret.txt']) {
    const destination = path.join(source, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `must not ship: ${name}\n`);
  }
  return { source, caller, script: path.join(source, 'package-extension.sh') };
}

function packageExtension(fixture, args = [], cwd = fixture.caller) {
  return spawnSync('bash', [fixture.script, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  });
}

function assertSuccess(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

function assertFailure(result) {
  assert.ifError(result.error);
  assert.notEqual(result.status, null, `process terminated by ${result.signal}`);
  assert.notEqual(result.status, 0, `unexpected success:\n${result.stdout}\n${result.stderr}`);
}

function assertArchive(archive, source) {
  const listing = spawnSync('unzip', ['-Z', '-1', archive], { encoding: 'utf8' });
  assertSuccess(listing);
  const entries = listing.stdout.trimEnd().split('\n').sort();
  assert.deepEqual(entries, [...requiredFiles].sort(), 'archive must contain exactly the allowlist at its root');

  for (const name of requiredFiles) {
    const extracted = spawnSync('unzip', ['-p', archive, name], { maxBuffer: 8 * 1024 * 1024 });
    assert.ifError(extracted.error);
    assert.equal(extracted.status, 0, `could not extract ${name}: ${extracted.stderr}`);
    assert.deepEqual(extracted.stdout, fs.readFileSync(path.join(source, name)), `incorrect contents: ${name}`);
  }
}

test('default archive uses manifest version and source root even from another cwd', t => {
  const fixture = makeFixture(t);
  const archive = path.join(fixture.source, `qa-assistant-v${fixtureVersion}.zip`);
  const result = packageExtension(fixture);
  assertSuccess(result);
  assert.ok(fs.existsSync(archive), 'default archive must be created in the source root');
  assert.equal(fs.existsSync(path.join(fixture.caller, path.basename(archive))), false);
  assertArchive(archive, fixture.source);
});

test('explicit output path contains exactly the required files when run from source root', t => {
  const fixture = makeFixture(t);
  const archive = path.join(fixture.caller, 'custom output.zip');
  const result = packageExtension(fixture, [archive], fixture.source);
  assertSuccess(result);
  assert.ok(fs.existsSync(archive), 'archive must be created at the requested path');
  assert.equal(fs.existsSync(path.join(fixture.source, `qa-assistant-v${fixtureVersion}.zip`)), false);
  assertArchive(archive, fixture.source);
});

test('explicit output path works from another cwd and contains only required files', t => {
  const fixture = makeFixture(t);
  const archive = path.join(fixture.caller, 'custom output.zip');
  const result = packageExtension(fixture, [archive]);
  assertSuccess(result);
  assert.ok(fs.existsSync(archive), 'archive must be created at the requested path');
  assert.equal(fs.existsSync(path.join(fixture.source, `qa-assistant-v${fixtureVersion}.zip`)), false);
  assertArchive(archive, fixture.source);
});

test('each required file is validated before an archive is created', async t => {
  for (const name of requiredFiles) {
    await t.test(`missing ${name}`, t => {
      const fixture = makeFixture(t);
      fs.unlinkSync(path.join(fixture.source, name));
      const archive = path.join(fixture.caller, 'missing-file-output.zip');
      const result = packageExtension(fixture, [archive], fixture.source);
      assertFailure(result);
      assert.equal(fs.existsSync(archive), false, 'must not leave the requested archive behind');
      assert.equal(fs.existsSync(path.join(fixture.source, `qa-assistant-v${fixtureVersion}.zip`)), false,
        'must not produce a default archive either');
    });
  }
});

test('existing output is never overwritten', async t => {
  for (const useDefault of [true, false]) {
    await t.test(useDefault ? 'default output' : 'explicit output', t => {
      const fixture = makeFixture(t);
      const archive = useDefault
        ? path.join(fixture.source, `qa-assistant-v${fixtureVersion}.zip`)
        : path.join(fixture.caller, 'existing output.zip');
      const original = Buffer.from('existing archive must remain unchanged\n');
      fs.writeFileSync(archive, original);
      const result = packageExtension(fixture, useDefault ? [] : [archive], fixture.source);
      assertFailure(result);
      assert.deepEqual(fs.readFileSync(archive), original);
    });
  }
});
