// Guard do modelo "Dois preços diretos" (v587 · migration 0056):
// - descontoPix global saiu do app_config + de todo lugar do código
// - _descontoPixPct, _precoPix, carrinhoTotalPix não existem mais
// - precoAvistaDe(p) é a única fonte pra "preço à vista"
//
// Se qualquer regressão colar uma dessas funções de volta no app.js ou
// supabase.js, o CI vermelho aqui. Padrão da v578/v582/etc.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const app = fs.readFileSync(path.resolve('app.js'), 'utf8').replace(/\r\n/g, '\n');
const sb  = fs.readFileSync(path.resolve('supabase.js'), 'utf8').replace(/\r\n/g, '\n');

// Nomes proibidos (código executável, não comentário/CHANGELOG).
// Contamos ocorrências totais e checamos que só aparecem em contextos comentados
// ou em strings de doc do próprio guard. Se aparecer chamada, dá match numa
// regex mais estrita.
const NOMES = ['_descontoPixPct', '_precoPix', 'carrinhoTotalPix'];

function chamadasCode(src, nome){
  // Match nome( ou nome. em linhas que NÃO começam com //, e não estão dentro de
  // template string com "v587" (nossa referência histórica). Heurística simples.
  const linhas = src.split('\n');
  const hits = [];
  linhas.forEach((l, i) => {
    // Ignora comentário de linha
    const stripped = l.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    // Chamada de função ou membro
    const re = new RegExp('\\b' + nome + '\\s*\\(');
    if(re.test(stripped)) hits.push({ line: i+1, text: l.trim() });
  });
  return hits;
}

let falhas = 0;
NOMES.forEach(nome => {
  const app_hits = chamadasCode(app, nome);
  const sb_hits  = chamadasCode(sb, nome);
  if(app_hits.length){
    console.error(`✗ ${nome} ainda chamado em app.js:`);
    app_hits.forEach(h => console.error(`  L${h.line}: ${h.text}`));
    falhas++;
  }
  if(sb_hits.length){
    console.error(`✗ ${nome} ainda chamado em supabase.js:`);
    sb_hits.forEach(h => console.error(`  L${h.line}: ${h.text}`));
    falhas++;
  }
});

// `descontoPix` no config só pode aparecer em comentário/CHANGELOG.
// Chamada suspeita: `.descontoPix`, `descontoPix:`, `'descontoPix'`, `"descontoPix"`.
function usoDescontoPix(src, arquivo){
  const linhas = src.split('\n');
  const suspeitas = [];
  linhas.forEach((l, i) => {
    const stripped = l.replace(/\/\/.*$/, '');
    if(/\bdescontoPix\b/.test(stripped)){
      // Aceita se dentro de string literal de commentário histórico marcado v587
      suspeitas.push({ line: i+1, text: l.trim() });
    }
  });
  return suspeitas;
}
const app_dp = usoDescontoPix(app, 'app.js');
const sb_dp  = usoDescontoPix(sb, 'supabase.js');
if(app_dp.length){ console.error(`✗ descontoPix ainda em código app.js:`); app_dp.forEach(h => console.error(`  L${h.line}: ${h.text}`)); falhas++; }
if(sb_dp.length){ console.error(`✗ descontoPix ainda em código supabase.js:`); sb_dp.forEach(h => console.error(`  L${h.line}: ${h.text}`)); falhas++; }

// precoAvistaDe deve existir e ser função top-level
assert.ok(/function\s+precoAvistaDe\s*\(/.test(app), 'precoAvistaDe deve existir como função em app.js');
assert.ok(/function\s+precoCartaoDe\s*\(/.test(app), 'precoCartaoDe deve existir como função em app.js');
assert.ok(/preco_cartao/.test(sb), 'supabase.js deve usar preco_cartao (nova coluna)');
assert.ok(/preco_avista/.test(sb), 'supabase.js deve usar preco_avista (nova coluna)');

if(falhas){
  console.error(`\n✗ loja-precos: ${falhas} regressão(ões) encontrada(s)`);
  process.exit(1);
}
console.log('✔ loja-precos: sem regressão — descontoPix limpo, precoAvistaDe é fonte única');
