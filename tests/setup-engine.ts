import { execFileSync } from 'node:child_process';
export default function setup() {
  execFileSync(
    'cargo',
    [
      'build',
      '--locked',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      '--example',
      'evaluate',
      '-j',
      '4',
    ],
    { stdio: 'inherit' },
  );
}
