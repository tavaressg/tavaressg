// Contrato do morphdom ESCOPADO no #fin-body (v543, Caminho A).
//
// Diferença para a tentativa v530-v541 (que falhou): lá o morphdom rodava no
// #root inteiro, sem childrenOnly. Resultado (morphdom-render.spec.mjs CASO 4):
// na 2ª entrada numa tela o nó novo ficava órfão e o antigo permanecia no DOM —
// toda closure que capturava o nó virava ghost.
//
// Aqui morfamos SÓ OS FILHOS de um container estável (o #fin-body, que já
// existe no DOM). Este teste prova que:
//   1. o container em si NUNCA é substituído (closures continuam válidas)
//   2. os filhos são atualizados corretamente
//   3. nós idênticos são preservados (é isso que elimina o flash)
//   4. handlers via delegation continuam funcionando após o morph
//
// Rodar: node tests/morphdom-fin-body.spec.mjs

import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const morphdomSrc = fs.readFileSync(path.resolve('vendor/morphdom.min.js'), 'utf8');
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
  runScripts: 'outside-only',
});
const { window } = dom;
const { document } = window;
globalThis.window = window;
globalThis.document = document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.Element = window.Element;

window.eval(morphdomSrc);
const morphdom = window.morphdom;
assert.equal(typeof morphdom, 'function', 'morphdom carregou');

const root = document.getElementById('root');

// Reproduz a estrutura real: #root > div(w) > div#fin-body > conteúdo da aba
const w = document.createElement('div');
const body = document.createElement('div');
body.id = 'fin-body';
body.className = 'fin-body';
w.appendChild(body);
root.appendChild(w);

// Helper igual ao que o app vai usar
function pintar(target, linhas){
  target.appendChild((() => {
    const d = document.createElement('div');
    d.innerHTML = '<button data-click="finCatNova" data-tipo="receita">＋ Receita</button>';
    return d;
  })());
  const list = document.createElement('div');
  list.className = 'list';
  linhas.forEach(c => {
    const row = document.createElement('div');
    row.className = 'st-row';
    row.setAttribute('data-click', 'finCatEdit');
    row.setAttribute('data-id', c.id);
    row.textContent = c.nome;
    list.appendChild(row);
  });
  target.appendChild(list);
}

function morfar(target, linhas){
  const novo = target.cloneNode(false);
  pintar(novo, linhas);
  morphdom(target, novo, { childrenOnly: true });
}

// ---------- pintura inicial ----------
pintar(body, [{ id: 'a', nome: 'Mensalidade' }, { id: 'b', nome: 'Matrícula' }]);
const bodyRef = body;                              // simula a closure do profFinanceiro
const rowA1 = body.querySelector('[data-id="a"]');

// ---------- 1) container NUNCA é substituído ----------
morfar(body, [{ id: 'a', nome: 'Mensalidade' }, { id: 'b', nome: 'Matrícula' }]);
assert.equal(bodyRef.isConnected, true, '1a) container segue no DOM após morph');
assert.equal(bodyRef === document.getElementById('fin-body'), true, '1b) closure ref === nó vivo');

// ---------- 2) nós idênticos preservados (o que mata o flash) ----------
const rowA2 = body.querySelector('[data-id="a"]');
assert.equal(rowA1 === rowA2, true, '2) linha inalterada preservou a identidade (sem repintar)');

// ---------- 3) mudança de conteúdo é aplicada ----------
morfar(body, [{ id: 'a', nome: 'Mensalidade EDITADA' }, { id: 'b', nome: 'Matrícula' }]);
const rowA3 = body.querySelector('[data-id="a"]');
assert.equal(rowA3.textContent, 'Mensalidade EDITADA', '3a) texto novo aplicado');
assert.equal(bodyRef.isConnected, true, '3b) container ainda vivo');

// ---------- 4) remoção e adição de linhas ----------
morfar(body, [{ id: 'b', nome: 'Matrícula' }, { id: 'c', nome: 'Exame' }]);
assert.equal(body.querySelectorAll('[data-click="finCatEdit"]').length, 2, '4a) 2 linhas após troca');
assert.equal(body.querySelector('[data-id="a"]'), null, '4b) linha removida sumiu');
assert.ok(body.querySelector('[data-id="c"]'), '4c) linha nova entrou');

// ---------- 5) delegation continua funcionando após o morph ----------
// Router instalado no document ANTES do morph — como no app real.
let disparos = [];
document.addEventListener('click', (ev) => {
  const el = ev.target.closest && ev.target.closest('[data-click]');
  if (!el) return;
  if (!root.contains(el)) return;
  disparos.push(el.getAttribute('data-click') + ':' + (el.dataset.id || el.dataset.tipo || ''));
});

body.querySelector('[data-id="c"]').click();
body.querySelector('[data-click="finCatNova"]').click();
morfar(body, [{ id: 'c', nome: 'Exame' }]);        // morph novo, listener é o mesmo
body.querySelector('[data-id="c"]').click();

assert.deepEqual(
  disparos,
  ['finCatEdit:c', 'finCatNova:receita', 'finCatEdit:c'],
  '5) delegation dispara antes E depois do morph, com os dados corretos'
);

// ---------- 6) container vazio → morph limpa tudo ----------
morfar(body, []);
assert.equal(body.querySelectorAll('[data-click="finCatEdit"]').length, 0, '6a) sem linhas');
assert.equal(bodyRef.isConnected, true, '6b) container sobrevive ao esvaziamento');

console.log('✔ morphdom-fin-body: 6 cenários OK');
console.log('  childrenOnly preserva o container → closures do profFinanceiro seguem válidas');
console.log('  nós inalterados mantêm identidade → sem flash no repaint');
console.log('  event delegation atravessa o morph sem re-attach');
