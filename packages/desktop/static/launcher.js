// Tela inicial do app de desktop. Fala com o processo principal só pela ponte `window.riverfront`.
'use strict';

const api = window.riverfront;
const $ = (id) => document.getElementById(id);

function toServerUrl(text) {
  let value = String(text || '').trim();
  if (!value) return null;
  if (!/^[a-z]+:\/\//i.test(value)) value = `ws://${value}`;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null;
  if (!url.port && url.protocol === 'ws:') url.port = '8787';
  if (url.pathname === '/' || !url.pathname) url.pathname = '/ws';
  url.hash = '';
  url.search = '';
  return url.toString();
}

function normalizeCode(text) {
  const raw = String(text || '').toUpperCase().replace(/[\s-]/g, '');
  if (!raw) return '';
  if (!/^[2-9A-HJ-NP-Z]{6}$/.test(raw)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function copyButton(text) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ghost';
  button.textContent = 'Copiar';
  button.addEventListener('click', async () => {
    const ok = await api.copy(text);
    button.textContent = ok ? 'Copiado!' : 'Falhou';
    setTimeout(() => (button.textContent = 'Copiar'), 1500);
  });
  return button;
}

function renderHost(status) {
  $('host-off').hidden = status.running;
  $('host-on').hidden = !status.running;
  if (!status.running) return;
  $('host-info').textContent = `Servidor ligado na porta ${status.port}. Jogadores conectados: ${status.players}.`;
  const list = $('enderecos');
  list.replaceChildren();
  const addresses = status.addresses.length > 0 ? status.addresses : ['127.0.0.1'];
  for (const ip of addresses) {
    for (const text of [`${ip}:${status.port}`, `http://${ip}:${status.port}/`]) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = text;
      li.append(span, copyButton(text));
      list.append(li);
    }
  }
}

async function refresh() {
  try {
    renderHost(await api.host.status());
  } catch (error) {
    $('host-erro').textContent = String(error && error.message ? error.message : error);
  }
}

$('jogar').addEventListener('click', () => api.openClient({}));

$('ligar').addEventListener('click', async () => {
  const port = Number($('porta').value);
  $('host-erro').textContent = '';
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    $('host-erro').textContent = 'Escolha uma porta entre 1024 e 65535.';
    return;
  }
  $('ligar').disabled = true;
  try {
    renderHost(await api.host.start(port));
  } catch (error) {
    const text = String(error && error.message ? error.message : error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    $('host-erro').textContent = text;
  } finally {
    $('ligar').disabled = false;
  }
});

$('desligar').addEventListener('click', async () => renderHost(await api.host.stop()));

$('abrir-hospedado').addEventListener('click', async () => {
  const status = await api.host.status();
  if (status.running) api.openClient({ server: `ws://127.0.0.1:${status.port}/ws` });
});

$('entrar').addEventListener('click', () => {
  $('entrar-erro').textContent = '';
  const server = toServerUrl($('endereco').value);
  if (!server) {
    $('entrar-erro').textContent = 'Endereço inválido. Exemplo: 192.168.0.10:8787';
    return;
  }
  const room = normalizeCode($('sala').value);
  if (room === null) {
    $('entrar-erro').textContent = 'Código de sala inválido. Ele tem o formato K7Q2-PX.';
    return;
  }
  api.openClient(room ? { server, room } : { server });
});

const mode = location.hash.slice(1);
if (mode === 'hospedar') $('porta').focus();
if (mode === 'entrar') $('endereco').focus();
$('versao').textContent = '© 2026 Gustavo Kamchen';
refresh();
setInterval(refresh, 5000);
