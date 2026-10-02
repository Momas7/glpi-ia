#!/usr/bin/env bash
# Gera docs/media/ticket-flow.gif a partir do E2E gravado.
# Uso: scripts/make-gif.sh   (requer ffmpeg e os navegadores do Playwright instalados)
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf test-results/video
E2E_VIDEO=1 npx playwright test
# O vídeo do agente (último contexto criado) mostra o atendimento completo.
VIDEO=$(ls -t test-results/video/*.webm | head -1)
ffmpeg -y -loglevel error -i "$VIDEO" \
  -vf "fps=8,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer" \
  docs/media/ticket-flow.gif
ls -lh docs/media/ticket-flow.gif
