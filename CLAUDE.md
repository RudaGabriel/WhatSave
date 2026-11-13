# Regras do projeto (para o assistente de código)

Projeto: **WhatSave**, extensão de navegador (Manifest V3) que exporta mídias,
legendas e links do WhatsApp Web. Autor original: Jstarzz. Edição, análise e
manutenção: Ruda Gabriel.

- **Idioma:** sempre pt-BR — respostas, código, comentários, mensagens na tela e
  no registro de atividade, mensagens de commit e PR.
- **Somente leitura no WhatsApp:** a extensão nunca envia, apaga, edita, encaminha
  ou marca mensagens. Ela apenas lê o que o WhatsApp Web já carregou e salva
  arquivos na pasta Downloads do usuário. Nenhum dado sai do computador (sem
  servidores, telemetria ou análise de uso).
- **Código à prova de erros:** antes de entregar, procurar bugs e cenários de erro
  no próprio diff (entradas inválidas, rede caindo, aba fechada no meio, arquivos
  grandes, limites do navegador, Windows, celular) e corrigir.
- **Changelog:** o cabeçalho de cada arquivo traz só a entrada da versão atual (mais
  a linha "Histórico completo das versões: CHANGELOG.md no repositório."). O
  histórico completo fica no `CHANGELOG.md`: nova entrada no topo da seção do
  arquivo e tabela de versões atualizada. Toda mudança de código sobe a versão do
  arquivo. Arquivos JSON (sem comentários) ficam apenas na tabela e na seção do
  `CHANGELOG.md`.
- **README sempre atualizado:** toda mudança que o usuário perceba (recurso novo,
  tela, opção, comando interno, arquivo, dependência, versão, quantidade de testes)
  atualiza o `README.md` no mesmo PR — badges de versão/testes, badges de
  bibliotecas e tecnologias novas, as seções "Tecnologias e bibliotecas", "Uso no
  dia a dia", "Opções", "Comandos internos" e "Solução de problemas". Tudo explicado
  de forma clara para quem não é técnico.
- **Exemplos neutros:** placeholders, exemplos, testes e documentação sem nomes de
  pessoas, clientes, lojas ou marcas (ex.: "Celular do Caixa 1", VENDEDOR A,
  FULANO). Números de telefone de teste só com zeros (ex.: `5500000000001`).
- **Projeto autônomo:** sem menções a outros projetos nem citações de terceiros.
  Os créditos são do autor original, Jstarzz, e de Ruda Gabriel, responsável pela
  edição, análise e manutenção (README, `LICENSE`, `package.json`, `manifest.json`,
  rodapé do popup e cabeçalhos). A única exceção é a biblioteca wa-js em
  `inpage/vendor`, cuja licença exige manter o aviso de direitos autorais.
- **Informações sempre atuais:** a cada mudança, procurar e corrigir no projeto
  inteiro o que ficou desatualizado — README (badges, versões, contagem de testes,
  lista de arquivos, comandos internos, opções, solução de problemas), tabela e
  seções do `CHANGELOG.md` (todo arquivo versionado tem linha e seção), cabeçalhos
  de versão, `APP_VERSION` (em `inpage/app.js` e `popup.js`, sempre iguais à
  versão do `manifest.json` e do `package.json`), comentários que citem arquivos,
  funções ou comportamentos que não existem mais, textos de ajuda do popup e
  mensagens no registro. Nada pode descrever o sistema como ele era antes. O
  teste `testes/projeto.test.js` confere parte disso automaticamente.
- **Ortografia e tom formal:** em toda mudança, revisar a ortografia, a acentuação,
  a pontuação e a concordância de todos os textos tocados (popup, avisos, mensagens
  de erro, registro, README, CHANGELOG, comentários, commits e PRs). O tom deve ser
  formal, em português do Brasil: sem gírias nem expressões coloquiais ("pra",
  "tá", "dá pra", "de novo", "sozinho" no sentido de "automaticamente"). O que não
  estiver formal é reescrito formalmente no mesmo PR.
- **Arquivos do Windows:** se forem criados scripts `.ps1`, `.bat` ou `.vbs`, eles
  ficam 100% ASCII (acentos exibidos na tela escritos como `\uXXXX`) e preservam
  BOM/CRLF onde existirem.
- **Biblioteca de terceiros:** `inpage/vendor/wppconnect-wa-wrapped.js` nunca é
  editada.
- **Antes de entregar:** `npm test` verde e `npm run test:navegador` aprovado
  (Playwright: popup no computador e no celular). Conferir as capturas geradas em
  `testes/navegador/` quando a tela mudar.
- **Pull requests:** depois de abrir o PR e com os testes verdes, **fazer o merge
  automaticamente** (autorizado pelo dono do repositório) — não esperar aprovação
  manual.
