// Reproduz o bug "body detached" que quebrou v530-v537:
//   1. Root começa com conteúdo A (Painel)
//   2. Simula render() com morphdom: cria newRoot com estrutura B (Financeiro)
//      onde profFinanceiro cria um `body` que é filho de `w` dentro de newRoot
//   3. Chama morphdom(root, newRoot)
//   4. Verifica se o `body` referenciado pela closure de profFinanceiro está
//      no DOM (isConnected) OU se morphdom reusou o old node e descartou o novo
//
// Se morphdom REUSOU old node (esperado sem chave de identidade), o `body`
// closure fica detached → _finPaintBody pinta no ghost → nada aparece.
//
// Objetivo: entender o comportamento exato ANTES de projetar fix.

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
// Bind DOM globals que morphdom lê diretamente (HTMLElement, Node, etc)
globalThis.window = window;
globalThis.document = document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.Element = window.Element;
globalThis.NodeList = window.NodeList;

// Carrega morphdom via vm.runInContext seria mais limpo, mas mais simples:
// executa dentro do window context (que já tem HTMLElement etc)
window.eval(morphdomSrc);
const morphdom = window.morphdom;
assert.equal(typeof morphdom, 'function', 'morphdom loaded');

// ---------- CASO 1: BUG REPRO ----------
// Estado inicial do root (Painel)
const root = document.getElementById('root');
root.innerHTML = '<div class="painel"><h1>Painel</h1></div>';

// Simula profFinanceiro criando o body dentro de w em um newRoot (clone de root)
const newRoot = root.cloneNode(false);
const w = document.createElement('div');
const bodyFresh = document.createElement('div');
bodyFresh.id = 'fin-body';
bodyFresh.className = 'fin-body';
bodyFresh.innerHTML = '<button data-click="finNovo">＋ Novo</button>';
w.appendChild(bodyFresh);
newRoot.appendChild(w);

// EXECUTA morphdom (nossa versão original em v530)
morphdom(root, newRoot);

// Estado pós-morphdom + assert imediato (antes de ser mexido em CASOs seguintes)
const bodyInDOM = document.getElementById('fin-body');
const caso1_connected = bodyFresh.isConnected;
const caso1_isSame = bodyFresh === bodyInDOM;
console.log('--- CASO 1: reuso vs move ---');
console.log('bodyFresh === bodyInDOM:', caso1_isSame);
console.log('bodyFresh.isConnected:  ', caso1_connected);
console.log('bodyInDOM textContent:  ', bodyInDOM && bodyInDOM.textContent.trim());
assert.equal(caso1_connected, true, 'CASO 1: 1ª entrada → body novo se conecta');
assert.equal(caso1_isSame, true, 'CASO 1: 1ª entrada → identity preservada (morphdom moveu new)');

// Se bodyFresh !== bodyInDOM, morphdom REUSOU o old div (painel) e morfou pra
// virar fin-body. bodyFresh ficou órfão. Todo appendChild(bodyFresh, X) daí
// vira ghost — sintoma que causou v531-v537.

// ---------- CASO 2: solução via `getNodeKey` ----------
// morphdom aceita opção `getNodeKey` que força match por identidade custom.
// Se ambos os nodes tiverem key igual, morphdom RESPEITA a identidade.
// Vamos ver se com key match, morphdom preserva o body correto.

root.innerHTML = '<div class="painel"><h1>Painel</h1></div>';
const newRoot2 = root.cloneNode(false);
const w2 = document.createElement('div');
const bodyFresh2 = document.createElement('div');
bodyFresh2.id = 'fin-body';
bodyFresh2.innerHTML = '<button data-click="finNovo">＋ Novo</button>';
w2.appendChild(bodyFresh2);
newRoot2.appendChild(w2);

morphdom(root, newRoot2, {
  getNodeKey(node){ return node.id || null; },
});

const bodyInDOM2 = document.getElementById('fin-body');
console.log('\n--- CASO 2: getNodeKey por id ---');
console.log('bodyFresh2 === bodyInDOM2:', bodyFresh2 === bodyInDOM2);
console.log('bodyFresh2.isConnected:  ', bodyFresh2.isConnected);

// ---------- CASO 3: root vs newRoot com childrenOnly ----------
root.innerHTML = '<div class="painel"><h1>Painel</h1></div>';
const bodyFresh3 = document.createElement('div');
bodyFresh3.id = 'fin-body';
bodyFresh3.innerHTML = '<button data-click="finNovo">＋ Novo</button>';
const w3 = document.createElement('div');
w3.appendChild(bodyFresh3);
// morphdom com childrenOnly + toNode sendo o próprio root com novos filhos
const stagingRoot = root.cloneNode(false);
stagingRoot.appendChild(w3);
morphdom(root, stagingRoot, {
  childrenOnly: true,
  getNodeKey(node){ return node.id || null; },
});

