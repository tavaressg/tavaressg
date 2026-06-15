/* ============================================================
   Yama · Jiu-Jitsu — Gestão + Journal num app só (protótipo)
   Estado compartilhado entre Aluno e Professor: o que o professor
   define (técnica do dia, graduação, check-in) reflete no aluno.
   ============================================================ */

/* ---------------- util ---------------- */
const $ = (s, el=document) => el.querySelector(s);
const el = (h) => { const t=document.createElement('template'); t.innerHTML=h.trim(); return t.content.firstElementChild; };
function safeTxt(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function openSheet(node){ const close=()=>{ node.classList.remove('open'); setTimeout(()=>node.remove(),260); }; node.onclick=(e)=>{ if(e.target===node) close(); }; document.body.appendChild(node); requestAnimationFrame(()=>node.classList.add('open')); return close; }
const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const diasSem = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
// ?demo=1 = vitrine (data congelada p/ o seed casar); usuário real = data de hoje (presença real ao longo dos dias)
const DEMO = (()=>{ try{ return new URLSearchParams(location.search).has('demo'); }catch(e){ return false; } })();
const hoje = DEMO ? new Date(2026, 5, 3) : (()=>{ const d=new Date(); d.setHours(0,0,0,0); return d; })();
const isoOf = (d)=> `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
let HOJE_ISO = isoOf(hoje);
function _checkMidnight(){ const now=new Date(); now.setHours(0,0,0,0); if(now.getTime()!==hoje.getTime()){ hoje.setTime(now.getTime()); HOJE_ISO=isoOf(hoje); _resetDiario(''); render(); } }
setInterval(_checkMidnight, 60000);
const fmtData = (d) => `${String(d.getDate()).padStart(2,'0')} ${meses[d.getMonth()]}`;
function diaRelativo(iso){
  if(!iso) return '';
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  const diff = Math.round((hoje - dt) / 86400000);
  if(diff===0) return 'Hoje';
  if(diff===1) return 'Ontem';
  if(diff<7)   return diasSem[dt.getDay()].slice(0,3)+', '+String(d).padStart(2,'0')+' '+meses[m-1];
  return String(d).padStart(2,'0')+' '+meses[m-1];
}
const plural = (n,s,p)=> `${n} ${Math.abs(n)===1?s:p}`;   // 1 semana · 2 semanas
const moneyBR = (n) => 'R$ ' + n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),2200); }

const BELTS = {
  branca:{cor:'#e8e8e8',nome:'Branca'}, azul:{cor:'#2f6fef',nome:'Azul'},
  roxa:{cor:'#7e4ddb',nome:'Roxa'}, marrom:{cor:'#7a4a25',nome:'Marrom'}, preta:{cor:'#1a1a1a',nome:'Preta'},
  cinza_branca:{cor:'#9e9e9e',nome:'Cinza/Branca'}, cinza:{cor:'#9e9e9e',nome:'Cinza'}, cinza_preta:{cor:'#9e9e9e',nome:'Cinza/Preta'},
  amarela_branca:{cor:'#f5c518',nome:'Amarela/Branca'}, amarela:{cor:'#f5c518',nome:'Amarela'}, amarela_preta:{cor:'#f5c518',nome:'Amarela/Preta'},
  laranja_branca:{cor:'#f57c00',nome:'Laranja/Branca'}, laranja:{cor:'#f57c00',nome:'Laranja'}, laranja_preta:{cor:'#f57c00',nome:'Laranja/Preta'},
  verde_branca:{cor:'#43a047',nome:'Verde/Branca'}, verde:{cor:'#43a047',nome:'Verde'}, verde_preta:{cor:'#43a047',nome:'Verde/Preta'},
  coral:{cor:'#c62828',nome:'Vermelha e Preta'}, coral_branca:{cor:'#c62828',nome:'Vermelha e Branca'}, vermelha:{cor:'#b71c1c',nome:'Vermelha'},
};
const ADULT_BELTS = ['branca','azul','roxa','marrom','preta'];

/* === CBJJ / IBJJF — Sistema Geral de Graduacao v3.2 (dez/2025) === */
const CBJJ = {
  version: '3.2',
  age_categories: [
    {name:'Pre-Mirim 1',age:4},{name:'Pre-Mirim 2',age:5},{name:'Pre-Mirim 3',age:6},
    {name:'Mirim 1',age:7},{name:'Mirim 2',age:8},{name:'Mirim 3',age:9},
    {name:'Infantil 1',age:10},{name:'Infantil 2',age:11},{name:'Infantil 3',age:12},
    {name:'Infanto-Juvenil 1',age:13},{name:'Infanto-Juvenil 2',age:14},{name:'Infanto-Juvenil 3',age:15},
    {name:'Juvenil 1',age:16},{name:'Juvenil 2',age:17},
    {name:'Adulto',age_min:18,age_max:29},
    {name:'Master 1',age_min:30,age_max:35},{name:'Master 2',age_min:36,age_max:40},
    {name:'Master 3',age_min:41,age_max:45},{name:'Master 4',age_min:46,age_max:50},
    {name:'Master 5',age_min:51,age_max:55},{name:'Master 6',age_min:56,age_max:60},
    {name:'Master 7',age_min:61,age_max:null},
  ],
  adult_belts: [
    {belt:'branca', min_age:0,  min_months:0,  next:'azul',   stripes:4},
    {belt:'azul',   min_age:16, min_months:24, next:'roxa',   stripes:4,
      reductions:[
        {cond:'Cadastro anterior em Cinza/Amarelo/Laranja', months:12},
        {cond:'Cadastro anterior em Verde', months:0},
        {cond:'Cadastro anterior em Azul Juvenil', months:0},
        {cond:'Campeao Mundial adulto na Azul', months:0},
      ]},
    {belt:'roxa',   min_age:16, min_months:18, next:'marrom', stripes:4,
      reductions:[
        {cond:'Cadastro anterior em Azul Juvenil', months:12},
        {cond:'Cadastro Laranja/Verde + Azul Juvenil', months:0},
        {cond:'Cadastro anterior como Roxa Juvenil', months:0},
        {cond:'Campeao Mundial adulto na Roxa', months:0},
      ]},
    {belt:'marrom', min_age:18, min_months:12, next:'preta',  stripes:4,
      reductions:[{cond:'Campeao Mundial adulto na Marrom', months:0}]},
    {belt:'preta',  min_age:19, min_months:null, next:null,   stripes:6,
      min_age_exception:{age:18, cond:'Campeao Mundial adulto na faixa marrom'}},
  ],
  black_belt_degrees: [
    {degree:1,years:3,cumulative:3},{degree:2,years:3,cumulative:6},{degree:3,years:3,cumulative:9},
    {degree:4,years:5,cumulative:14},{degree:5,years:5,cumulative:19},{degree:6,years:5,cumulative:24},
    {degree:7,years:7,cumulative:31,belt:'coral'},{degree:8,years:7,cumulative:38,belt:'coral_branca'},
    {degree:9,years:10,cumulative:48,belt:'vermelha'},
  ],
};

function idadeCBJJ(anoNasc){ return anoNasc ? hoje.getFullYear() - anoNasc : null; }
function categoriaCBJJ(anoNasc){
  const idade = idadeCBJJ(anoNasc);
  if(idade==null) return null;
  const cats = CBJJ.age_categories;
  for(let i=cats.length-1;i>=0;i--){
    const c=cats[i];
    if(c.age!=null && idade===c.age) return c.name;
    if(c.age_min!=null && idade>=c.age_min && (c.age_max==null||idade<=c.age_max)) return c.name;
  }
  if(idade<4) return null;
  return cats[cats.length-1].name;
}
function tempoNaFaixaMeses(dataFaixa){
  if(!dataFaixa) return null;
  const [y,m,d] = dataFaixa.split('-').map(Number);
  let ms = (hoje.getFullYear()-y)*12 + (hoje.getMonth()-(m-1));
  if(hoje.getDate()<d) ms--;
  return Math.max(0, ms);
}
function elegibilidadeCBJJ(eu){
  const checks = [];
  const info = CBJJ.adult_belts.find(b=>b.belt===eu.faixa);
  if(!info || !info.next) return { eligible:false, checks:[{label:'Faixa maxima atingida',ok:true,detail:''}], nextBelt:null };
  const nextInfo = CBJJ.adult_belts.find(b=>b.belt===info.next);
  const idade = idadeCBJJ(eu.nascimento);
  const fg = (DB.graduacoes||[]).find(x=>x.tipo==='faixa' && x.faixa===eu.faixa);
  const mesesNaFaixa = fg ? tempoNaFaixaMeses(fg.data) : null;
  if(nextInfo){
    const minAge = nextInfo.min_age;
    if(idade!=null){
      checks.push({ label:`Idade minima: ${minAge} anos`, ok:idade>=minAge, detail:idade>=minAge?`Voce tem ${idade} anos`:`Faltam ${minAge-idade} ano(s)` });
    } else {
      checks.push({ label:`Idade minima: ${minAge} anos`, ok:null, detail:'Informe seu ano de nascimento' });
    }
  }
  if(info.min_months && info.min_months>0){
    if(mesesNaFaixa!=null){
      const falta = Math.max(0, info.min_months - mesesNaFaixa);
      checks.push({ label:`Tempo minimo na ${BELTS[eu.faixa].nome}: ${info.min_months} meses`, ok:falta===0, detail:falta===0?`${mesesNaFaixa} meses na faixa`:`Faltam ${falta} meses` });
    } else {
      checks.push({ label:`Tempo minimo na ${BELTS[eu.faixa].nome}: ${info.min_months} meses`, ok:null, detail:'Sem data de graduacao registrada' });
    }
  }
  const eligible = checks.length>0 && checks.every(c=>c.ok===true);
  return { eligible, checks, nextBelt:info.next };
}
function beltPill(b, graus){
  const x = BELTS[b]; const g = graus!=null ? ` · ${graus}º` : '';
  return `<span class="belt-pill" style="background:${x.cor}22;color:${b==='branca'?'#888':x.cor}">
    <span class="belt-bar" style="background:${x.cor}"></span>${x.nome}${g}</span>`;
}
// Mini-faixa visual: corpo colorido + barra preta (graus) + ponta colorida no fim
function beltMini(b, graus){
  const x = BELTS[b];
  const stripes = '<i></i>'.repeat(graus||0);
  return `<span class="belt-mini" style="--bc:${x.cor}">
    <span class="bm-body"></span><span class="bm-tip">${stripes}</span><span class="bm-end"></span></span>`;
}

/* ---------------- ESTADO COMPARTILHADO (o "banco") ---------------- */
const DB = {
  role: 'aluno',                 // 'aluno' | 'professor'
  academia: { nome:'Yama Jiu-Jitsu', kanji:'山', artes:'Judô Kodokan · Kosen · Jiu-Jitsu' },
  professor: { nome:'Prof. Ricardo Maciel' },

  // >>> ponto de integração nº1: a técnica do dia é definida pelo professor
  tecnicaDoDia: {
    definida: true,
    data: '2026-06-03',
    hora: '19h',
    codigo: '0000',          // código fixo da aula exibido no totem (teste: 0000)
    nome: 'Raspagem da Borboleta',
    posicao: 'Guarda',
    posicaoEmoji: '🛡️',
    obs: 'Foco no controle dos ganchos e na entrada do underhook.',
  },

  // aluno logado
  eu: { nome:'Gabriel Tavares', nomeCompleto:'Gabriel Tavares de Jesus', apelido:'Tavares',
        iniciais:'GT', faixa:'azul', graus:2, modalidade:'Jiu-Jitsu', foto:null,
        desde:'2021-03', nascimento:1998,
        aulasGrau:{ atual:44, meta:48 },   // 44/48 — 4 para o próximo grau
        aulasGraduacao:100,                // aulas restantes para a próxima faixa
        avisos:3,
        mensalidade:{ valor:180, status:'ok', venc:'10/06' } },

  // journal pessoal (treinos do aluno)
  treinos: [
    { id:3, tipo:'tecnica', data:'2026-06-02', titulo:'Aula Técnica', tecnica:'Raspagem da borboleta + 3 rounds de randori', mood:'🔥', dia:'Ontem',
      det:{ counters:{fin:2,bat:1,rasp:3,pass:0,queda:0,esc:1}, bem:['Apliquei no rolamento','Boa defesa de guarda'], melhorar:['Faltou pressão'], nota:'Raspagem entrou limpa contra o João faixa-roxa. Underhook fez toda a diferença.' } },
    { id:2, tipo:'livre',   data:'2026-05-31', titulo:'Livre', tecnica:'Open mat — 5 rounds, foco em passagem', mood:'😊', dia:'Dom',
      det:{ counters:{fin:1,bat:2,rasp:1,pass:4,queda:1,esc:2}, bem:['Bom condicionamento'], melhorar:['Fui pego em','Cansei rápido'], nota:'Passagem toreando funcionou bem. Preciso segurar mais a pegada.' } },
    { id:1, tipo:'tecnica', data:'2026-05-30', titulo:'Aula Técnica', tecnica:'Estrangulamento pelas costas (mata-leão)', mood:'😐', dia:'Sáb',
      det:{ counters:{fin:3,bat:0,rasp:0,pass:1,queda:0,esc:0}, bem:['Aprendi a técnica'], melhorar:['Errei o timing'], nota:'Mata-leão: esconder o queixo antes de fechar. Peguei 3x no drilling.' } },
  ],

  // >>> ponto de integração nº2: graduações (professor registra, aluno vê na timeline)
  graduacoes: [
    { faixa:'azul', graus:2, tipo:'grau', data:'2026-02-15', por:'Prof. Ricardo' },
    { faixa:'azul', graus:1, tipo:'grau', data:'2025-09-10', por:'Prof. Ricardo' },
    { faixa:'azul', graus:0, tipo:'faixa', data:'2024-11-20', por:'Prof. Ricardo' },
    { faixa:'branca', graus:4, tipo:'faixa', data:'2021-03-01', por:'—' },
  ],

  // >>> ponto de integração nº3: check-in fundido ao registro do treino
  checkinHoje: { feito:false, hora:null },
  // consistência / streak semanal (S T Q Q S S D)
  semana: { feitos:2, meta:4, streakSemanas:5, dias:[true,true,false,false,false,false,false] },

  // gestão (lado professor)
  alunos: [
    { nm:'Gabriel Alves', ini:'GA', faixa:'azul', graus:2, pres:'19:32', pago:'ok', cor:'#2f8fef' },
    { nm:'Marina Costa', ini:'MC', faixa:'roxa', graus:1, pres:'19:28', pago:'ok', cor:'#7e4ddb' },
    { nm:'Pedro Henrique', ini:'PH', faixa:'branca', graus:3, pres:'19:40', pago:'late', cor:'#43b581' },
    { nm:'Lucas Ferraz', ini:'LF', faixa:'azul', graus:0, pres:null, pago:'soon', cor:'#f5a25a' },
    { nm:'Ana Beatriz', ini:'AB', faixa:'marrom', graus:2, pres:'19:35', pago:'ok', cor:'#ef5350' },
    { nm:'Rafael Souza', ini:'RS', faixa:'branca', graus:1, pres:null, pago:'late', cor:'#7a4a25' },
  ],

  // Retrospectiva "Seu ano no Jiu-Jitsu" (estilo Wrapped)
  retro: {
    ano: 2026, treinos: 142, horas: 178, novasTecnicas: 11, melhorStreak: 9,
    tecnicaTop: 'Hadaka-jime', tecnicaTopTreinos: 14,
    finBat: 2.3, pctTecnica: 70, faixaConquista: 'Azul · 2º grau',
  },

  // biblioteca pessoal de técnicas (nomenclatura japonesa · arte única, do em pé ao chão)
  tecnicas: [
    // Tachi-waza · Nage-waza (quedas / projeções)
    { jp:'O-soto-gari', pt:'Grande ceifada externa', cat:'nage', oficial:true, nivel:'treinando', treinos:8, ultima:'01 jun', ultimaRev:'2026-05-20', nota:'Desequilibrar pra trás (kuzushi), plantar o pé de apoio e ceifar a perna como um pêndulo.' },
    { jp:'O-uchi-gari', pt:'Grande ceifada interna', cat:'nage', oficial:true, nivel:'aprendendo', treinos:3, ultima:'29 mai', ultimaRev:'2026-05-29', nota:'Enganchar por dentro e empurrar na diagonal; cuidado pra não cair junto.' },
    { jp:'Seoi-nage', pt:'Projeção por sobre o ombro', cat:'nage', oficial:true, nivel:'treinando', treinos:9, ultima:'31 mai', ultimaRev:'2026-05-18', nota:'Entrar girando, quadril abaixo do dele, cotovelo preso. Puxar a manga pra cima.' },
    { jp:'Uchi-mata', pt:'Projeção por dentro da coxa', cat:'nage', oficial:true, nivel:'aprendendo', treinos:2, ultima:'15 mai', ultimaRev:'2026-05-15', nota:'Carregar o peso pra frente e levantar a coxa interna num só tempo.' },
    { jp:'Tomoe-nage', pt:'Projeção em círculo (sacrifício)', cat:'nage', oficial:true, nivel:'aprendendo', treinos:2, ultima:'12 mai', ultimaRev:'2026-05-12', nota:'Sentar sob o oponente, pé no quadril, projetar por cima da cabeça. Ponte do Kosen pro chão.' },
    // Ne-waza · Osaekomi-waza (imobilizações / controle) — oficiais do Kodokan
    { jp:'Kesa-gatame', pt:'Imobilização em echarpe', cat:'osaekomi', oficial:true, nivel:'dominada', treinos:12, ultima:'02 jun', ultimaRev:'2026-06-02', nota:'Prender cabeça e braço, quadril baixo, perna-freio atrás pra não ser rolado.' },
    { jp:'Kuzure-kesa-gatame', pt:'Echarpe modificada', cat:'osaekomi', oficial:true, nivel:'treinando', treinos:6, ultima:'30 mai', ultimaRev:'2026-05-30', nota:'Underhook no braço de longe em vez de prender a cabeça — mais estável contra a fuga.' },
    { jp:'Kata-gatame', pt:'Imobilização pelo ombro', cat:'osaekomi', oficial:true, nivel:'treinando', treinos:5, ultima:'28 mai', ultimaRev:'2026-05-28', nota:'O ombro empurra o braço contra o pescoço; junta as mãos e abre a base.' },
    { jp:'Kami-shiho-gatame', pt:'Cem quilos (norte-sul)', cat:'osaekomi', oficial:true, nivel:'treinando', treinos:7, ultima:'27 mai', ultimaRev:'2026-05-27', nota:'Pegar a cintura/faixa, peito no peito, cabeça de um lado. Andar na ponta dos pés se ele virar.' },
    { jp:'Yoko-shiho-gatame', pt:'Cem quilos cruzado (lateral)', cat:'osaekomi', oficial:true, nivel:'dominada', treinos:10, ultima:'25 mai', ultimaRev:'2026-05-25', nota:'Bloquear quadril e pescoço, pressão de peito, joelhos colados pra matar a recuperação de guarda.' },
    { jp:'Tate-shiho-gatame', pt:'Montada (cem quilos montado)', cat:'osaekomi', oficial:true, nivel:'aprendendo', treinos:3, ultima:'21 mai', ultimaRev:'2026-05-21', nota:'Ganchos por dentro, peso no peito, mãos no chão pra não ser rolado.' },
    // Ne-waza · Shime-waza (estrangulamentos)
    { jp:'Hadaka-jime', pt:'Mata-leão', cat:'shime', oficial:true, nivel:'dominada', treinos:14, ultima:'30 mai', ultimaRev:'2026-05-30', nota:'Esconder o queixo, mão de bandeira, fechar o triângulo de braços.' },
    { jp:'Okuri-eri-jime', pt:'Estrangulamento pela gola deslizante', cat:'shime', oficial:true, nivel:'treinando', treinos:5, ultima:'24 mai', ultimaRev:'2026-05-24', nota:'Pela costas: mão profunda na gola, a outra puxa a lapela oposta pra fechar.' },
    { jp:'Sankaku-jime', pt:'Triângulo', cat:'shime', oficial:true, nivel:'treinando', treinos:7, ultima:'28 mai', ultimaRev:'2026-05-16', nota:'Ângulo é tudo — sair pra fora antes de fechar a perna. Especialidade do Kosen.' },
    // Ne-waza · Kansetsu-waza (chaves articulares)
    { jp:'Juji-gatame', pt:'Chave de braço cruzada (armlock)', cat:'kansetsu', oficial:true, nivel:'treinando', treinos:8, ultima:'26 mai', ultimaRev:'2026-05-26', nota:'Prender o braço, juntar os joelhos, subir o quadril devagar pra não perder.' },
    { jp:'Ude-garami', pt:'Chave de braço dobrada (kimura/americana)', cat:'kansetsu', oficial:true, nivel:'treinando', treinos:6, ultima:'23 mai', ultimaRev:'2026-05-23', nota:'Figura-de-quatro no braço; pulso colado ao corpo e gira o ombro.' },
    { jp:'Ude-hishigi-waki-gatame', pt:'Chave de braço sob a axila', cat:'kansetsu', oficial:true, nivel:'aprendendo', treinos:2, ultima:'10 mai', ultimaRev:'2026-05-10', nota:'Prender o braço na axila e pressionar o cotovelo. Cuidado: entra rápido.' },
    // Kosen · ne-waza — guarda e jogo por baixo (não-oficial)
    { jp:'Hikikomi', pt:'Puxada para a guarda', cat:'kosen', oficial:false, nivel:'dominada', treinos:15, ultima:'02 jun', ultimaRev:'2026-06-01', nota:'Marca do Kosen: puxar direto pro chão. Pegada firme e senta já entrando com o gancho.' },
    { jp:'Hikikomi-gaeshi', pt:'Puxada com rolamento (raspagem)', cat:'kosen', oficial:false, nivel:'treinando', treinos:6, ultima:'31 mai', ultimaRev:'2026-05-17', nota:'Puxa pra guarda e usa o impulso pra rolar por cima — a raspagem clássica do Kosen.' },
    { jp:'Dō-jime', pt:'Tesoura de tronco', cat:'kosen', oficial:false, nivel:'treinando', treinos:4, ultima:'19 mai', ultimaRev:'2026-05-19', nota:'Comprime o tronco com as pernas. Proibido no judô esportivo, vivo no ne-waza Kosen.' },
    { jp:'Ashi-garami', pt:'Entrelaçamento de pernas (chave de perna)', cat:'kosen', oficial:false, nivel:'aprendendo', treinos:3, ultima:'22 mai', ultimaRev:'2026-05-13', nota:'Enrosca a perna e controla o joelho/tornozelo. O Kosen explora muito o que o judô esportivo baniu.' },
    { jp:'Kani-basami', pt:'Tesoura voadora', cat:'kosen', oficial:false, nivel:'aprendendo', treinos:2, ultima:'14 mai', ultimaRev:'2026-05-14', nota:'Derruba prendendo o corpo entre as pernas como uma tesoura. Clássico do Kosen, hoje banido no judô.' },
    { jp:'Obi-tori-gaeshi', pt:'Inversão pegando a faixa', cat:'kosen', oficial:false, nivel:'treinando', treinos:5, ultima:'27 mai', ultimaRev:'2026-05-24', nota:'Agarra a faixa/cintura por baixo e inverte a posição. Entrada de ne-waza pra pegar as costas.' },
    { jp:'Niju-garami', pt:'Duplo entrelaçamento de pernas', cat:'kosen', oficial:false, nivel:'aprendendo', treinos:2, ultima:'16 mai', ultimaRev:'2026-05-11', nota:'Entrelaça as duas pernas pra controlar quadril e perna do oponente. Controle de guarda clássico do Kosen.' },
    { jp:'Tawara-gaeshi', pt:'Inversão "fardo de arroz"', cat:'kosen', oficial:false, nivel:'treinando', treinos:4, ultima:'23 mai', ultimaRev:'2026-05-18', nota:'Defendendo por baixo, abraça o tronco e rola o oponente por cima da cabeça como um saco. Virada de ne-waza.' },
    { jp:'Tate-sankaku', pt:'Triângulo montado', cat:'kosen', oficial:false, nivel:'treinando', treinos:6, ultima:'29 mai', ultimaRev:'2026-05-21', nota:'Sankaku por cima, controlando da montada. Posição de domínio muito explorada no ne-waza Kosen.' },
    { jp:'Sangaku-garami', pt:'Controle de triângulo (braço-perna)', cat:'kosen', oficial:false, nivel:'aprendendo', treinos:2, ultima:'12 mai', ultimaRev:'2026-05-12', nota:'Entrelaça perna e braço num triângulo de controle pra preparar a finalização. Transição típica do Kosen.' },
  ],

  // Sistemas de jogo — técnicas conectadas no seu jogo (do controle à finalização)
  sistemas: [
    { nome:'Guarda → finalização', emoji:'🛡️', cor:'#2f8fef', desc:'Seu jogo por baixo, do puxar à chave.',
      passos:[ {t:'Hikikomi', d:'puxa pra guarda'}, {t:'Dō-jime', d:'controla o tronco'}, {t:'Juji-gatame', d:'finaliza no braço'} ] },
    { nome:'Pressão por cima', emoji:'⬇️', cor:'#ef5350', desc:'Passou, controlou, estrangulou.',
      passos:[ {t:'Yoko-shiho-gatame', d:'cem quilos lateral'}, {t:'Kami-shiho-gatame', d:'norte-sul'}, {t:'Hadaka-jime', d:'pega as costas'} ] },
    { nome:'Em pé → chão (Kosen)', emoji:'⬆️', cor:'#43b581', desc:'Da queda direto pro ataque no solo.',
      passos:[ {t:'O-soto-gari', d:'derruba'}, {t:'Tate-shiho-gatame', d:'monta'}, {t:'Ude-garami', d:'chaveia'} ] },
  ],

  // Notas rápidas (insights soltos, sem formulário)
  notas: [
    { id:1, data:'2026-06-01', texto:'Lembrar de manter o cotovelo colado no juji-gatame, sempre perco quando abro.' },
  ],

  // Lesões (registrar e acompanhar)
  lesoes: [
    { id:1, parte:'Joelho direito', data:'2026-05-10', status:'recuperando', nota:'Torci numa raspagem. Evitar leglock por 3 semanas.' },
  ],

  // Centro de notificações
  notificacoes: [
    { id:1, ic:'🥋', txt:'Técnica do dia definida: Raspagem da Borboleta', data:'2026-06-03' },
    { id:2, ic:'⭐', txt:'Você está a 4 aulas do 3º grau!', data:'2026-06-02' },
    { id:3, ic:'💳', txt:'Mensalidade vence dia 10/06', data:'2026-06-01' },
  ],

  // loja da academia (retirada na recepção, sem frete)
  loja: {
    cat: 'Todos',
    carrinho: [],   // { id, tam, qtd }
    produtos: [
      { id:1, nome:'Kimono Yama Trançado', cat:'Kimonos', preco:489, emoji:'🥋', cor:'#eaf4fe', desc:'Trançado 350g, gola EVA, bordados Yama. Pré-encolhido.', tam:['A1','A2','A3','A4'] },
      { id:2, nome:'Kimono Infantil Yama', cat:'Kimonos', preco:289, emoji:'🥋', cor:'#e7f6ef', desc:'Leve e resistente para os pequenos guerreiros.', tam:['M0','M1','M2','M3'] },
      { id:3, nome:'Rashguard Yama Preta', cat:'Vestuário', preco:149, emoji:'👕', cor:'#f0f0f2', desc:'Manga longa, tecido de compressão com proteção UV.', tam:['P','M','G','GG'] },
      { id:4, nome:'Camiseta Yama Logo', cat:'Vestuário', preco:79, emoji:'👕', cor:'#fdecec', desc:'Algodão premium com a estampa do kanji 山.', tam:['P','M','G','GG'] },
      { id:5, nome:'Moletom Yama', cat:'Vestuário', preco:199, emoji:'🧥', cor:'#fef7e0', desc:'Capuz, felpado por dentro, ideal pós-treino.', tam:['P','M','G','GG'] },
      { id:6, nome:'Faixa Azul Yama', cat:'Acessórios', preco:89, emoji:'🟦', cor:'#eaf4fe', desc:'100% algodão, costura reforçada, ponta preta.', tam:['A1','A2','A3','A4'] },
      { id:7, nome:'Protetor Bucal', cat:'Acessórios', preco:45, emoji:'🦷', cor:'#f0f0f2', desc:'Moldável, com estojo higiênico incluso.', tam:['Único'] },
      { id:8, nome:'Mochila Yama', cat:'Acessórios', preco:169, emoji:'🎒', cor:'#e7f6ef', desc:'Compartimento separado para kimono molhado.', tam:['Único'] },
    ],
  },

  // metas pessoais (removido)

  // nav atual de cada perfil
  navAluno: 'inicio',
  navProf: 'painel',
  jogoTab: 'progresso',     // Tatame: progresso | biblioteca | analise
  registro: { randori:null, nota:'', mood:null },  // sessão de registro (aba Renshū = botão +)
  jornadaTab: 'historico', // Jornada: historico | frequencia | graduacao
  histPeriodo: 'ano',    // Histórico: semana | mes | ano
  onboarded: true,       // false força a tela de boas-vindas (1ª vez)
  sbUser:    null,       // { id, email } do usuário Supabase autenticado
  authOpen:  false,      // true → mostra tela de login/signup
  authTab:   'login',    // 'login' | 'signup'
};
const isHoje = (s) => s === HOJE_ISO;

/* ============================================================
   MIGRAÇÃO — modelo de dados unificado (Etapa 1 da fusão Tatame+Renshū)
   Aditivo: cada técnica ganha `estado` (foco|arma|guardada|aprendida) e
   `dias[]` (histórico diário de 30 dias) · DB.links substitui DB.sistemas.
   ============================================================ */
const FOCO_INICIAL = ['Sankaku-jime','Hikikomi-gaeshi','Niju-garami']; // máx 3 em treino
const _WD = ['dom','seg','ter','qua','qui','sex','sáb'];
function gerarDias(t){
  const base  = t.nivel==='dominada'?64 : t.nivel==='treinando'?40 : 18;
  const slope = t.nivel==='dominada'?0.4 : t.nivel==='treinando'?1.1 : 0.7;
  const ph = (t.jp||'').length;            // varia o ruído por técnica
  const out=[];
  for(let i=0;i<30;i++){
    let r = base + slope*i + Math.sin(i*1.6+ph)*8;
    r = Math.max(0, Math.min(100, Math.round(r)));
    out.push({ a:Math.round(8*r/100), t:8, dia:_WD[(i+1)%7] });
  }
  return out;
}
DB.tecnicas.forEach(t=>{
  t.estado = FOCO_INICIAL.includes(t.jp) ? 'foco' : (t.nivel==='dominada' ? 'arma' : 'aprendida');
  if(!t.dias) t.dias = DEMO ? gerarDias(t) : [];
  if(t.hojeT==null){ t.hojeT=0; t.hojeA=0; }
});
DB.links = [];
DB.sistemas.forEach(s=>{ for(let i=0;i<s.passos.length-1;i++) DB.links.push({ de:s.passos[i].t, para:s.passos[i+1].t }); });
DB.analytics = DB.analytics || { events:[] };

/* ============================================================
   PERSISTÊNCIA — localStorage (versionada, migration-safe)
   Catálogo (técnicas/sistemas/loja) vem SEMPRE do código; só o
   estado-de-usuário é salvo. Progresso por técnica é guardado num
   mapa keyed por `jp` e re-aplicado no catálogo no boot — assim dá
   pra editar o currículo durante o beta sem zerar o diário do aluno.
   ============================================================ */
const STORE_KEY = 'yama.v1';
const SCHEMA = 1;
// >>> EDITAR: canal de feedback dos testers. WhatsApp (https://wa.me/55DDDNUMERO) ou e-mail (mailto:voce@exemplo.com)
const _FB = [53,31,99,62,48,90,9]; const FEEDBACK_URL = 'https://wa.me/'+_FB.join('')+'?text=';
// DEMO já definido no topo (vitrine ?demo=1)
// chaves de DB que pertencem ao usuário (persistidas)
const USER_KEYS = ['eu','treinos','graduacoes','checkinHoje','semana','notas','lesoes','notificacoes','retro','analytics'];
// campos de progresso pessoal por técnica
const TEC_PROG = ['estado','dias','hojeA','hojeT','treinos','ultima','ultimaRev','nota','nivel'];

function _hasStorage(){ try{ const k='__y'; localStorage.setItem(k,'1'); localStorage.removeItem(k); return true; }catch(e){ return false; } }
const STORAGE_OK = _hasStorage();

function save(){
  if(!STORAGE_OK) return;
  try{
    const data = { __schema:SCHEMA, onboarded:DB.onboarded, _ultimoDia:HOJE_ISO };
    USER_KEYS.forEach(k=>{ data[k]=DB[k]; });
    data.tecProg = {};
    DB.tecnicas.forEach(t=>{ const p={}; TEC_PROG.forEach(f=>{ p[f]=t[f]; }); data.tecProg[t.jp]=p; });
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  }catch(e){ if(e.name==='QuotaExceededError') toast('⚠️ Armazenamento cheio — exporte seus dados'); }
  if(DB.sbUser && !DEMO && typeof sbSync!=='undefined') sbSync.pushAll();
}
let _saveT=null;
function scheduleSave(){ if(!STORAGE_OK) return; clearTimeout(_saveT); _saveT=setTimeout(save,1200); }

function load(){
  if(!STORAGE_OK) return false;
  let data; try{ const raw=localStorage.getItem(STORE_KEY); if(!raw) return false; data=JSON.parse(raw); }catch(e){ return false; }
  if(!data || typeof data!=='object') return false;
  try{
    if(data.treinos && !Array.isArray(data.treinos)) return false;
    if(data.eu && typeof data.eu!=='object') return false;
    if(data.__schema && data.__schema > SCHEMA) return false;
    USER_KEYS.forEach(k=>{ if(data[k]!=null) DB[k]=data[k]; });
    if(data.tecProg) DB.tecnicas.forEach(t=>{ const p=data.tecProg[t.jp]; if(p) TEC_PROG.forEach(f=>{ if(p[f]!=null) t[f]=p[f]; }); });
    const MOOD_TO_FEEL={'😣':1,'😐':2,'😊':4,'🔥':5};
    DB.treinos.forEach(t=>{ if(!t.feel && t.mood && MOOD_TO_FEEL[t.mood]){ t.feel=MOOD_TO_FEEL[t.mood]; } });
    DB.onboarded = !!data.onboarded;
    _resetDiario(data._ultimoDia);
  }catch(e){ return false; }
  return true;
}

function _resetDiario(ultimoDia){
  if(ultimoDia === HOJE_ISO) return;
  DB.checkinHoje = { feito:false, hora:null };
  DB.tecnicas.forEach(t=>{ t.hojeA=0; t.hojeT=0; });
}

// estado inicial de um aluno novo: mantém o CATÁLOGO, zera o diário pessoal
function aplicarCleanSlate(){
  DB.treinos=[]; DB.notas=[]; DB.lesoes=[]; DB.notificacoes=[];
  DB.semana={ feitos:0, meta:4, streakSemanas:0, dias:[false,false,false,false,false,false,false] };
  DB.checkinHoje={ feito:false, hora:null };
  DB.graduacoes=[];
  DB.eu = Object.assign({}, DB.eu, { nome:'', nomeCompleto:'', apelido:'Atleta', iniciais:'A', faixa:'branca', graus:0, foto:null, desde:'2026-06', nascimento:null, aulasGrau:{atual:0,meta:40}, aulasGraduacao:160, avisos:0, mensalidade:{valor:0,status:'ok',venc:'—'} });
  // técnicas: zera progresso, preserva catálogo (jp/pt/cat/oficial) + nota (dica de aula)
  DB.tecnicas.forEach(t=>{ t.estado='aprendida'; t.dias=[]; t.hojeA=0; t.hojeT=0; t.treinos=0; t.ultima='—'; t.ultimaRev=null; });
  DB.analytics = { events:[] };
}

/* ============================================================
   ANALYTICS + ERROS — 100% local e exportável (sem backend).
   Os eventos viajam dentro do "Exportar dados" → você agrega os 5 testers.
   ============================================================ */
function track(e, props){
  if (DEMO) return;                       // vitrine não gera métrica
  if (!DB.analytics) DB.analytics = { events:[] };
  const ev = Object.assign({ t:new Date().toISOString(), e }, props||{});
  DB.analytics.events.push(ev);
  if (DB.analytics.events.length > 1000) DB.analytics.events.splice(0, DB.analytics.events.length-1000);
  if (typeof scheduleSave === 'function') scheduleSave();
  if (DB.sbUser && typeof sbSync!=='undefined') sbSync.trackEvent(e, props||{});
}
// captura de erros do cliente → entram como evento 'erro' (monitoramento sem servidor)
(function(){
  try{
    window.addEventListener('error', (ev)=>{ try{ track('erro', { msg:String((ev&&(ev.message||ev.error))||'').slice(0,240), src:String((ev&&ev.filename)||'').split('/').pop(), ln:ev&&ev.lineno }); }catch(_){} });
    window.addEventListener('unhandledrejection', (ev)=>{ try{ track('erro', { msg:('promise: '+String((ev&&ev.reason&&ev.reason.message)||(ev&&ev.reason)||'')).slice(0,240) }); }catch(_){} });
  }catch(_){}
})();
// KPIs do beta derivados dos eventos + treinos (ativação · funil · retenção · engajamento · churn)
function betaKPIs(){
  const ev = (DB.analytics&&DB.analytics.events)||[];
  const opens = ev.filter(x=>x.e==='app_open');
  const erros = ev.filter(x=>x.e==='erro');
  const diasAtivos = [...new Set(ev.map(x=>(x.t||'').slice(0,10)).filter(Boolean))].sort();
  const primeiroDia = diasAtivos[0]||null;
  const treinos = (DB.treinos||[]).length;
  const funil = {
    abriu: opens.length>0 || !!primeiroDia,
    onboarding: ev.some(x=>x.e==='onboarding_done') || !!DB.onboarded,
    treino1: treinos>=1, treino3: treinos>=3,
    compartilhou: ev.some(x=>x.e==='share_aberto')
  };
  const dnum = (iso)=>{ const p=iso.split('-').map(Number); return Date.UTC(p[0],p[1]-1,p[2])/86400000; };
  let d1=false, d7=false;
  if(primeiroDia){ const base=dnum(primeiroDia); diasAtivos.forEach(d=>{ const k=dnum(d)-base; if(k===1) d1=true; if(k>=1&&k<=7) d7=true; }); }
  const porSemana = (typeof paceSemanal==='function') ? Math.round(paceSemanal()*10)/10 : 0;
  const ultTreino = (DB.treinos&&DB.treinos[0]) ? DB.treinos[0].data : null;
  const diasSemTreinar = ultTreino ? diasEntre(ultTreino) : null;
  return {
    ativado: funil.treino1, diasAtivos: diasAtivos.length, sessoes: opens.length,
    treinos, treinosPorSemana: porSemana, streak: (DB.semana&&DB.semana.streakSemanas)||0,
    retencaoD1: d1, retencaoD7: d7, diasSemTreinar, funil, erros: erros.length, eventos: ev.length
  };
}
// painel "Métricas do beta" (transparência p/ o tester + vai no export p/ você agregar)
function abrirMetricas(){
  const k = betaKPIs(), f = k.funil, yn=(b)=> b?'✅':'—';
  const sheet = el(`<div class="sheet-overlay"><div class="sheet sheet-scroll">
    <div class="sheet-grip"></div>
    <div class="sheet-title">📈 Métricas do beta</div>
    <div class="kpis block">
      <div class="kpi"><div class="v red">${k.treinos}</div><div class="l">Treinos</div></div>
      <div class="kpi"><div class="v blue">${k.diasAtivos}</div><div class="l">Dias ativos</div></div>
      <div class="kpi"><div class="v green">${k.treinosPorSemana}</div><div class="l">Treinos/sem</div></div>
    </div>
    <div class="mt-list">
      <div class="mt-row"><span>Ativado (1º treino)</span><b>${yn(k.ativado)}</b></div>
      <div class="mt-row"><span>Voltou no dia seguinte (D1)</span><b>${yn(k.retencaoD1)}</b></div>
      <div class="mt-row"><span>Ativo na 1ª semana (D7)</span><b>${yn(k.retencaoD7)}</b></div>
      <div class="mt-row"><span>Streak</span><b>${plural(k.streak,'semana','semanas')}</b></div>
      <div class="mt-row"><span>Dias sem treinar</span><b>${k.diasSemTreinar==null?'—':k.diasSemTreinar}</b></div>
      <div class="mt-row"><span>Erros capturados</span><b>${k.erros}</b></div>
    </div>
    <div class="sec-title" style="margin:10px 0 0">Funil</div>
    <div class="mt-list">
      <div class="mt-row"><span>Abriu o app</span><b>${yn(f.abriu)}</b></div>
      <div class="mt-row"><span>Concluiu onboarding</span><b>${yn(f.onboarding)}</b></div>
      <div class="mt-row"><span>1º treino</span><b>${yn(f.treino1)}</b></div>
      <div class="mt-row"><span>3º treino</span><b>${yn(f.treino3)}</b></div>
      <div class="mt-row"><span>Compartilhou</span><b>${yn(f.compartilhou)}</b></div>
    </div>
    <div class="cfg-note">Ficam só no seu aparelho e vão no "Exportar dados" — é assim que acompanhamos o beta, sem servidor.</div>
    <button class="sheet-cancel" id="mt-close">Fechar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#mt-close').onclick=close;
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

/* ============================================================
   RENSHŪ — helpers compartilhados (Registrar · Progresso)
   "Deu certo / Não deu certo" por técnica em foco → taxa de acerto.
   ============================================================ */
const META_CAP = 70;                                  // teto da linha de meta
const _media = (arr)=> arr.length ? arr.reduce((s,x)=>s+x,0)/arr.length : 0;
const _pctAT = (a,t)=> t>0 ? Math.round(a/t*100) : 0;
function focoTecnicas(){ return DB.tecnicas.filter(t=>t.estado==='foco'); }
function totaisTec(t){ const d=t.dias||[]; const T=d.reduce((s,x)=>s+x.t,0), A=d.reduce((s,x)=>s+x.a,0); return {T,A,p:_pctAT(A,T)}; }
function corPct(p){ return p>=60 ? 'var(--good)' : 'var(--muted)'; }
// nível DINÂMICO a partir dos treinos reais (0 treino = 'novo' = só catálogo)
function nivelDe(t){ const n=t.treinos||0; if(n>=12) return 'dominada'; if(n>=5) return 'treinando'; if(n>=1) return 'aprendendo'; return 'novo'; }
function ratesDe(t){ return (t.dias||[]).map(d=>_pctAT(d.a,d.t)); }
// linha de meta = média de acerto das técnicas em foco + armas, travada no teto
function metaLinha(){
  const vals = DB.tecnicas.filter(t=>t.estado==='foco'||t.estado==='arma').map(t=>totaisTec(t).p);
  return Math.min(META_CAP, Math.round(_media(vals)));
}

/* ---- contadores do dia: vivem em t.hojeA / t.hojeT (persistem até salvar) ---- */
function _updateStepperUI(jp){
  const card=document.querySelector(`.rs-pcard[data-jp="${jp}"]`); if(!card) return;
  const t=DB.tecnicas.find(x=>x.jp===jp); if(!t) return;
  const errou=(t.hojeT||0)-(t.hojeA||0);
  const ackB=card.querySelector('[data-act="a+"]'); if(ackB) ackB.previousElementSibling.textContent=t.hojeA||0;
  const errB=card.querySelector('[data-act="e+"]'); if(errB) errB.previousElementSibling.textContent=errou;
  const rst=card.querySelector('[data-act="limpar"]');
  if((t.hojeT||0)>0 && !rst){ const b=el(`<button class="rs-reset" data-act="limpar">limpar</button>`); b.onclick=()=>rtLimpar(jp); card.querySelector('.rs-acts').appendChild(b); }
  if((t.hojeT||0)===0 && rst) rst.remove();
}
function rtAck(jp,d){ const t=DB.tecnicas.find(x=>x.jp===jp); if(!t) return; if(d>0){ t.hojeA=(t.hojeA||0)+1; t.hojeT=(t.hojeT||0)+1; } else if(t.hojeA>0){ t.hojeA--; t.hojeT--; } _updateStepperUI(jp); }
function rtErr(jp,d){ const t=DB.tecnicas.find(x=>x.jp===jp); if(!t) return; if(d>0){ t.hojeT=(t.hojeT||0)+1; } else if((t.hojeT||0)-(t.hojeA||0)>0){ t.hojeT--; } _updateStepperUI(jp); }
function rtLimpar(jp){ const t=DB.tecnicas.find(x=>x.jp===jp); if(t){ t.hojeA=0; t.hojeT=0; } _updateStepperUI(jp); }

// cartão Renshū de uma técnica (nome + tradução PT + Deu certo/Não deu)
function renshuCardNode(t){
  const errou=(t.hojeT||0)-(t.hojeA||0);
  const card=el(`<div class="rs-pcard" data-jp="${t.jp}">
    <div class="rs-top"><div class="rs-nm-wrap"><span class="rs-name">${t.jp}</span><div class="rs-sub">${t.pt||''}</div></div>
      <div class="rs-acts">${(t.hojeT||0)>0?`<button class="rs-reset" data-act="limpar">limpar</button>`:''}</div></div>
    <div class="rs-row ok"><span>Deu certo!</span>
      <div class="rs-stepper"><button data-act="a-">−</button><b>${t.hojeA||0}</b><button class="plus" data-act="a+">＋</button></div></div>
    <div class="rs-row no"><span>Não deu certo</span>
      <div class="rs-stepper"><button data-act="e-">−</button><b>${errou}</b><button class="plus" data-act="e+">＋</button></div></div>
  </div>`);
  card.querySelector('[data-act="a+"]').onclick=()=>rtAck(t.jp,1);
  card.querySelector('[data-act="a-"]').onclick=()=>rtAck(t.jp,-1);
  card.querySelector('[data-act="e+"]').onclick=()=>rtErr(t.jp,1);
  card.querySelector('[data-act="e-"]').onclick=()=>rtErr(t.jp,-1);
  const lim=card.querySelector('[data-act="limpar"]'); if(lim) lim.onclick=()=>rtLimpar(t.jp);
  return card;
}

// CORPO COMPARTILHADO do registro — idêntico na aba Renshū e no botão + (registrar)
function registroBody(){
  const reg = DB.registro;
  const wrap = el('<div class="registro-body"></div>');
  // 1) primeira pergunta: fez randori? (na aula técnica o aluno pode não rolar e ir embora)
  const segR = el(`<div class="fsec">
    <div class="fsec-title"><span class="ico">🤼</span> Fez randori hoje?</div>
    <div class="seg">
      <button class="${reg.randori===false?'active':''}" data-r="no">Não fiz</button>
      <button class="${reg.randori===true?'active':''}" data-r="yes">Fiz randori</button>
    </div>
  </div>`);
  segR.querySelector('[data-r="no"]').onclick=()=>{ reg.randori=false; _autosaveDraft(); render(); };
  segR.querySelector('[data-r="yes"]').onclick=()=>{ reg.randori=true; _autosaveDraft(); render(); };
  wrap.appendChild(segR);
  // 2) Renshū — só aparece se fez randori
  if(reg.randori===true){
    const focos=focoTecnicas();
    if(focos.length){
      const avg=Math.round(_media(focos.map(t=>totaisTec(t).p)));
      wrap.appendChild(el(`<div class="rz-card">
        <div class="rz-head"><span class="rz-lab">Em treino · ${focos.length}</span><span class="rz-avg">${avg}% acerto médio</span></div>
        ${focos.map(t=>{const{p}=totaisTec(t);return `<div class="rz-item"><span class="rz-nm">${t.jp}</span><div class="rz-bar"><span style="width:${p}%;background:${corPct(p)}"></span></div><span class="rz-pct" style="color:${corPct(p)}">${p}%</span></div>`;}).join('')}
      </div>`));
      wrap.appendChild(el(`<div class="fsec-title"><span class="ico">🎯</span> O que deu certo no rolê?</div>`));
      focos.forEach(t=> wrap.appendChild(renshuCardNode(t)));
    } else {
      wrap.appendChild(el(`<div class="rs-empty-foco">Nenhuma técnica em foco. Escolha as técnicas que vai treinar na aba <b>Progresso</b>.</div>`));
    }
  }
  // 3) nota rápida — sempre visível, opcional
  const notaSec=el(`<div class="fsec">
    <div class="fsec-title"><span class="ico">📝</span> Nota rápida <small>(opcional)</small></div>
    <textarea class="ta" id="reg-nota" placeholder="Algo que queira lembrar do treino…">${reg.nota||''}</textarea>
  </div>`);
  notaSec.querySelector('#reg-nota').oninput=(e)=>{ reg.nota=e.target.value; _autosaveDraft(); };
  wrap.appendChild(notaSec);
  // 4) Como foi o treino? — escala 1–5 (obrigatório, sem emoji)
  const feelSec=el(`<div class="fsec">
    <div class="fsec-title"><span class="ico">📊</span> Como foi o treino? <small>obrigatório</small></div>
    <div class="feel-scale">${[1,2,3,4,5].map(n=>`<button class="feel-btn ${reg.mood===n?'on lvl'+n:''}" data-n="${n}">${n}</button>`).join('')}</div>
    <div class="feel-ends"><span>Muito difícil</span><span>Excelente</span></div>
    <div class="feel-cap">${reg.mood?FEEL_LABEL[reg.mood]:'Avalie de 1 a 5'}</div>
  </div>`);
  const fcap=feelSec.querySelector('.feel-cap');
  feelSec.querySelectorAll('.feel-btn').forEach(b=>{ b.onclick=()=>{ reg.mood=+b.dataset.n;
    feelSec.querySelectorAll('.feel-btn').forEach(x=>{ x.classList.remove('on'); x.className='feel-btn'; });
    b.className='feel-btn on lvl'+reg.mood; fcap.textContent=FEEL_LABEL[reg.mood]; _autosaveDraft(); }; });
  wrap.appendChild(feelSec);
  return wrap;
}

// salvar — único, usado pela aba Renshū e pelo botão +
let _salvarLock=false;
function salvar(){
  if(_salvarLock) return; _salvarLock=true; setTimeout(()=>{ _salvarLock=false; }, 1500);
  const reg = DB.registro;
  if(reg.randori===null){ toast('Você fez randori hoje?'); return; }
  if(!reg.mood){ toast('Avalie como foi o treino (1–5)'); return; }
  const today=_WD[hoje.getDay()];
  const reps = reg.randori ? focoTecnicas().filter(t=>(t.hojeT||0)>0) : [];
  const det = { randori:reg.randori, renshu:reps.map(t=>({jp:t.jp,a:t.hojeA||0,t:t.hojeT})), nota:(reg.nota||'').trim(), feel:reg.mood };
  reps.forEach(t=>{
    t.dias=t.dias||[]; const last=t.dias[t.dias.length-1];
    if(last&&last.hoje){ last.a+=(t.hojeA||0); last.t+=t.hojeT; }
    else { t.dias.push({a:t.hojeA||0,t:t.hojeT,dia:today,hoje:true}); if(t.dias.length>30) t.dias.shift(); }
    t.treinos=(t.treinos||0)+1; t.ultima='hoje'; t.ultimaRev=HOJE_ISO;
    t.hojeA=0; t.hojeT=0;
  });
  if(!DB.checkinHoje.feito){
    DB.checkinHoje={feito:true,hora:new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})};
  } // semana/streak são recalculados em atualizarSemana()
  const aula=aulaDoDia();
  const novoId = Date.now();
  const tecLabel = reps.length ? ('Renshū · '+det.renshu.map(r=>r.jp).join(', ')) : (reg.randori?'Treino com randori':'Treino (sem randori)');
  DB.treinos.unshift({ id:novoId, tipo:aula.tipo, data:HOJE_ISO, titulo:aula.label, tecnica:tecLabel, mood:FEEL_LABEL[reg.mood], feel:reg.mood, det });
  track('treino_registrado', { randori:reg.randori, tecnicas:reps.length, feel:reg.mood, total:DB.treinos.length });
  DB.registro = { randori:null, nota:'', mood:null };
  _clearDraft();
  // volta para Home com toast sutil (share via detalhe do treino)
  DB.flow=null; DB.navAluno='inicio';
  render(); toast('Treino salvo ✔');
}

