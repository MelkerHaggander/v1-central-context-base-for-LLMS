#!/usr/bin/env bash
# Put a relocatable CPython and the boringcontext package inside this app so
# the Next.js function can spawn it. Vercel’s Node runtime has no python3.
# Local installs skip this. The runtime directory is not committed.
set -euo pipefail

if [[ "${VERCEL:-}" != "1" ]]; then
  exit 0
fi

app_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo_root=""
for candidate in "$app_dir/../.." "$app_dir/.."; do
  if [[ -f "$candidate/pyproject.toml" && -d "$candidate/boringcontext" ]]; then
    repo_root="$(cd "$candidate" && pwd)"
    break
  fi
done
if [[ -z "$repo_root" ]]; then
  echo "boringcontext package was not found above apps/api" >&2
  exit 1
fi

arch="$(uname -m)"
case "$arch" in
  x86_64) triple="x86_64-unknown-linux-gnu" ;;
  aarch64) triple="aarch64-unknown-linux-gnu" ;;
  *)
    echo "unsupported architecture: $arch" >&2
    exit 1
    ;;
esac

release="20260325"
version="3.12.13"
name="cpython-${version}+${release}-${triple}-install_only_stripped.tar.gz"
url="https://github.com/astral-sh/python-build-standalone/releases/download/${release}/${name}"

dest="$app_dir/vendor/python-runtime"
rm -rf "$dest"
mkdir -p "$dest"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading ${name}"
curl -fsSL "$url" -o "$tmp/python.tar.gz"
tar -xzf "$tmp/python.tar.gz" -C "$dest"

python_bin="$dest/python/bin/python3"
if [[ -L "$python_bin" ]]; then
  real="$(readlink -f "$python_bin")"
  rm "$python_bin"
  cp -a "$real" "$python_bin"
  chmod 755 "$python_bin"
fi

if ! "$python_bin" -m pip --version >/dev/null 2>&1; then
  "$python_bin" -m ensurepip --upgrade
fi

packages="$dest/packages"
mkdir -p "$packages"
src="$tmp/src"
mkdir -p "$src"
cp -a "$repo_root/pyproject.toml" "$src/"
cp -a "$repo_root/boringcontext" "$src/"
"$python_bin" -m pip install --no-cache-dir --upgrade pip
"$python_bin" -m pip install --no-cache-dir --target "$packages" "$src"
find "$packages" -type d -name '__pycache__' -prune -exec rm -rf {} +

export PYTHONPATH="$packages"
export PYTHONDONTWRITEBYTECODE=1
export PYTHONNOUSERSITE=1
"$python_bin" -c "import boringcontext, boringcontext.invoke"
echo "bundled boringcontext on PYTHONPATH"
