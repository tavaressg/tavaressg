// Comportamento do _rtEvento (Realtime, v556 · migration 0054).
//
// Roda o código REAL do app.js — `corpoDaFuncao` recorta as duas funções e elas
// são avaliadas com stubs no lugar das dependências. Reimplementar a lógica aqui
// tornaria o teste um espelho do que eu acho que o app faz, que é exatamente o
// jeito de um guard passar calado (CRLF na v545, regex global na v550).
//
// O que está travado aqui é a REGRA DE CUSTO: check-in de outro aluno pinta a
// lista do professor pelo payload e NÃO refaz o getAlunos — que puxa os
// `checkins` de 120d da academia inteira. Se alguém trocar isso por um refetch,
// a fila do QR (30 alunos) vira 30 getAlunos e o Realtime fica mais caro que o
// polling de 5 min que ele substitui. Esse é o teste que precisa quebrar.
//
// Rodar: node tests/realtime.spec.mjs

import assert from 'node:assert/strict';
import { corpoDaFuncao } from './_fonte.mjs';

const HOJE_ISO = '2026-09-06';

function montar(){
  const est = { servidor: 0, local: 0, pulls: 0, meusPedidos: 0, filaPedidos: 0, repaints: 0, profTs: 12345 };
  const ctx = {
    DB: { sbUser: { id: 'eu' }, eu: { isProfessor: true }, turmas: [{ id: 't1', nome: 'Adulto Noite' }] },
    HOJE_ISO,
    _profData: { alunos: [{ id: 'a1', nm: 'Fulano', pres: null, presTurma: null, diasSem: 33, ultimaPres: '2026-08-14' }], kpis: {} },
    sbSync: { pullAll: () => { est.pulls++; est.servidor++; return Promise.resolve({}); } },
    buildDump: () => ({ servidor: est.servidor, local: est.local }),
    _lastPushed: '',
    _profTs: 111, _pedidosTs: 222, _meusPedidosTs: 333,
    renderBg: () => { est.repaints++; },
    _loadPedidos: () => { est.filaPedidos++; },
    _loadMeusPedidos: () => { est.meusPedidos++; },
    est,
  };
  const nomes = Object.keys(ctx);
  const fn = new Function(...nomes, `
    ${corpoDaFuncao('_rtEvento')}
    ${corpoDaFuncao('_rtPullAll')}
    ${corpoDaFuncao('_pullSemEco')}
    return { rt: _rtEvento, pull: _pullSemEco, base: (v) => { _lastPushed = v; }, get lastPushed(){ return _lastPushed; },
      get caches(){ return [_profTs, _pedidosTs, _meusPedidosTs]; } };
  `);
  ctx.api = fn(...nomes.map(n => ctx[n]));
  ctx.rt = ctx.api.rt;
  ctx.aluno = ctx._profData.alunos[0];
  return ctx;
}

const ck = (o) => Object.assign({ user_id: 'a1', data: HOJE_ISO, hora: '19:32', turma_id: 't1', via: 'app' }, o);

// ---------- professor: chamada ao vivo, zero requisição ----------
{
  const c = montar();
  c.rt('checkins', ck());
  assert.equal(c.aluno.pres, '19:32', 'pres sai do payload');
  assert.deepEqual(c.aluno.presTurma, ['Adulto Noite'], 'turma resolvida pelo id local');
  assert.equal(c.aluno.diasSem, 0, 'presente hoje sai de "Ausentes 7+d" (achado no teste em prod, v557)');
  assert.equal(c.aluno.ultimaPres, HOJE_ISO, 'última presença acompanha');
  assert.equal(c.est.pulls, 0, 'REGRA DE CUSTO: check-in de outro aluno não pode ir ao servidor');
  assert.equal(c.est.repaints, 1, 'repintou');

  c.rt('checkins', ck());
  assert.equal(c.aluno.presTurma.length, 1, 'mesma turma não duplica');

  c.aluno.pres = null;
  c.aluno.diasSem = 33;
  c.rt('checkins', ck({ data: '2020-01-01' }));
  assert.equal(c.aluno.pres, null, 'check-in de outro dia não conta como presente hoje');
  assert.equal(c.aluno.diasSem, 33, 'check-in de outro dia não zera dias sem treinar');

  c.rt('checkins', ck({ user_id: 'fora-da-cache' }));   // não pode lançar
  c.rt('checkins', ck({ turma_id: 'turma-desconhecida' }));
  assert.equal(c.aluno.presTurma.length, 1, 'turma sem nome local não entra');
}

