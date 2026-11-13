#!/bin/bash
# Hook de início de sessão (Claude Code na nuvem).
# O WhatSave é uma extensão em JS puro, sem gerenciador de pacotes: a única
# ferramenta necessária é o Node, usado para checar a sintaxe (`node --check`).
set -euo pipefail

# Só roda em sessões na nuvem.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Instala o Node apenas se estiver ausente.
if ! command -v node >/dev/null 2>&1; then
  apt-get update
  apt-get install -y nodejs
fi
