const { execFileSync } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');
execFileSync('swiftc', ['-O', path.join(root, 'native/selection-shortcut.swift'), '-o', path.join(root, 'native/selection-shortcut')], { stdio: 'inherit' });
execFileSync('codesign', ['--force', '--sign', '-', path.join(root, 'native/selection-shortcut')], { stdio: 'inherit' });
