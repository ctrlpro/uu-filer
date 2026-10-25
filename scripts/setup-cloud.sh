#!/usr/bin/env bash
set -euo pipefail
cd /workspace/uu-filer
source scripts/cloud-env.sh
mkdir -p "$UU_TOOLS"
if ! command -v cargo >/dev/null; then
  curl --fail --show-error --location https://sh.rustup.rs --output "$UU_TOOLS/rustup-init.sh"
  CARGO_HOME="$UU_TOOLS/cargo" RUSTUP_HOME="$UU_TOOLS/rustup" sh "$UU_TOOLS/rustup-init.sh" -y --profile minimal --no-modify-path
  source scripts/cloud-env.sh
fi
rustup component add rustfmt clippy
if ! pkg-config --exists webkit2gtk-4.1 gtk+-3.0; then
  if ! grep -q 'VERSION_CODENAME=trixie' /etc/os-release; then
    echo 'Rootless desktop dependency setup requires Debian 13. Install the Tauri platform prerequisites for this OS.' >&2
    exit 1
  fi
  mkdir -p "$UU_TOOLS/apt/lists/partial" "$UU_TOOLS/apt/cache/archives/partial" "$UU_TOOLS/sysroot"
  printf '%s\n' 'deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://deb.debian.org/debian trixie main' > "$UU_TOOLS/apt/sources.list"
  apt_options=(-o "Dir::State::lists=$UU_TOOLS/apt/lists" -o "Dir::Cache::archives=$UU_TOOLS/apt/cache/archives" -o "Dir::Etc::sourcelist=$UU_TOOLS/apt/sources.list" -o Dir::Etc::sourceparts=- -o Dir::Etc::parts=- -o Debug::NoLocking=1)
  /usr/bin/apt-get "${apt_options[@]}" update
  /usr/bin/apt-get "${apt_options[@]}" --download-only --no-install-recommends -y install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf
  python3 - <<'PY'
from pathlib import Path
import os
import subprocess
root = Path('/workspace/.tools/sysroot')
for package in Path('/workspace/.tools/apt/cache/archives').glob('*.deb'):
    subprocess.run(['dpkg-deb', '-x', str(package), str(root)], check=True)
for directory, _, files in os.walk(root):
    for name in files:
        link = Path(directory) / name
        if link.is_symlink() and not link.exists():
            target = os.readlink(link)
            system = Path(target) if target.startswith('/') else Path('/') / link.parent.relative_to(root) / target
            if system.exists():
                link.unlink()
                link.symlink_to(system)
PY
  source scripts/cloud-env.sh
fi
npm ci
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features -j 4
cargo check --locked --manifest-path src-tauri/Cargo.toml --features desktop -j 4