// ---------- aluno: só o que exige recálculo vai ao servidor ----------
{
  const c = montar();
  c.DB.sbUser.id = 'a1'; c.DB.eu.isProfessor = false;

  c.rt('checkins', ck({ via: 'professor' }));
  assert.equal(c.est.pulls, 1, 'presença marcada na chamada → pullAll (aulas no grau são do servidor)');

  c.rt('checkins', ck({ via: 'app' }));
  assert.equal(c.est.pulls, 1, 'eco do próprio QR já está local → sem refetch');

  c.rt('graduations', { user_id: 'a1', faixa: 'roxa' });
  assert.equal(c.est.pulls, 2, 'minha graduação → pullAll');

  c.rt('graduations', { user_id: 'outro', faixa: 'roxa' });
  assert.equal(c.est.pulls, 2, 'graduação alheia não mexe no meu estado');
}

// ---------- pedidos: cada papel lê a sua lista ----------
{
  const c = montar();
  c.DB.eu.isProfessor = false; c.DB.sbUser.id = 'a1';
  c.rt('pedidos', { user_id: 'a1', status: 'pago' });
  assert.equal(c.est.meusPedidos, 1);
  assert.equal(c.est.filaPedidos, 0);

  c.DB.eu.isProfessor = true;
  c.rt('pedidos', { user_id: 'qualquer', status: 'pago' });
  assert.equal(c.est.filaPedidos, 1, 'professor vê a fila da academia');
}

// ---------- sem sessão: no-op ----------
{
  const c = montar();
  c.DB.sbUser = null;
  c.rt('checkins', ck());
  assert.equal(c.aluno.pres, null, 'sem sessão não toca em nada');
  assert.equal(c.est.pulls, 0);
}

// ---------- reconexão depois de queda (v565) ----------
// O Realtime não reenvia o que aconteceu durante a queda: professor sem sinal na aula
// perderia os check-ins do intervalo até o refetch por foco (piso de 5 min).
{
  const c = montar();
  c.rt('reconectou', null);   // row null: não pode ler row.user_id
  assert.deepEqual(c.api.caches, [0, 0, 0], 'zera alunos, pedidos e meus pedidos — o render pede o que a tela mostra');
  assert.equal(c.est.pulls, 1, 'busca os dados do próprio usuário uma vez');
  assert.equal(c.est.repaints, 1, 'repinta pra disparar os loaders da tela atual');
}

// ---------- pull de fundo não devolve o eco pra nuvem (v560) ----------
// Com a conta aberta em 2+ aparelhos, gravar de volta o que acabou de baixar fazia
// todos gravarem juntos → state_conflict → "Dados atualizados a partir de outro aparelho".
{
  const c = montar();
  const dumpAtual = () => JSON.stringify(c.buildDump());
  c.api.base(dumpAtual());                  // nada pendente
  await c.api.pull();
  assert.equal(c.api.lastPushed, dumpAtual(), 'sem edição pendente: o que veio do servidor vira baseline (render não empurra de volta)');

  const d = montar();
  d.api.base('edição local ainda não enviada');
  await d.api.pull();
  assert.equal(d.api.lastPushed, 'edição local ainda não enviada', 'com edição pendente NÃO rebaseia — senão ela deixaria de subir');
}

// ---------- ordem da timeline empata igual ao servidor (v560) ----------
{
  const cmp = new Function(`${corpoDaFuncao('_gradCmp')}; return _gradCmp;`)();
  const g2 = { data: '2026-09-16', graus: 2, created_at: '2026-09-17T00:10:20Z' };
  const g3 = { data: '2026-09-16', graus: 3, created_at: '2026-09-17T00:16:07Z' };
  const antigo = { data: '2026-02-02', graus: 1, created_at: '2026-07-24T02:28:19Z' };
  const novoSemTs = { data: '2026-09-16', graus: 4 };
  // Entrada na ordem em que o banco devolve (`order('data')`) — é nela que o empate erra.
  assert.deepEqual([antigo, g2, g3].sort((x, y) => cmp(y, x)).map(g => g.graus), [3, 2, 1],
    'mesmo dia: o criado depois vem em cima (o 2º grau aparecia acima do 3º)');
  assert.equal([g2, novoSemTs, g3].sort(cmp).pop(), novoSemTs, 'recém-salvo sem created_at conta como o mais novo');
}

console.log('✔ realtime: _rtEvento — payload pinta, recálculo pergunta, sem sessão no-opa');
