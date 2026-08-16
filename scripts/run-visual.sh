#!/usr/bin/env bash
set -euo pipefail

# 視覚回帰(VRT)は必ずPlaywright公式コンテナの中で実行する。
#
# スナップショットの比較はピクセル単位なので、フォントとラスタライザが1つでも
# 違えば同じページでも別の絵になる。実際、素のubuntu runnerとローカルでは本文の
# 高さが1pxずれ、寸法が違うと`maxDiffPixelRatio`は効かずに落ちた。CIもローカルも
# この1つのイメージへ揃えることで、環境差そのものを無くす。
#
# `pnpm test:visual` と `pnpm --filter web test:visual` はどちらもここへ来る。
# 素のPlaywrightを直接叩くのは、このスクリプトがコンテナの中で呼ぶ
# `test:visual:run` だけ。
#
#   pnpm test:visual                            比較する
#   pnpm test:visual -- --update-snapshots=all  基準画像を作り直す

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# apps/web の @playwright/test と揃えること。ずれるとブラウザのversionが
# 合わず、比較の前提が崩れる。
image="mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e"

# コンテナの中(CIのjob container、または下のdocker run)ではPlaywrightを直接
# 叩く。pnpm越しだとworkspaceの整合性検査が走り、ホストから持ち込んだ
# node_modulesを作り直そうとする。ここで要るのは既にあるバイナリの実行だけ。
run_playwright() {
  cd "$repository_root/apps/web"
  exec ./node_modules/.bin/playwright test tests/visual "$@"
}

if [[ -f /.dockerenv ]]; then
  run_playwright "$@"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "VRTにはdockerが必要です。CIと同じイメージで撮らないとスナップショットが一致しません。" >&2
  exit 1
fi

# `--ipc=host` はChromiumが共有メモリ不足で落ちるのを避ける公式推奨の設定。
# `--user` を渡さないと、生成物がroot所有でホストへ残る。
exec docker run --rm \
  --ipc=host \
  --user "$(id -u):$(id -g)" \
  --volume "$repository_root:/work" \
  --workdir /work \
  --env CI \
  --env HOME=/tmp \
  "$image" \
  bash -lc 'cd apps/web && exec ./node_modules/.bin/playwright test tests/visual "$@"' _ "$@"
