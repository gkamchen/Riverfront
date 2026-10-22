# Distribuição

Como gerar os instaladores do Riverfront, o pacote do servidor dedicado e como as releases são publicadas.

## O que é gerado

| Arquivo | Plataforma | Comando |
| --- | --- | --- |
| `Riverfront-<versão>-instalador-x64.exe` | Windows (NSIS, escolhe a pasta, cria atalhos) | `npm run dist:win` |
| `Riverfront-<versão>-portatil-x64.exe` | Windows (roda sem instalar) | `npm run dist:win` |
| `Riverfront-<versão>-mac-x64.dmg` / `-arm64.dmg` | macOS Intel / Apple Silicon | `npm run dist:mac` (só no macOS) |
| `Riverfront-<versão>-linux-x64.AppImage` | Linux | `npm run dist:linux` (no Linux) |
| `riverfront-server-<versão>.zip` | servidor dedicado (Node 20+ ou Docker) | `npm run pack:server` |
| `release/demo/` | demo estática para o GitHub Pages (`/Riverfront/`) | `npm run build:demo` |

Tudo sai em `release/` (fora do controle de versão): `release/desktop/`, `release/server/` e `release/demo/`.

Última geração local (Windows, versão 0.1.0):

| Arquivo | Tamanho |
| --- | --- |
| `release/desktop/Riverfront-0.1.0-instalador-x64.exe` | 106,7 MiB (com `LICENSE.txt` e `THIRD_PARTY_NOTICES.txt` em `resources`) |
| `release/desktop/Riverfront-0.1.0-portatil-x64.exe` | 106,5 MiB |
| `release/server/riverfront-server-0.1.0.zip` | 0,5 MiB (18 arquivos, com LICENSE.txt e THIRD_PARTY_NOTICES.txt) |
| `release/demo/` | 1,5 MiB |

O instalador passou no `--smoke-test` (tela inicial, servidor embutido, `/healthz`, cliente carregado e WebSocket aceito a partir de `riverfront://app`), e o zip do servidor foi descompactado e iniciado (`/healthz` e a página respondendo).

## Licença nos pacotes

`THIRD_PARTY_NOTICES.txt` é gerado por `scripts/third-party-notices.mjs` a partir do `package-lock.json` (roda no começo de `npm run build`): lista as dependências que vão para quem joga (three, ws e o runtime do Electron), com licença e texto. Ele vai na raiz do cliente compilado e da demo, no zip do servidor e no instalador (pasta `resources`); o pedaço do three.js no cliente leva um cabeçalho com a licença. Os avisos do Chromium vêm em `LICENSES.chromium.html`, ao lado do executável.

O código é distribuído sob a PolyForm Noncommercial 1.0.0 (`LICENSE` na raiz, campo `"license": "PolyForm-Noncommercial-1.0.0"` em todos os `package.json`). O instalador do Windows mostra `packages/desktop/build/license.txt` (resumo em português + texto oficial da licença), o zip do servidor leva `LICENSE.txt` e os metadados do executável dizem "Licença PolyForm Noncommercial 1.0.0".

## Demo estática (GitHub Pages)

`npm run build:demo` gera `release/demo` com caminhos relativos (`base: ./`), então funciona em `https://gkamchen.github.io/Riverfront/` ou em qualquer subpasta. A demo não leva nada do servidor e o painel online só abre quando a URL traz `?servidor=`, `#servidor=` ou `#sala=...&servidor=...`. Para publicar, copie o conteúdo de `release/demo` para o branch/pasta do GitHub Pages. Como hospedar o servidor está em [hospedagem.md](hospedagem.md).

## App de desktop

`packages/desktop` é um app Electron (versão fixa em `package.json`) que:

- abre uma tela inicial com **Jogar**, **Hospedar partida** e **Entrar**;
- carrega o cliente web compilado por um protocolo próprio (`riverfront://app`), com CSP restrita;
- roda o servidor como biblioteca quando o jogador hospeda uma partida;
- não expõe Node às páginas: `contextIsolation`, `sandbox`, sem `nodeIntegration`; o preload só oferece `window.riverfront` (ligar/desligar o servidor, abrir o jogo, copiar texto), e o processo principal valida cada chamada e a origem de quem chamou;
- bloqueia navegação para fora do app (links http/https abrem no navegador do sistema) e nega pedidos de permissão (câmera, microfone, notificações).

### Gerando localmente

```bash
npm install
npm run dist:win        # no Windows
```

O comando compila tudo (`npm run build`), monta `packages/desktop/dist` (processo principal e preload empacotados com esbuild, tela inicial e cliente web) e chama o electron-builder. Na primeira vez o electron-builder baixa o Electron e o NSIS para o cache.

