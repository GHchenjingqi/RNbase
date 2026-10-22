#!/usr/bin/env bash
# =====================================================================
# 拉取离线语音识别模型（zipformer-zh-14M int8）到 Android assets。
#
# 模型来源：HuggingFace csukuangfj/sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23
# 许可证：Apache-2.0
# 体积：约 24 MB（4 个文件，不压缩进 APK，运行时从 assets 直接 mmap）
#
# 用法：
#   bash scripts/fetch-model.sh
#
# 注意：
#   - 仅在需要（首次 / 更新模型）时运行；下载结果会被打进 APK assets。
#   - 文件较大，请确保网络可访问 huggingface.co（国内可用镜像域名替换 BASE_URL）。
#   - 不要把这些 .onnx 提交到 git（体积大且可由本脚本复现）。
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSET_DIR="$ROOT/platforms/android/app/src/main/assets/models/zh-small/1.0.0"

# HuggingFace 主域名；国内不可达时替换为镜像，例如：
#   https://hf-mirror.com/csukuangfj/sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23/resolve/main
BASE_URL="${SHERPA_MODEL_BASE_URL:-https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23/resolve/main}"

FILES=(
  "encoder-epoch-99-avg-1.int8.onnx"
  "decoder-epoch-99-avg-1.int8.onnx"
  "joiner-epoch-99-avg-1.int8.onnx"
  "tokens.txt"
)

mkdir -p "$ASSET_DIR"

if ! command -v curl >/dev/null 2>&1; then
  echo "[fetch-model] 需要 curl，但未找到，请先安装 curl。" >&2
  exit 1
fi

for f in "${FILES[@]}"; do
  out="$ASSET_DIR/$f"
  if [ -s "$out" ]; then
    echo "[fetch-model] 已存在，跳过: $f"
  else
    echo "[fetch-model] 下载: $f"
    curl -L --fail --show-error --progress-bar -o "$out" "$BASE_URL/$f"
  fi
done

echo "[fetch-model] 完成。模型目录: $ASSET_DIR"
echo "[fetch-model] 下一步: 在 Android 真机上 assembleDebug 并运行语音测试页验证离线识别。"
