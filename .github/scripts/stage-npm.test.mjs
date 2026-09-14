import assert from 'node:assert/strict'
import test from 'node:test'
import { stagePackage } from './stage-npm.mjs'

const pkg = { name: '@seed-ship/duckdb-mcp-native', version: '1.6.2' }
const ok = (data) => ({ status: 0, stdout: JSON.stringify(data), stderr: '' })
const missing = {
  status: 1,
  stdout: JSON.stringify({ error: { code: 'E404' } }),
  stderr: 'not found',
}
function fixture(results) {
  const calls = []
  return {
    calls,
    run(args) {
      calls.push(args)
      assert.ok(results.length, 'Unexpected npm call')
      return results.shift()
    },
  }
}

test('stages an unpublished version without direct publication or approval', () => {
  const f = fixture([missing, ok([]), ok({ stageId: 'stage-123' })])
  assert.equal(stagePackage(pkg, f.run).stage_id, 'stage-123')
  assert.deepEqual(f.calls[2], [
    'stage',
    'publish',
    '--access',
    'public',
    '--tag',
    'latest',
    '--json',
    '--ignore-scripts',
  ])
})
test('reuses an existing staged version', () => {
  const f = fixture([
    missing,
    ok([{ packageName: pkg.name, version: pkg.version, tag: 'latest', id: 'existing' }]),
  ])
  assert.equal(stagePackage(pkg, f.run).stage_id, 'existing')
  assert.equal(f.calls.length, 2)
})
test('does not stage an already published version', () => {
  const f = fixture([ok(pkg.version)])
  assert.equal(stagePackage(pkg, f.run).state, 'published')
  assert.equal(f.calls.length, 1)
})
test('authentication and network errors stop before staging', () => {
  for (const code of ['E401', 'E403', 'EAI_AGAIN']) {
    const f = fixture([{ status: 1, stdout: JSON.stringify({ error: { code } }), stderr: code }])
    assert.throws(() => stagePackage(pkg, f.run), new RegExp(code))
    assert.equal(f.calls.length, 1)
  }
})
test('a requested version mismatch stops before contacting npm', () => {
  assert.throws(() => stagePackage(pkg, () => assert.fail('npm called'), '1.6.3'), /does not match/)
})
test('a conflicting staged dist-tag is not silently reused', () => {
  const f = fixture([
    missing,
    ok([{ packageName: pkg.name, version: pkg.version, tag: 'beta', id: 'existing' }]),
  ])
  assert.throws(() => stagePackage(pkg, f.run), /expected latest/)
})
test('a failed stage command propagates the error', () => {
  const f = fixture([missing, ok([]), { status: 1, stdout: '', stderr: 'stage rejected' }])
  assert.throws(() => stagePackage(pkg, f.run), /stage rejected/)
})
test('prereleases are staged with their prerelease tag', () => {
  const f = fixture([missing, ok([]), ok({ stageId: 'beta-stage' })])
  const result = stagePackage({ ...pkg, version: '1.6.3-beta.1' }, f.run)
  assert.equal(result.tag, 'beta')
  assert.equal(f.calls[2][5], 'beta')
})
test('accepts a matching version tag', () => {
  const f = fixture([ok(pkg.version)])
  assert.equal(stagePackage(pkg, f.run, 'v1.6.2').state, 'published')
})