const bodyInDOM3 = document.getElementById('fin-body');
console.log('\n--- CASO 3: childrenOnly + getNodeKey ---');
console.log('bodyFresh3 === bodyInDOM3:', bodyFresh3 === bodyInDOM3);
console.log('bodyFresh3.isConnected:  ', bodyFresh3.isConnected);

// ---------- CASO 4: mesma tela repetida (2ª entrada em Financeiro) ----------
// Simula quando root JÁ tem fin-body e user re-navega pra Financeiro
// (rendering igual, elementos "similares" mas de instances diferentes)
root.innerHTML = '';
const w4Old = document.createElement('div');
const bodyOld = document.createElement('div');
bodyOld.id = 'fin-body';
bodyOld.innerHTML = '<button data-click="finVelho">antigo</button>';
w4Old.appendChild(bodyOld);
root.appendChild(w4Old);

// user re-entra em Financeiro — profFinanceiro cria body NOVO
const newRoot4 = root.cloneNode(false);
const w4New = document.createElement('div');
const bodyNew = document.createElement('div');
bodyNew.id = 'fin-body';
bodyNew.innerHTML = '<button data-click="finNovo">＋ Novo</button>';
w4New.appendChild(bodyNew);
newRoot4.appendChild(w4New);

morphdom(root, newRoot4, {
  getNodeKey(node){ return node.id || null; },
});

const bodyInDOM4 = document.getElementById('fin-body');
const caso4_newConnected = bodyNew.isConnected;
const caso4_oldIsInDOM = bodyOld === bodyInDOM4;
console.log('\n--- CASO 4: 2ª entrada em Financeiro (id match) ---');
console.log('bodyNew === bodyInDOM4 (esperado false — id match reusa old):', bodyNew === bodyInDOM4);
console.log('bodyOld === bodyInDOM4 (esperado true):                     ', caso4_oldIsInDOM);
console.log('bodyNew.isConnected (esperado false — ficou orfão):         ', caso4_newConnected);
console.log('bodyInDOM4.textContent:                                     ', bodyInDOM4.textContent.trim());
assert.equal(caso4_newConnected, false, 'CASO 4: 2ª entrada → body novo fica órfão (id match reusa old)');
assert.equal(caso4_oldIsInDOM, true, 'CASO 4: DOM contém o body ANTIGO, não o novo');
assert.equal(bodyInDOM4.textContent.trim(), '＋ Novo', 'CASO 4: body antigo tem conteúdo do novo (morphdom morfou children)');

// ---------- CASO 5: FIX (v539) — lookup fresh sempre encontra o body vivo ----
// Simula o padrão do app corrigido: profFinanceiro cria body, morphdom morfa,
// callback assíncrono chama _finPaintBody() SEM captured ref — faz lookup e
// pinta no body VIVO em DOM.
root.innerHTML = '';
const w5Old = document.createElement('div');
const bodyOld5 = document.createElement('div');
bodyOld5.id = 'fin-body';
bodyOld5.innerHTML = '<div>tab velha</div>';
w5Old.appendChild(bodyOld5);
root.appendChild(w5Old);

// user entra em Financeiro de novo → profFinanceiro cria body novo
const newRoot5 = root.cloneNode(false);
const w5New = document.createElement('div');
const bodyNew5 = document.createElement('div');
bodyNew5.id = 'fin-body';
bodyNew5.appendChild(document.createElement('div')); // holder de loading
w5New.appendChild(bodyNew5);
newRoot5.appendChild(w5New);

morphdom(root, newRoot5, { getNodeKey: n => n.id || null });

// Callback assíncrono simulado: NÃO usa bodyNew5 closure — lookup fresh
const paintDeferred = () => {
  const live = document.getElementById('fin-body');
  if(!live) return false;
  live.innerHTML = '';
  live.appendChild(document.createTextNode('CONTEÚDO PINTADO'));
  return true;
};
const painted = paintDeferred();

const bodyInDOM5 = document.getElementById('fin-body');
console.log('\n--- CASO 5: FIX (lookup fresh) ---');
console.log('paint retornou true:                    ', painted);
console.log('bodyInDOM5.textContent:                 ', bodyInDOM5.textContent.trim());
console.log('bodyNew5.isConnected (esperado false):   ', bodyNew5.isConnected);
console.log('bodyOld5 === bodyInDOM5 (esperado true): ', bodyOld5 === bodyInDOM5);
assert.equal(painted, true, 'CASO 5: paint lookup encontra body vivo');
assert.equal(bodyInDOM5.textContent.trim(), 'CONTEÚDO PINTADO', 'CASO 5: conteúdo aparece no body correto');

console.log('\n✔ Todos os asserts passaram');
console.log('Fix v539 valida a regra: lookup fresh sempre pinta no body em DOM.');