// tirar uma técnica do foco (guarda na biblioteca, sem apagar histórico)
function rsRemoverFoco(jp){
  const t = DB.tecnicas.find(x=>x.jp===jp); if(!t) return;
  const sheet = el(`<div class="sheet-overlay"><div class="sheet">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Tirar do foco?</div>
    <div class="sheet-desc">Você para de praticar <b>"${t.jp}"</b>, mas ela fica guardada na <b>Biblioteca</b> pra voltar quando quiser. O histórico não é apagado.</div>
    <button class="btn-save" id="rs-confirm">Tirar do foco</button>
    <button class="sheet-cancel" id="rs-cancel">Cancelar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#rs-cancel').onclick=close;
  sheet.querySelector('#rs-confirm').onclick=()=>{ t.estado='guardada'; sheet.remove(); render(); toast('Guardada na Biblioteca'); };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

// colocar uma técnica da biblioteca no foco (máx 3)
function rsAddFoco(){
  if(focoTecnicas().length>=3){ toast('Máximo de 3 em treino'); return; }
  const cands = DB.tecnicas.map((t,i)=>({t,i})).filter(x=>x.t.estado!=='foco')
    .sort((a,b)=>(b.t.treinos||0)-(a.t.treinos||0));
  const sheet = el(`<div class="sheet-overlay"><div class="sheet">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Praticar qual técnica?</div>
    <div class="sheet-desc">Ela entra no seu Renshū — você passa a contar acertos a cada treino.</div>
    <div class="rs-picklist" id="rs-picklist"></div>
    <button class="sheet-cancel" id="rs-pick-cancel">Cancelar</button>
  </div></div>`);
  const list = sheet.querySelector('#rs-picklist');
  cands.forEach(({t})=>{
    const row = el(`<div class="rs-pick"><div class="rs-pk-tx"><div class="tn">${t.jp}</div><div class="ts">${t.pt||''} · ${plural(t.treinos||0,'treino','treinos')}</div></div><span class="rs-pk-go">＋</span></div>`);
    row.onclick=()=>{ t.estado='foco'; track('foco_add',{jp:t.jp}); sheet.remove(); render(); toast('No foco — bora praticar'); };
    list.appendChild(row);
  });
  if(!cands.length) list.appendChild(el(`<div class="rs-empty-foco">Todas as técnicas já estão no foco.</div>`));
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#rs-pick-cancel').onclick=close;
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

/* ============================================================
   ROTEADOR
   ============================================================ */
function render(){
  if (!DEMO) atualizarSemana();        // semana/streak sempre derivados dos treinos reais
  const root = $('#root');
  root.innerHTML = '';
  /* auth desabilitado — implementação futura */
  if (DB.onboardingOpen){ root.appendChild(renderOnboarding()); return; }
  if (DB.retroOpen){ root.appendChild(renderRetro()); return; }
  // renderPresenca removido do roteador — presença agora é parte do flow unificado
  if (DB.lojaOpen){ root.appendChild(renderLoja()); return; }
  if (DB.shareOpen){ root.appendChild(renderShare()); return; }
  if (DB.treinoAberto){ root.appendChild(renderTreinoDetalhe()); return; }
  if (DB.flow){ root.appendChild(renderFlow(DB.flow)); return; }
  if (DB.role === 'aluno') root.appendChild(renderAluno());
  else root.appendChild(renderProfessor());
}

/* ---------------- topbar comum ---------------- */
function topbar(sub){
  return `<div class="topbar">
    <div class="academy"><img src="logo.png?v=2" onerror="this.onerror=null;this.src='yama-logo.png?v=2'" alt="${DB.academia.nome}"></div>
    <div class="tb-info"><div class="nm">${DB.academia.nome}</div>${sub?`<div class="sub">${sub}</div>`:''}</div>
    ${DB.sbUser?`<span id="sync-dot" class="sync-dot sync-ok" title="Sincronizado com a nuvem"></span>`:''}
  </div>`;
}
function roleSeg(){
  return `<div class="role-seg">
    <button class="${DB.role==='aluno'?'active':''}" onclick="setRole('aluno')">👤 Aluno</button>
    <button class="${DB.role==='professor'?'active':''}" onclick="setRole('professor')">🥋 Professor</button>
  </div>`;
}

/* ============================================================
   PERFIL ALUNO
   ============================================================ */
function renderAluno(){
  const v = el(`<div class="view"></div>`);
  const nav = DB.navAluno;
  const body = el('<div></div>');
  if (nav==='inicio'){
    body.appendChild(alunoInicio());
  } else {
    body.innerHTML = topbar('');
    if (nav==='jogo')    body.appendChild(alunoMeuJogo());
    if (nav==='jornada') body.appendChild(alunoJornada());
    if (nav==='perfil')  body.appendChild(alunoPerfil());
  }
  v.appendChild(body);
  v.appendChild(tabbarAluno());
  return v;
}

function alunoInicio(){
  const w = el('<div></div>');
  const me = DB.eu;

  // ---- Cabeçalho Kanri: logo da academia + foto personalizável + nome ----
  const sz = me.fotoSize || 90;
  const head = el(`<div class="kanri-head">
    <div class="kh-bell bell" role="button" tabindex="0" aria-label="Notificações">🔔${me.avisos>0?`<span class="bell-badge">${me.avisos}</span>`:''}</div>
    <div class="hero-bg">
      <img class="kanri-logo" src="logo.png?v=2" onerror="this.onerror=null;this.src='yama-logo.png?v=2'" alt="Yama Jiu-Jitsu">
    </div>
    <div class="kh-divider"></div>
    <div class="profile-photo" style="width:${sz}px;height:${sz}px;margin-top:${-Math.round(sz/2)}px;font-size:${Math.round(sz*0.34)}px">
      <span class="pp-ini">${me.iniciais}</span>
      <img src="${me.foto||''}" onerror="this.remove()" alt="">
    </div>
    <div class="profile-name">${me.nomeCompleto && me.nomeCompleto!==me.apelido ? safeTxt(me.nomeCompleto)+' | ' : ''}${safeTxt(me.apelido)}</div>
  </div>`);
  head.querySelector('.kh-bell').onclick = ()=> abrirNotificacoes();
  w.appendChild(head);

  // ---- Faixa / progresso compacto (ACIMA do registrar) — DINÂMICO ----
  const metaG = me.aulasGrau.meta||40;
  const atualG = DEMO ? me.aulasGrau.atual : Math.min(metaG, DB.treinos.length + (me.aulasGrau.base||0));
  const pctGrau = Math.round(atualG / metaG * 100);
  const faltam = Math.max(0, metaG - atualG);
  const prog = el(`<div class="prog-mini">
    <div class="pm-top">
      <div class="pm-belt">${beltMini(me.faixa, me.graus)}</div>
      <span class="pm-num">${atualG}/${metaG}</span>
    </div>
    <div class="mini-bar"><span style="width:${pctGrau}%"></span></div>
    <div class="pm-foot">${plural(faltam,'aula','aulas')} para o ${me.graus+1}º grau →</div>
  </div>`);
  prog.onclick = ()=>{ DB.jornadaTab='graduacao'; goAluno('jornada'); };
  w.appendChild(prog);

  // ---- Selo de consistência (streak) leve, abaixo da faixa ----
  w.appendChild(streakBadge());

  // ---- 🎯 Foco atual: o que você está trabalhando agora ----
  // resumo do que estou praticando (espelha o Renshū: estado==='foco')
  const focosHome = focoTecnicas();
  if (focosHome.length){
    const foco = el(`<div class="foco-card">
      <div class="foco-top"><span class="foco-ic">🎯</span>
        <span class="foco-lbl">Trabalhando em</span></div>
      <div class="foco-chips">${focosHome.map(t=>`<span class="foco-chip">${t.jp}</span>`).join('')}</div>
    </div>`);
    foco.querySelectorAll('.foco-chip').forEach(c=> c.onclick = ()=>{ DB.navAluno='jogo'; DB.jogoTab='progresso'; render(); });
    w.appendChild(foco);
  }

  // ---- Treino em andamento (draft ativo) ----
  if(localStorage.getItem('yama.draft')){
    const draftCard = el(`<div class="draft-card">
      <div class="draft-body"><span class="draft-ic">🥋</span>
        <div class="draft-tx"><div class="draft-t">Treino em andamento</div>
          <div class="draft-s">Volte após a aula para completar o registro</div></div></div>
      <button class="draft-btn">Completar treino</button>
    </div>`);
    draftCard.querySelector('.draft-btn').onclick = ()=> openFlow();
    w.appendChild(draftCard);
  }

  // ---- Últimos treinos (3, com o título do dia) ----
  w.appendChild(el(`<div class="sec-row" style="margin-top:24px"><div class="sec-title">Últimos treinos</div>
    <a onclick="DB.jornadaTab='historico';goAluno('jornada')">Ver tudo</a></div>`));
  if (!DB.treinos.length){
    w.appendChild(emptyState('🥋','Nenhum treino ainda','Registre seu primeiro treino e comece seu diário.','Registrar treino', ()=> openFlow(aulaDoDia().tipo)));
  } else {
    const hist = el(`<div class="history"></div>`);
    DB.treinos.slice(0,3).forEach(tr=>{
      const item = histItem(tr, true); item.onclick = ()=> abrirTreino(tr.id);
      hist.appendChild(item);
    });
    w.appendChild(hist);
  }
  w.appendChild(el(`<div style="height:20px"></div>`));

  return w;
}

// Aula padrão do dia: seg–sex = Aula Técnica · sáb/dom = Livre (open mat)
function aulaDoDia(){
  const d = hoje.getDay();
  if (d===0 || d===6) return { tipo:'livre', label:'Aula Livre', emoji:'⚡' };
  return { tipo:'tecnica', label:'Aula Técnica', emoji:'🥋' };
}

// Selo de streak / consistência semanal
function streakBadge(){
  const s = DB.semana;
  const labels = ['S','T','Q','Q','S','S','D'];
  const todayIdx = (hoje.getDay()+6)%7;   // segunda = 0
  const dots = labels.map((d,i)=>
    `<span class="wk-dot ${s.dias[i]?'on':''} ${i===todayIdx?'today':''}"></span>`).join('');
  return el(`<div class="streak-badge compact">
    <span class="sb-fire">🔥</span>
    <span class="sb-n">${s.streakSemanas} sem</span>
    <div class="sb-dots">${dots}</div>
  </div>`);
}


// rótulo de data "Qua, 03 jun" a partir de t.data
function dataLabel(t){
  const [y,m,d] = t.data.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  return `${diasSem[dt.getDay()].slice(0,3)}, ${String(d).padStart(2,'0')} ${meses[m-1]}`;
}
function histItem(t, dateMode){
  const sub = dateMode ? dataLabel(t) : t.tecnica;
  const right = dateMode ? feelBadge(t)
                         : `<div class="day">${diaRelativo(t.data)}</div>${feelBadge(t)}`;
  const e = el(`<div class="h-item h-${t.tipo}">
    <div class="h-ic">${t.tipo==='tecnica'?'🥋':'⚡'}</div>
    <div class="h-tx"><div class="t">${t.titulo}</div><div class="d">${sub}</div></div>
    <div class="h-right">${right}</div></div>`);
  return e;
}

// JORNADA = histórico (antigo Diário) + graduação, num lugar só (a + d)
function alunoJornada(){
  const w = el('<div></div>');
  w.innerHTML = `<div class="hello"><div class="date">Jornada</div>
    <div class="greet">&nbsp;</div></div>`;

  const subs = [['historico','Histórico'],['frequencia','Frequência'],['graduacao','Graduação']];
  const seg = el(`<div class="subtabs-scroll"></div>`);
  subs.forEach(([id,l])=>{
    const b = el(`<button class="subtab2 ${DB.jornadaTab===id?'on':''}">${l}</button>`);
    b.onclick = ()=>{ DB.jornadaTab=id; render(); };
    seg.appendChild(b);
  });
  w.appendChild(seg);

  const cont = el('<div></div>');
  if (DB.jornadaTab==='historico')  cont.appendChild(jornadaHistorico());
  if (DB.jornadaTab==='frequencia') cont.appendChild(jornadaFrequencia());
  if (DB.jornadaTab==='graduacao')  cont.appendChild(evoluirGraduacao());
  w.appendChild(cont);
  return w;
}

// Sub-aba Histórico: heatmap (por período) + notas + feed filtrável
function jornadaHistorico(){
  const w = el('<div></div>');
  w.appendChild(heatmapCard());

  // filtro funcional
  const filtro = DB.histFiltro || 'todos';
  const fseg = el(`<div class="filter-seg"></div>`);
  [['todos','Todos'],['tecnica','Técnica'],['livre','Livre']].forEach(([id,l])=>{
    const b = el(`<button class="${filtro===id?'active':''}">${l}</button>`);
    b.onclick = ()=>{ DB.histFiltro=id; render(); };
    fseg.appendChild(b);
  });
  w.appendChild(fseg);

  // filtro por mês (vindo da aba Frequência)
  if (DB.histMes!=null){
    const chip = el(`<div class="mes-chip">📅 ${meses[DB.histMes]} <span class="mc-x">✕</span></div>`);
    chip.onclick = ()=>{ DB.histMes=null; render(); };
    w.appendChild(chip);
  }

  // notas rápidas
  if (DB.notas && DB.notas.length){
    w.appendChild(el(`<div class="sec-title">Notas rápidas</div>`));
    const nl = el(`<div class="nota-list"></div>`);
    DB.notas.slice(0,3).forEach(n=> nl.appendChild(el(`<div class="nota-item"><span class="ni-tx">${safeTxt(n.texto)}</span><span class="nota-dt">${fmtDataLonga(n.data)}</span></div>`)));
    w.appendChild(nl);
    w.appendChild(el(`<div class="sec-title">Treinos</div>`));
  }

  // feed filtrado (tipo + mês)
  if (!DB.treinos.length){
    w.appendChild(emptyState('📓','Seu diário está vazio','Cada treino que você registrar aparece aqui, com técnica, randori e fotos.','Registrar treino', ()=> openFlow(aulaDoDia().tipo)));
    return w;
  }
  const hist = el(`<div class="history"></div>`);
  let itens = DB.treinos.filter(t=> filtro==='todos' || t.tipo===filtro);
  if (DB.histMes!=null) itens = itens.filter(t=>{ const [y,m,d]=t.data.split('-').map(Number); return (m-1)===DB.histMes; });
  if (!itens.length) hist.appendChild(el(`<div class="empty-line">Nenhum treino${DB.histMes!=null?' em '+meses[DB.histMes]:''}${filtro==='todos'?'':' ('+filtro+')'} ainda.</div>`));
  itens.forEach(t=>{ const item = histItem(t); item.onclick = ()=> abrirTreino(t.id); hist.appendChild(item); });
  w.appendChild(hist);
  w.appendChild(el(`<div style="height:18px"></div>`));
  return w;
}

// Sub-aba Frequência: metas, presença, evolução + retrospectiva
// ritmo real de treino — calculado pela MÉDIA SEMANAL (mais justo) e convertido p/ mês
function paceSemanal(){
  const ds=(DB.treinos||[]).map(t=>t.data).filter(Boolean).sort();
  if(ds.length===0) return 0;
  const p=ds[0].split('-').map(Number); const first=new Date(p[0],p[1]-1,p[2]); first.setHours(0,0,0,0);
  const semanas=Math.max(1,(hoje-first)/(86400000*7));   // semanas decorridas (≥1)
  return DB.treinos.length/semanas;                       // média de treinos por semana
}
function paceMensal(){
  const ps=paceSemanal();
  if(ps<=0) return 8;                                     // sem dados → estimativa suave
  return Math.max(1, Math.round(ps*4.345));               // semana → mês
}
// agregados reais de frequência (a partir de DB.treinos)
function freqStats(){
  const ts = DB.treinos||[];
  const months=[]; for(let i=5;i>=0;i--){ const d=new Date(hoje.getFullYear(),hoje.getMonth()-i,1); months.push({y:d.getFullYear(),m:d.getMonth(),label:meses[d.getMonth()],count:0}); }
  const dow=[0,0,0,0,0,0]; let monthCount=0;
  ts.forEach(t=>{ if(!t.data) return; const p=t.data.split('-').map(Number); if(p.length<3) return; const dt=new Date(p[0],p[1]-1,p[2]);
    const mo=months.find(x=>x.y===p[0]&&x.m===p[1]-1); if(mo) mo.count++;
    const wd=(dt.getDay()+6)%7; if(wd<=5) dow[wd]++;
    if(p[0]===hoje.getFullYear()&&p[1]-1===hoje.getMonth()) monthCount++; });
  const att=_attendedSet(); let classDays=0, attended=0;
  for(let day=1;day<=hoje.getDate();day++){ const d=new Date(hoje.getFullYear(),hoje.getMonth(),day); const wd=d.getDay(); if(wd>=1&&wd<=6){ classDays++; if(att.has(isoOf(d))) attended++; } }
  const presenca = classDays? Math.round(attended/classDays*100):0;
  const dowNames=['segundas','terças','quartas','quintas','sextas','sábados'];
  const topi = dow.indexOf(Math.max(...dow));
  return { months, dow, monthCount, monthMeta:(DB.semana.meta||4)*4, presenca, total:ts.length, topDow: dow[topi]>0?dowNames[topi]:null };
}
// retrospectiva derivada dos dados reais
function retroStats(){
  const ts=DB.treinos||[];
  const novas=DB.tecnicas.filter(t=>(t.treinos||0)>0).length;
  let top='—',topN=0; DB.tecnicas.forEach(t=>{ if((t.treinos||0)>topN){topN=t.treinos||0; top=t.jp;} });
  const fx=(BELTS[DB.eu.faixa]?BELTS[DB.eu.faixa].nome:DB.eu.faixa)+(DB.eu.graus?` · ${DB.eu.graus}º grau`:'');
  return { ano:hoje.getFullYear(), treinos:ts.length, horas:Math.round(ts.length*1.5), novasTecnicas:novas,
    melhorStreak:DB.semana.streakSemanas||0, tecnicaTop:top, tecnicaTopTreinos:topN, faixaConquista:fx };
}
function jornadaFrequencia(){
  const w = el('<div></div>');
  if(!DEMO && (DB.treinos||[]).length===0){
    w.appendChild(emptyState('📊','Sua frequência aparece aqui','Registre treinos pra acompanhar presença, ritmo por mês e seus dias preferidos.','Registrar treino', ()=> openFlow(aulaDoDia().tipo)));
    w.appendChild(el(`<div style="height:18px"></div>`));
    return w;
  }
  const r  = DEMO ? DB.retro : retroStats();
  const fs = DEMO
    ? { presenca:78, monthCount:9, monthMeta:16, topDow:'quartas', dow:[14,9,16,8,13,11],
        months:[{label:'jan',count:12},{label:'fev',count:14},{label:'mar',count:9},{label:'abr',count:16},{label:'mai',count:13},{label:'jun',count:11}] }
    : freqStats();
  // banner retrospectiva
  const retro = el(`<div class="retro-banner">
    <div class="rb-ic">🎁</div>
    <div class="rb-tx"><div class="rb-t">Seu ano no Jiu-Jitsu</div>
      <div class="rb-s">${plural(r.treinos,'treino','treinos')} · ${r.horas}h no tatame</div></div>
    <div class="rb-go">›</div></div>`);
  retro.onclick = ()=> abrirRetro();
  w.appendChild(retro);

  // meta do mês
  const pct = fs.monthMeta? Math.round(fs.monthCount/fs.monthMeta*100):0;
  w.appendChild(el(`<div class="card card-pad" style="margin:0 20px 16px">
    <div class="pm-top"><span class="pm-belt-nm">Meta do mês</span><span class="pm-num">${fs.monthCount}/${fs.monthMeta}</span></div>
    <div class="mini-bar"><span style="width:${Math.min(100,pct)}%"></span></div>
    <div class="pm-foot">${plural(Math.max(0,fs.monthMeta-fs.monthCount),'treino','treinos')} para a meta de ${meses[hoje.getMonth()]}</div>
  </div>`));

  // KPIs de presença
  w.appendChild(el(`<div class="kpis block">
    <div class="kpi"><div class="v green">${fs.presenca}%</div><div class="l">Presença no mês</div></div>
    <div class="kpi"><div class="v red">${DB.semana.streakSemanas||0}</div><div class="l">Semanas seguidas</div></div>
    <div class="kpi"><div class="v blue">${r.treinos}</div><div class="l">Total de treinos</div></div>
  </div>`));

  // treinos por mês (interativo: toque filtra o Histórico)
  w.appendChild(el(`<div class="sec-row"><div class="sec-title">Treinos por mês</div>
    <span style="font-size:12px;color:var(--muted);font-weight:700">toque pra filtrar</span></div>`));
  const mx=Math.max(1,...fs.months.map(m=>m.count));
  const barCard = el(`<div class="card card-pad" style="margin:0 20px 18px"><div class="mbar-row"></div></div>`);
  const row = barCard.querySelector('.mbar-row');
  fs.months.forEach((mo,i)=>{
    const bar = el(`<div class="mbar ${DB.histMes===i?'on':''}">
      <span class="mbar-v">${mo.count}</span>
      <div class="mbar-track"><div class="mbar-fill" style="height:${Math.round(mo.count/mx*100)}%"></div></div>
      <span class="mbar-l">${(mo.label||'').slice(0,3)}</span></div>`);
    bar.onclick = ()=>{ DB.histMes = (DB.histMes===i?null:i); DB.jornadaTab='historico'; render(); };
    row.appendChild(bar);
  });
  w.appendChild(barCard);

  // distribuição por dia da semana (quais dias você mais treina)
  w.appendChild(el(`<div class="sec-title">Por dia da semana</div>`));
  const dias=['Seg','Ter','Qua','Qui','Sex','Sáb'], dmx=Math.max(1,...fs.dow);
  const dowCard = el(`<div class="card card-pad" style="margin:0 20px 18px"><div class="dow-row"></div></div>`);
  const drow = dowCard.querySelector('.dow-row');
  fs.dow.forEach((v,i)=>{ drow.appendChild(el(`<div class="dow-bar">
    <span class="dow-v">${v}</span>
    <div class="dow-track"><div class="dow-fill ${v===dmx&&v>0?'top':''}" style="height:${Math.round(v/dmx*100)}%"></div></div>
    <span class="dow-l">${dias[i]}</span></div>`)); });
  w.appendChild(dowCard);
  if(fs.topDow) w.appendChild(el(`<div class="freq-note">📌 Você treina mais nas <b>${fs.topDow}</b>.</div>`));
  w.appendChild(el(`<div style="height:18px"></div>`));
  return w;
}

// Retrospectiva "Seu ano no Jiu-Jitsu" (Wrapped)
function abrirRetro(){ DB.retroOpen=true; render(); window.scrollTo(0,0); }
function fecharRetro(){ DB.retroOpen=false; render(); }
function renderRetro(){
  const r = DEMO ? DB.retro : retroStats();
  const v = el(`<div class="view"></div>`);
  v.innerHTML = `<div class="flow-head"><div class="back" onclick="fecharRetro()">‹</div>
    <div class="ft"><div class="t">Seu ano no Jiu-Jitsu</div><div class="s">${r.ano} · Yama</div></div></div>`;
  const body = el(`<div class="retro-body"></div>`);
  body.appendChild(el(`<div class="retro-hero"><div class="rh-big">${r.treinos}</div><div class="rh-lbl">treinos em ${r.ano}</div></div>`));
  const cards = [
    ['⏱️', r.horas+'h', 'no tatame'],
    ['📚', r.novasTecnicas, 'novas técnicas'],
    ['🔥', r.melhorStreak+' sem', 'melhor sequência'],
    ['🥋', r.tecnicaTop, `mais treinada (${r.tecnicaTopTreinos}×)`],
    ['🎖️', r.faixaConquista, 'graduação atual'],
  ];
  if (DEMO) cards.splice(4,0,['⚔️', String(r.finBat).replace('.',',')+'×', 'finaliza > apanha']);
  const grid = el(`<div class="retro-grid"></div>`);
  cards.forEach(([e,val,l])=> grid.appendChild(el(`<div class="retro-card"><div class="rc-e">${e}</div><div class="rc-v">${val}</div><div class="rc-l">${l}</div></div>`)));
  body.appendChild(grid);
  body.appendChild(el(`<div class="retro-foot">Oss! Mais um ano de evolução na Yama 🥋</div>`));
  body.appendChild(el(`<div style="height:40px"></div>`));
  v.appendChild(body);
  return v;
}

// Calendário da Yama: Seg–Sex = Aula Técnica · Sáb = Livre · Dom = sem aula
// presença real = datas com treino registrado (+ hoje se houve check-in) — memoizado
let _attSig=null, _attSet=null;
function _attendedSet(){
  const sig = (DB.treinos||[]).length + '|' + (DB.treinos[0]?DB.treinos[0].id:'') + '|' + (DB.checkinHoje&&DB.checkinHoje.feito?1:0);
  if (sig!==_attSig){ _attSet=new Set((DB.treinos||[]).map(t=>t.data).filter(Boolean)); if(DB.checkinHoje&&DB.checkinHoje.feito) _attSet.add(HOJE_ISO); _attSig=sig; }
  return _attSet;
}
// semana atual (seg→dom) + streak de semanas seguidas com treino — tudo dos dados reais
function semanaStats(){
  const meta=(DB.semana&&DB.semana.meta)||4, THR=1;   // streak conta semana com ≥1 treino
  const att=_attendedSet();
  const monday=new Date(hoje); monday.setDate(hoje.getDate()-((hoje.getDay()+6)%7)); monday.setHours(0,0,0,0);
  const weekCount=(mon)=>{ let c=0; for(let i=0;i<7;i++){ const d=new Date(mon); d.setDate(mon.getDate()+i); if(att.has(isoOf(d))) c++; } return c; };
  const dias=[]; let feitos=0;
  for(let i=0;i<7;i++){ const d=new Date(monday); d.setDate(monday.getDate()+i); const a=att.has(isoOf(d)); dias.push(a); if(a) feitos++; }
  let streak=0, guard=0; const cur=new Date(monday);
  if(feitos<THR) cur.setDate(cur.getDate()-7);          // semana atual em curso não quebra o streak
  while(weekCount(cur)>=THR && guard++<520){ streak++; cur.setDate(cur.getDate()-7); }
  return { dias, feitos, streakSemanas:streak, meta };
}
let _semCacheSig=null;
function atualizarSemana(){
  const sig=_attSig;
  if(sig===_semCacheSig) return;
  _semCacheSig=sig;
  const s=semanaStats(); DB.semana.dias=s.dias; DB.semana.feitos=s.feitos; DB.semana.streakSemanas=s.streakSemanas;
}
function diaTreino(d){
  const dow = d.getDay();
  let tipo = null;
  if (dow>=1 && dow<=5) tipo='tecnica';
  else if (dow===6) tipo='livre';
  const classDay = tipo!==null;
  const past = d <= hoje;
  let attended = false;
  if (classDay && past){
    if (DEMO){ const key = d.getFullYear()*1000 + d.getMonth()*32 + d.getDate(); attended = (key % 4 !== 0); } // vitrine
    else attended = _attendedSet().has(isoOf(d));   // presença real do aluno
  }
  return { date:new Date(d), dow, classDay, tipo, attended, past };
}
function hmCellClass(c){
  if (!c.classDay) return 'hm-cell hm-empty';          // domingo: sem aula
  if (c.attended) return 'hm-cell ' + (c.tipo==='tecnica' ? 'hm-tec' : 'hm-liv');
  if (c.past) return 'hm-cell hm-miss';                // dia de aula que faltou
  return 'hm-cell hm-future';                          // aula futura agendada
}
// Heatmap por período: só dias de aula, cor por tipo
function heatmapCard(){
  const periodo = DB.histPeriodo || 'ano';
  const seg = el(`<div class="hist-seg"></div>`);
  [['semana','Semana'],['mes','Mês'],['ano','Ano']].forEach(([id,l])=>{
    const b = el(`<button class="${periodo===id?'active':''}">${l}</button>`);
    b.onclick = ()=>{ DB.histPeriodo=id; render(); };
    seg.appendChild(b);
  });

  const card = el(`<div class="card card-pad" style="margin:0 20px 18px"></div>`);
  card.appendChild(el(`<div class="hm-top"><div class="ttl">Consistência</div></div>`));
  card.appendChild(seg);

  if (periodo==='semana'){
    // 7 dias da semana atual (seg→dom)
    const base = new Date(hoje); const off=(base.getDay()+6)%7; base.setDate(base.getDate()-off);
    const labels=['S','T','Q','Q','S','S','D'];
    const row = el(`<div class="hm-week"></div>`);
    for(let i=0;i<7;i++){ const d=new Date(base); d.setDate(base.getDate()+i); const c=diaTreino(d);
      row.appendChild(el(`<div class="hmw-day"><span class="${hmCellClass(c)} big"></span><span class="hmw-lbl">${labels[i]}</span><span class="hmw-num">${d.getDate()}</span></div>`)); }
    card.appendChild(row);
  } else if (periodo==='mes'){
    // calendário do mês atual
    const first = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const startOff=(first.getDay()+6)%7; const dim=new Date(hoje.getFullYear(), hoje.getMonth()+1, 0).getDate();
    const grid = el(`<div class="hm-month"></div>`);
    ['S','T','Q','Q','S','S','D'].forEach(l=> grid.appendChild(el(`<span class="hmm-h">${l}</span>`)));
    for(let k=0;k<startOff;k++) grid.appendChild(el(`<span class="hmm-cell"></span>`));
    for(let day=1;day<=dim;day++){ const d=new Date(hoje.getFullYear(),hoje.getMonth(),day); const c=diaTreino(d);
      grid.appendChild(el(`<span class="hmm-cell"><span class="${hmCellClass(c)}"></span><span class="hmm-n">${day}</span></span>`)); }
    card.appendChild(grid);
    card.appendChild(el(`<div class="hm-sub" style="margin-top:10px">${meses[hoje.getMonth()]} de ${hoje.getFullYear()}</div>`));
  } else {
    // ano: 24 colunas = semanas reais (Seg–Dom). Rótulo do mês mora DENTRO da coluna
    // que contém o dia 1 → alinhamento garantido, sem deriva entre rótulo e grade.
    const thisMonday = new Date(hoje); thisMonday.setDate(hoje.getDate() - ((hoje.getDay()+6)%7)); thisMonday.setHours(0,0,0,0);
    const start = new Date(thisMonday); start.setDate(start.getDate() - 23*7);
    const data=[]; for(let d=new Date(start); d<=hoje; d.setDate(d.getDate()+1)) data.push(diaTreino(new Date(d)));
    const weeks=[]; let curr=[];
    data.forEach(cell=>{ curr.push(cell); if ((cell.date.getDay()+6)%7===6){ weeks.push(curr); curr=[]; } });
    if(curr.length){ while(curr.length<7) curr.push(null); weeks.push(curr); }
    // mês de cada coluna: a que tem o dia 1; a primeira coluna herda seu mês de início
    const colMonth = weeks.map(wk=>{ for(const c of wk){ if(c && c.date.getDate()===1) return c.date.getMonth(); } return null; });
    if(colMonth[0]==null){ const f=weeks[0].find(c=>c); if(f) colMonth[0]=f.date.getMonth(); }
    const cols = weeks.map((wk,wi)=>{
      let cells=''; for(let r=0;r<6;r++){ const cell=wk[r]; const dn=cell?cell.date.getDate():''; cells+=`<span class="${cell?hmCellClass(cell):'hm-cell hm-empty'}">${dn}</span>`; }
      const lbl = colMonth[wi]!=null ? meses[colMonth[wi]] : '';
      return `<div class="hm-col"><span class="hm-clbl">${lbl}</span>${cells}</div>`;
    }).join('');
    const days=['S','T','Q','Q','S','S'];
    card.appendChild(el(`<div class="hm-body">
      <div class="hm-days">${days.map(d=>`<span>${d}</span>`).join('')}</div>
      <div class="hm-scroll"><div class="hm-grid">${cols}</div></div>
    </div>`));
    const total = data.filter(x=>x&&x.attended).length;
    card.appendChild(el(`<div class="hm-sub" style="margin-top:8px">${plural(total,'treino','treinos')} · últimas 24 semanas</div>`));
    requestAnimationFrame(()=>{ const sc=card.querySelector('.hm-scroll'); if(sc) sc.scrollLeft=sc.scrollWidth; });
  }

  card.appendChild(el(`<div class="hm-legend">
    <span class="hm-cell hm-miss"></span><span>Faltou</span>
    <span class="hm-cell hm-tec"></span><span>Técnica</span>
    <span class="hm-cell hm-liv"></span><span>Livre</span></div>`));
  return card;
}

// Detalhe de um treino
function abrirTreino(id){ DB.treinoAberto = id; render(); window.scrollTo(0,0); }
function fecharTreino(){ DB.treinoAberto = null; render(); }
function renderTreinoDetalhe(){
  const t = DB.treinos.find(x=>x.id===DB.treinoAberto);
  const v = el(`<div class="view"></div>`);
  v.innerHTML = `<div class="flow-head">
    <div class="back" onclick="fecharTreino()">‹</div>
    <div class="ft"><div class="t">${t.titulo}</div><div class="s">${diaRelativo(t.data)} · ${fmtDataLonga(t.data)}</div></div>
  </div>`;
  const body = el(`<div class="flow-body" style="padding-bottom:40px"></div>`);

  const sensTxt = t.feel ? `Sensação · ${FEEL_LABEL[t.feel]}` : '';
  body.appendChild(el(`<div class="det-hero h-${t.tipo}">
    <div class="dh-ic">${t.tipo==='tecnica'?'🥋':'⚡'}</div>
    <div class="dh-tx"><div class="dh-t">${t.tecnica}</div>
      <div class="dh-mood">${sensTxt}</div></div></div>`));
  const btnShare = el(`<button class="share-btn">📲 Compartilhar treino</button>`);
  btnShare.onclick = ()=> abrirShare(t.id);
  body.appendChild(btnShare);

  const det = t.det;
  if (det){
    // tira de contexto: randori? (+ compat: gi/rounds/intensidade de treinos antigos)
    const metaBits = [];
    if (det.randori!=null) metaBits.push(det.randori ? '🤼 Com randori' : '🧘 Sem randori');
    if (det.gi) metaBits.push(`👕 ${det.gi==='nogi'?'No-Gi':'Kimono'}`);
    if (det.rounds) metaBits.push(`🔄 ${det.rounds} round${det.rounds>1?'s':''}`);
    if (det.intensidade) metaBits.push(`💪 ${INTENS[det.intensidade]||det.intensidade}`);
    if (metaBits.length) body.appendChild(el(`<div class="det-meta">${metaBits.map(b=>`<span class="dm-pill">${b}</span>`).join('')}</div>`));
    // Renshū do rolê: acerto por técnica praticada
    if (det.renshu && det.renshu.length){
      body.appendChild(el(`<div class="fsec-title" style="margin-top:6px"><span class="ico">🎯</span> No rolê de hoje</div>`));
      const rl = el(`<div class="det-renshu" style="padding:0 20px"></div>`);
      det.renshu.forEach(x=>{ const p=_pctAT(x.a,x.t);
        rl.appendChild(el(`<div class="dr-item"><span class="dr-nm">${x.jp}</span>
          <span class="dr-bar"><span style="width:${p}%;background:${corPct(p)}"></span></span>
          <span class="dr-pct" style="color:${corPct(p)}">${p}%</span>
          <span class="dr-frac">${x.a}/${x.t}</span></div>`));
      });
      body.appendChild(rl);
    }
    if (det.incomodo){
      body.appendChild(el(`<div class="fsec-title" style="margin-top:16px"><span class="ico">🩹</span> Incomodou</div>`));
      body.appendChild(el(`<div class="det-nota" style="border-left:3px solid var(--red)">${safeTxt(det.incomodo)}</div>`));
    }
    if (det.nota){
      body.appendChild(el(`<div class="fsec-title" style="margin-top:14px"><span class="ico">📝</span> Anotações</div>`));
      body.appendChild(el(`<div class="det-nota">${safeTxt(det.nota)}</div>`));
    }
    if (det.fotos && det.fotos.length){
      body.appendChild(el(`<div class="fsec-title" style="margin-top:14px"><span class="ico">📸</span> Fotos</div>`));
      const fg = el(`<div class="foto-grid" style="padding:0 20px"></div>`);
      det.fotos.forEach(src=> fg.appendChild(el(`<div class="foto-th"><img src="${src}" alt=""></div>`)));
      body.appendChild(fg);
    }
  }
  const delBtn = el(`<button class="del-treino">Excluir treino</button>`);
  delBtn.onclick = ()=>{
    const sheet = el(`<div class="sheet-overlay"><div class="sheet">
      <div class="sheet-grip"></div>
      <div class="sheet-title">Excluir treino?</div>
      <div class="sheet-desc">Este treino será removido permanentemente. Não dá pra desfazer.</div>
      <button class="btn-save danger" id="del-confirm">Excluir</button>
      <button class="sheet-cancel" id="del-cancel">Cancelar</button>
    </div></div>`);
    const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
    sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
    sheet.querySelector('#del-cancel').onclick=close;
    sheet.querySelector('#del-confirm').onclick=()=>{ DB.treinos=DB.treinos.filter(x=>x.id!==t.id); close(); DB.treinoAberto=null; render(); toast('Treino excluído'); };
    document.body.appendChild(sheet);
    requestAnimationFrame(()=>sheet.classList.add('open'));
  };
  body.appendChild(delBtn);
  v.appendChild(body);
  return v;
}
function fmtDataLonga(s){ const [y,mo,d]=s.split('-'); return `${d} de ${meses[+mo-1]} de ${y}`; }

/* ============================================================
   WRAP COMPARTILHÁVEL — story em canvas (export PNG real) · vários modelos
   ============================================================ */
const SHARE_TPLS = [['resumo','Treino'],['acerto','Acerto'],['streak','Streak'],['checkin','No tatame'],['marca','Marca'],['kanji','Símbolo']];
let _shareLogo = null, _sharePhoto = null;
function abrirShare(id){ DB.shareOpen=id; DB.shareTpl=DB.shareTpl||'resumo'; track('share_aberto'); render(); window.scrollTo(0,0); }
function fecharShare(){ DB.shareOpen=null; DB.shareFromSave=false; _sharePhoto=null; render(); }
function _rr(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
// desenha imagem cobrindo a área (cover), centralizada
function _cover(ctx,img,W,H){ const ir=img.naturalWidth/img.naturalHeight, cr=W/H; let w,h; if(ir>cr){h=H;w=H*ir;}else{w=W;h=W/ir;} ctx.drawImage(img,(W-w)/2,(H-h)/2,w,h); }
// CARD minimalista COMPACTO e TRANSLÚCIDO — sticker pra colar no story (deixa ver a foto por trás)
function drawStory(ctx,W,H,t,tpl,logoImg,photoImg){
  const SF='-apple-system,"Segoe UI",Roboto,sans-serif';
  const RED='#ff5a4d';
  const det=t.det||{}, reps=det.renshu||[];
  const totA=reps.reduce((s,r)=>s+(r.a||0),0), totT=reps.reduce((s,r)=>s+(r.t||0),0);
  const acerto = totT?Math.round(totA/totT*100):null;
  ctx.clearRect(0,0,W,H);
  if(photoImg){ _cover(ctx,photoImg,W,H); ctx.fillStyle='rgba(8,10,14,.18)'; ctx.fillRect(0,0,W,H); }

  // ----- card compacto (~metade do tamanho) + translúcido -----
  const cardW=480, cardX=(W-cardW)/2;
  const cardH = (tpl==='marca'||tpl==='kanji') ? 420 : 520;
  const cardY=(H-cardH)/2, R=36;
  ctx.save();
  ctx.shadowColor='rgba(0,0,0,.38)'; ctx.shadowBlur=40; ctx.shadowOffsetY=14;
  ctx.fillStyle='rgba(18,21,27,0.58)';                 // translúcido: vê o story por trás
  _rr(ctx,cardX,cardY,cardW,cardH,R); ctx.fill();
  ctx.restore();
  ctx.save(); _rr(ctx,cardX,cardY,cardW,cardH,R); ctx.clip();
  ctx.strokeStyle='rgba(255,255,255,0.14)'; ctx.lineWidth=2; _rr(ctx,cardX,cardY,cardW,cardH,R); ctx.stroke();
  const rg=ctx.createLinearGradient(cardX,cardY,cardX+cardW,cardY); rg.addColorStop(0,'#e5392f'); rg.addColorStop(1,'#7a1410');
  ctx.fillStyle=rg; ctx.fillRect(cardX,cardY,cardW,6); ctx.restore();

  // sombra leve no texto p/ legibilidade sobre card translúcido
  const son=()=>{ ctx.shadowColor='rgba(0,0,0,.5)'; ctx.shadowBlur=8; ctx.shadowOffsetY=1; };
  const soff=()=>{ ctx.shadowColor='transparent'; ctx.shadowBlur=0; ctx.shadowOffsetY=0; };
  son();
  const PAD=40, ix=cardX+PAD, iw=cardW-PAD*2;
  ctx.textAlign='left';
  const logoTile=(x,y,sz)=>{ if(!logoImg) return; soff(); ctx.save(); _rr(ctx,x,y,sz,sz,sz*0.24); ctx.fillStyle='#fff'; ctx.fill(); const p=sz*0.14; ctx.drawImage(logoImg,x+p,y+p,sz-2*p,sz-2*p); ctx.restore(); son(); };
  const foot=()=>{ ctx.textAlign='left'; ctx.fillStyle='rgba(255,255,255,.55)'; ctx.font=`700 13px ${SF}`; ctx.fillText('山 · meu jiu-jitsu',ix,cardY+cardH-28); };

  // ----- variantes de marca -----
  if(tpl==='marca'){
    logoTile(W/2-60,cardY+78,120);
    ctx.textAlign='center'; ctx.fillStyle='#fff'; ctx.font=`900 34px ${SF}`; ctx.fillText('YAMA JIU-JITSU',W/2,cardY+250);
    ctx.fillStyle='rgba(255,255,255,.7)'; ctx.font=`700 16px ${SF}`; ctx.fillText('Judô Kodokan · Kosen · Jiu-Jitsu',W/2,cardY+282);
    ctx.fillStyle=RED; ctx.font=`800 13px ${SF}`; ctx.fillText('山 · MEU JIU-JITSU',W/2,cardY+cardH-32); soff(); return;
  }
  if(tpl==='kanji'){
    ctx.textAlign='center'; ctx.fillStyle='#fff'; ctx.font=`900 200px ${SF}`; ctx.fillText('山',W/2,cardY+cardH/2+62);
    ctx.fillStyle='rgba(255,255,255,.85)'; ctx.font=`800 22px ${SF}`; ctx.fillText('YAMA JIU-JITSU',W/2,cardY+cardH-40); soff(); return;
  }

  // ----- header comum -----
  logoTile(ix,cardY+PAD,52);
  ctx.fillStyle='#fff'; ctx.font=`800 22px ${SF}`; ctx.fillText('YAMA JIU-JITSU',ix+66,cardY+PAD+21);
  ctx.fillStyle='rgba(255,255,255,.6)'; ctx.font=`700 14px ${SF}`; ctx.fillText(fmtDataLonga(t.data).toUpperCase(),ix+66,cardY+PAD+43);

  if(tpl==='checkin'){
    const cy=cardY+PAD+110;
    ctx.fillStyle='rgba(255,255,255,.7)'; ctx.font=`800 15px ${SF}`; ctx.fillText('NO TATAME',ix,cy-26);
    ctx.fillStyle='#fff'; ctx.font=`900 84px ${SF}`; ctx.fillText(DB.tecnicaDoDia.hora||'19h',ix,cy+58);
    ctx.fillStyle='rgba(255,255,255,.85)'; ctx.font=`800 22px ${SF}`; ctx.fillText(t.titulo,ix,cy+96);
    ctx.fillStyle=RED; ctx.font=`800 16px ${SF}`; ctx.fillText('Bora treinar',ix,cy+128);
    foot(); soff(); return;
  }

  if(tpl==='streak'){
    const s=DB.semana, cy=cardY+PAD+78;
    ctx.fillStyle=RED; ctx.font=`900 120px ${SF}`; ctx.textAlign='left'; ctx.fillText(String(s.streakSemanas),ix,cy+82);
    ctx.fillStyle='#fff'; ctx.font=`800 24px ${SF}`; ctx.fillText('semanas seguidas',ix,cy+118);
    ctx.fillStyle='rgba(255,255,255,.6)'; ctx.font=`700 15px ${SF}`; ctx.fillText(`${s.feitos}/${s.meta} treinos esta semana`,ix,cy+146);
    const r=12, gap=(iw-r*2)/6; let dx=ix+r;
    ['S','T','Q','Q','S','S','D'].forEach((l,i)=>{ soff(); ctx.beginPath(); ctx.arc(dx,cy+190,r,0,Math.PI*2); ctx.fillStyle=s.dias[i]?'#e5392f':'rgba(255,255,255,.18)'; ctx.fill(); son();
      ctx.fillStyle='rgba(255,255,255,.5)'; ctx.font=`700 12px ${SF}`; ctx.textAlign='center'; ctx.fillText(l,dx,cy+216); dx+=gap; });
    foot(); soff(); return;
  }

  if(tpl==='acerto'){
    const cy=cardY+PAD+100;
    ctx.fillStyle='#fff'; ctx.textAlign='left'; ctx.font=`800 22px ${SF}`; ctx.fillText(t.titulo,ix,cy-24);
    if(acerto!=null){
      ctx.fillStyle=RED; ctx.font=`900 140px ${SF}`; ctx.fillText(acerto+'%',ix,cy+118);
      ctx.fillStyle='rgba(255,255,255,.7)'; ctx.font=`800 18px ${SF}`; ctx.fillText('de acerto no rolê',ix,cy+150);
    } else {
      ctx.fillStyle=RED; ctx.font=`900 64px ${SF}`; ctx.fillText(det.randori?'RANDORI':'PRESENÇA',ix,cy+64);
      ctx.fillStyle='rgba(255,255,255,.7)'; ctx.font=`700 17px ${SF}`; ctx.fillText('no tatame',ix,cy+94);
    }
    foot(); soff(); return;
  }

  // ----- default: RESUMO -----
  {
    const ty=cardY+PAD+88;
    ctx.fillStyle='#fff'; ctx.textAlign='left'; ctx.font=`900 30px ${SF}`; ctx.fillText(t.titulo,ix,ty);
    soff(); ctx.strokeStyle='rgba(255,255,255,.16)'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(ix,ty+20); ctx.lineTo(ix+iw,ty+20); ctx.stroke(); son();
    const stats=[ [acerto!=null?acerto+'%':'—','ACERTO'], [det.randori?'SIM':'NÃO','RANDORI'], [String(DB.semana.streakSemanas),'STREAK'] ];
    const colW=iw/3, sy=ty+76;
    stats.forEach((st,i)=>{ const cx=ix+colW*i+colW/2;
      ctx.textAlign='center'; ctx.fillStyle=(i===0?RED:'#fff'); ctx.font=`900 34px ${SF}`; ctx.fillText(st[0],cx,sy);
      ctx.fillStyle='rgba(255,255,255,.55)'; ctx.font=`800 12px ${SF}`; ctx.fillText(st[1],cx,sy+22); });
    if(reps.length){
      let ly=sy+74; ctx.textAlign='left'; ctx.fillStyle='rgba(255,255,255,.5)'; ctx.font=`800 12px ${SF}`; ctx.fillText('TÉCNICAS',ix,ly); ly+=26;
      reps.slice(0,2).forEach(r=>{ ctx.fillStyle='rgba(255,255,255,.92)'; ctx.font=`700 17px ${SF}`; ctx.textAlign='left'; ctx.fillText(r.jp,ix,ly); ctx.textAlign='right'; ctx.fillText(`${r.a}/${r.t}`,ix+iw,ly); ly+=26; });
    } else if(t.feel){
      ctx.textAlign='left'; ctx.fillStyle='rgba(255,255,255,.6)'; ctx.font=`700 16px ${SF}`; ctx.fillText('Sensação · '+FEEL_LABEL[t.feel],ix,sy+78);
    }
    foot();
  }
  soff();
}
function renderShare(){
  const t = DB.treinos.find(x=>x.id===DB.shareOpen);
  if(!t){ DB.shareOpen=null; return el('<div></div>'); }
  const sub = DB.shareFromSave ? 'Treino salvo ✔ · compartilhe ou feche' : 'Card pro seu story';
  const v = el(`<div class="view"></div>`);
  v.innerHTML = `<div class="flow-head">
    <div class="back" onclick="fecharShare()">✕</div>
    <div class="ft"><div class="t">Compartilhar</div><div class="s">${sub}</div></div>
  </div>`;
  const body = el(`<div class="share-body"></div>`);
  const stage = el(`<div class="story-stage${_sharePhoto?' has-photo':''}"></div>`);
  const cv = el(`<canvas class="story-canvas" width="1080" height="1920"></canvas>`);
  stage.appendChild(cv); body.appendChild(stage);
  body.appendChild(el(`<div class="story-hint">${_sharePhoto?'card sobre a sua foto — posta a imagem inteira':'card vira sticker (PNG sem fundo) · ou adicione a sua foto'}</div>`));
  const ctx = cv.getContext('2d');
  const redraw=()=> { try{ drawStory(ctx,1080,1920,t,DB.shareTpl,
      (_shareLogo&&_shareLogo.complete&&_shareLogo.naturalWidth)?_shareLogo:null,
      (_sharePhoto&&_sharePhoto.complete&&_sharePhoto.naturalWidth)?_sharePhoto:null); }catch(e){} };
  if(!_shareLogo){ _shareLogo=new Image(); _shareLogo.onload=redraw; _shareLogo.onerror=function(){ if(this.src.indexOf('yama-logo')<0) this.src='yama-logo.png?v=2'; }; _shareLogo.src='logo.png?v=2'; }
  redraw();
  // modelos
  const chips = el(`<div class="tpl-row"></div>`);
  SHARE_TPLS.forEach(([id,label])=>{ const b=el(`<button class="tpl-chip ${DB.shareTpl===id?'on':''}">${label}</button>`);
    b.onclick=()=>{ DB.shareTpl=id; chips.querySelectorAll('.tpl-chip').forEach(x=>x.classList.remove('on')); b.classList.add('on'); redraw(); }; chips.appendChild(b); });
  body.appendChild(chips);
  // foto de fundo (opcional) — postar com a sua imagem direto no story
  const fileIn = el(`<input type="file" accept="image/*" capture="environment" style="display:none">`);
  fileIn.onchange=e=>{ const f=e.target.files&&e.target.files[0]; if(!f) return; const rd=new FileReader(); rd.onload=ev=>{ const img=new Image(); img.onload=()=>{ _sharePhoto=img; render(); }; img.src=ev.target.result; }; rd.readAsDataURL(f); };
  const photoRow = el(`<div class="share-photo-row"></div>`);
  const lbl = el(`<button class="share-photo">📷 ${_sharePhoto?'Trocar foto':'Adicionar sua foto'}</button>`);
  lbl.onclick=()=>fileIn.click(); photoRow.appendChild(lbl);
  if(_sharePhoto){ const clr=el(`<button class="share-clear">Remover</button>`); clr.onclick=()=>{ _sharePhoto=null; render(); }; photoRow.appendChild(clr); }
  photoRow.appendChild(fileIn);
  body.appendChild(photoRow);
  // controles — Compartilhar direto é o melhor caminho pro Instagram
  const ctrl = el(`<div class="share-ctrl">
    <button class="btn-save" id="share-go">📲 Compartilhar no story</button>
    <div class="share-actions">
      <button class="share-act" id="share-copy">📋 Copiar imagem</button>
      <button class="share-act" id="share-dl">⬇️ Baixar PNG</button>
    </div>
    <div class="share-hint">${_sharePhoto?'Posta a imagem inteira (card + sua foto)':'Sem foto: copie e cole o card por cima da foto no story'}</div>
  </div>`);
  // compartilhar nativo — abre o Instagram/Stories direto no celular
  ctrl.querySelector('#share-go').onclick=()=> cv.toBlob(async b=>{ const file=new File([b],'yama-treino.png',{type:'image/png'}); if(navigator.canShare && navigator.canShare({files:[file]})){ try{ await navigator.share({files:[file],title:'Yama Jiu-Jitsu',text:'山 Yama Jiu-Jitsu'}); }catch(e){} } else { toast('Compartilhar direto indisponível — use Copiar/Baixar'); } });
  // copiar — ClipboardItem com Promise (síncrono no gesto: funciona no iOS/Safari)
  ctrl.querySelector('#share-copy').onclick=()=>{
    if(!(navigator.clipboard && window.ClipboardItem)){ toast('Copiar indisponível; use Baixar PNG'); return; }
    try{
      const item=new ClipboardItem({'image/png': new Promise(res=> cv.toBlob(bb=>res(bb),'image/png')) });
      navigator.clipboard.write([item]).then(()=>toast('Copiado ✔ cole no seu story 📲')).catch(()=>toast('Não rolou copiar; use Baixar PNG'));
    }catch(err){ toast('Não rolou copiar; use Baixar PNG'); }
  };
  ctrl.querySelector('#share-dl').onclick=()=> cv.toBlob(b=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='yama-treino.png'; document.body.appendChild(a); a.click(); a.remove(); toast('PNG baixado ✔'); });
  body.appendChild(ctrl);
  v.appendChild(body);
  return v;
}

// TATAME = o coração: Seu Jogo (visão 3ª pessoa) + biblioteca de Técnicas
function alunoMeuJogo(){
  const w = el('<div></div>');
  w.innerHTML = `<div class="hello"><div class="date">Tatame</div>
    <div class="greet">&nbsp;</div></div>`;

  const subs = [['progresso','Progresso'],['biblioteca','Biblioteca'],['analise','Análise']];
  const seg = el(`<div class="subtabs-scroll"></div>`);
  let tab = DB.jogoTab;
  if (tab==='renshu') tab = DB.jogoTab = 'progresso';
  subs.forEach(([id,l])=>{
    const b = el(`<button class="subtab2 ${tab===id?'on':''}">${l}</button>`);
    b.onclick = ()=>{ DB.jogoTab=id; render(); };
    seg.appendChild(b);
  });
  w.appendChild(seg);

  const cont = el('<div></div>');
  if (tab==='progresso')  cont.appendChild(evoluirProgresso());
  if (tab==='biblioteca') cont.appendChild(evoluirBiblioteca());
  if (tab==='analise')    cont.appendChild(evoluirAnalise());
  w.appendChild(cont);
  return w;
}

/* ---- Sub-aba: RENSHŪ — registro (mesmo corpo do botão +) ---- */
function evoluirRenshu(){
  const w = el('<div class="reg-tab"></div>');
  w.appendChild(registroBody());
  const sb=el(`<button class="btn-save reg-save">Salvar treino</button>`);
  sb.onclick=()=>salvar();
  w.appendChild(sb);
  w.appendChild(el(`<div style="height:14px"></div>`));
  return w;
}

/* ---- Sub-aba: ANÁLISE (visão macro do jogo) ---- */
function evoluirAnalise(){
  const w = el('<div></div>');
  const ativas = DB.tecnicas.filter(t=>t.estado==='foco'||t.estado==='arma');
  const meta = metaLinha();

  // ===== Acerto geral no tempo (agregado foco + arsenal) — topo =====
  const agg = [];
  for(let i=0;i<30;i++){ let a=0,tt=0,dia='';
    ativas.forEach(t=>{ const d=(t.dias||[])[i]; if(d){ a+=d.a; tt+=d.t; dia=d.dia; } });
    agg.push({a,t:tt,dia}); }
  const aggTot = agg.reduce((s,d)=>({a:s.a+d.a,t:s.t+d.t}),{a:0,t:0});
  const aggP = _pctAT(aggTot.a, aggTot.t);
  w.appendChild(el(`<div class="sec-title" style="margin-top:6px">Acerto geral no tempo</div>`));
  const aggCard = el(`<div class="sc-card" style="margin:0 20px 16px"></div>`);
  aggCard.appendChild(el(`<div class="sc-big"><b style="color:${corPct(aggP)}">${aggP}%</b><span>de acerto geral</span><i>foco + arsenal</i></div>`));
  aggCard.appendChild(dayChartNode(agg));
  w.appendChild(aggCard);

  // ===== KPIs focados em técnica =====
  const arsenalArr = ativas.map(t=>({t,...totaisTec(t)})).filter(x=>x.T>0 && x.p>=meta).sort((a,b)=>b.p-a.p);
  const acertoMedio = Math.round(_media(ativas.map(t=>totaisTec(t).p)));
  w.appendChild(el(`<div class="kpis block">
    <div class="kpi"><div class="v blue">${DB.tecnicas.length}</div><div class="l">Técnicas</div></div>
    <div class="kpi"><div class="v red">${arsenalArr.length}</div><div class="l">No arsenal</div></div>
    <div class="kpi"><div class="v green">${acertoMedio}%</div><div class="l">Acerto médio</div></div>
  </div>`));

  // ===== Arsenal confiável (técnicas acima da média — vindo do Seu Jogo) =====
  w.appendChild(el(`<div class="sec-title" style="margin-top:14px">Arsenal confiável</div>`));
  if (arsenalArr.length){
    const al = el(`<div class="arsenal-list"></div>`);
    arsenalArr.forEach(({t,p})=>{
      const row = el(`<div class="ars-row">
        <div class="ars-tx"><div class="tn">${t.jp}</div><div class="ts">${t.pt||''}</div></div>
        <div class="ars-bar"><span style="width:${p}%"></span></div>
        <span class="ars-pct">${p}%</span></div>`);
      const i = DB.tecnicas.findIndex(x=>x.jp===t.jp);
      if(i>=0) row.onclick = ()=> abrirTecnica(i);
      al.appendChild(row);
    });
    w.appendChild(al);
  } else {
    w.appendChild(el(`<div class="prog-empty">Nenhuma técnica acima da média ainda — siga praticando no Renshū.</div>`));
  }

  // domínio por categoria (o que já aprendi)
  w.appendChild(el(`<div class="sec-title" style="margin-top:16px">Domínio por categoria</div>`));
  const dom = el(`<div class="dom-list"></div>`);
  CAT_ORDER.forEach(cat=>{
    const itens = DB.tecnicas.filter(t=>t.cat===cat);
    if (!itens.length) return;
    const d = itens.filter(t=>nivelDe(t)==='dominada').length;
    const tr = itens.filter(t=>nivelDe(t)==='treinando').length;
    const ap = itens.filter(t=>nivelDe(t)==='aprendendo').length;
    const tot = itens.length;
    const row = el(`<div class="dom-row">
      <div class="dom-top"><span class="dom-nm">${CATS[cat].emoji} ${CATS[cat].nome}</span><span class="dom-ct">${tot}</span></div>
      <div class="dom-bar">
        <span class="dseg green" style="flex:${d}"></span>
        <span class="dseg blue" style="flex:${tr}"></span>
        <span class="dseg gold" style="flex:${ap}"></span>
      </div>
      <div class="dom-leg">${d} dominadas · ${tr} treinando · ${ap} aprendendo</div>
    </div>`);
    dom.appendChild(row);
  });
  w.appendChild(dom);
  w.appendChild(el(`<div style="height:18px"></div>`));
  return w;
}

/* ============================================================
   PROGRESSO (Etapa 3) — gráfico de 30 dias por técnica em foco
   ============================================================ */
// gráfico interativo de 30 dias (hoje à direita) + linha de meta dinâmica
function dayChartNode(dias){
  // eixo SEMPRE com 30 fatias; os dias ainda não treinados ficam em branco (placeholder)
  // e vão sendo preenchidos da direita (hoje) pra esquerda conforme o aluno avança.
  const SLOTS=30, real=dias||[], n=real.length, meta=metaLinha();
  const last = real[n-1] || {a:0,t:0,dia:'hoje'};
  const pad = Math.max(0, SLOTS-n);
  let bars='', labs='';
  for(let i=0;i<pad;i++){ bars+=`<div class="dcol empty"><div class="dbar empty"></div></div>`; labs+=`<div class="dlab"></div>`; }
  real.forEach((d,idx)=>{ const r=_pctAT(d.a,d.t);
    bars+=`<div class="dcol" data-i="${idx}"><div class="dbar ${r>=meta?'above':'below'}" style="height:${Math.max(3,r)}%"></div></div>`;
    labs+=`<div class="dlab">${(idx%5===0||idx===n-1)?(d.dia||''):''}</div>`;
  });
  const defCap = `hoje (${last.dia}) · <b>${_pctAT(last.a,last.t)}%</b>`;
  const node = el(`<div class="dchart">
    <div class="dchart-leg"><i></i> sua média · ${meta}%</div>
    <div class="dplot"><div class="bmeta" style="bottom:${meta}%"></div>${bars}</div>
    <div class="dlabs">${labs}</div>
    <div class="wk-cap">${defCap}</div>
  </div>`);
  const cap = node.querySelector('.wk-cap');
  let sel=null;
  node.querySelectorAll('.dcol[data-i]').forEach(col=>{
    col.onclick = ()=>{
      const i = +col.dataset.i;
      node.querySelectorAll('.dbar').forEach(b=>b.classList.remove('sel'));
      if(sel===i){ sel=null; cap.innerHTML=defCap; return; }
      sel=i; col.querySelector('.dbar').classList.add('sel');
      const d=real[i], p=_pctAT(d.a,d.t);
      cap.innerHTML = `${d.dia} (-${n-1-i}d) · <b style="color:${corPct(p)}">${p}%</b> · ${d.a} de ${d.t}`;
    };
  });
  return node;
}
function evoluirProgresso(){
  const w = el('<div></div>');
  const focos = focoTecnicas();
  w.appendChild(el(`<div class="sec-row" style="margin-top:6px"><div class="sec-title" style="margin:0">Em treino · ${focos.length}/3</div>
    <span style="font-size:12px;color:var(--muted);font-weight:700">acerto no tempo · 30 dias</span></div>`));
  if(!focos.length){
    w.appendChild(el(`<div class="prog-empty">Nenhuma técnica em foco ainda.</div>`));
  }
  focos.forEach(t=>{
    const {T,A,p} = totaisTec(t);
    const card = el(`<div class="sc-card"></div>`);
    const head = el(`<div class="sc-head"><span class="sc-name">${t.jp}</span><button class="sc-rm" title="tirar do foco">✕</button></div>`);
    head.querySelector('.sc-rm').onclick = ()=> rsRemoverFoco(t.jp);
    card.appendChild(head);
    if(T===0){
      card.appendChild(el(`<div class="prog-empty">ainda sem tentativas — pratique no próximo treino</div>`));
      w.appendChild(card); return;
    }
    card.appendChild(el(`<div class="sc-big"><b style="color:${corPct(p)}">${p}%</b><span>de acerto</span><i>${A} de ${T}</i></div>`));
    card.appendChild(dayChartNode(t.dias));
    w.appendChild(card);
  });
  // gestão do foco: adicionar técnica (máx 3)
  if(focos.length<3){
    const add = el(`<button class="add-tec-btn">＋ praticar nova técnica</button>`);
    add.onclick = ()=> rsAddFoco();
    w.appendChild(add);
  } else {
    w.appendChild(el(`<div class="prog-hint">Máximo de 3 em treino. Tire uma (✕) pra colocar outra.</div>`));
  }
  w.appendChild(el(`<div style="height:18px"></div>`));
  return w;
}

/* ============================================================
   BIBLIOTECA (Etapa 4) — fusão Técnicas + Sistemas + estados + 🔁 Anki
   ============================================================ */
const ESTADO_GRUPOS = [['foco','Em treino'],['arma','Arsenal'],['guardada','Guardadas'],['aprendida','Aprendidas']];
function bibStatTile(l,v){ return `<div class="st-tile"><div class="st-l">${l}</div><div class="st-v">${v}</div></div>`; }
function bibStats(t){
  const {T,A,p}=totaisTec(t);
  if(T>0){ const best=Math.max(...ratesDe(t));
    return `<div class="rs-stats">${bibStatTile('Acerto',p+'%')}${bibStatTile('Tentativas',T)}${bibStatTile('Melhor dia',best+'%')}${bibStatTile('Praticada',t.ultima||'—')}</div>`; }
  return `<div class="rs-stats">${bibStatTile('Treinos',t.treinos||0)}${bibStatTile('Praticada',t.ultima||'—')}</div>`;
}
function bibToggle(jp){ DB.bibExp = DB.bibExp===jp?null:jp; render(); }
function bibRevisar(jp){ const i=DB.tecnicas.findIndex(t=>t.jp===jp); if(i>=0) marcarRevisado(i); }
function bibEditar(jp){ const i=DB.tecnicas.findIndex(t=>t.jp===jp); if(i>=0) abrirEditorTecnica(i); }
function bibVoltarFoco(jp){
  if(focoTecnicas().length>=3){ toast('Máximo de 3 em treino'); return; }
  const t=DB.tecnicas.find(x=>x.jp===jp); if(t){ t.estado='foco'; toast('Voltou pro treino'); render(); }
}
function bibDelLink(de,para){ DB.links = DB.links.filter(e=>!(e.de===de&&e.para===para)); render(); }
function bibConnectSub(de){
  const cands = DB.tecnicas.filter(t=>t.jp!==de && !DB.links.some(e=>e.de===de&&e.para===t.jp))
    .sort((a,b)=>(b.treinos||0)-(a.treinos||0));
  const sheet = el(`<div class="sheet-overlay"><div class="sheet">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Conectar subtécnica</div>
    <div class="sheet-desc">Pra onde a <b>"${de}"</b> costuma levar? A conexão monta seu mapa de jogo.</div>
    <div class="rs-picklist" id="bc-list"></div>
    <button class="sheet-cancel" id="bc-cancel">Cancelar</button>
  </div></div>`);
  const list = sheet.querySelector('#bc-list');
  cands.forEach(t=>{
    const row = el(`<div class="rs-pick"><div class="rs-pk-tx"><div class="tn">${t.jp}</div><div class="ts">${t.pt||''}</div></div><span class="rs-pk-go">＋</span></div>`);
    row.onclick=()=>{ DB.links.push({de, para:t.jp}); sheet.remove(); render(); toast('Subtécnica conectada'); };
    list.appendChild(row);
  });
  if(!cands.length) list.appendChild(el(`<div class="rs-empty">nenhuma técnica disponível pra conectar</div>`));
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#bc-cancel').onclick=close;
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}
function evoluirBiblioteca(){
  const w = el('<div></div>');
  // KPIs por nível — DINÂMICO (deriva dos treinos reais; 0 treino = só catálogo)
  const cont = { aprendendo:0, treinando:0, dominada:0 };
  DB.tecnicas.forEach(t=>{ const nv=nivelDe(t); if(cont[nv]!=null) cont[nv]++; });
  w.appendChild(el(`<div class="kpis block" style="margin-top:6px">
    <div class="kpi"><div class="v gold">${cont.aprendendo}</div><div class="l">Aprendendo</div></div>
    <div class="kpi"><div class="v blue">${cont.treinando}</div><div class="l">Treinando</div></div>
    <div class="kpi"><div class="v green">${cont.dominada}</div><div class="l">Dominadas</div></div>
  </div>`));

  // 🔁 Revisão espaçada — técnicas que estão te cobrando
  const due = tecnicasParaRevisar();
  if (due.length){
    w.appendChild(el(`<div class="sec-row"><div class="sec-title" style="margin:0">🔁 Revisar · ${due.length}</div>
      <span style="font-size:12px;color:var(--muted);font-weight:700">faz tempo que não treina</span></div>`));
    const rl = el(`<div class="tec-list"></div>`);
    due.slice(0,4).forEach(({t,i,dias})=>{
      const row = el(`<div class="tec-row rev-row">
        <div class="tec-ic rev-ic">🔁</div>
        <div class="tec-tx"><div class="tn">${t.jp}</div>
          <div class="ts">${t.pt} · faz ${dias} dias</div></div>
        <button class="rev-ok" title="Revisei">✓</button></div>`);
      row.querySelector('.rev-ok').onclick = (e)=>{ e.stopPropagation(); marcarRevisado(i); };
      row.onclick = ()=> bibToggle(t.jp);
      rl.appendChild(row);
    });
    w.appendChild(rl);
  }

  // adicionar técnica
  const addBtn = el(`<button class="add-tec-btn">＋ Adicionar técnica</button>`);
  addBtn.onclick = ()=> abrirEditorTecnica(null);
  w.appendChild(addBtn);

  // 📚 Catálogo — por categoria (Kodokan), accordion fechado, 1 categoria por vez
  w.appendChild(el(`<div class="bib-div">📚 Catálogo · por categoria</div>`));
  CAT_ORDER.forEach(cat=>{
    const itens = DB.tecnicas.filter(t=>t.cat===cat);
    if(!itens.length) return;
    const c = CATS[cat];
    const open = DB.bibCat===cat;
    const due = itens.filter(t=>(t.treinos||0)>0 && revInfo(t).due).length;
    const head = el(`<div class="cat-acc ${open?'open':''}">
      <div class="cat-emoji">${c.emoji}</div>
      <div class="cat-tx"><div class="cn">${c.nome}</div><div class="cs">${c.sub}</div></div>
      ${due?`<span class="cat-due" title="a revisar">${due}🔁</span>`:''}
      <span class="cat-tag ${cat==='kosen'?'kosen':'oficial'}">${cat==='kosen'?'não-oficial':'Kodokan'}</span>
      <span class="cat-acc-n">${itens.length}</span>
      <span class="cat-caret">${open?'⌄':'›'}</span>
    </div>`);
    head.onclick = ()=>{ DB.bibCat = open?null:cat; DB.bibExp=null; render(); };
    w.appendChild(head);
    if(open) itens.forEach(t=> w.appendChild(bibCardNode(t, t.estado)));
  });
  w.appendChild(el(`<div style="height:18px"></div>`));
  return w;
}
// cartão de técnica da Biblioteca (expansível: stats + revisão + pré/sub)
function bibCardNode(t, st){
  const exp  = DB.bibExp===t.jp;
  const subs = DB.links.filter(e=>e.de===t.jp).map(e=>e.para);
  const pres = DB.links.filter(e=>e.para===t.jp).map(e=>e.de);
  const r = revInfo(t);
  const {T,p}=totaisTec(t);
  const stat = (st!=='aprendida' && T>0) ? `${p}% de acerto` : `${plural(t.treinos||0,'treino','treinos')}`;
  const tagTxt = `${t.oficial?'Kodokan':'Kosen'}`;
  const card = el(`<div class="rep-card">
    <div class="rep-row">
      <div class="rep-tx"><div class="rep-nm">${t.jp}${r.due?' <span class="rev-dot" title="revisar"></span>':''}</div>
        <div class="rep-st">${t.pt||''} · ${tagTxt} · ${stat}${subs.length?` · ${subs.length} sub`:''}${pres.length?` · ${pres.length} pré`:''}</div></div>
      <span class="rep-caret">${exp?'⌄':'›'}</span>
    </div>
    ${exp?`<div class="rep-sub">
      <div class="rs-lab">Estatísticas</div>
      ${bibStats(t)}
      ${t.nota?`<div class="rs-lab">Sua anotação</div><div class="det-nota">${t.nota}</div>`:''}
      <div class="rs-lab">Revisão espaçada</div>
      <div class="bib-rev ${r.due?'due':''}">${r.due?`faz ${r.dias} dias — passou do intervalo de ${r.alvo}d`:`em dia · revisada faz ${r.dias}d (intervalo ${r.alvo}d)`}</div>
      ${st==='guardada'?`<button class="rs-add voltar" data-act="voltar">↩ voltar a praticar</button>`:(st==='aprendida'?`<button class="rs-add voltar" data-act="voltar">＋ colocar no foco</button>`:'')}
      <div class="rs-lab">Vem de (pré-técnicas)</div>
      ${pres.length?pres.map(s=>`<div class="rs-item"><span>${s} →</span><button data-del-de="${s}" data-del-para="${t.jp}">✕</button></div>`).join(''):'<div class="rs-empty">nada apontando pra cá ainda</div>'}
      <div class="rs-lab">Leva pra (subtécnicas)</div>
      ${subs.length?subs.map(s=>`<div class="rs-item"><span>→ ${s}</span><button data-del-de="${t.jp}" data-del-para="${s}">✕</button></div>`).join(''):'<div class="rs-empty">nenhuma ainda</div>'}
      <button class="rs-add" data-act="connect">＋ conectar subtécnica</button>
      <div class="bib-actions">
        <button class="bib-btn" data-act="revisar">Marcar revisado</button>
        <button class="bib-btn ghost" data-act="editar">Editar</button>
      </div>
    </div>`:''}
  </div>`);
  card.querySelector('.rep-row').onclick = ()=> bibToggle(t.jp);
  if(exp){
    card.querySelectorAll('[data-del-de]').forEach(b=> b.onclick=(e)=>{ e.stopPropagation(); bibDelLink(b.dataset.delDe,b.dataset.delPara); });
    const av=card.querySelector('[data-act="voltar"]');  if(av) av.onclick=(e)=>{ e.stopPropagation(); bibVoltarFoco(t.jp); };
    card.querySelector('[data-act="connect"]').onclick=(e)=>{ e.stopPropagation(); bibConnectSub(t.jp); };
    card.querySelector('[data-act="revisar"]').onclick=(e)=>{ e.stopPropagation(); bibRevisar(t.jp); };
    card.querySelector('[data-act="editar"]').onclick=(e)=>{ e.stopPropagation(); bibEditar(t.jp); };
  }
  return card;
}

/* ---- Sub-aba: GRADUAÇÃO ---- */
function evoluirGraduacao(){
  const w = el('<div></div>');
  const me = DB.eu, belt = BELTS[me.faixa];
  const stripes = '<i></i>'.repeat(me.graus);
  const curRed = me.faixa==='preta';
  const fg = (DB.graduacoes||[]).find(x=>x.tipo==='faixa' && x.faixa===me.faixa);
  const mesesFaixa = fg ? tempoNaFaixaMeses(fg.data) : null;
  let tempoTxt='—';
  if(mesesFaixa!=null){ const an=Math.floor(mesesFaixa/12), rm=mesesFaixa%12; tempoTxt=((an?an+'a ':'')+(rm?rm+'m':'')).trim()||'0m'; }

  w.appendChild(el(`<div class="mod-card" style="margin-top:6px">
    <div class="mod-title">Faixa atual: <b style="color:var(--ink)">${belt.nome} · ${me.graus}º grau</b></div>
    <div class="belt-rank" style="--bc:${belt.cor}"><span class="br-body"></span><span class="br-tip${curRed?' red-tip':''}">${stripes}</span><span class="br-end"></span></div>
    <div class="mod-grid">
      <div class="mc"><div class="big">${tempoTxt}</div>
        <div class="lbl">na faixa ${belt.nome.toLowerCase()}</div></div>
    </div>
  </div>`));

  const eleg = elegibilidadeCBJJ(me);
  if(eleg.nextBelt){
    const nextB = BELTS[eleg.nextBelt];
    const nextRed = eleg.nextBelt==='preta';
    const allOk = eleg.checks.filter(c=>c.ok===true).length;
    const total = eleg.checks.filter(c=>c.ok!=null).length;
    const statusCls = eleg.eligible ? 'cbjj-ok' : 'cbjj-wait';
    const statusTxt = eleg.eligible ? 'Elegivel para promocao' : `${allOk}/${total} requisitos atendidos`;
    w.appendChild(el(`<div class="cbjj-ready ${statusCls}">
      <div class="cbjj-head">
        ${beltMini(eleg.nextBelt, 0)}
        <div><div class="cbjj-next">Proxima faixa: <b style="color:${nextB.cor}">${nextB.nome}</b></div>
          <div class="cbjj-status">${statusTxt}</div></div>
      </div>
      <div class="cbjj-checks" id="cbjj-checks"></div>
    </div>`));
    const checksEl = w.querySelector('#cbjj-checks');
    eleg.checks.forEach(c=>{
      const ico = c.ok===true?'✅':c.ok===false?'❌':'ℹ️';
      checksEl.appendChild(el(`<div class="cbjj-chk"><span class="chk-ico">${ico}</span><div><div class="chk-label">${c.label}</div><div class="chk-detail">${c.detail}</div></div></div>`));
    });
  }

  const metaG = me.aulasGrau.meta||40;
  const atualG = DEMO ? me.aulasGrau.atual : Math.min(metaG, DB.treinos.length + (me.aulasGrau.base||0));
  const pctGrau = Math.round(atualG / metaG * 100);
  const faltam = Math.max(0, metaG - atualG);
  const totalAulas = DB.treinos.length + (me.aulasGrau.base||0);
  const restantes = DEMO ? me.aulasGraduacao : Math.max(0, (me.aulasGraduacao||160) - totalAulas);
  const paceSem = DEMO ? 3 : Math.round(paceSemanal()*10)/10;
  const pace = DEMO ? 13 : paceMensal();
  w.appendChild(el(`<div class="mod-card aulas-card">
    <div class="mod-title" style="font-size:13px">Progresso por aulas</div>
    <div class="mod-grid">
      <div class="mc"><div class="big" style="font-size:18px">${atualG}/${metaG}</div>
        <div class="lbl">${plural(faltam,'aula','aulas')} p/ proximo grau</div>
        <div class="mini-bar"><span style="width:${pctGrau}%"></span></div></div>
      <div class="mc bd"><div class="big" style="font-size:18px">~${restantes}</div>
        <div class="lbl">aulas p/ proxima faixa · ${paceSem}/sem</div></div>
    </div>
  </div>`));

  const tlHead = el(`<div class="sec-row"><div class="sec-title" style="margin:0">Linha do tempo</div></div>`);
  if(!DB.eu.gradLocked){
    const impBtn = el(`<a class="sec-link">Importar histórico</a>`);
    impBtn.onclick = ()=> abrirImportGrad();
    tlHead.appendChild(impBtn);
  } else if(!DB.eu.gradCorrecaoDone){
    const corBtn = el(`<a class="sec-link">Corrigir</a>`);
    corBtn.onclick = ()=> abrirImportGrad();
    tlHead.appendChild(corBtn);
  }
  w.appendChild(tlHead);
  const tl = el(`<div class="timeline"></div>`);
  const grads = [...(DB.graduacoes||[])].sort((a,b)=>b.data.localeCompare(a.data));
  if(!grads.length) tl.appendChild(el(`<div class="tl-empty">Nenhuma graduação registrada.<br>Importe seu histórico para visualizar.</div>`));
  grads.forEach(g=>{
    const x = BELTS[g.faixa];
    if(!x) return;
    const titulo = g.tipo==='faixa' ? `Faixa ${x.nome}` : `${g.graus}º grau · ${x.nome}`;
    const [y,m,d] = g.data.split('-');
    const dataFmt = `${d}/${m}/${y}`;
    tl.appendChild(el(`<div class="tl-item">
      <div class="tl-dot" style="background:${x.cor}22">${g.tipo==='faixa'?'🥋':'⭐'}</div>
      <div class="tl-tx"><div class="t">${titulo}</div>
        <div class="dt">${dataFmt}</div></div></div>`));
  });
  w.appendChild(tl);
  return w;
}

function abrirImportGrad(){
  const isCorrecao = !!DB.eu.gradLocked;
  const title = isCorrecao ? 'Corrigir histórico' : 'Importar histórico de graduação';
  const existentes = DB.graduacoes||[];
  let entries = existentes.length ? existentes.map(g=>({...g})) : [{ faixa:'branca', graus:0, tipo:'faixa', data:'', por:'—', aulas:0 }];

  function renderSheet(){
    const sheet = el(`<div class="sheet-overlay"><div class="sheet" style="max-height:85vh;overflow-y:auto">
      <div class="sheet-grip"></div>
      <div class="sheet-title">${title}</div>
      <div class="sheet-desc">${isCorrecao?'Corrija as datas ou dados. Após salvar, o histórico será travado definitivamente.':'Adicione cada graduação que você recebeu, da faixa branca até a atual.'}</div>
      <div id="grad-list"></div>
      <button class="btn-ghost" id="grad-add" style="margin-top:12px">+ Adicionar graduação</button>
      <button class="btn-save" id="grad-save" style="margin-top:14px">${isCorrecao?'Salvar e travar':'Importar histórico'}</button>
      <button class="sheet-cancel" id="grad-cancel">Cancelar</button>
    </div></div>`);
    const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
    sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
    sheet.querySelector('#grad-cancel').onclick=close;

    const list = sheet.querySelector('#grad-list');
    entries.forEach((e,i)=>{
      const bOpts = ADULT_BELTS.map(b=>`<option value="${b}" ${e.faixa===b?'selected':''}>${BELTS[b].nome}</option>`).join('');
      const row = el(`<div class="grad-entry" style="margin-bottom:14px;padding:14px;background:var(--field);border-radius:14px">
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px">
          <select class="inp" style="flex:1" data-field="faixa">${bOpts}</select>
          <select class="inp" style="width:80px" data-field="tipo">
            <option value="faixa" ${e.tipo==='faixa'?'selected':''}>Faixa</option>
            <option value="grau" ${e.tipo==='grau'?'selected':''}>Grau</option>
          </select>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <input class="inp" type="date" data-field="data" value="${e.data}" style="flex:1">
          ${e.tipo==='grau'?`<input class="inp" type="number" data-field="graus" value="${e.graus||0}" min="0" max="6" style="width:60px" placeholder="Grau">`:''}
          <button class="sc-rm" data-del="${i}" title="Remover">✕</button>
        </div>
        <div style="display:flex;gap:10px;align-items:center;margin-top:8px">
          <input class="inp" type="number" data-field="aulas" value="${e.aulas||0}" min="0" style="flex:1" placeholder="Aulas neste grau">
          <span style="font-size:13px;color:var(--muted);white-space:nowrap">aulas feitas</span>
        </div>
      </div>`);
      row.querySelectorAll('[data-field]').forEach(inp=>{
        inp.onchange=()=>{ const f=inp.dataset.field; entries[i][f]=(f==='graus'||f==='aulas')?+inp.value:inp.value; };
      });
      const del=row.querySelector('[data-del]');
      if(del) del.onclick=()=>{ entries.splice(i,1); sheet.remove(); renderSheet(); };
      list.appendChild(row);
    });

    sheet.querySelector('#grad-add').onclick=()=>{
      entries.push({ faixa:'branca', graus:0, tipo:'faixa', data:'', por:'—', aulas:0 });
      sheet.remove(); renderSheet();
    };

    sheet.querySelector('#grad-save').onclick=()=>{
      const valid = entries.filter(e=>e.data);
      if(!valid.length){ toast('Adicione pelo menos uma graduação com data'); return; }
      DB.graduacoes = valid.sort((a,b)=>a.data.localeCompare(b.data));
      const last = DB.graduacoes[DB.graduacoes.length-1];
      DB.eu.aulasGrau = Object.assign(DB.eu.aulasGrau, { base: last.aulas||0 });
      if(isCorrecao) DB.eu.gradCorrecaoDone = true;
      DB.eu.gradLocked = true;
      close(); render(); toast(isCorrecao?'Histórico corrigido e travado':'Histórico importado ✔');
    };

    document.body.appendChild(sheet);
    requestAnimationFrame(()=>sheet.classList.add('open'));
  }
  renderSheet();
}

/* ---- Sub-aba: TÉCNICAS (biblioteca) ---- */
const NIVEIS = { novo:['Catálogo','muted'], aprendendo:['Aprendendo','gold'], treinando:['Treinando','blue'], dominada:['Dominada','green'] };
// Categorias no continuum da arte única — do em pé ao chão
const CATS = {
  nage:     { nome:'Nage-waza', sub:'Quedas / projeções (em pé)', emoji:'⬆️' },
  osaekomi: { nome:'Osaekomi-waza', sub:'Imobilizações · controle', emoji:'🔒' },
  shime:    { nome:'Shime-waza', sub:'Estrangulamentos', emoji:'🌀' },
  kansetsu: { nome:'Kansetsu-waza', sub:'Chaves articulares', emoji:'🦾' },
  kosen:    { nome:'Kosen · ne-waza', sub:'Guarda e jogo por baixo', emoji:'🥋' },
};
const CAT_ORDER = ['nage','osaekomi','shime','kansetsu','kosen'];

// ---- Revisão espaçada ("Anki do BJJ") ----
const REV_INTERVALO = { aprendendo:3, treinando:7, dominada:21 }; // dias até cobrar revisão
function diasEntre(iso){
  if (!iso) return 999;
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  return Math.round((hoje - dt) / 86400000);
}
function revInfo(t){
  const dias = diasEntre(t.ultimaRev);
  const alvo = REV_INTERVALO[nivelDe(t)] || 7;
  return { dias, alvo, due: dias >= alvo, atraso: dias - alvo };
}
function tecnicasParaRevisar(){
  // só entra na fila o que você JÁ treinou (treinos>0); nunca-treinada não é "revisão"
  return DB.tecnicas.map((t,i)=>({t,i,...revInfo(t)})).filter(x=>x.due && (x.t.treinos||0)>0).sort((a,b)=>b.atraso-a.atraso);
}

function marcarRevisado(i){
  DB.tecnicas[i].ultimaRev = HOJE_ISO;
  track('revisao', { jp:DB.tecnicas[i].jp });
  toast('Revisão registrada ✔');
  render();
}
function abrirTecnica(i){
  const t = DB.tecnicas[i];
  const [nl,cor] = NIVEIS[nivelDe(t)];
  const c = CATS[t.cat] || { nome:'', emoji:'🥋' };
  const r = revInfo(t);
  const tag = t.oficial
    ? `<span class="cat-tag oficial">Kodokan oficial</span>`
    : `<span class="cat-tag kosen">Kosen · não-oficial</span>`;
  const revTxt = r.due
    ? `🧠 <b>Revisão espaçada:</b> faz <b>${r.dias} dias</b> que você não revisita — passou do intervalo de ${r.alvo} dias.`
    : `🧠 <b>Revisão espaçada:</b> revisada faz ${r.dias} dias. Em dia (intervalo de ${r.alvo} dias).`;
  const sheet = el(`<div class="sheet-overlay"><div class="sheet">
    <div class="sheet-grip"></div>
    <div class="tec-sheet-head">
      <div class="tec-ic" style="width:52px;height:52px;font-size:26px">${c.emoji}</div>
      <div><div class="tec-sheet-name">${t.jp}</div>
        <div class="ts">${t.pt}</div></div>
      <span class="niv-badge ${cor}" style="margin-left:auto">${nl}</span>
    </div>
    <div class="tec-sheet-meta">${tag}<span class="meta-dot">·</span><span>${c.nome}</span><span class="meta-dot">·</span><span>${plural(t.treinos||0,'treino','treinos')} · últ. ${t.ultima}</span></div>
    <div class="flbl" style="margin-top:16px">Sua anotação</div>
    <div class="det-nota">${t.nota||'—'}</div>
    <div class="revisao-card ${r.due?'due':''}">${revTxt}</div>
    <button class="btn-save" id="ts-rev">Marcar como revisado</button>
    <button class="sheet-cancel" id="ts-edit" style="color:var(--blue)">Editar técnica</button>
    <button class="sheet-cancel" id="ts-close">Fechar</button>
  </div></div>`);
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick = (e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#ts-close').onclick = close;
  sheet.querySelector('#ts-rev').onclick = ()=>{ sheet.remove(); marcarRevisado(i); };
  sheet.querySelector('#ts-edit').onclick = ()=>{ sheet.remove(); abrirEditorTecnica(i); };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

// Editor de técnica (criar nova ou editar)
function abrirEditorTecnica(idx){
  const editing = idx!=null;
  const t = editing ? DB.tecnicas[idx]
    : { jp:'', pt:'', cat:'osaekomi', oficial:true, nivel:'aprendendo', nota:'' };
  let cat = t.cat, niv = t.nivel;
  const sheet = el(`<div class="sheet-overlay"><div class="sheet">
    <div class="sheet-grip"></div>
    <div class="sheet-title">${editing?'Editar técnica':'Nova técnica'}</div>
    <label class="flbl">Nome (japonês)</label>
    <input class="inp" id="et-jp" placeholder="Ex: Juji-gatame" value="${t.jp}">
    <label class="flbl" style="margin-top:12px">Tradução (PT)</label>
    <input class="inp" id="et-pt" placeholder="Ex: Chave de braço cruzada" value="${t.pt}">
    <label class="flbl" style="margin-top:12px">Categoria</label>
    <div class="seg-wrap" id="et-cat"></div>
    <label class="flbl" style="margin-top:12px">Nível</label>
    <div class="seg" id="et-niv"></div>
    <label class="flbl" style="margin-top:12px">Anotação</label>
    <textarea class="ta" id="et-nota" placeholder="O ponto-chave da técnica…">${t.nota||''}</textarea>
    <button class="btn-save" id="et-save" style="margin-top:14px">${editing?'Salvar alterações':'Adicionar à biblioteca'}</button>
    <button class="sheet-cancel" id="et-cancel">Cancelar</button>
  </div></div>`);
  const cg = sheet.querySelector('#et-cat');
  CAT_ORDER.forEach(k=>{ const b=el(`<button class="seg-chip ${k===cat?'on':''}">${CATS[k].nome}</button>`);
    b.onclick=()=>{ cat=k; cg.querySelectorAll('.seg-chip').forEach(x=>x.classList.remove('on')); b.classList.add('on'); }; cg.appendChild(b); });
  const ng = sheet.querySelector('#et-niv');
  Object.keys(NIVEIS).forEach(k=>{ const b=el(`<button class="${k===niv?'active':''}">${NIVEIS[k][0]}</button>`);
    b.onclick=()=>{ niv=k; ng.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }; ng.appendChild(b); });
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick = (e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#et-cancel').onclick = close;
  sheet.querySelector('#et-save').onclick = ()=>{
    const jp = sheet.querySelector('#et-jp').value.trim();
    if (!jp){ toast('Dê um nome à técnica'); return; }
    const data = { jp, pt:sheet.querySelector('#et-pt').value.trim(), cat, oficial:cat!=='kosen', nivel:niv, nota:sheet.querySelector('#et-nota').value.trim() };
    if (editing) Object.assign(DB.tecnicas[idx], data);
    else DB.tecnicas.push({ ...data, treinos:0, ultima:'hoje', ultimaRev:HOJE_ISO });
    sheet.remove();
    DB.navAluno='jogo'; DB.jogoTab='biblioteca'; render();
    toast(editing?'Técnica atualizada ✔':'Técnica adicionada ✔');
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

function alunoPerfil(){
  const w = el('<div></div>');
  const me = DB.eu;
  w.innerHTML = `<div class="profile-head">
    <button class="pf-edit">Editar</button>
    <div class="pa">${me.foto?`<img src="${me.foto}" alt="">`:me.iniciais}</div>
    <div class="pn">${me.nome}</div>
  </div>`;
  w.querySelector('.pf-edit').onclick = ()=> abrirEditarPerfil();

  // Loja + "Minha academia" (mensalidade/frequência) dependem da gestão do professor.
  // No beta (sem backend/professor) ficam ESCONDIDOS — só aparecem na vitrine ?demo=1.
  if (DEMO){
    const lojaWrap = el(`<div class="loja-destaque">
      <div class="ld-head"><span class="ld-t">🛍️ Loja Yama</span><a class="ld-link">ver tudo ›</a></div>
      <div class="ld-strip"></div>
    </div>`);
    lojaWrap.querySelector('.ld-link').onclick = ()=> openLoja();
    const strip = lojaWrap.querySelector('.ld-strip');
    DB.loja.produtos.slice(0,5).forEach(p=>{
      const card = el(`<div class="ld-card">
        <div class="ld-img" style="background:${p.cor}">${p.emoji}</div>
        <div class="ld-nm">${p.nome}</div><div class="ld-pr">${moneyBR(p.preco)}</div></div>`);
      card.onclick = ()=>{ openLoja(); abrirProduto(p.id); };
      strip.appendChild(card);
    });
    w.appendChild(lojaWrap);

    const m = me.mensalidade;
    const payTxt = m.status==='ok' ? `Em dia · vence ${m.venc}` : 'Vencida';
    w.appendChild(el(`<div class="sec-title">Minha academia</div>`));
    w.appendChild(el(`<div class="info-list block">
      <div class="info-row"><div class="ii">💳</div><div class="it"><div class="t">Mensalidade</div>
        <div class="s">${payTxt}</div></div><div class="iv ${m.status==='ok'?'green':'red'}">${moneyBR(m.valor)}</div></div>
      <div class="info-row"><div class="ii">📅</div><div class="it"><div class="t">Frequência (mês)</div>
        <div class="s">Meta de 16 treinos</div></div><div class="iv">9</div></div>
      <div class="info-row"><div class="ii">🥋</div><div class="it"><div class="t">Turma</div>
        <div class="s">Adulto · Gi · 19h</div></div><div class="iv"></div></div>
    </div>`));
  }

  w.appendChild(el(`<div class="sec-title">Conta</div>`));
  const conta = el(`<div class="info-list">
    <div class="info-row" id="row-lesoes" style="cursor:pointer"><div class="ii">🤕</div><div class="it"><div class="t">Lesões</div></div><div class="iv">›</div></div>
    <div class="info-row" id="row-notif" style="cursor:pointer"><div class="ii">🔔</div><div class="it"><div class="t">Notificações</div></div><div class="iv">›</div></div>
    <div class="info-row" id="row-tema" style="cursor:pointer"><div class="ii">🌙</div><div class="it"><div class="t">Tema escuro</div></div><div class="iv">›</div></div>
    <div class="info-row" id="row-config" style="cursor:pointer"><div class="ii">⚙️</div><div class="it"><div class="t">Configurações</div></div><div class="iv">›</div></div>
  </div>`);
  conta.querySelector('#row-lesoes').onclick = ()=> abrirLesoes();
  conta.querySelector('#row-notif').onclick = ()=> abrirNotificacoes();
  conta.querySelector('#row-tema').onclick = ()=> toggleTheme();
  conta.querySelector('#row-config').onclick = ()=> abrirConfiguracoes();
  w.appendChild(conta);
  return w;
}

function tabbarAluno(){
  const tabs = [
    ['inicio','Início', icoHome()],
    ['jogo','Tatame', icoChart()],
    ['__fab','Registrar', null],
    ['jornada','Jornada', icoBook()],
    ['perfil','Perfil', icoUser()],
  ];
  const bar = el(`<div class="tabbar" role="tablist"></div>`);
  tabs.forEach(([id,label,ico])=>{
    if (id==='__fab'){
      const f = el(`<div class="tab fab-tab" role="button" tabindex="0" aria-label="Registrar treino"><div class="fb" aria-hidden="true">+</div><span class="tl">${label}</span></div>`);
      f.onclick = ()=> openFlow();
      f.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openFlow(); } };
      bar.appendChild(f); return;
    }
    const sel = DB.navAluno===id;
    const t = el(`<div class="tab ${sel?'active':''}" role="tab" tabindex="0" aria-label="${label}" aria-selected="${sel}">${ico}<span class="tl">${label}</span></div>`);
    t.onclick = ()=> goAluno(id);
    t.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); goAluno(id); } };
    bar.appendChild(t);
  });
  return bar;
}

// Nota rápida — insight solto, sem formulário
/* abrirNotaRapida: removido — sem botão na UI */

/* ============================================================
   FLOW DE REGISTRO (Aula Técnica / Livre)
   ============================================================ */
const DRAFT_KEY = 'yama.draft';
function _loadDraft(){ try{ const raw=localStorage.getItem(DRAFT_KEY); if(!raw) return null; const d=JSON.parse(raw); return (d&&d.date===HOJE_ISO)?d:null; }catch(e){ return null; } }
function _saveDraft(d){ try{ localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); }catch(e){} }
function _clearDraft(){ try{ localStorage.removeItem(DRAFT_KEY); }catch(e){} }
function _autosaveDraft(){ const d=_loadDraft(); if(d){ d.registro=DB.registro; _saveDraft(d); } }

function openFlow(){
  const draft = _loadDraft();
  const treinoHoje = DB.treinos.find(t=>t.data===HOJE_ISO);
  if (draft) {
    // draft exists — ask to resume or start new
    const sheet = el(`<div class="sheet-overlay"><div class="sheet">
      <div class="sheet-grip"></div>
      <div class="sheet-title">Treino em andamento</div>
      <div class="sheet-desc">Você tem um treino em andamento de hoje (check-in às ${draft.checkinHora}). Continuar de onde parou?</div>
      <button class="btn-save" id="draft-resume">Continuar treino</button>
      <button class="sheet-cancel" id="draft-new">Começar novo</button>
    </div></div>`);
    const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
    sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
    sheet.querySelector('#draft-resume').onclick=()=>{ close(); DB.registro=draft.registro||{randori:null,nota:'',mood:null}; DB.flow={phase:2}; render(); window.scrollTo(0,0); };
    sheet.querySelector('#draft-new').onclick=()=>{ close(); _clearDraft(); _startPhase1(); };
    document.body.appendChild(sheet);
    requestAnimationFrame(()=>sheet.classList.add('open'));
    return;
  }
  const treinosHoje = DB.treinos.filter(t=>t.data===HOJE_ISO).length;
  if (treinosHoje) DB.flow = { phase:1, aviso2x:true };
  else DB.flow = { phase:1 };
  render(); window.scrollTo(0,0);
}
function _startPhase1(){ DB.flow = { phase:1 }; render(); window.scrollTo(0,0); }
function closeFlow(){ DB.flow=null; render(); }

const INTENS = { leve:'Leve', medio:'Médio', forte:'Forte' };  // compat: detalhe de treinos antigos
const FEEL_LABEL = {1:'Muito difícil',2:'Difícil',3:'Normal',4:'Bom',5:'Excelente'};
// selo de sensação do treino (escala 1–5, profissional) — fallback p/ mood emoji antigo
function feelBadge(t){ return t.feel ? `<div class="feel-chip lvl${t.feel}">${t.feel}</div>` : ''; }

function _flowCheckin(){
  const hora = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  DB.checkinHoje = { feito:true, hora };
  DB._checkinLocal = true;
  track('presenca', { via:'flow' });
  // create draft
  const draft = { date:HOJE_ISO, checkinHora:hora, registro:{randori:null,nota:'',mood:null} };
  _saveDraft(draft);
  if(DB.sbUser && typeof sbSync!=='undefined') sbSync.pushCheckin();
  toast('Presença confirmada ✔ · complete o treino depois');
  DB.flow = null;
  render();
}

// Botão + (registrar): fluxo bifásico
function renderFlow(){
  const phase = DB.flow && DB.flow.phase || 1;
  if (phase === 1) return _renderPhase1();
  return _renderPhase2();
}

function _renderPhase1(){
  const v = el(`<div class="view"></div>`);
  v.innerHTML = `<div class="flow-head">
    <div class="back" onclick="closeFlow()">‹</div>
    <div class="ft"><div class="t">Check-in</div>
      <div class="s">${diasSem[hoje.getDay()]}, ${fmtData(hoje)}</div></div>
  </div>`;
  const body = el(`<div class="flow-body" style="padding:40px 20px;text-align:center"></div>`);
  body.appendChild(el(`<div style="font-size:64px;margin-bottom:16px">🥋</div>`));
  body.appendChild(el(`<div style="font-size:22px;font-weight:800;margin-bottom:8px">Bora treinar!</div>`));
  body.appendChild(el(`<div style="font-size:14px;color:var(--muted);font-weight:600;margin-bottom:32px">Confirme sua presença com um toque</div>`));
  if(DB.flow && DB.flow.aviso2x){
    const n = DB.treinos.filter(t=>t.data===HOJE_ISO).length;
    body.appendChild(el(`<div style="background:var(--red-tint);color:var(--red-strong);border-radius:12px;padding:10px 14px;font-size:13px;font-weight:700;margin-bottom:20px">Você já registrou ${plural(n,'treino','treinos')} hoje</div>`));
  }
  const btn = el(`<button class="btn-save" style="max-width:300px;margin:0 auto">Vou treinar!</button>`);
  btn.onclick = ()=> _flowCheckin();
  body.appendChild(btn);
  v.appendChild(body);
  return v;
}

function _renderPhase2(){
  const v = el(`<div class="view"></div>`);
  v.innerHTML = `<div class="flow-head">
    <div class="back" onclick="closeFlow()">‹</div>
    <div class="ft"><div class="t">Registrar treino</div>
      <div class="s">${diasSem[hoje.getDay()]}, ${fmtData(hoje)}</div></div>
  </div>`;
  const body = el(`<div class="flow-body" style="padding-bottom:120px"></div>`);
  body.appendChild(registroBody());
  v.appendChild(body);
  v.appendChild(el(`<div class="save-bar"><button class="btn-save" onclick="salvar()">Salvar treino</button></div>`));
  return v;
}

/* ============================================================
   PRESENÇA — Totem Inverso (QR + código manual)
   ============================================================ */
function openPresenca(){ DB.presencaOpen=true; DB.presenca={ codigo:'' }; render(); window.scrollTo(0,0); }
function closePresenca(){ DB.presencaOpen=false; render(); }

function renderPresenca(){
  const aula = DB.tecnicaDoDia;
  const v = el(`<div class="view"></div>`);
  v.innerHTML = `<div class="flow-head">
    <div class="back" onclick="closePresenca()">‹</div>
    <div class="ft"><div class="t">Registrar presença</div>
      <div class="s">Aula das ${aula.hora} · ${DB.academia.nome}</div></div>
  </div>`;
  const body = el(`<div class="flow-body presenca-body"></div>`);

  // QR do totem
  body.appendChild(el(`<div class="qr-card">
    <div class="qr-frame">${icoQRbig()}</div>
    <button class="btn-scan" onclick="presencaScan()">Escanear QR do totem</button>
    <div class="qr-hint">Aponte a câmera para o totem na recepção</div>
  </div>`));

  // divisor
  body.appendChild(el(`<div class="or-div"><span>ou digite o código do totem</span></div>`));

  // caixas do código (OTP)
  const code = DB.presenca.codigo;
  const boxes = [0,1,2,3].map(i =>
    `<div class="otp-box ${i===code.length?'active':''} ${code[i]?'filled':''}">${code[i]||''}</div>`).join('');
  body.appendChild(el(`<div class="otp-row">${boxes}</div>`));

  // teclado numérico
  const kp = el(`<div class="keypad"></div>`);
  ['1','2','3','4','5','6','7','8','9','','0','⌫'].forEach(k=>{
    if (k===''){ kp.appendChild(el(`<div></div>`)); return; }
    const b = el(`<button class="key">${k}</button>`);
    b.onclick = ()=> k==='⌫' ? presencaBack() : presencaDigit(k);
    kp.appendChild(b);
  });
  body.appendChild(kp);

  // geofence (futuro)

  v.appendChild(body);

  // barra confirmar
  v.appendChild(el(`<div class="save-bar">
    <button class="btn-save" ${code.length===4?'':'disabled'} onclick="presencaConfirm()">Confirmar presença</button>
  </div>`));
  return v;
}

function presencaDigit(n){
  if (DB.presenca.codigo.length>=4) return;
  DB.presenca.codigo += n;
  atualizaOtp();
}
function presencaBack(){ DB.presenca.codigo = DB.presenca.codigo.slice(0,-1); atualizaOtp(); }
function atualizaOtp(){
  const code = DB.presenca.codigo;
  document.querySelectorAll('.otp-box').forEach((b,i)=>{
    b.textContent = code[i]||'';
    b.classList.toggle('filled', !!code[i]);
    b.classList.toggle('active', i===code.length);
  });
  const btn = document.querySelector('.save-bar .btn-save');
  if (btn) btn.disabled = code.length!==4;
}
function presencaScan(){ toast('QR scan em breve — digite o código'); }
function presencaConfirm(){
  if (DB.presenca.codigo !== DB.tecnicaDoDia.codigo){
    toast('Código incorreto — confira no totem');
    DB.presenca.codigo=''; atualizaOtp();
    return;
  }
  confirmarPresenca('codigo');
}
function confirmarPresenca(via){
  DB.checkinHoje = { feito:true, hora:new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) };
  DB._checkinLocal = true;
  track('presenca', { via });
  DB.presencaOpen = false;   // semana/streak recalculados em atualizarSemana()
  render();
  if(DB.sbUser && typeof sbSync!=='undefined') sbSync.pushCheckin();
  toast(via==='qr' ? 'Presença confirmada via QR ✔' : 'Presença confirmada ✔');
}

/* ============================================================
   LOJA — produtos da academia (retirada na recepção)
   ============================================================ */
function openLoja(){ DB.lojaOpen=true; render(); window.scrollTo(0,0); }
function closeLoja(){ DB.lojaOpen=false; render(); }
function setLojaCat(c){ DB.loja.cat=c; render(); }
function carrinhoQtd(){ return DB.loja.carrinho.reduce((s,i)=>s+i.qtd,0); }
function carrinhoTotal(){ return DB.loja.carrinho.reduce((s,i)=>{ const p=DB.loja.produtos.find(x=>x.id===i.id); return s+p.preco*i.qtd; },0); }

function renderLoja(){
  const v = el(`<div class="view"></div>`);
  v.innerHTML = `<div class="flow-head">
    <div class="back" onclick="closeLoja()">‹</div>
    <div class="ft"><div class="t">Loja Yama</div><div class="s">Retire na recepção · sem frete</div></div>
    <div class="cart-btn" onclick="abrirCarrinho()">🛍️${carrinhoQtd()?`<span class="cart-badge">${carrinhoQtd()}</span>`:''}</div>
  </div>`;
  const body = el(`<div></div>`);

  // chips de categoria
  const chips = el(`<div class="cat-chips"></div>`);
  ['Todos','Kimonos','Vestuário','Acessórios'].forEach(c=>{
    const ch = el(`<button class="cat-chip ${DB.loja.cat===c?'on':''}">${c}</button>`);
    ch.onclick = ()=> setLojaCat(c);
    chips.appendChild(ch);
  });
  body.appendChild(chips);

  // grade de produtos
  const grid = el(`<div class="prod-grid"></div>`);
  DB.loja.produtos
    .filter(p=> DB.loja.cat==='Todos' || p.cat===DB.loja.cat)
    .forEach(p=>{
      const c = el(`<div class="prod-card">
        <div class="prod-img" style="background:${p.cor}">${p.emoji}</div>
        <div class="prod-info">
          <div class="prod-name">${p.nome}</div>
          <div class="prod-price">${moneyBR(p.preco)}</div>
        </div></div>`);
      c.onclick = ()=> abrirProduto(p.id);
      grid.appendChild(c);
    });
  body.appendChild(grid);
  body.appendChild(el(`<div style="height:28px"></div>`));
  v.appendChild(body);
  return v;
}

function abrirProduto(id){
  const p = DB.loja.produtos.find(x=>x.id===id);
  let tam = p.tam[0], qtd = 1;
  const sheet = el(`<div class="sheet-overlay"><div class="sheet prod-sheet">
    <div class="sheet-grip"></div>
    <div class="prod-hero" style="background:${p.cor}">${p.emoji}</div>
    <div class="prod-sheet-name">${p.nome}</div>
    <div class="prod-sheet-price">${moneyBR(p.preco)}</div>
    <div class="prod-sheet-desc">${p.desc}</div>
    <div class="flbl" style="margin-top:16px">Tamanho</div>
    <div class="chips tam-chips"></div>
    <div class="qty-row">
      <span class="flbl" style="margin:0">Quantidade</span>
      <div class="qty"><button class="qbtn" data-d="-1">−</button><span class="qv">1</span><button class="qbtn" data-d="1">+</button></div>
    </div>
    <button class="btn-save add-btn">Adicionar · ${moneyBR(p.preco)}</button>
  </div></div>`);
  const tc = sheet.querySelector('.tam-chips');
  p.tam.forEach(t=>{
    const ch = el(`<div class="chip ${t===tam?'on':''}">${t}</div>`);
    ch.onclick = ()=>{ tam=t; tc.querySelectorAll('.chip').forEach(x=>x.classList.remove('on')); ch.classList.add('on'); };
    tc.appendChild(ch);
  });
  sheet.querySelectorAll('.qbtn').forEach(b=> b.onclick=()=>{
    qtd = Math.max(1, qtd + (+b.dataset.d));
    sheet.querySelector('.qv').textContent = qtd;
    sheet.querySelector('.add-btn').textContent = `Adicionar · ${moneyBR(p.preco*qtd)}`;
  });
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick = (e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('.add-btn').onclick = ()=>{ addCarrinho(p.id,tam,qtd); close(); };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

function addCarrinho(id,tam,qtd){
  const ex = DB.loja.carrinho.find(i=>i.id===id && i.tam===tam);
  if (ex) ex.qtd += qtd; else DB.loja.carrinho.push({ id, tam, qtd });
  toast('Adicionado à sacola 🛍️');
  if (DB.lojaOpen) render();
}

function abrirCarrinho(){
  if (!DB.loja.carrinho.length){ toast('Sua sacola está vazia'); return; }
  const itens = DB.loja.carrinho.map(i=>{
    const p = DB.loja.produtos.find(x=>x.id===i.id);
    return `<div class="cart-item">
      <div class="ci-img" style="background:${p.cor}">${p.emoji}</div>
      <div class="ci-tx"><div class="ci-n">${p.nome}</div><div class="ci-s">Tam ${i.tam} · ${i.qtd}x</div></div>
      <div class="ci-p">${moneyBR(p.preco*i.qtd)}</div></div>`;
  }).join('');
  const sheet = el(`<div class="sheet-overlay"><div class="sheet">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Sua sacola</div>
    ${itens}
    <div class="cart-total"><span>Total</span><b>${moneyBR(carrinhoTotal())}</b></div>
    <div class="cart-pickup">📍 Retire na recepção da Yama — sem frete</div>
    <button class="btn-save" style="margin-top:6px">Finalizar com PIX</button>
    <button class="sheet-cancel">Continuar comprando</button>
  </div></div>`);
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick = (e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('.sheet-cancel').onclick = close;
  sheet.querySelector('.btn-save').onclick = ()=>{ close(); finalizarCompra(); };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

function finalizarCompra(){
  DB.loja.carrinho = [];
  if (DB.lojaOpen) render();
  toast('Pedido confirmado! Retire na recepção ✔');
}

/* ============================================================
   PERFIL PROFESSOR (gestão)
   ============================================================ */
/* ============================================================
   AUTH — tela de login / cadastro (Supabase)
   ============================================================ */
function renderAuth(){
  const tab = DB.authTab || 'login';
  const v = el('<div class="view auth-view"></div>');
  v.appendChild(el('<div class="auth-safe"></div>'));
  v.appendChild(el(`<div class="auth-hero">
    <img class="auth-logo" src="logo.png?v=2" onerror="this.onerror=null;this.src='yama-logo.png?v=2'" alt="">
    <div class="auth-title">${DB.academia.nome}</div>
    <div class="auth-sub">${DB.academia.artes}</div>
  </div>`));
  const seg = el(`<div class="auth-seg">
    <button class="${tab==='login'?'on':''}" id="atab-l">Entrar</button>
    <button class="${tab==='signup'?'on':''}" id="atab-s">Criar conta</button>
  </div>`);
  seg.querySelector('#atab-l').onclick = ()=>{ DB.authTab='login';  render(); };
  seg.querySelector('#atab-s').onclick = ()=>{ DB.authTab='signup'; render(); };
  v.appendChild(seg);
  const form = el('<div class="auth-form"></div>');
  form.appendChild(el('<label class="flbl">E-mail</label>'));
  const emEl = el(`<input class="inp" type="email" id="a-email" placeholder="seu@email.com" autocomplete="email" inputmode="email">`);
  form.appendChild(emEl);
  form.appendChild(el('<label class="flbl" style="margin-top:12px">Senha</label>'));
  const pwEl = el(`<input class="inp" type="password" id="a-pw" placeholder="Senha" autocomplete="${tab==='login'?'current-password':'new-password'}" style="margin-top:6px">`);
  form.appendChild(pwEl);
  if(tab==='login'){
    const btn = el('<button class="btn-register auth-btn">Entrar</button>');
    btn.onclick = async ()=>{
      const e=emEl.value.trim(), p=pwEl.value;
      if(!e||!p){ toast('Preencha e-mail e senha'); return; }
      btn.disabled=true; btn.textContent='Entrando…';
      try{
        const { user } = await sbAuth.signIn(e, p);
        DB.sbUser = user;
        btn.textContent='Sincronizando…';
        await Promise.all([sbSync.pullAll(user.id), sbSync.pullTecnicaDoDia()]);
        DB.authOpen = false;
        if(!DB.eu.apelido || !DB.onboarded) DB.onboardingOpen = true;
        track('app_open');
        render();
      }catch(err){
        btn.disabled=false; btn.textContent='Entrar';
        const m=err.message||'';
        toast(m.includes('Invalid login')?'E-mail ou senha incorretos':'Erro: '+m);
      }
    };
    form.appendChild(btn);
    const fg = el('<div class="auth-forgot">Esqueceu a senha?</div>');
    fg.onclick = ()=>_authResetPw();
    form.appendChild(fg);
  } else {
    form.appendChild(el('<label class="flbl" style="margin-top:12px">Confirmar senha</label>'));
    const pw2 = el(`<input class="inp" type="password" id="a-pw2" placeholder="Confirmar senha" autocomplete="new-password" style="margin-top:6px">`);
    form.appendChild(pw2);
    const btn = el('<button class="btn-register auth-btn">Criar conta</button>');
    btn.onclick = async ()=>{
      const e=emEl.value.trim(), p=pwEl.value, p2=pw2.value;
      if(!e){ toast('Preencha o e-mail'); return; }
      if(p.length<6){ toast('Senha: mínimo 6 caracteres'); return; }
      if(p!==p2){ toast('As senhas não coincidem'); return; }
      btn.disabled=true; btn.textContent='Criando…';
      try{
        const result = await sbAuth.signUp(e, p);
        if(!result.session){
          btn.disabled=false; btn.textContent='Criar conta';
          toast('Confirme seu e-mail e faça login'); DB.authTab='login'; render(); return;
        }
        DB.sbUser = result.user;
        aplicarCleanSlate(); DB.onboarded=false;
        DB.authOpen=false; DB.onboardingOpen=true;
        render();
      }catch(err){
        btn.disabled=false; btn.textContent='Criar conta';
        const m=err.message||'';
        toast(m.includes('already registered')?'E-mail já cadastrado — faça login':'Erro: '+m);
      }
    };
    form.appendChild(btn);
    form.appendChild(el('<div class="auth-note">🔒 Seus dados ficam salvos na nuvem e sincronizam entre seus aparelhos.</div>'));
  }
  v.appendChild(form);
  return v;
}

function _authResetPw(){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Recuperar senha</div>
    <div class="sheet-desc">Informe seu e-mail e enviaremos um link para redefinir a senha.</div>
    <input class="inp" type="email" id="rp-em" placeholder="seu@email.com">
    <button class="btn-save" id="rp-send">Enviar link</button>
    <button class="sheet-cancel" id="rp-cancel">Cancelar</button>
  </div></div>`);
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick = (e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#rp-cancel').onclick = close;
  sheet.querySelector('#rp-send').onclick = async ()=>{
    const em = sheet.querySelector('#rp-em').value.trim();
    if(!em){ toast('Informe o e-mail'); return; }
    try{ await sbAuth.resetPw(em); close(); toast('E-mail enviado — verifique sua caixa'); }
    catch(e){ toast(e.message); }
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}

function _sairDaConta(){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Sair da conta?</div>
    <div class="sheet-desc">Seus dados ficam salvos na nuvem. Ao entrar novamente eles serão restaurados.</div>
    <button class="btn-save danger" id="sair-sim">Sair</button>
    <button class="sheet-cancel" id="sair-nao">Cancelar</button>
  </div></div>`);
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick = (e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#sair-nao').onclick = close;
  sheet.querySelector('#sair-sim').onclick = async ()=>{
    sheet.remove();
    if(typeof sbAuth!=='undefined') await sbAuth.signOut();
    if(typeof sbAuth!=='undefined') { DB.sbUser=null; aplicarCleanSlate(); render(); toast('Até logo 👋'); }
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}

/* ============================================================
   PROFESSOR — cache de dados Supabase
   ============================================================ */
let _profData = null;
let _profTs   = 0;

function _loadProfData(){
  if(Date.now() - _profTs < 30000) return;
  _profTs = Date.now();
  if(typeof sbProf==='undefined'){
    _profData = { alunos:DB.alunos||[], kpis:{ total:(DB.alunos||[]).length, ativos:0, treinosTotal:0, shares:0, erros:0, receitaMes:0 } };
    return;
  }
  Promise.all([ sbProf.getAlunos(), sbProf.getKPIs() ]).then(([alunos, kpis])=>{
    _profData = { alunos, kpis }; render();
  }).catch(_=>{ _profTs = 0; });
}

function renderProfessor(){
  _loadProfData();
  const v = el(`<div class="view"></div>`);
  v.innerHTML = topbar('Painel do professor') + roleSeg();
  const body = el('<div></div>');
  const nav = DB.navProf;
  if (nav==='painel')    body.appendChild(profPainel());
  if (nav==='alunos')    body.appendChild(profAlunos());
  if (nav==='tecnica')   body.appendChild(profTecnica());
  if (nav==='financeiro')body.appendChild(profFinanceiro());
  v.appendChild(body);
  v.appendChild(tabbarProf());
  return v;
}

function profPainel(){
  const w = el('<div></div>');
  const d = _profData;
  const alunos   = d ? d.alunos : [];
  const kpis     = d ? d.kpis   : { total:0, ativos:0, treinosTotal:0, shares:0, erros:0, receitaMes:0 };
  const presentes = alunos.filter(a=>a.pres).length;
  const vencidos  = alunos.filter(a=>a.pago==='late').length;

  w.innerHTML = `<div class="hello"><div class="greet">${diasSem[hoje.getDay()]}, ${fmtData(hoje)}</div>
    <div class="date">Olá, ${DB.professor.nome} 🥋</div></div>`;

  const t = DB.tecnicaDoDia;
  const setHoje = t.definida && isHoje(t.data);
  const tt = el(`<div class="today-tech ${setHoje?'':'empty'}" style="margin:0 20px 22px;cursor:pointer">
    <div class="tt-pad">
      <span class="badge">🥋 Técnica de hoje</span>
      <div class="tname">${setHoje?t.nome:'Toque para definir'}</div>
      ${setHoje?`<div class="tmeta">${t.posicaoEmoji} ${t.posicao} · Código: <b>${t.codigo}</b></div>`:''}
    </div></div>`);
  tt.onclick=()=>goProf('tecnica');
  w.appendChild(tt);

  w.appendChild(el(`<div class="stat-grid block">
    <div class="stat-card"><div class="si red">👥</div><div class="sv">${d?presentes:'…'}</div><div class="sl">Presentes hoje</div></div>
    <div class="stat-card"><div class="si blue">📋</div><div class="sv">${d?kpis.total:'…'}</div><div class="sl">Alunos</div></div>
    <div class="stat-card"><div class="si green">💰</div><div class="sv">${d?moneyBR(kpis.receitaMes):'…'}</div><div class="sl">Mensalidades pagas</div></div>
    <div class="stat-card"><div class="si gold">⚠️</div><div class="sv">${d?vencidos:'…'}</div><div class="sl">Vencidos</div></div>
  </div>`));

  w.appendChild(el(`<div class="sec-row"><div class="sec-title">Check-ins de hoje</div>
    <a onclick="goProf('alunos')">Ver todos</a></div>`));
  const list = el('<div class="list block"></div>');
  if(!d){
    list.appendChild(el('<div class="loading-center">Carregando dados da nuvem…</div>'));
  } else if(!presentes){
    list.appendChild(el('<div class="empty-line">Nenhum check-in ainda hoje.</div>'));
  } else {
    alunos.filter(a=>a.pres).slice(0,4).forEach(a=>{
      list.appendChild(el(`<div class="ci-row"><span class="ci-dot"></span>
        <div class="avatar" style="background:${a.cor};width:36px;height:36px;font-size:13px">${a.ini}</div>
        <div><div style="font-size:13.5px;font-weight:700">${a.nm}</div>
          <div style="font-size:11.5px;color:var(--muted);font-weight:600">${BELTS[a.faixa]?.nome||a.faixa} · ${a.graus}º grau</div></div>
        <span class="ci-time">${a.pres}</span></div>`));
    });
  }
  w.appendChild(list);

  if(d && kpis.treinosTotal > 0){
    w.appendChild(el('<div class="sec-title" style="margin:16px 20px 8px">Beta KPIs</div>'));
    w.appendChild(el(`<div class="list block">
      <div class="mt-row"><span>Alunos com treino</span><b>${kpis.ativos}</b></div>
      <div class="mt-row"><span>Total de treinos</span><b>${kpis.treinosTotal}</b></div>
      <div class="mt-row"><span>Stories compartilhados</span><b>${kpis.shares}</b></div>
      <div class="mt-row"><span>Erros capturados</span><b>${kpis.erros}</b></div>
    </div>`));
  }
  return w;
}

function profAlunos(){
  const w = el('<div></div>');
  const alunos = (_profData?.alunos)||[];
  const presentes = alunos.filter(a=>a.pres).length;
  w.innerHTML = `<div class="hello"><div class="date">Alunos</div>
    <div class="greet">${_profData?alunos.length+' cadastrados · '+presentes+' presentes hoje':'Carregando…'}</div></div>`;

  let filtro = 'todos';
  const seg = el(`<div class="filter-seg">
    <button class="active" data-f="todos">Todos</button>
    <button data-f="presentes">Presentes</button>
    <button data-f="vencidos">Vencidos</button>
  </div>`);
  const list = el('<div class="list"></div>');

  const renderList = ()=>{
    list.innerHTML='';
    if(!_profData){ list.appendChild(el('<div class="loading-center">Carregando dados da nuvem…</div>')); return; }
    const filtrados = alunos.filter(a=>
      filtro==='todos' ? true : filtro==='presentes' ? !!a.pres : a.pago==='late'
    );
    if(!filtrados.length){ list.appendChild(el(`<div class="empty-line">Nenhum ${filtro==='presentes'?'presente':'vencido'} no momento.</div>`)); return; }
    filtrados.forEach(a=>{
      const payMap={ok:['pay-ok','Em dia'],late:['pay-late','Vencido'],soon:['pay-soon','A vencer']};
      const [cls,txt]=payMap[a.pago]||['pay-ok','—'];
      const row=el(`<div class="st-row" style="cursor:pointer">
        <div class="avatar" style="background:${a.cor}">${a.ini}</div>
        <div class="st-mid"><div class="nm">${a.nm}</div>
          <div class="meta">${beltPill(a.faixa,a.graus)} <span style="font-size:11px;color:var(--muted)">${a.pres?'✓ '+a.pres:'ausente hoje'}</span></div></div>
        <div class="st-right"><span class="pay-badge ${cls}">${txt}</span></div>
      </div>`);
      row.onclick=()=>_profAlunoSheet(a);
      list.appendChild(row);
    });
  };

  seg.querySelectorAll('[data-f]').forEach(b=>{
    b.onclick=()=>{
      filtro=b.dataset.f;
      seg.querySelectorAll('[data-f]').forEach(x=>x.classList.remove('active'));
      b.classList.add('active'); renderList();
    };
  });
  renderList();
  w.appendChild(seg); w.appendChild(list);
  return w;
}

function _profAlunoSheet(a){
  const hora = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  const sheet = el(`<div class="sheet-overlay"><div class="sheet">
    <div class="sheet-grip"></div>
    <div class="sheet-title">${a.nm}</div>
    <div class="sheet-desc">${BELTS[a.faixa]?.nome||a.faixa} · ${a.graus}º grau${a.desde&&a.desde!=='—'?' · desde '+a.desde:''}</div>
    <div class="cfg-list">
      ${a.pres
        ?'<div class="cfg-row danger" id="pa-rem"><span>❌ Remover presença</span></div>'
        :'<div class="cfg-row" id="pa-add"><span>✓ Lançar presença agora</span></div>'}
      ${a.pago==='late'
        ?'<div class="cfg-row" id="pa-pago"><span>💰 Marcar como pago</span></div>'
        :'<div class="cfg-row danger" id="pa-late"><span>⚠️ Marcar como vencido</span></div>'}
      <div class="cfg-row" id="pa-grad"><span>🥋 Graduar</span></div>
    </div>
    <button class="sheet-cancel" id="pa-cancel">Fechar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  const refresh=()=>{ _profData=null; _profTs=0; _loadProfData(); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#pa-cancel').onclick=close;
  const r1=sheet.querySelector('#pa-add');
  const r2=sheet.querySelector('#pa-rem');
  const r3=sheet.querySelector('#pa-pago');
  const r4=sheet.querySelector('#pa-late');
  if(r1) r1.onclick=async()=>{ close(); await sbProf.lancarPresenca(a.id,hora); refresh(); toast('Presença lançada ✔'); };
  if(r2) r2.onclick=async()=>{ close(); await sbProf.removerPresenca(a.id); refresh(); toast('Presença removida'); };
  if(r3) r3.onclick=async()=>{ close(); await sbProf.setMensalidade(a.id,'ok'); refresh(); toast('Marcado como pago ✔'); };
  if(r4) r4.onclick=async()=>{ close(); await sbProf.setMensalidade(a.id,'late'); refresh(); toast('Marcado como vencido'); };
  sheet.querySelector('#pa-grad').onclick=()=>{ close(); _profGraduarSheet(a, refresh); };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}
function _profGraduarSheet(a, refresh){
  const faixas = Object.keys(BELTS);
  let selFaixa = a.faixa||'branca', selGraus = a.graus||0;
  const sheet = el(`<div class="sheet-overlay"><div class="sheet">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Graduar ${a.nm}</div>
    <div class="sheet-desc">Atual: ${BELTS[a.faixa]?.nome||a.faixa} · ${a.graus}º grau</div>
    <label class="flbl">Nova faixa</label>
    <div class="seg" id="gr-faixa"></div>
    <label class="flbl" style="margin-top:12px">Graus</label>
    <div class="seg" id="gr-graus"></div>
    <label class="flbl" style="margin-top:12px">Tipo</label>
    <div class="seg" id="gr-tipo"></div>
    <button class="btn-save" id="gr-save" style="margin-top:14px">Confirmar graduação</button>
    <button class="sheet-cancel" id="gr-cancel">Cancelar</button>
  </div></div>`);
  let selTipo = 'graduação';
  const segFaixa = sheet.querySelector('#gr-faixa');
  faixas.forEach(f=>{ const b=el(`<button class="${f===selFaixa?'active':''}">${BELTS[f].nome}</button>`);
    b.onclick=()=>{ selFaixa=f; segFaixa.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }; segFaixa.appendChild(b); });
  const segGraus = sheet.querySelector('#gr-graus');
  [0,1,2,3,4].forEach(g=>{ const b=el(`<button class="${g===selGraus?'active':''}">${g}º</button>`);
    b.onclick=()=>{ selGraus=g; segGraus.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }; segGraus.appendChild(b); });
  const segTipo = sheet.querySelector('#gr-tipo');
  ['graduação','grau'].forEach(t=>{ const b=el(`<button class="${t===selTipo?'active':''}">${t}</button>`);
    b.onclick=()=>{ selTipo=t; segTipo.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }; segTipo.appendChild(b); });
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#gr-cancel').onclick=close;
  sheet.querySelector('#gr-save').onclick=async()=>{
    close(); toast('Graduando…');
    await sbProf.graduarAluno(a.id, selFaixa, selGraus, selTipo, DB.eu.nome||'Professor');
    refresh(); toast(`${a.nm} graduado para ${BELTS[selFaixa].nome} ${selGraus}º grau ✔`);
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}

function profTecnica(){
  const w = el('<div></div>');
  const t = DB.tecnicaDoDia;
  w.innerHTML = `<div class="hello"><div class="date">Técnica do dia</div>
    <div class="greet">Aparece no journal de todos os alunos presentes</div></div>`;
  const body = el(`<div class="flow-body"></div>`);
  body.appendChild(el(`<div class="fsec">
    <label class="flbl">Nome da técnica</label>
    <input class="inp" id="tec-nome" value="${t.definida?t.nome:''}" placeholder="Ex: Raspagem da borboleta">
  </div>`));
  const POS = [['Guarda','🛡️'],['Costas','🎯'],['Montada','⬆️'],['Passagem','➡️'],['Quedas','🤼'],['Finalização','🔒']];
  body.appendChild(el(`<div class="fsec"><label class="flbl">Posição</label>
    <div class="posic-grid" id="posic"></div></div>`));
  body.appendChild(el(`<div class="fsec"><label class="flbl">Observações para a turma</label>
    <textarea class="ta" id="tec-obs" placeholder="Detalhes, pontos de atenção…">${t.definida?t.obs:''}</textarea></div>`));
  body.appendChild(el(`<div style="padding-bottom:120px"></div>`));
  w.appendChild(body);
  w.appendChild(el(`<div class="save-bar"><button class="btn-save" onclick="salvarTecnica()">Publicar para a turma</button></div>`));

  setTimeout(()=>{
    const g = $('#posic', w);
    POS.forEach(([nm,em])=>{
      const sel = t.definida && t.posicao===nm;
      const p = el(`<div class="posic ${sel?'on':''}" data-nm="${nm}" data-em="${em}"><span class="pe">${em}</span>${nm}</div>`);
      p.onclick=()=>{ g.querySelectorAll('.posic').forEach(x=>x.classList.remove('on')); p.classList.add('on'); };
      g.appendChild(p);
    });
  },0);
  return w;
}
function _gerarCodigo(){ return String(Math.floor(1000+Math.random()*9000)); }
function salvarTecnica(){
  const nome = $('#tec-nome').value.trim();
  if(!nome){ toast('Dê um nome à técnica'); return; }
  const sel = $('#posic .posic.on');
  const codigo = _gerarCodigo();
  DB.tecnicaDoDia = { definida:true, data:HOJE_ISO, codigo, nome,
    posicao: sel?sel.dataset.nm:'Geral', posicaoEmoji: sel?sel.dataset.em:'🥋',
    obs: $('#tec-obs').value.trim() || 'Sem observações.' };
  if(typeof sbProf!=='undefined') sbProf.pushTecnicaDoDia(DB.tecnicaDoDia, codigo);
  toast(`Técnica publicada ✔ Código: ${codigo}`);
  goProf('painel');
}

function profFinanceiro(){
  const w = el('<div></div>');
  const alunos   = (_profData?.alunos)||[];
  const vencidos = alunos.filter(a=>a.pago==='late');
  const aVencer  = alunos.filter(a=>a.pago==='soon');
  const pagos    = alunos.filter(a=>a.pago==='ok');
  const receita    = pagos.reduce((s,a)=>s+(a.mensValor||0),0);
  const aReceber   = aVencer.reduce((s,a)=>s+(a.mensValor||0),0);
  const vencidoVal = vencidos.reduce((s,a)=>s+(a.mensValor||0),0);
  const mesAtual   = new Date().toLocaleDateString('pt-BR',{month:'long'});

  w.innerHTML = `<div class="hello"><div class="date">Financeiro</div>
    <div class="greet">${mesAtual} · mensalidades</div></div>`;
  w.appendChild(el(`<div class="fin-head">
    <div class="lbl">Recebido no mês</div><div class="big">${_profData?moneyBR(receita):'…'}</div>
    <div class="row">
      <div class="c"><div class="v green">${_profData?moneyBR(aReceber):'…'}</div><div class="l">A receber</div></div>
      <div class="c"><div class="v red">${_profData?moneyBR(vencidoVal):'…'}</div><div class="l">Vencido</div></div>
      <div class="c"><div class="v">${_profData?pagos.length:'…'}</div><div class="l">Pagos</div></div>
    </div></div>`));

  let filtro = 'vencidos';
  const seg = el(`<div class="filter-seg">
    <button class="active" data-f="vencidos">Vencidos (${vencidos.length})</button>
    <button data-f="avencer">A vencer (${aVencer.length})</button>
    <button data-f="pagos">Pagos (${pagos.length})</button>
  </div>`);
  const list = el('<div class="list"></div>');

  const renderFin = ()=>{
    list.innerHTML='';
    if(!_profData){ list.appendChild(el('<div class="loading-center">Carregando…</div>')); return; }
    const src = filtro==='vencidos'?vencidos : filtro==='avencer'?aVencer : pagos;
    if(!src.length){ list.appendChild(el('<div class="empty-line">Nenhum nesta categoria.</div>')); return; }
    src.forEach(a=>{
      const row=el(`<div class="st-row" style="cursor:pointer">
        <div class="avatar" style="background:${a.cor}">${a.ini}</div>
        <div class="st-mid"><div class="nm">${a.nm}</div>
          <div class="meta"><span style="font-size:11.5px;color:var(--muted);font-weight:600">Vence ${a.mensVenc}</span></div></div>
        <div class="st-right">
          <div style="font-size:14.5px;font-weight:800;color:${a.pago==='late'?'var(--red)':'var(--ink)'}">${a.mensValor>0?moneyBR(a.mensValor):'—'}</div>
        </div>
      </div>`);
      row.onclick=()=>_profAlunoSheet(a);
      list.appendChild(row);
    });
  };

  seg.querySelectorAll('[data-f]').forEach(b=>{
    b.onclick=()=>{
      filtro=b.dataset.f;
      seg.querySelectorAll('[data-f]').forEach(x=>x.classList.remove('active'));
      b.classList.add('active'); renderFin();
    };
  });
  renderFin();
  w.appendChild(seg); w.appendChild(list);
  return w;
}

function tabbarProf(){
  const tabs = [
    ['painel','Painel', icoHome()],
    ['alunos','Alunos', icoUsers()],
    ['tecnica','Técnica', null],
    ['financeiro','Financeiro', icoCard()],
    ['perfil','Mais', icoUser()],
  ];
  const bar = el(`<div class="tabbar"></div>`);
  tabs.forEach(([id,label,ico])=>{
    if (id==='tecnica'){
      const f = el(`<div class="tab fab-tab"><div class="fb">🥋</div><span class="tl">${label}</span></div>`);
      f.onclick=()=>goProf('tecnica'); bar.appendChild(f); return;
    }
    const t = el(`<div class="tab ${DB.navProf===id?'active':''}">${ico||icoMore()}<span class="tl">${label}</span></div>`);
    t.onclick=()=> goProf(id);
    bar.appendChild(t);
  });
  return bar;
}

/* ---------------- navegação ---------------- */
function setRole(r){ DB.role=r; DB.flow=null; render(); window.scrollTo(0,0); }
function goAluno(id){ DB.navAluno=id; render(); window.scrollTo(0,0); }
function goProf(id){ DB.navProf=id; render(); window.scrollTo(0,0); }
function toggleTheme(){
  const dark = document.documentElement.getAttribute('data-theme')==='dark';
  const next = dark?'light':'dark';
  document.documentElement.setAttribute('data-theme', next);
  try{ localStorage.setItem('yama.theme', next); }catch(e){}
}
try{ const _st=localStorage.getItem('yama.theme'); if(_st) document.documentElement.setAttribute('data-theme', _st); }catch(e){}

/* ============================================================
   ONBOARDING · EDIÇÃO DE PERFIL · CONFIG · PLACEHOLDERS · VAZIOS
   ============================================================ */

// Estado vazio reutilizável
function emptyState(emoji, titulo, sub, btnText, btnAction){
  const e = el(`<div class="empty-state">
    <div class="es-emoji">${emoji}</div>
    <div class="es-t">${titulo}</div>
    <div class="es-s">${sub}</div>
    ${btnText?`<button class="es-btn">${btnText}</button>`:''}
  </div>`);
  if (btnText && btnAction) e.querySelector('.es-btn').onclick = btnAction;
  return e;
}

// ---- Onboarding leve (boas-vindas) ----
function abrirOnboarding(){ DB.onboardingOpen=true; render(); window.scrollTo(0,0); }
function renderOnboarding(){
  const me = DB.eu;
  const v = el(`<div class="view onb"></div>`);
  const body = el(`<div class="onb-body"></div>`);
  body.appendChild(el(`<img class="onb-logo" src="logo.png?v=2" onerror="this.onerror=null;this.src='yama-logo.png?v=2'" alt="">`));
  body.appendChild(el(`<div class="onb-t">Bem-vindo à Yama</div>`));
  body.appendChild(el(`<div class="onb-s">Seu diário de Jiu-Jitsu — do em pé ao chão. Vamos te conhecer rapidinho.</div>`));
  body.appendChild(el(`<label class="flbl onb-lbl">Como te chamam?</label>`));
  const inp = el(`<input class="inp" id="onb-apelido" value="${me.apelido}" placeholder="Seu apelido">`);
  body.appendChild(inp);
  body.appendChild(el(`<label class="flbl onb-lbl">Sua faixa</label>`));
  let bf = me.faixa;
  const beltSeg = el(`<div class="seg-wrap onb-belt"></div>`);
  ['branca','azul','roxa','marrom','preta'].forEach(b=>{
    const btn=el(`<button class="seg-chip ${b===bf?'on':''}">${BELTS[b].nome}</button>`);
    btn.onclick=()=>{ bf=b; beltSeg.querySelectorAll('.seg-chip').forEach(x=>x.classList.remove('on')); btn.classList.add('on'); };
    beltSeg.appendChild(btn);
  });
  body.appendChild(beltSeg);

  body.appendChild(el(`<label class="flbl onb-lbl">Ano de nascimento</label>`));
  const inpNasc = el(`<input class="inp" id="onb-nasc" type="number" inputmode="numeric" placeholder="Ex: 1998" value="${me.nascimento||''}" min="1920" max="${hoje.getFullYear()}">`);
  body.appendChild(inpNasc);

  // privacidade + consentimento (LGPD · beta só maiores de 18 · dados ficam no aparelho)
  body.appendChild(el(`<div class="onb-priv">🔒 Seus dados ficam salvos na <b>nuvem</b> e sincronizam entre seus aparelhos.</div>`));
  const consent = el(`<label class="onb-consent">
    <input type="checkbox" id="onb-ok">
    <span>Tenho <b>18 anos ou mais</b> e li a <a class="lk" id="onb-pol">Política de Privacidade e os Termos</a>.</span>
  </label>`);
  body.appendChild(consent);
  consent.querySelector('#onb-pol').onclick = (e)=>{ e.preventDefault(); e.stopPropagation(); abrirPolitica(); };

  const go = el(`<button class="btn-register onb-btn" disabled>Começar</button>`);
  const chk = consent.querySelector('#onb-ok');
  chk.onchange = ()=>{ go.disabled = !chk.checked; };
  const _iniciais = (s)=>{ const p=(s||'').trim().split(/\s+/); return ((p[0]||'')[0]||'').toUpperCase() + ((p[1]||'')[0]||'').toUpperCase(); };
  go.onclick = ()=>{
    if (!chk.checked){ toast('Marque o aceite para continuar'); return; }
    const ap = inp.value.trim(); if (ap){ me.apelido = ap; me.nome = me.nome || ap; me.iniciais = _iniciais(ap); }
    me.faixa = bf;
    const nascVal = parseInt(inpNasc.value); if(nascVal>=1920 && nascVal<=hoje.getFullYear()) me.nascimento=nascVal;
    me.consentimento = HOJE_ISO;   // registro do aceite (LGPD)
    // primeira graduação = faixa inicial (alimenta a timeline da Jornada)
    if (!DB.graduacoes.some(g=>g.tipo==='faixa' && g.faixa===bf))
      DB.graduacoes.unshift({ faixa:bf, graus:0, tipo:'faixa', data:HOJE_ISO, por:'—' });
    DB.onboarded=true; DB.onboardingOpen=false;
    const primeiraVez = !me.viuAjuda;
    track('onboarding_done', { faixa:bf });
    render(); toast(`Tudo pronto, ${me.apelido}! Oss 🥋`);
    if(DB.sbUser && typeof sbSync!=='undefined') sbSync.pushAll();
    if (primeiraVez) abrirAjuda(true);   // mini-guia na 1ª vez
  };
  body.appendChild(go);
  v.appendChild(body);
  return v;
}

// ---- Política de Privacidade + Termos (LGPD · beta local-only · 18+) ----
function abrirPolitica(){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet sheet-scroll">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Privacidade & Termos</div>
    <div class="doc">
      <p class="doc-em">🔒 Seus dados ficam <b>só neste aparelho</b>. O app não tem servidor nem conta — nada é enviado para a internet automaticamente.</p>
      <h4>O que guardamos</h4>
      <p>Apenas o que você digita: apelido, faixa e os treinos, técnicas e notas que registra. Tudo no armazenamento local do seu navegador.</p>
      <h4>Para que serve</h4>
      <p>Funcionar como seu diário de treino e, durante o beta, nos ajudar a melhorar o app.</p>
      <h4>Compartilhamento</h4>
      <p>Nenhum. Só sai do aparelho o que <b>você</b> decidir enviar — um print, o card de story ou o arquivo de "Exportar dados" que você mandar no grupo.</p>
      <h4>Seus direitos (LGPD)</h4>
      <p>Acessar/portar: <b>Config → Exportar meus dados</b>. Corrigir: <b>Perfil → Editar</b>. Apagar tudo: <b>Config → Apagar todos os dados</b>.</p>
      <h4>Idade</h4>
      <p>Nesta fase de teste, o uso é restrito a <b>maiores de 18 anos</b>.</p>
      <h4>Beta</h4>
      <p>App em teste: pode ter falhas e mudanças. Sem garantias. Faça backup (Exportar) com frequência — se você limpar o navegador, os dados deste aparelho são perdidos.</p>
      <h4>Governança</h4>
      <p>Controlador: <b>Academia Yama Jiu-Jitsu</b>. Coletamos o mínimo (sem CPF, e-mail ou senha nesta fase). Não há decisões automatizadas sobre você. Os dados ficam até você apagar.</p>
      <h4>Contato</h4>
      <p>Dúvidas ou exclusão de dados: fale com a equipe pelo botão <b>Enviar feedback</b> em Config.</p>
    </div>
    <button class="sheet-cancel" id="pol-close">Entendi</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#pol-close').onclick=close;
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

// ---- Mini-guia / ajuda (1ª vez + acessível no Config) ----
function abrirAjuda(primeira){
  DB.eu.viuAjuda = true;
  track('ajuda', { primeira: !!primeira });
  const sheet = el(`<div class="sheet-overlay"><div class="sheet sheet-scroll">
    <div class="sheet-grip"></div>
    <div class="sheet-title">${primeira?'Bora começar 🥋':'Como usar'}</div>
    <div class="faq">
      <div class="faq-item"><span class="fq-ic">➕</span><div><b>Registre o treino</b><p>Toque no <b>+</b> no fim da aula e conte como foi — leva uns 15 segundos.</p></div></div>
      <div class="faq-item"><span class="fq-ic">🥋</span><div><b>Sua faixa e graus</b><p>Ajuste em <b>Perfil → Editar</b>. Você mesmo declara sua graduação.</p></div></div>
      <div class="faq-item"><span class="fq-ic">📊</span><div><b>Acompanhe a evolução</b><p>Em <b>Tatame → Progresso</b> você vê o acerto por técnica; a consistência fica na <b>Jornada</b>.</p></div></div>
      <div class="faq-item"><span class="fq-ic">🔒</span><div><b>Seus dados são seus</b><p>Ficam só neste aparelho. Faça backup em <b>Config → Exportar</b> toda semana.</p></div></div>
      <div class="faq-item"><span class="fq-ic">💬</span><div><b>Achou um bug? Tem ideia?</b><p>Manda em <b>Config → Enviar feedback</b> — cai direto no nosso grupo.</p></div></div>
    </div>
    <button class="btn-save" id="faq-go">${primeira?'Começar a treinar':'Fechar'}</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#faq-go').onclick=close;
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

// ---- Editar perfil ----
function abrirEditarPerfil(){
  const me = DB.eu;
  let foto = me.foto, faixa = me.faixa, graus = me.graus, nascimento = me.nascimento;
  const maxGraus = (f)=> f==='preta'?6:4;
  const sheet = el(`<div class="sheet-overlay"><div class="sheet">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Editar perfil</div>
    <div class="ep-foto">
      <div class="ep-avatar">${foto?`<img src="${foto}" alt="">`:me.iniciais}</div>
      <label class="ep-foto-btn">Trocar foto<input type="file" accept="image/*" hidden id="ep-file"></label>
    </div>
    <label class="flbl" style="margin-top:14px">Apelido</label>
    <input class="inp" id="ep-apelido" value="${me.apelido}">
    <label class="flbl" style="margin-top:12px">Nome completo</label>
    <input class="inp" id="ep-nome" value="${me.nomeCompleto}">
    <label class="flbl" style="margin-top:12px">Ano de nascimento</label>
    <input class="inp" id="ep-nasc" type="number" inputmode="numeric" placeholder="Ex: 1998" value="${nascimento||''}" min="1920" max="${hoje.getFullYear()}">
    <label class="flbl" style="margin-top:12px">Faixa</label>
    <div class="seg-wrap" id="ep-belt"></div>
    <label class="flbl" style="margin-top:12px">Grau</label>
    <div class="seg" id="ep-graus"></div>
    <label class="flbl" style="margin-top:12px">Data da faixa atual</label>
    <input class="inp" id="ep-data-faixa" type="date">
    <button class="btn-save" id="ep-save" style="margin-top:16px">Salvar</button>
    <button class="sheet-cancel" id="ep-cancel">Cancelar</button>
  </div></div>`);
  sheet.querySelector('#ep-file').onchange=(e)=>{ const f=e.target.files[0]; if(!f)return;
    if(f.size>500000){ toast('Foto muito grande (máx 500KB)'); return; }
    const r=new FileReader();
    r.onload=()=>{ foto=r.result; sheet.querySelector('.ep-avatar').innerHTML=`<img src="${foto}" alt="">`; }; r.readAsDataURL(f); };
  const _rebuildGraus=()=>{
    const gs=sheet.querySelector('#ep-graus'); gs.innerHTML='';
    const mx=maxGraus(faixa); if(graus>mx) graus=mx;
    for(let g=0;g<=mx;g++){ const x=el(`<button class="${g===graus?'active':''}">${g}º</button>`);
      x.onclick=()=>{ graus=g; gs.querySelectorAll('button').forEach(y=>y.classList.remove('active')); x.classList.add('active'); }; gs.appendChild(x); }
  };
  const bs=sheet.querySelector('#ep-belt');
  ADULT_BELTS.forEach(b=>{ const x=el(`<button class="seg-chip ${b===faixa?'on':''}">${BELTS[b].nome}</button>`);
    x.onclick=()=>{ faixa=b; bs.querySelectorAll('.seg-chip').forEach(y=>y.classList.remove('on')); x.classList.add('on'); _rebuildGraus(); }; bs.appendChild(x); });
  _rebuildGraus();
  const dataFaixaAtual = (DB.graduacoes||[]).find(g=>g.tipo==='faixa'&&g.faixa===me.faixa);
  const epDataFaixa = sheet.querySelector('#ep-data-faixa');
  if(dataFaixaAtual) epDataFaixa.value = dataFaixaAtual.data;
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#ep-cancel').onclick=close;
  sheet.querySelector('#ep-save').onclick=()=>{
    me.apelido = sheet.querySelector('#ep-apelido').value.trim() || me.apelido;
    me.nomeCompleto = sheet.querySelector('#ep-nome').value.trim() || me.nomeCompleto;
    const base = (me.nomeCompleto||me.apelido||'').trim();
    me.nome = base.split(' ').slice(0,2).join(' ') || me.apelido;
    me.iniciais = (base.split(/\s+/).map(s=>s[0]).slice(0,2).join('') || (me.apelido||'A')[0]).toUpperCase();
    const nv=parseInt(sheet.querySelector('#ep-nasc').value); me.nascimento=(nv>=1920&&nv<=hoje.getFullYear())?nv:me.nascimento;
    const novaData = epDataFaixa.value || HOJE_ISO;
    const faixaMudou = faixa !== me.faixa;
    const grausMudou = graus !== me.graus;
    me.faixa=faixa; me.graus=graus; me.foto=foto;
    if(faixaMudou){
      if(!DB.graduacoes.some(g=>g.tipo==='faixa'&&g.faixa===faixa))
        DB.graduacoes.push({faixa, graus:0, tipo:'faixa', data:novaData, por:'—'});
    } else {
      const existing = DB.graduacoes.find(g=>g.tipo==='faixa'&&g.faixa===faixa);
      if(existing && epDataFaixa.value) existing.data = epDataFaixa.value;
    }
    if(grausMudou && graus>0 && !faixaMudou){
      if(!DB.graduacoes.some(g=>g.tipo==='grau'&&g.faixa===faixa&&g.graus===graus))
        DB.graduacoes.push({faixa, graus, tipo:'grau', data:HOJE_ISO, por:'—'});
    }
    DB.graduacoes.sort((a,b)=>a.data.localeCompare(b.data));
    sheet.remove(); render(); toast('Perfil atualizado ✔');
    if(DB.sbUser && typeof sbSync!=='undefined') sbSync.pushProfile();
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

// ---- Configurações ----
function abrirConfiguracoes(){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Configurações</div>
    <div class="cfg-list">
      <div class="cfg-row" id="cfg-ajuda"><span>📖 Como usar</span><span class="cfg-go">›</span></div>
      <div class="cfg-row" id="cfg-metrics"><span>📈 Métricas do beta</span><span class="cfg-go">›</span></div>
      <div class="cfg-row" id="cfg-feedback"><span>💬 Enviar feedback (beta)</span><span class="cfg-go">›</span></div>
      <div class="cfg-row" id="cfg-export"><span>⬇️ Exportar meus dados (backup)</span><span class="cfg-go">›</span></div>
      <div class="cfg-note">🔒 Seus dados ficam só neste aparelho. Exporte toda semana — assim não perde nada se trocar de celular ou limpar o navegador.</div>
      <div class="cfg-row" id="cfg-priv"><span>🔒 Privacidade & Termos</span><span class="cfg-go">›</span></div>
      <div class="cfg-row" id="cfg-sobre"><span>ℹ️ Sobre o app</span><span class="cfg-go">›</span></div>
      <div class="cfg-row danger" id="cfg-limpar"><span>🗑️ Apagar todos os dados</span><span class="cfg-go">›</span></div>
    </div>
    <button class="sheet-cancel" id="cfg-close">Fechar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#cfg-close').onclick=close;
  sheet.querySelector('#cfg-ajuda').onclick=()=>{ close(); abrirAjuda(false); };
  sheet.querySelector('#cfg-metrics').onclick=()=>{ close(); abrirMetricas(); };
  sheet.querySelector('#cfg-feedback').onclick=()=>{ close(); abrirFeedback(); };
  sheet.querySelector('#cfg-export').onclick=()=>{ close(); exportarDados(); };
  sheet.querySelector('#cfg-priv').onclick=()=>{ close(); abrirPolitica(); };
  sheet.querySelector('#cfg-limpar').onclick=()=>{ close(); limparDados(); };
  sheet.querySelector('#cfg-sobre').onclick=()=> toast('Yama Jiu-Jitsu · protótipo beta 🥋');
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

// ---- Feedback do beta ----
function abrirFeedback(){
  track('feedback');
  const msg = `Feedback Yama (beta)\nAluno: ${DB.eu.apelido||'-'} · faixa ${DB.eu.faixa||'-'}\nTreinos: ${DB.treinos.length}\n\nO que achou / o que quebrou:\n`;
  let url;
  if (FEEDBACK_URL.startsWith('mailto:')) url = FEEDBACK_URL + (FEEDBACK_URL.includes('?')?'&':'?') + 'subject=' + encodeURIComponent('Feedback Yama beta') + '&body=' + encodeURIComponent(msg);
  else url = FEEDBACK_URL + encodeURIComponent(msg);
  try{ window.open(url, '_blank'); }catch(e){ toast('Não consegui abrir — fale com o professor'); }
}

// ---- Montar Sistema novo ----
// ---- Lesões ----
function abrirLesoes(){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet">
    <div class="sheet-grip"></div>
    <div class="sheet-title">🤕 Lesões</div>
    <div class="lesao-list" id="lesao-list"></div>
    <button class="btn-save" id="lesao-add" style="margin-top:6px">＋ Registrar lesão</button>
    <button class="sheet-cancel" id="lesao-close">Fechar</button>
  </div></div>`);
  const renderList=()=>{ const c=sheet.querySelector('#lesao-list'); c.innerHTML='';
    if(!DB.lesoes.length){ c.appendChild(el(`<div class="empty-line">Nenhuma lesão registrada. 🙏</div>`)); return; }
    DB.lesoes.forEach(l=>{ const st={ativa:['gold','Ativa'],recuperando:['blue','Recuperando'],curada:['green','Curada']}[l.status]||['blue',l.status];
      c.appendChild(el(`<div class="lesao-item"><div class="li-top"><span class="li-nm">${safeTxt(l.parte)}</span><span class="niv-badge ${st[0]}">${st[1]}</span></div>${l.nota?`<div class="li-nota">${safeTxt(l.nota)}</div>`:''}<div class="li-dt">${fmtDataLonga(l.data)}</div></div>`)); }); };
  renderList();
  sheet.querySelector('#lesao-add').onclick=()=> abrirNovaLesao(renderList);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#lesao-close').onclick=close;
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}
function abrirNovaLesao(onDone){
  let status='ativa';
  const sheet = el(`<div class="sheet-overlay"><div class="sheet">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Registrar lesão</div>
    <label class="flbl">Parte do corpo</label>
    <input class="inp" id="nl-parte" placeholder="Ex: Joelho direito, ombro…">
    <label class="flbl" style="margin-top:12px">Status</label>
    <div class="seg" id="nl-status"></div>
    <label class="flbl" style="margin-top:12px">Anotação</label>
    <textarea class="ta" id="nl-nota" placeholder="Como aconteceu, cuidados…"></textarea>
    <button class="btn-save" id="nl-save" style="margin-top:12px">Salvar</button>
    <button class="sheet-cancel" id="nl-cancel">Cancelar</button>
  </div></div>`);
  const ss=sheet.querySelector('#nl-status');
  [['ativa','Ativa'],['recuperando','Recuperando'],['curada','Curada']].forEach(([k,l])=>{ const b=el(`<button class="${k===status?'active':''}">${l}</button>`);
    b.onclick=()=>{ status=k; ss.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }; ss.appendChild(b); });
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#nl-cancel').onclick=close;
  sheet.querySelector('#nl-save').onclick=()=>{ const parte=sheet.querySelector('#nl-parte').value.trim(); if(!parte){ toast('Informe a parte do corpo'); return; }
    DB.lesoes.unshift({ id:Date.now(), parte, data:HOJE_ISO, status, nota:sheet.querySelector('#nl-nota').value.trim() });
    close(); if(onDone) onDone(); toast('Lesão registrada 🤕'); };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

// ---- Exportar dados ----
function exportarDados(){
  track('export');
  const tecProg = DB.tecnicas.map(t=>({jp:t.jp, treinos:t.treinos||0, estado:t.estado, ultima:t.ultima, dias:t.dias}));
  const dump = {
    schema: SCHEMA, exportadoEm: new Date().toISOString(),
    eu: { apelido:DB.eu.apelido, faixa:DB.eu.faixa, graus:DB.eu.graus, desde:DB.eu.desde, consentimento:DB.eu.consentimento },
    treinos: DB.treinos, notas: DB.notas, lesoes: DB.lesoes, graduacoes: DB.graduacoes,
    tecnicas: tecProg,
    kpis: (typeof betaKPIs==='function' ? betaKPIs() : null),     // métricas do beta p/ agregação
    analytics: DB.analytics                                        // eventos + erros
  };
  const json = JSON.stringify(dump, null, 2);
  const sheet = el(`<div class="sheet-overlay"><div class="sheet">
    <div class="sheet-grip"></div>
    <div class="sheet-title">📤 Exportar dados</div>
    <div class="flbl">Backup do seu diário (JSON)</div>
    <textarea class="ta" readonly style="min-height:150px;font-size:11px;font-family:monospace">${json.replace(/</g,'&lt;')}</textarea>
    <button class="btn-save" id="exp-copy">Copiar JSON</button>
    <button class="btn-save" id="exp-dl" style="margin-top:8px;background:var(--blue)">Baixar arquivo</button>
    <button class="sheet-cancel" id="exp-close">Fechar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#exp-close').onclick=close;
  sheet.querySelector('#exp-copy').onclick=()=>{ try{ navigator.clipboard.writeText(json); }catch(e){} toast('JSON copiado 📋'); };
  sheet.querySelector('#exp-dl').onclick=()=>{ const blob=new Blob([json],{type:'application/json'}); const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download='yama-diario.json'; a.click(); URL.revokeObjectURL(url); toast('Download iniciado 📤'); };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

// ---- Centro de notificações ----
function abrirNotificacoes(){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet">
    <div class="sheet-grip"></div>
    <div class="sheet-title">🔔 Notificações</div>
    <div class="notif-list" id="notif-list"></div>
    <button class="sheet-cancel" id="notif-close">Fechar</button>
  </div></div>`);
  const list=sheet.querySelector('#notif-list');
  if(!DB.notificacoes.length) list.appendChild(el(`<div class="empty-line">Nenhum aviso novo 🔔</div>`));
  DB.notificacoes.forEach(n=> list.appendChild(el(`<div class="notif-item"><span class="notif-ic">${n.ic}</span><div class="notif-tx"><div class="nt-t">${safeTxt(n.txt)}</div><div class="nt-d">${fmtDataLonga(n.data)}</div></div></div>`)));
  DB.eu.avisos=0; // marca como lidas
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>{ sheet.remove(); render(); },260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#notif-close').onclick=close;
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

// ---- Apagar tudo (reset completo do diário; mantém o catálogo) ----
function limparDados(){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Apagar todos os dados?</div>
    <div class="sheet-desc">Isto apaga seus treinos, progresso das técnicas, streak e graduações deste aparelho. O catálogo de técnicas permanece. Não dá pra desfazer.</div>
    <button class="btn-save danger" id="rs-sim">Apagar tudo</button>
    <button class="sheet-cancel" id="rs-nao">Cancelar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#rs-nao').onclick=close;
  sheet.querySelector('#rs-sim').onclick=async()=>{
    aplicarCleanSlate();
    try{ localStorage.removeItem(STORE_KEY); }catch(e){}
    if(DB.sbUser && typeof sbAuth!=='undefined'){ DB.sbUser=null; await sbAuth.signOut(); }
    sheet.remove(); render(); toast('Dados apagados ✔');
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

/* ---------------- ícones ---------------- */
function icoHome(){return `<svg viewBox="0 0 24 24" fill="none"><path d="M3 11l9-8 9 8M5 10v9a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1v-9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;}
function icoBook(){return `<svg viewBox="0 0 24 24" fill="none"><path d="M4 5h13a2 2 0 012 2v12a1 1 0 01-1.4.9L12 18l-5.6 1.9A1 1 0 015 19V7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;}
function icoChart(){return `<svg viewBox="0 0 24 24" fill="none"><path d="M5 20V10M12 20V4M19 20v-7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;}
function icoUser(){return `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;}
function icoUsers(){return `<svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="2"/><path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16 5.5a3 3 0 010 5.6M17 20c0-2.2-1-3.7-2.5-4.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;}
function icoCard(){return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" stroke-width="2"/><path d="M3 10h18" stroke="currentColor" stroke-width="2"/></svg>`;}
function icoMore(){return `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;}
function icoQR(){return `<svg viewBox="0 0 24 24" fill="none" style="width:26px;height:26px"><path d="M4 4h6v6H4V4zM14 4h6v6h-6V4zM4 14h6v6H4v-6z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" fill="currentColor"/></svg>`;}
function icoQRbig(){return `<svg viewBox="0 0 24 24" fill="none"><path d="M4 4h6v6H4V4zM14 4h6v6h-6V4zM4 14h6v6H4v-6z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M14 14h2.4v2.4H14zM17.6 14H20v2.4h-2.4zM14 17.6h2.4V20H14zM17.6 17.6H20V20h-2.4z" fill="currentColor"/></svg>`;}

/* ============================================================
   SELF-TEST (smoke) — rode com ?test=1 ou selfTest() no console.
   Read-mostly: só mexe na navegação e restaura no fim.
   ============================================================ */
function selfTest(){
  const R=[]; const ok=(name,cond)=>R.push({name, pass: !!cond});
  try{
    ok('plural singular', plural(1,'treino','treinos')==='1 treino');
    ok('plural plural', plural(3,'treino','treinos')==='3 treinos');
    ok('nivelDe novo (0)', nivelDe({treinos:0})==='novo');
    ok('nivelDe dominada (12)', nivelDe({treinos:12})==='dominada');
    ok('_pctAT 1/2=50', _pctAT(1,2)===50);
    ok('isoOf formato', /^\d{4}-\d{2}-\d{2}$/.test(isoOf(new Date())));
    try{ const n=dayChartNode([{a:1,t:2,dia:'x'}]); ok('chart 30 colunas', n.querySelectorAll('.dcol').length===30); }catch(e){ ok('chart 30 colunas', false); }
    try{ const s=semanaStats(); ok('semana tem 7 dias', Array.isArray(s.dias)&&s.dias.length===7); ok('streak é número', typeof s.streakSemanas==='number'); }catch(e){ ok('semanaStats', false); }
    try{ const k=betaKPIs(); ok('kpis tem funil', !!(k&&k.funil&&typeof k.funil.abriu==='boolean')); }catch(e){ ok('betaKPIs', false); }
    ok('safeTxt escapa HTML', safeTxt('<b>x</b>')==='&lt;b&gt;x&lt;/b&gt;');
    ok('nivelDe aprendendo (3)', nivelDe({treinos:3})==='aprendendo');
    ok('nivelDe treinando (5)', nivelDe({treinos:5})==='treinando');
    try{
      const testKey='__yama_test'; const testData={__schema:SCHEMA,onboarded:true,_ultimoDia:HOJE_ISO,eu:{apelido:'Test'},treinos:[]};
      localStorage.setItem(testKey, JSON.stringify(testData));
      const raw=JSON.parse(localStorage.getItem(testKey));
      ok('save/load round-trip', raw && raw.eu && raw.eu.apelido==='Test');
      localStorage.removeItem(testKey);
    }catch(e){ ok('save/load round-trip', false); }
    ok('focoTecnicas é array', Array.isArray(focoTecnicas()));
    ok('_pctAT 0/0=0', _pctAT(0,0)===0);
    ok('idadeCBJJ 1998', idadeCBJJ(1998)===hoje.getFullYear()-1998);
    ok('idadeCBJJ null', idadeCBJJ(null)===null);
    ok('categoriaCBJJ adulto', categoriaCBJJ(hoje.getFullYear()-25)==='Adulto');
    ok('categoriaCBJJ master1', categoriaCBJJ(hoje.getFullYear()-32)==='Master 1');
    ok('categoriaCBJJ null', categoriaCBJJ(null)===null);
    ok('elegibilidade azul', (()=>{ const r=elegibilidadeCBJJ({faixa:'azul',nascimento:1998}); return r.nextBelt==='roxa'&&Array.isArray(r.checks); })());
    ok('elegibilidade preta', (()=>{ const r=elegibilidadeCBJJ({faixa:'preta',nascimento:1998}); return r.nextBelt===null; })());
    ok('tempoNaFaixaMeses', tempoNaFaixaMeses(HOJE_ISO)===0);
  }catch(e){ ok('pure-functions', false); }
  // render de todas as abas (snapshot + restore)
  const snap={ nav:DB.navAluno, jt:DB.jogoTab, jo:DB.jornadaTab };
  [['inicio'],['jogo','progresso'],['jogo','biblioteca'],['jogo','analise'],['jornada','historico'],['jornada','frequencia'],['jornada','graduacao'],['perfil']]
    .forEach(([nav,sub])=>{ try{ DB.navAluno=nav; if(sub){ if(nav==='jogo')DB.jogoTab=sub; else DB.jornadaTab=sub; } render(); const t=($('#root').innerText)||''; ok('render '+nav+(sub?'/'+sub:''), !/NaN|undefined|\[object/.test(t)); }catch(e){ ok('render '+nav, false); } });
  DB.navAluno=snap.nav; DB.jogoTab=snap.jt; DB.jornadaTab=snap.jo; try{ render(); }catch(e){}
  const pass=R.filter(r=>r.pass).length, fail=R.length-pass;
  try{ console.log(`%cYama selfTest: ${pass}/${R.length} OK${fail?' · '+fail+' FALHARAM':''}`, 'font-weight:bold;color:'+(fail?'#e5392f':'#2fa86a')); R.filter(r=>!r.pass).forEach(r=>console.warn('FALHOU:', r.name)); }catch(e){}
  return { pass, fail, total:R.length, results:R };
}

/* ---------------- boot ---------------- */
if (DEMO) {
  // modo demonstração (?demo=1): seed rico, NÃO carrega nem salva nada
  render();
} else if (typeof SB === 'undefined' || typeof SUPABASE_URL === 'undefined' || SUPABASE_URL.includes('SEU_PROJETO')) {
  // Supabase ainda não configurado → modo localStorage (compatibilidade legada)
  const _hadSave = load();
  if (!_hadSave) { aplicarCleanSlate(); DB.onboarded = false; }
  if (!DB.onboarded) DB.onboardingOpen = true;
  if(!render._wrapped){ const _ro = render; render = function(){ _ro.apply(this, arguments); scheduleSave(); }; render._wrapped=true; }
  track('app_open');
  render();
} else {
  // Modo Supabase: auth obrigatória, sync offline-first
  (async ()=>{
    if(!render._wrapped){ const _ro = render; render = function(){ _ro.apply(this, arguments); scheduleSave(); }; render._wrapped=true; }

    // 2. carrega cache local (UI instantânea enquanto verifica sessão)
    const _hadLocal = load();
    if (!_hadLocal) aplicarCleanSlate();

    // 3. verifica sessão Supabase (lê de localStorage — sem rede)
    let session = null;
    try{ const { data } = await SB.auth.getSession(); session = data?.session??null; }catch(_){}

    if (session) {
      DB.sbUser = session.user;
      // não confiar no checkin do cache local — zera até pullAll confirmar
      DB.checkinHoje = { feito:false, hora:null };
      if (!DB.eu.apelido || !DB.onboarded) DB.onboardingOpen = true;
      track('app_open');
      render();
      Promise.all([sbSync.pullAll(session.user.id), sbSync.pullTecnicaDoDia()]).then(()=>{
        render();
      }).catch(()=>{});
      sbAuth.onAuthStateChange((event)=>{
        if(event==='SIGNED_OUT'){ DB.sbUser=null; aplicarCleanSlate(); DB.authOpen=true; render(); }
      });
    } else {
      // sem sessão → tela de auth
      DB.authOpen = true;
      track('app_open');
      render();
      sbAuth.onAuthStateChange((event, s)=>{
        if(event==='SIGNED_IN' && s){
          DB.sbUser = s.user;
          DB.authOpen = false;
          DB.checkinHoje = { feito:false, hora:null };
          if(!DB.eu.apelido || !DB.onboarded) DB.onboardingOpen = true;
          render();
          Promise.all([sbSync.pullAll(s.user.id), sbSync.pullTecnicaDoDia()]).then(()=>{
            render();
          }).catch(()=>{});
        }
      });
    }
  })();
}

// Splash: some após o app montar
(function(){
  const sp = document.getElementById('splash');
  if (!sp) return;
  const hide = ()=>{ sp.classList.add('hide'); setTimeout(()=>sp.remove(), 600); };
  sp.addEventListener('click', hide);          // toque pula a splash
  setTimeout(hide, 1900);
})();

// ?test=1 → roda o smoke test e guarda o resultado em window.__selfTest
try{ if (new URLSearchParams(location.search).has('test')) setTimeout(()=>{ window.__selfTest = selfTest(); }, 500); }catch(_){}
