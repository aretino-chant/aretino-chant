#!/usr/bin/env node
// Publishes every workspace package whose version is not on the registry yet,
// so that landing a version bump on main is all a release takes.
//
// Only @aretino-chant/* packages are considered: the VS Code extension in
// packages/vscode ships to the Marketplace, not to npm.
//
// Usage: node scripts/publish-bumped.mjs [--dry-run]

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const scope = '@aretino-chant/';

function readPackages() {
  const dir = join(root, 'packages');
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join('packages', entry.name))
    .filter((relative) => existsSync(join(root, relative, 'package.json')))
    .map((relative) => ({
      dir: relative,
      manifest: JSON.parse(readFileSync(join(root, relative, 'package.json'), 'utf8')),
    }))
    .filter(({ manifest }) => !manifest.private && manifest.name?.startsWith(scope));
}

// core has to reach the registry before the packages that depend on it, so
// publish in dependency order rather than in directory order.
function inDependencyOrder(packages) {
  const byName = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]));
  const ordered = [];
  const done = new Set();

  const visit = (pkg, stack) => {
    const { name } = pkg.manifest;
    if (done.has(name)) return;
    if (stack.includes(name)) {
      throw new Error(`Dependency cycle: ${[...stack, name].join(' -> ')}`);
    }
    const deps = [
      ...Object.keys(pkg.manifest.dependencies ?? {}),
      ...Object.keys(pkg.manifest.peerDependencies ?? {}),
      ...Object.keys(pkg.manifest.optionalDependencies ?? {}),
    ];
    for (const dep of deps) {
      if (byName.has(dep)) visit(byName.get(dep), [...stack, name]);
    }
    done.add(name);
    ordered.push(pkg);
  };

  for (const pkg of packages) visit(pkg, []);
  return ordered;
}

function publishedVersions(name) {
  try {
    const out = execFileSync('npm', ['view', name, 'versions', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const versions = JSON.parse(out);
    return new Set(Array.isArray(versions) ? versions : [versions]);
  } catch (error) {
    const stderr = String(error.stderr ?? '');
    // A package nobody has published yet is a first release, not a failure.
    if (stderr.includes('E404')) return new Set();
    throw new Error(`npm view ${name} failed: ${stderr.trim() || error.message}`);
  }
}

function summarize(lines) {
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  }
}

const packages = inDependencyOrder(readPackages());
const pending = [];
const skipped = [];

for (const pkg of packages) {
  const { name, version } = pkg.manifest;
  if (publishedVersions(name).has(version)) {
    skipped.push(`- \`${name}@${version}\` is already published`);
  } else {
    pending.push(pkg);
  }
}

if (pending.length === 0) {
  summarize(['### npm publish', '', 'No version bumps to publish.', ...skipped]);
  process.exit(0);
}

const published = [];
try {
  for (const { manifest } of pending) {
    const args = ['publish', '--workspace', manifest.name, '--access', 'public'];
    if (dryRun) args.push('--dry-run');
    console.log(`\n$ npm ${args.join(' ')}`);
    execFileSync('npm', args, { cwd: root, stdio: 'inherit' });
    published.push(`- \`${manifest.name}@${manifest.version}\``);
  }
} finally {
  summarize([
    `### npm publish${dryRun ? ' (dry run)' : ''}`,
    '',
    ...(published.length ? published : ['- nothing published']),
    ...skipped,
  ]);
}