Para só abrir o app sem gerar instalador:

```bash
npm run desktop
```

Para conferir um pacote gerado sem clicar em nada:

```bash
release/desktop/win-unpacked/Riverfront.exe --smoke-test
```

Ele abre a tela inicial, liga o servidor embutido numa porta livre, consulta o `/healthz`, abre o jogo, conecta um WebSocket a partir da página do jogo, desliga o servidor e sai com código 0 (ou 1 com o motivo).

### Ícones

Não há arquivos de imagem no repositório: `scripts/make-icons.mjs` desenha o ícone (moldura de madeira, rio e duas torres) e grava `icon.png` (1024 px), `icon.ico` (16 a 256 px) e `icons/*.png` em `packages/desktop/build/`. O build do desktop roda o script quando os ícones não existem; para refazer, `npm run icons`.

### Assinatura de código

Os instaladores ainda **não são assinados**. Consequências:

- **Windows**: o SmartScreen mostra "O Windows protegeu o computador". O jogador clica em "Mais informações" > "Executar assim mesmo". Com um certificado de assinatura (EV ou OV), basta definir `CSC_LINK` e `CSC_KEY_PASSWORD` como segredos e remover `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` do workflow.
- **macOS**: o Gatekeeper bloqueia o primeiro clique; o jogador abre com botão direito > Abrir. Para assinar e notarizar é preciso uma conta Apple Developer (`CSC_LINK`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`).
- **Linux**: AppImage não precisa de assinatura; o jogador dá permissão de execução (`chmod +x`).

## Servidor dedicado

```bash
npm run pack:server
```

Monta `release/server/riverfront-server-<versão>/` e o `.zip` correspondente (o zip é gerado por um script próprio, sem dependências, e mantém a permissão de execução do `.sh`). Conteúdo e configuração em [online.md](online.md#pacote-do-servidor-dedicado).

Imagem Docker a partir do zip:

```bash
unzip riverfront-server-0.1.0.zip && cd riverfront-server-0.1.0
docker compose up -d
```

## Versões

A versão vem do `package.json`. Para lançar, crie uma tag `vX.Y.Z`; no CI, `scripts/sync-version.mjs` aplica essa versão em `package.json` (raiz, protocol, server, desktop) antes do build, então os nomes dos arquivos, o "Sobre" do app e o `/healthz` do servidor saem com a versão da tag. Localmente:

```bash
node scripts/sync-version.mjs 0.2.0
```

## Integração contínua

### `ci.yml`

Em todo push na `main` e em pull requests: `npm ci`, `npm run build`, `npm test`, pacote do servidor e build do desktop (sem instalador), em Ubuntu com Node 22.

### `release.yml`

Disparado por tag `v*`:

1. **desktop** (matriz Windows, macOS, Linux): testes, instaladores, upload como artefato do workflow (14 dias);
2. **server**: zip do servidor, upload como artefato;
3. **publish**: baixa todos os artefatos e cria a Release `vX.Y.Z` num **repositório público separado**, com os arquivos anexados.

O código é público em https://github.com/gkamchen/Riverfront; as releases podem ir para o próprio repositório ou para um separado só de binários. As actions estão fixadas pelo SHA do commit (o comentário ao lado diz a versão).

#### Configuração necessária

Em **Settings > Secrets and variables > Actions** do repositório do código:

| Tipo | Nome | Valor |
| --- | --- | --- |
| Variável | `RELEASE_REPO` | `dono/riverfront-releases` (repositório público que recebe as releases) |
| Segredo | `RELEASES_TOKEN` | token *fine-grained* do GitHub com acesso **só** ao repositório de releases e permissão **Contents: Read and write** |

O repositório de releases precisa ter pelo menos um commit (um README basta), porque a tag é criada lá apontando para o branch padrão dele. Se a variável ou o segredo faltarem, o job `publish` falha com uma mensagem explicando o que configurar; os artefatos continuam disponíveis na execução do workflow.

Tags com hífen (`v0.3.0-beta.1`) viram *pre-release*.

#### Lançando uma versão

```bash
git tag v0.2.0
git push origin v0.2.0
```

Acompanhe em **Actions**. A página de download fica em `https://github.com/<RELEASE_REPO>/releases/latest`.

## O que não é verificado localmente

No Windows dá para gerar e testar só os instaladores de Windows. Os builds de macOS (dmg) e Linux (AppImage) dependem dos runners do GitHub Actions (ou de uma máquina com o sistema correspondente).
