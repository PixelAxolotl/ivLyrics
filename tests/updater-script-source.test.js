const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const rawBase = 'https://raw.githubusercontent.com/ivLis-Studio/ivLyrics/main/updater';
const bootstrapScripts = [
    'updater/install.ps1',
    'updater/install.sh',
    'updater/uninstall.ps1',
    'updater/uninstall.sh'
];
const publicReferenceFiles = [
    'README.md',
    'README_EN.md',
    'marketplace.md',
    'Utils.js',
    'updater/README.md',
    'updater/windows/ivlyrics-updater.ps1',
    'updater/unix/ivlyrics-updater.sh'
];

for (const relativePath of bootstrapScripts) {
    assert(
        fs.statSync(path.join(root, relativePath)).isFile(),
        `${relativePath} should be tracked as an updater bootstrap script`
    );
}

const references = publicReferenceFiles
    .map(relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8'))
    .join('\n');

for (const scriptName of ['install.ps1', 'install.sh', 'uninstall.ps1', 'uninstall.sh']) {
    assert(
        references.includes(`${rawBase}/${scriptName}`),
        `public commands should reference ${scriptName} from GitHub Raw`
    );
}

assert(
    !/https?:\/\/ivlis\.kr\/ivLyrics\/(?:install|uninstall)\.(?:ps1|sh)/i.test(references),
    'public install, update, and uninstall commands should not use the legacy ivlis.kr script URLs'
);

for (const relativePath of ['updater/install.ps1', 'updater/install.sh']) {
    const installer = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert(
        !/addon-manager\.(?:ps1|sh)|Addon Manager/i.test(installer),
        `${relativePath} should not download or execute the removed Addon Manager script`
    );
}

console.log('Updater script source regression tests passed.');
