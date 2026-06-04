import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const MODE = process.argv[2];

if (!MODE || !['patch', 'minor', 'major', 'init'].includes(MODE)) {
  console.error('Usage: node scripts/bump-version.mjs <patch|minor|major|init>');
  process.exit(1);
}

const rootPkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const [currMajor, currMinor, currPatch] = rootPkg.version.split('.').map(Number);

let newMajor = currMajor;
let newMinor = currMinor;
let newPatch = currPatch;

if (MODE === 'major') { newMajor += 1; newMinor = 0; newPatch = 0; }
else if (MODE === 'minor') { newMinor += 1; newPatch = 0; }
else if (MODE === 'patch') { newPatch += 1; }

const newVersion = `${newMajor}.${newMinor}.${newPatch}`;

const pubspecRaw = readFileSync('./appmovil/pubspec.yaml', 'utf-8');
const buildMatch = pubspecRaw.match(/^version:\s+\d+\.\d+\.\d+\+(\d+)$/m);
const currentBuild = buildMatch ? parseInt(buildMatch[1], 10) : 0;
const newBuild = MODE === 'init' ? 1 : currentBuild + 1;

console.log(`\n  ${rootPkg.version} \u2192 ${newVersion}  (build ${newBuild})\n`);

for (const pkgPath of ['./package.json', './backend/package.json', './web/package.json']) {
  const raw = readFileSync(pkgPath, 'utf-8');
  const updated = raw.replace(/"version":\s*"\d+\.\d+\.\d+"/, `"version": "${newVersion}"`);
  writeFileSync(pkgPath, updated);
  console.log(`  \u2713 ${pkgPath}`);
}

const updatedPubspec = pubspecRaw.replace(
  /^version:\s+\d+\.\d+\.\d+\+\d+/m,
  `version: ${newVersion}+${newBuild}`,
);
writeFileSync('./appmovil/pubspec.yaml', updatedPubspec);
console.log('  \u2713 appmovil/pubspec.yaml');

const versionDart = `const String appVersion = '${newVersion}';\nconst int buildNumber = ${newBuild};\n`;
writeFileSync('./appmovil/lib/config/version.dart', versionDart);
console.log('  \u2713 appmovil/lib/config/version.dart');

const tag = `v${newVersion}`;

execSync('git add -A', { stdio: 'inherit' });
execSync(`git commit -m "chore: bump version to ${newVersion}"`, { stdio: 'inherit' });
execSync(`git tag ${tag}`, { stdio: 'inherit' });

console.log(`\n  \u2713 ${tag}\n`);
