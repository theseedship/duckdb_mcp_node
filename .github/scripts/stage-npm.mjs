import { appendFileSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export function stagePackage(pkg, run, expectedVersion) {
  const { name, version } = pkg
  expectedVersion = expectedVersion?.replace(/^v/, '')
  if (expectedVersion && expectedVersion !== version) {
    throw new Error(`Requested version ${expectedVersion} does not match package.json ${version}`)
  }
  const spec = `${name}@${version}`
  const tag = version.includes('-') ? version.split('-')[1].split('.')[0] : 'latest'
  const json = (args) => {
    const result = run(args)
    if (result.status !== 0) throw new Error(result.stderr || `npm ${args[0]} failed`)
    return JSON.parse(result.stdout)
  }
  const published = run(['view', spec, 'version', '--json'])
  if (published.status === 0) {
    if (JSON.parse(published.stdout) !== version) throw new Error('Unexpected registry version')
    return { state: 'published', version, tag }
  }
  let code
  try {
    code = JSON.parse(published.stdout).error?.code
  } catch {
    /* reported below */
  }
  if (code !== 'E404') throw new Error(published.stderr || 'Cannot check npm publication state')

  const pending = json(['stage', 'list', name, '--json'])
  if (!Array.isArray(pending)) throw new Error('Unexpected npm stage list response')
  const existing = pending.find((item) => item.packageName === name && item.version === version)
  if (existing) {
    if (existing.tag !== tag)
      throw new Error(`Existing staged version uses tag ${existing.tag}, expected ${tag}`)
    if (!existing.id) throw new Error('Existing staged version has no id')
    return { state: 'staged', version, tag, stage_id: existing.id }
  }

  // The workflow builds and validates the package before invoking this script.
  const result = json([
    'stage',
    'publish',
    '--access',
    'public',
    '--tag',
    tag,
    '--json',
    '--ignore-scripts',
  ])
  const stageId =
    result.stageId || result[name]?.stageId || (Array.isArray(result) && result[0]?.stageId)
  if (!stageId)
    throw new Error('npm did not return a stage id; inspect Staged Packages before retrying')
  return { state: 'staged', version, tag, stage_id: stageId }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const result = stagePackage(
    pkg,
    (args) => {
      const child = spawnSync('npm', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      if (child.error) throw child.error
      return child
    },
    process.env.EXPECTED_VERSION
  )
  if (process.env.GITHUB_OUTPUT) {
    for (const [key, value] of Object.entries(result)) {
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
    }
  }
  const message =
    result.state === 'published'
      ? `${pkg.name}@${result.version} is already available on npm.`
      : `${pkg.name}@${result.version} is staged (ID: ${result.stage_id}). Open Staged Packages on npmjs.com, click Approve and confirm with 2FA to publish it.`
  console.log(message)
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## npm release\n\n${message}\n`)
}
