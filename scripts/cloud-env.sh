#!/usr/bin/env bash
# Source this file in the existing /workspace checkout. No worktree is required.
export UU_TOOLS=/workspace/.tools
if [ -d "$UU_TOOLS/cargo/bin" ]; then
  export CARGO_HOME="$UU_TOOLS/cargo"
  export RUSTUP_HOME="$UU_TOOLS/rustup"
  export PATH="$CARGO_HOME/bin:$PATH"
fi
export npm_config_cache="$UU_TOOLS/npm-cache"
if [ -d "$UU_TOOLS/sysroot/usr/lib/x86_64-linux-gnu/pkgconfig" ]; then
  export PKG_CONFIG_PATH="$UU_TOOLS/sysroot/usr/lib/x86_64-linux-gnu/pkgconfig:$UU_TOOLS/sysroot/usr/share/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
  export PKG_CONFIG_SYSROOT_DIR="$UU_TOOLS/sysroot"
  export LD_LIBRARY_PATH="$UU_TOOLS/sysroot/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
