# Changelog — Journal BJJ | Yama

> Histórico de versões (mais recente no topo). Convenção [Keep a Changelog](https://keepachangelog.com).
> Roadmap do que ainda não foi feito: [ROADMAP.md](ROADMAP.md). Decisões: [decisions/](decisions/).
>
> **Notas de leitura:** ordenação por **data ↓** e, dentro do dia, por **versão ↓**. O número de versão casa com `app.js?v=N`, mas **não é uma chave monotônica confiável** neste histórico: alguns números foram **reutilizados** no início (dois `v122`, `v142`, `v143` — mudanças diferentes no mesmo dia) e o intervalo **v178–v192 não foi reconstruído** (sem histórico git na época). Entradas sem número (`Backend — …`, `Reconciliação`, `Hardening`) são lotes de artefato/manutenção e ficam no fim do respectivo dia.

---

## Concluídas ✓

### v459 — carrossel do hero: snap inicial forçado + dot conservador (2026-08-11)

Sheet de produto abria com carrossel em posição intermediária no iOS PWA: a foto ficava
"meio a meio" e o dot 2 acendia mesmo com a foto 2 só metade visível. Duas causas
independentes fechadas na mesma versão:

- **Snap não completava:** `scroll-snap-type: x mandatory` tem bug conhecido no iOS Safari
  standalone quando conteúdo é montado dinamicamente (o `_buildHeroGallery` roda ~200ms
  depois do sheet abrir, esperando os probes das fotos). Fix: `requestAnimationFrame` +
  `scrollTo({left:0, behavior:'auto'})` logo após o append — garante estado inicial exato.
- **Dot flip prematuro:** o handler usava `Math.round(scrollLeft/width)`, que acende o dot
  2 assim que `scrollLeft ≥ 50%`. No meio do gesto, dot mudava antes do snap completar.
  Fix: só reflete quando `|raw − round(raw)| < 0.1` (tolerância 10%) — dots ficam parados
  no último snap conhecido durante o gesto.

### v458 — emoji do produto para de vazar atrás da foto (2026-08-11)

`.prod-hero`, `.prod-img` e `.ci-img` (sheet, grade e carrinho) tinham o emoji fallback
como text node solto — CSS não consegue mirar text node pra esconder. Quando a foto tinha
transparência ou o carrossel montava dinamicamente, o emoji 👕 aparecia atrás. `.ld-img`
já resolvia via wrapper `<span class="ld-emoji">` escondido por `.has-img .ld-emoji`.

Fix mínimo (3 lugares): no template, se `p.img` existe, nem emite a emoji — `${p.img?'':safeTxt(p.emoji)}`.
Sem text node, nada pra vazar em nenhum estado. Se um dia o produto ficar sem foto, a
emoji volta como fallback normal.

### v457 — horário da aula nos cards da Home (2026-08-11)

Home "Últimos treinos" mostrava só "Ter, 11 ago" — se aluno tem duas aulas no mesmo dia,
dois cards idênticos, sem forma de distinguir. Agora mostra "🕐 19:30 · Ter, 11 ago".
`histItem` em `dateMode=true` também prefixa com hora. Fallback preservado pra treinos
legados sem `horaAula`.

### v456 — horário da aula no subtítulo da Jornada (2026-08-11)

Card do treino na Jornada agora mostra "🕐 19:30 · Renshū · De La Riva" (ou só "🕐 19:30"
pra placeholder da chamada do professor, sem enriquecimento). Prefixa `horaAula` no subtítulo
do `histItem` — treinos legados sem `horaAula` seguem mostrando só a técnica.

### v455 — presença marcada pelo professor vira treino placeholder editável (2026-08-11)

**Reescrita da v454.** O modelo de "card read-only separado" mostrado no `_meusCheckins` era
inconsistente com o resto da UX (aluno não conseguia enriquecer, e a Home "últimos treinos"
não incluía). Reescrito pra **injetar em `DB.treinos`** direto no adapter.

`sbSync.pullAll` agora: pra cada check-in do servidor sem par em `DB.treinos` (chave estrita
`data + turmaId + horaAula`, fallback DATE-only pra treinos legados sem `turmaId`), injeta
um placeholder com `_fonte:'servidor'`, `tecnica:''`, `mood:null`. O placeholder vira parte
do dump privado do aluno — a chave estrita garante idempotência entre boots e aparelhos.

**Consequências:**
- Home "Últimos treinos" e Jornada mostram o card como qualquer treino próprio.
- Clique abre `renderTreinoDetalhe`, editável — aluno enriquece Renshū/mood/randori depois.
- Long-press esconde "Excluir" pra `_fonte:'servidor'` — presença é do servidor; aluno
  pede pro professor apagar se for erro.
- `_finalizarCheckin` agora também carimba `turmaId + horaAula` no treino local — sem isso,
  o próximo `pullAll` criaria placeholder duplicado.

Reverti as mudanças da v454 em `_attendedSet`, `_treinosNoDia`, `_treinoDays` e
`jornadaHistorico` — `DB.treinos` já é o merge agora.

### v454 — Jornada do aluno inclui presenças do professor (estratégia intermediária) (2026-08-10)

Adicionou `sbSync.pullAll` puxando `checkins` do próprio aluno para `DB._meusCheckins`
(memo, não persistido). `_attendedSet`, `_treinosNoDia`, `_treinoDays` e `jornadaHistorico`
mergiam ao renderizar. **Substituída pela v455**, que mudou a estratégia pra injetar
placeholders em `DB.treinos` direto (permite editabilidade, elimina merges espalhados).

CI falhou nesta versão (`_meusCheckins` afetava assertions do selfTest headless). Corrigido
implicitamente pela v455 ao reverter os merges.

### 0037 — `aulas_por_aluno` reconhece `tipo='inicio'` na âncora do grau (2026-08-11)

Import de presenças legadas gravava `aulas_credito_grau` no evento âncora (adapter
`importarCreditosPresencas`). Pra alunos com apenas o evento inicial (`tipo='inicio'`, sem
graduação registrada ainda), o crédito ficava **gravado no banco mas invisível no app**:
a RPC 0034 procurava `ref_grau` só em `tipo='faixa'` quando `graus=0`, retornava NULL, e o
`o_credito_grau` caía em 0. **45 alunos afetados em prod**.

**Fix:** ampliar o predicado do `ref_grau` (e do `o_credito_grau`) pra `tipo IN ('faixa','inicio')`
quando `graus=0`. Mesma regra que `ref_faixa` já usava. `create or replace function`, zero
downtime. Achado ao investigar por que a importação do Paçoca (Guilherme Sales Jones) não
aparecia — a linha estava lá, era leitura quebrada.

### v453 — coluna "Últ. presença" mostra DD/MM/AA + coluna "Dias sem" deletada (2026-08-10)

Duas colunas dizendo a mesma coisa: "Últ. presença" mostrava só "ausente"/"✓ hh:mm" e "Dias sem"
mostrava "999d". Redundante. Agora "Últ. presença" mostra a **data** do último check-in (formato
`DD/MM/AA`) quando o aluno não está presente hoje; se está, mantém `✓ hh:mm`. Coluna "Dias sem"
removida em todos os 3 breakpoints (1024/1200/1320px). Sort da coluna agora aponta pra `diasSem`.
Adapter (`supabase.js`) expõe `base.ultimaPres` (ISO YYYY-MM-DD do último checkin).

### v452 — remove ícones SVG do sheet "Mais" (2026-08-10)

Sheet do "Mais" do professor mobile tinha ícone SVG grande do lado do label ("🎗️ Graduação"). O
emoji do próprio label já cumpria a função visual — SVG duplicava. Removido `.mais-ic` da linha
e do CSS. Layout ficou mais limpo, altura da linha caiu.

### v451 — vitrine da Loja Yama: remove `document.hidden` do rAF (2026-08-10)

A v450 tinha `if(document.hidden) { running=false; return; }` como guard "otimização" dentro do
`step()`. Bug: em iOS PWA logo após load, `document.hidden` fica `true` sem disparar
`visibilitychange`. O loop morria e nunca reanimava. **Fix:** removido o check manual — rAF é
throttled naturalmente pelo browser em aba background e retoma sozinho. Ficou minimalista.

### v450 — vitrine da Loja Yama volta a ser arrastável (2026-08-10)

Regressão do v442 (que trocou rAF por CSS marquee): `translateX` no track exige `overflow:hidden`
no ticker, então o aluno não conseguia mais "puxar por lado e voltar no que já passou". Volta pro
autoscroll via `scrollLeft` (padrão do v270). Corrige o bug antigo do v270 (aba background trava
rAF em 0Hz e não retoma): adiciona listener `visibilitychange` que reinicia o rAF quando a aba
volta a ficar visível.

**Bônus (mesma versão, CSS):** `belt-mini` no mobile virou `flex:none`. Antes o `.st-mid .meta`
(flex container) apertava a belt e o `overflow:hidden` recortava o lado direito de forma
DIFERENTE em cada linha (às vezes cortando o end colorido, às vezes o tip preto) — daí a
sensação de "belts com tamanhos e ponteiras aleatórios". `.meta` também ganhou `flex-wrap:wrap`
e o `.st-turma-chip` perdeu o `max-width:130px` que truncava "CHIISAI" em "CHIISA…".

### v449 — "meus pedidos" sai do card Loja Yama da home (2026-08-10)

O link "meus pedidos" ficava no header do card da vitrine na home, ao lado de "ver tudo ›" —
misturava consulta de histórico com a apresentação da loja e confundia. Migrado pra dentro
da própria Loja aberta, como uma linha `.cfg-row` "🧾 Meus pedidos ›" no topo.

### v448 — RPC de check-in exige `hora_aula` (fim das aulas-fantasma NULL) (2026-08-09)

Aluno via **duas presenças** no mesmo dia na chamada — uma no horário da turma (19:30), outra
com aula-fantasma (hora=NULL). Bug pré-v429 no cliente que passava `p_hora_aula=null` pra RPC,
que aceitava e criava aula NULL. O UNIQUE `(user_id, aula_id)` não deduplicava contra a chamada
do professor (aula_id diferente). Tinha 7 alunos com esse padrão na base.

**Fix em duas camadas:**
- **Servidor (migration 0036):** `checkin_self_registrar` e `marcar_presenca_lote` passam a
  rejeitar `p_hora_aula NULL/vazio` com `raise exception 'hora_aula obrigatoria'`. Impossível
  criar aula-fantasma nova, mesmo com cliente cacheado pré-v429.
- **Cliente (v448):** `sbSync.pushCheckin` faz early-return se `ses.hora` estiver vazio — não
  chega no RPC nem gera 500. Defesa contra dump antigo.

Limpeza: deletado o checkin duplicado do Gabriel e a aula-fantasma órfã que sobrou.

### v447 — painel 🐞 volta a listar erros (`contexto` → `ctx`) (2026-08-09)

Três bugs em cascata, todos por nome de coluna errado:
1. `sbProf.getErros` fazia `.select('msg, contexto, ...')`. A coluna é `ctx`, não `contexto`.
   PostgREST devolvia erro, adapter engolia com `data || []`, sheet mostrava "Nenhum erro"
   mesmo com erro real na base.
2. `_profErrosSheet` lia `r.contexto` no render — mesmo bug.
3. Trigger `notify_client_error` (migration 0032) tinha `new.contexto`. Coluna inexistente. O
   `exception when others` engolia o `undefined_column` silenciosamente e a ntfy saía sem o
   `@ arquivo:linha`. Migration 0035 corrige — bonus: `:0:0` (browser sanitizando cross-origin)
   agora vira "" e não polui a msg.

Adicionado `crossorigin="anonymous"` em `app.js`/`supabase.js` — libera stack completo pro
`window.onerror` mesmo em same-origin.

### v446 — "Mais" do professor no mobile abre sheet com todas as áreas (2026-08-09)

No desktop, a sidebar mostra tudo (Painel/Alunos/Turmas/**Graduação**/Relatórios/**Vídeos**/**Loja**/**Yama**/Perfil). No mobile, o bottom tabbar cabe só 5 tabs — Graduação, Vídeos, Loja e Yama ficavam `tab-wide` (invisíveis) e o professor precisava **virar o celular pra landscape** ou usar o botão ⚙️ do header do Painel pra achar o Hub. E a "Mais" navegava direto pro `perfil`, sem passar por lugar nenhum.

Agora "Mais" abre `_profMaisSheet` com 5 atalhos: 🎗️ Graduação · 🎥 Vídeos · 🛍️ Loja · ⚙️ Hub YAMA · 👤 Meu perfil. Clique fecha o sheet e navega. Desktop segue com a sidebar (o sheet funciona lá também, mas ninguém precisa dele).

### v445 — pagamento Pix usa valor com desconto (2026-08-09)

`carrinhoTotal()` continua sendo a referência do preço-cartão (nunca chega ao servidor — cartão
é pago na academia). Novo helper `carrinhoTotalPix()` aplica `_precoPix()` sobre o total.

**Onde entra:**
- Tela "Pagamento por PIX": valor-cartão riscado + valor-Pix em verde + badge `−X%`.
- BR Code (Copia-e-Cola) montado com o valor-Pix — o banco cobra o valor correto.
- `pedidos.total` gravado no DB = valor-Pix (o que o aluno realmente pagou).
- Sacola já mostra "Total no Pix" com os dois preços, evitando surpresa no checkout.

### v444 — "Configurações da loja" vira botão na Loja (2026-08-09)

Sheet nova `_lojaConfigSheet` na Loja do professor (**⚙️ Configurações da loja**) que hospeda
o `descontoPix`. Sai do `_dadosAcademiaSheet` — não fazia sentido misturar regra de loja com
identidade da academia (nome/WhatsApp/PIX). Config continua em `academies.config.descontoPix`,
compartilhada por todos os professores.

### v443 — título "Loja Yama" vira botão + seta animada (2026-08-09)

O card "🛍️ Loja Yama" no perfil do aluno tinha o link "ver tudo ›" mas o próprio título não
abria a loja. Adicionado clique + `keydown` (Enter/Espaço) no `.ld-t`, mais uma setinha `›` ao
lado com animação `ld-nudge` (leve toque a cada 1.8s) sinalizando que é clicável.

### v442 — vitrine da Loja Yama volta a animar (CSS marquee em vez de rAF) (2026-08-09)

O autoscroll da vitrine (introduzido em v270) usava `requestAnimationFrame` incrementando
`scrollLeft` a cada frame. Chrome trava rAF em **0 Hz** quando a aba fica em background
(economia de bateria) — e em PWA / trocas de aba a página frequentemente é considerada
"hidden". Resultado: vitrine parada mesmo com a aba visível de novo.

**Fix:** troquei por CSS marquee (`@keyframes translateX(-50%)` sobre o `.ld-track`, que já
tem os cards duplicados). CSS animation não sofre do mesmo throttle, e é ~20 linhas de código
a menos. Pausa no toque via classe `.ld-hold` (pointerdown/up).

### v441 — Loja com submenu de ocultos + preço cartão/Pix (2026-08-09)

**Ocultos viram subpágina.** Antes eram um `<details>` no fim da lista (v440). Agora um botão
**🚫 Ocultos (N)** ao lado do "＋ Novo produto" abre uma tela dedicada (`DB.lojaOcultosOpen`)
com só os ocultos + botão "‹ Voltar pra loja".

**Preço dual (cartão + Pix).** Novo campo `academies.config.descontoPix` (0–90%, global da
academia). Quando > 0, cards mostram preço-cartão riscado + preço-Pix em verde com badge
"−X%". Aparece na lista do professor, na grade do aluno e no sheet do produto. Nota "💳
Cartão: pago na academia Yama" no sheet. Se `descontoPix = 0`, tudo cai no comportamento
antigo (preço único).

### v440 — Loja principal só mostra ativos, remove aviso de estoque baixo (2026-08-09)

Filtro `p.ativo!==false` na lista principal da Loja do professor. Ocultos passam pra um
`<details>` colapsável no fim (depois substituído por subpágina na v441). Badge "estoque
baixo" e contador no header removidos — pedido do dono.

### v439 — `renderBg` guarda `produtoFormOpen` (fix foto sumindo após animação) (2026-08-09)

O auto-save da foto (v437) chamava `sbProf.salvarProduto` → `onDadosMudaram` → `renderBg()`.
Mas `renderBg` só bloqueava com `authOpen`, `trocarSenhaOpen`, `onboardingOpen`, `batchCheckin`
— **`produtoFormOpen` não estava na lista**. O refetch varria o form com a foto recém-carregada
logo depois da animação (bug "faz animação e some do nada"). Fix: adicionado `produtoFormOpen`
à guarda.

### v438 — upload de foto de produto com spinner + auto-save (2026-08-09)

**O buraco:** o botão "＋" no editor de produto subia a foto pro Storage no mesmo instante,
mas `produtos.img_url` só era gravado no clique em "Salvar". Se o professor fechasse a tela
sem salvar, a foto ficava órfã no bucket e o produto continuava sem imagem — foi o que
aconteceu com o **KIMONO YAMA | BRANCO** no 2026-08-09 (8 fotos no bucket, `img_url = null`).

**Correção:**
- **Auto-save após upload** — quando o produto já existe no DB, `sbProf.salvarProduto`
  roda direto ao final do `fileIn.onchange`, persistindo `img_url`/`img_urls` sem exigir
  clique em Salvar.
- **Placeholder animado** (`.pf-foto.pf-loading` — shimmer + spinner) por cada foto em voo.
  Botão "＋" fica `disabled` durante o upload; botão "Salvar" vira "Enviando foto…" e
  desabilita até tudo terminar (foto no meio do upload não pode virar `img_url`).

### v437 + Edge `create-student` — cadastro individual usa a senha padrão da academia (2026-08-09)

**O buraco:** o cadastro individual gerava senha aleatória (ex.: `VFcfw542`) e mostrava na sheet
"Aluno cadastrado ✔". Mas o template do convite WhatsApp (`_waConviteBody`, disparado do hub
YAMA / Distribuir acesso) prometia a **senha padrão da academia** (`Yama2026`). Duas verdades
diferentes pro mesmo aluno — quem mandasse o WhatsApp direto sem passar pelo lote
`senhaPadraoLote` entregava uma senha que o Auth não aceitava.

**Correção:** `create-student` passa a aceitar `senha` opcional no body (≥6 chars). O app
manda `_senhaPadrao()` no cadastro individual; sem senha padrão configurada, cai no gerador
aleatório antigo (retrocompat). Deploy: `supabase functions deploy create-student`.

### v436 + Edge `resetar-senha` — reset de senha individual na ficha (2026-08-08)

**O buraco:** o `senha-padrao` (lote) pula, **de propósito**, quem já acessou — trocar a
senha de quem está usando a conta seria sequestrá-la. Em 2026-08-08 isso deixava **8 alunos**
de fora, **6 deles com senha que ninguém conhece**. Eles nem apareciam na lista de pendentes,
e o professor só resolvia editando no SQL Editor.

**Por que não foi por e-mail.** A recuperação (v430) é o caminho preferível — o aluno escolhe
a senha e o professor nunca a conhece. Mas o SMTP padrão do Supabase limita a ~2 e-mails/hora
para o projeto inteiro, o que inviabiliza. **Configurar SMTP próprio continua sendo a
correção de raiz** (ver ROADMAP): destrava também o "Esqueci minha senha" dos 149 alunos.

**Botão "🔑 Redefinir senha"** na ficha do ERP. Duas etapas: a primeira avisa o que a ação
significa, a segunda mostra a senha **uma vez** (com copiar e enviar no WhatsApp). A senha é
aleatória (mesmo gerador do `create-student` — sem caracteres ambíguos, porque é ditada por
WhatsApp) e não é gravada em lugar nenhum do cliente.

**Limite de privacidade, explicitado na própria tela e no código:** quem sabe a senha
**entra na conta e vê o diário** — dado que a RLS nega ao professor de propósito (ADR
0002/0004). O `must_change_pw` **não impede** isso: o gate obriga a definir uma senha antes
de usar o app, então quem entrar primeiro passa por ele. O que ele garante é **detecção** —
a senha entregue deixa de valer, o aluno não entra e reclama. Somado ao `admin_audit`
(`senha_reset_individual`, sem a senha), dá para reconstruir o ocorrido. É controle
administrativo com rastro, não sigilo.

**Hierarquia** (idêntica na Edge Function e no botão, verificada nos dois): dono nunca é
alvo, nem por ele mesmo; professor só pode ser redefinido pelo **dono**; ninguém em si
mesmo; sempre a mesma academia. Rate limit de 10/h no balde `rate_hit` (0001).

### v435 — "Check-ins de hoje" mostra a turma (2026-08-08)

O card do painel listava nome, faixa e hora — o professor não sabia de **qual aula** era a
presença. A consulta de hoje trazia só `user_id,hora`; a turma nem chegava ao cliente.
Agora vem `turmas(nome)` no embed, achatado em `presTurma`.

`a.pres` **continua string** (a hora): exports, ordenação da lista e filtros dependem disso —
a turma foi para um campo novo, fora do `mapAluno` (que tem outros chamadores).

Suporta **mais de uma turma no mesmo dia** (`ADULTO · NO-GI`), consequência direta da v429.
Check-in legado sem vínculo simplesmente não mostra chip. Reusa `.st-turma-chip` da lista de
alunos. `min-width:0` no bloco central faz nome longo truncar em vez de empurrar a hora pra
fora do card — verificado em 375 px, sem scroll horizontal.

### v433/v434 — cartão de visita: abre instantâneo da 2ª vez em diante (2026-08-08)

Depois da v432 a tela nunca mais mostrava dado errado, mas **ainda dependia de uma ida ao
servidor para desenhar qualquer coisa** — não existia nada no aparelho. Todo app que abre
instantâneo tem os dados localmente; não há truque que substitua isso.

**v433 — o cartão.** `localStorage['yama.perfil.<user_id>']` com
`apelido · nomeCompleto · iniciais · faixa · graus` (~100 bytes). Pintado antes de qualquer
rede; o `pullState` sobrescreve em seguida. É **exceção explícita ao ADR 0004**, emendada lá
com as sete condições que a mantêm inofensiva — a principal sendo que `save()` já retorna
com `!_cloudReady`, então pintar do cache **não pode** empurrar dump vazio por cima do
diário (verificado).

**v434 — a miniatura.** `fotoMini`: JPEG de 96 px em `data:`, ~5 KB.
- **Não a signed URL:** cacheá-la não pinta nada instantâneo (o browser ainda baixaria a
  imagem) e expira em 24 h, virando imagem quebrada.
- **Não a foto cheia:** medido com ruído — **729 KB contra 5,1 KB, 143×**. O `localStorage`
  é síncrono; ler centenas de KB antes do primeiro quadro travaria a main thread.
- Sai do **mesmo canvas** do upload (sem rede, sem CORS) e é regerada a cada boot. Falha
  (CORS, URL expirada, canvas *tainted*) só deixa o avatar nas iniciais.
- Leitura aceita **só `data:image/`** com teto de 20 KB: URL plantada no `localStorage` é
  ignorada, senão o app sairia buscando imagem de terceiro no boot.

**`defer` nos três scripts do caminho crítico.** `vendor/supabase-js`, `supabase.js` e
`app.js` eram bloqueantes. Já ficavam no fim do `<body>`, mas o parser parava neles até
baixar e executar. Medido em localhost: `domInteractive` **676 ms → 332 ms**, e os quatro
recursos passaram a baixar em paralelo (~331 ms) em vez de escalonados (334→340). `defer`
preserva a ordem, então a cadeia vendor → adapter → app continua de pé.

**Gargalo real do primeiro acesso, medido:** ~350 KB de JavaScript (gzip: app.js 232 KB +
vendor 51 KB + supabase.js 25 KB + css 38 KB) contra **8 KB** do dump e **84 bytes** de
identidade. O `app.js` custa 250 ms só de parse+execução, mesmo sem latência. Otimizar a
consulta antes disso seria polir o que não pesa — ver ROADMAP (minificação · code splitting).

### v432 — boot: primeiro paint com dado real (fim do flash de perfil vazio) (2026-08-08)

**Sintoma:** ao abrir, a Home aparecia com o perfil vazio e o dado real entrava depois.

**Duas causas somadas.**

1. **Paint prematuro.** O `setTimeout(400ms)` do fim do `app.js` existe pro `_pushBoot()`,
   mas chamava `renderBg()` junto. Em cold start esses 400 ms chegam **antes** do
   `pullState` voltar, e o `DB` ainda é o objeto vazio (v424: o `DB` nasce vazio em
   produção) — resultado: Home pintada com perfil em branco.
2. **Primeiro render no fim da fila.** `_cloudReady = true` (o que libera o splash da
   v419) era setado logo após o `applyDump`, mas o único `render()` do `_cloudLogin`
   ficava **depois de 6 `await` em série**: `pullAll` · `mustChangePassword` · `pullLoja`
   · `pullTecnicas` · `pullTurmas` · `pullMatricula`. O splash saía e revelava o paint
   vazio do item 1, e o dado real só entrava round-trips depois.

**Correções.** `renderBg()` no-opa durante a hidratação (flag `_hidratando`, distinta do
`_cloudLoginBusy` — ver abaixo). `_cloudLogin` passou a pintar **assim que o dump é
aplicado**, com `_lastPushed` calculado antes (o `render` é embrulhado com
`scheduleSave()`: sem a baseline, o primeiro paint empurraria de volta o que acabou de ser
puxado). O que vem depois virou revalidação explícita. `mustChangePassword()` subiu para um
`Promise.all` com o `pullState` — ele decide **qual** é a primeira tela, e agora a primeira
tela é pintada na hidratação; como await tardio, quem precisa trocar a senha veria a Home
piscar. Os 4 pulls finais, que não têm dependência entre si, viraram `Promise.all`: 4 idas
ao servidor em série → 1.

**Bug pego no próprio teste desta versão:** a primeira tentativa reusou `_cloudLoginBusy`
no guard do `renderBg()`. Essa flag é guarda de reentrância e só cai no `finally`, depois
da revalidação inteira — o render final era engolido e a tela nunca via o overlay. Medido
no harness: 1 paint onde deviam ser 2. Daí a flag separada `_hidratando`, que vale só até
o primeiro paint.

**Não implementado (e por quê):** cache-first de verdade (abrir sem rede nenhuma) exigiria
persistir o dump no dispositivo. Hoje **não existe** cache local do perfil — o
`localStorage` guarda só tema, densidade do ERP, vídeos vistos e a sessão do supabase-js; o
dump vive só em `user_state` (ADR 0004). Adicionar isso colocaria diário, notas e lesões no
disco do aparelho — decisão de privacidade, não de performance. Fica registrado no ROADMAP.

### v431 — ficha: transparência do crédito de aulas importadas (2026-08-08)

Caso real que expôs a lacuna: aluno com **9 CHECK-INS** no card da ficha e **20/40** na
coluna GRAU da lista, sem nada explicando os 11 de diferença. Os 11 são o
`aulas_credito_grau` da **0029** — histórico do app antigo que vive como *número* no evento
de graduação, não como linhas em `checkins`. Some da lista de presenças e da contagem de
check-ins, mas conta para a graduação (a RPC `aulas_por_aluno` da 0034 soma os dois).

Agora o card "Histórico de presenças" abre com a nota, quando o crédito é > 0:

> +11 aulas importadas do app antigo — contam para a graduação, mas não têm registro individual.

Fica **acima** do early-return da lista vazia de propósito: aluno com crédito importado e
zero check-ins no app novo é justamente quem mais precisa da explicação. Plural/singular
concordam. Estilo com `var(--field)`/`var(--muted)` — discreto, não vira alerta, e funciona
nos dois temas.

**Só o professor vê.** `_erpPresencas` tem um único chamador (`_erpMain`, a ficha do ERP).
A Jornada do aluno usa `aulasStats`/`jornadaHistorico` e nunca renderiza a nota — decisão do
dono: o aluno vê só o total, sem saber se houve importação.

### v430 — acesso do aluno: recuperação de senha e senha padrão compartilhada (2026-08-08)

**"Esqueci minha senha" nunca funcionou.** `resetPw` mandava
`redirectTo: location.origin`, e `origin` é só esquema+host — **nunca inclui o caminho**.
O app mora em `https://tavaressg.github.io/tavaressg/`, então o link do e-mail levava a
`https://tavaressg.github.io/`, que devolve **404 "There isn't a GitHub Pages site here"**.
O token vinha certo no fragmento (`#access_token=…`), só caía numa página que não sabe
consumi-lo — `PASSWORD_RECOVERY` nunca disparava. Agora vai `origin + pathname`, que
funciona igual em produção (subpasta), em localhost e num domínio próprio.

> Confirmado empiricamente pelo dono: o e-mail **chega** (SMTP padrão do Supabase está
> ok, não precisa de provedor próprio) e o link caía no 404. Um raciocínio intermediário
> supôs que o GoTrue cairia no `SITE_URL` por não achar a URL na allowlist — **não é o que
> acontece**; o `redirectTo` foi honrado e levou pra raiz. Vale a lição de método: o teste
> empírico já existia e foi trocado por dedução.

**Senha padrão era privada de cada professor.** `_senhaPadrao()` lia de
`DB.loja.config.senhaPadrao`, e `'loja'` está em `USER_KEYS` — ou seja, ia no dump, cujo
destino é `user_state` com RLS estritamente self. Consequência: **cada professor tinha a
sua própria senha padrão**. O dono definia `Yama2026` e o segundo professor via o default
hard-coded; se ele clicasse "aplicar", sobrescreveria os 149 alunos com outra senha e
invalidaria em massa os convites já enviados. Migrado para `academies.config`, junto de
`qrToken`/`waTemplates`/`pixBrCode`, com a mesma cadeia de fallback do `_lojaPix`
(nuvem → legado local → default). Semeado em prod com `Yama2026` (a senha que os 149
alunos realmente têm, verificada por bcrypt) via `config || '{...}'::jsonb`, preservando
as 6 chaves existentes.

O texto da tela dizia *"Fica só neste aparelho (não vai pra nuvem)"* — mentira dupla (ia
pro dump E não era compartilhada). Agora diz que vale para toda a academia. O sheet passou
a **esperar a confirmação da nuvem** antes de fechar: senha "salva" que não subiu faria o
professor mandar convite com senha errada.

**Corrida fechada:** `DB.academyConfig` carrega em background e nada redesenhava quando
chegava — a tela "Distribuir acesso" mostraria o fallback até um render acidental, e o
botão "aplicar" leria esse valor. `getConfig()` passou a chamar `renderBg()`.

**Diagnóstico registrado (sem correção nesta versão):** o Edge Function `senha-padrao`
ignora de propósito quem já acessou (`last_sign_in_at` não nulo) — hoje **8 alunos**, dos
quais **6 com senha que ninguém conhece**. É a explicação do sintoma "mando a senha e o
aluno não entra". Eles não aparecem na lista de pendentes e nada avisa que o botão não os
cobre. Também filtra `role='aluno'`: **professor e dono nunca recebem a senha padrão**.
Ver ROADMAP.

### v429 + migration 0034 — aula vira AULA, e a contagem vira fonte única no servidor (2026-08-07)

**Regra nova (decisão do dono):** aula passa a ser contada por **aula distinta**, não
por dia. Academia com 4 turmas ADULTO no mesmo dia (06:30/08:00/12:00/19:30) conta 4.
Sem teto — na prática o esforço limita sozinho. `freq` (% do mês), `diasSem` e streak
**continuam por dia**: são sobre regularidade, não volume.

**Três bugs no caminho do aluno, empilhados:**

1. **Aula fantasma.** `_finalizarCheckin` montava `sessao` sem a `hora`, então
   `pushCheckin` mandava `p_hora_aula: null` e a RPC criava/reusava uma aula
   `(turma, data, NULL)` paralela à real das 19:30. O `UNIQUE (user_id, aula_id)` não
   deduplicava contra a chamada do professor → **check-in duplicado** na mesma aula
   física. E a consulta da v426 (que filtra por `aulas.hora`) não enxergava o
   auto-registro, então o professor marcava de novo.
2. **Dedup por turma.** `porTurma` era chaveado por `turmaId` puro: depois do primeiro
   check-in do dia, as outras 3 sessões da mesma turma sumiam de `_sessoesElegiveis()`.
   Agora a chave é `_aulaKey()` = `turmaId|hora`, casando com a do banco.
3. **Contagem por dia.** Os dois lados usavam `Set` de datas — 4 check-ins viravam
   1 aula.

**Migration 0034 — `aulas_por_aluno()`.** A regra estava escrita **duas vezes** em JS
(`app.js aulasStats` contava de `DB.treinos`; `supabase.js getAlunos` contava de
`checkins`), e o comentário do app admitia *"Reproduz a mesma logica do adapter"*. Duas
implementações divergem por construção — e divergiam: o aluno via um número na Jornada,
o professor via outro na lista. Pior, o diário não tem `turma_id`/`hora`, então era
**impossível** contar aulas distintas por ele.

Agora uma RPC `security definer` faz a conta no Postgres e **os dois papéis chamam a
mesma função** — o escopo mora dentro do `select` (`professor → academia inteira ·
aluno → só ele`). Impossível divergir, não por disciplina, por construção. Segue o
padrão de segurança da 0028: gate na query, `revoke` de `public`/`anon`, `grant` só pra
`authenticated`.

**Some junto o teto de 120 dias.** `getAlunos` buscava check-ins com
`.gte('data', hoje-120d)` e contava no cliente; grau ancorado antes disso perderia
presenças a partir de ~17/11/2026 (quando o corte passa a ser mais recente que
`APP_INICIO`). Alargar a janela resolveria o número e criaria outro problema
(~18k linhas/ano trafegadas a cada refresh). `count(*)` no banco devolve **1 linha por
aluno, constante**. A janela de 120d continua no `ckAll`, mas só pro que ela serve de
verdade: a tendência `freq4`/`base4` de 16 semanas.

**`selfTest` alterado com autorização explícita** (item de "nunca faça sem pedir"). As 4
asserções C1 afirmavam `aulas = DIA distinto` — passaram a afirmar a regra nova, mais uma
quinta cobrindo a precedência do servidor sobre o fallback local. 167/167.

**Ao aplicar a 0034 em produção, `aulasNoGrau` sobe** para quem tem mais de um check-in
no mesmo dia — e é esse número que acende "apto a graduar". Vale conferir quem cruza a
meta no dia do deploy. Sem a migration aplicada, a RPC falha e o app cai no fallback
local (`DB._aulasServidor = null`) — nada quebra, os números só ficam como antes.

### v428 — remoção do lançamento manual de presença (código morto e quebrado) (2026-08-07)

Deletados `_profSetPresenca` (`app.js`), `sbProf.lancarPresenca` e
`sbProf.removerPresenca` (`supabase.js`). Duas razões independentes, ambas suficientes:

**Sem chamador desde a v292**, que tirou "lançar/remover presença" da ficha do aluno
para deixar **um** caminho de escrita — Turmas → Adicionar frequência, o único que grava
`aula_id`/`turma_id`/`hora` reais. A UI foi embora; a plumbing ficou.

**Quebrados desde a 0027** (prod em 2026-07-29). `lancarPresenca` inseria sem `aula_id`,
e a constraint `checkins_fato` exige `turma_id is not null and aula_id is not null` — o
insert morreria com `23514`. A própria migration cita a função pelo nome como uma das
três vias que veio fechar. `removerPresenca` só apagava linhas com `aula_id is null`,
que pós-0027 não podem existir: no-op. Pior, `_profSetPresenca` escrevia o estado local
**antes** de chamar o backend e engolia o erro num `try/catch` que nem pegava (função
async) — o professor veria a presença aparecer e sumir no refetch seguinte.

Continuam vivos e são o caminho suportado: `marcarPresencaLote` (escrita),
`removerPresencaBatch` e `removerCheckinId` (remoção).

Nada de banco — a 0010 já permite N check-ins/dia (UNIQUE parcial `(user_id, aula_id)`)
e a 0027 já barra o insert sem aula. selfTest 166/166.

**Conhecido, não corrigido:** o check-in do aluno deduplica por `turmaId` puro
(`DB.checkinHoje.porTurma`), então quem treina **duas vezes na mesma turma** no mesmo dia
(ADULTO 06:00 e 19:30) só consegue registrar a primeira — o banco e a chamada do professor
aceitam as duas. Fechar exige trocar a chave para `turmaId|hora`, o que mexe no formato do
dump (`checkinHoje` está em `USER_KEYS`) e precisa de aprovação. Turmas **diferentes** no
mesmo dia funcionam normalmente.

### v425–v427 — `render()` de fundo: refetch para de apagar trabalho em andamento (2026-08-07)

**A doença.** `render()` faz `root.innerHTML=''` — teardown total. Isso é inofensivo
numa tela que é projeção do modelo (`DB`), e a maioria é. Quebra nas telas cujo
estado ainda mora no DOM ou numa closure. O problema nunca foi a tela: foi o
**refetch em background não saber distinguir** "tela que só exibe dado" de "tela com
trabalho em andamento". Três versões, o mesmo bug com roupas diferentes.

**v425 — gaveta de rascunho** (`DB._formDrafts`, memória apenas, fora do dump).
`_bindFormDraft()` liga um formulário ao rascunho: restaura no render, grava a cada
digitação (debounce 200ms). Aplicado em `renderCadastroAluno` e `renderProdutoForm`.
A tela vira projeção do rascunho, então `render()` fica inofensivo — sem precisar
travá-lo em cada uma das 144 chamadas, nem na 145ª.

**v426 — chamada (Adicionar frequência).** Mesmo bug: os alunos já marcados viviam
num `Set` local que sumia a cada `render()` — o professor recomeçava a chamada.
Ganhou gaveta com chave `freq:{turma}:{data}:{hora}` (a mesma turma tem horários
diferentes no mesmo dia) mais uma guarda pontual no `_loadProfData`.
No mesmo lote, **bug corrigido**: a consulta de "quem já tem check-in" filtrava só
por `turma_id`+`data`, ignorando o horário — marcar presença às 06:00 fazia o aluno
aparecer como "já presente" nas aulas das 08:00 e 19:30. A amarração correta é o
`aula_id` (fonte única desde a 0025), **não** `checkins.hora`: medido em produção,
`checkins.hora` guarda QUANDO o check-in foi registrado e `aulas.hora` é o horário
da AULA — 261 dos 262 registros divergem. O histórico de presenças passou a ordenar
e exibir pelo horário da aula.

**v427 — a correção estrutural.** Varredura completa dos gatilhos de refetch mostrou
que a guarda pontual da v426 cobria uma tela de nove gatilhos. Faltavam três telas:

- **Login (`renderAuth`)** — `#a-email`/`#a-pw` são DOM puro. Alternar pro gerenciador
  de senhas e voltar disparava `focus` → `_refetchAoVoltar` → `getAlunos()`, que **sem
  sessão resolve com `[]`** (`myAcademyId()` retorna `null`) em vez de rejeitar: o
  `.then()` rodava e o `render()` limpava o formulário. O fetch inteiro era desperdício.
- **Troca de senha (`renderTrocarSenha`)** — mesmos campos, mesmo buraco.
- **Onboarding (`renderOnboarding`)** — `#onb-apelido`, `#onb-nasc` e as vars `bf`/`bg`
  (faixa e grau escolhidos) em closure.

Nasce **`renderBg()`**: redesenho de fundo que no-opa quando há trabalho em andamento
(`authOpen · trocarSenhaOpen · onboardingOpen · batchCheckin`). Todos os oito call
sites de background passaram a usá-lo — `_loadProfData`, `_loadRelData`, `_loadTurmas`,
`_loadPedidos`, `_loadMeusPedidos`, `_refreshOnFocus`, resume detection (>5 min
suspenso), `_checkMidnight` e o `setTimeout` de boot. A guarda pontual da v426 virou
caso particular. `_refetchAoVoltar` ganhou `if(!DB.sbUser) return` — sem sessão não há
o que refazer. `render()` (o do usuário) segue redesenhando tudo, como deve.

**Bug extra achado na varredura:** `_viewKey()` não tinha `authOpen` — o login herdava
a chave da tela pós-login (`al:inicio::`), então entrar no app dava `sameView=true`:
`_closeAllSheets()` não rodava e o scroll de outra tela era restaurado.

selfTest 166/166 · verificado no browser: login sobrevive ao `renderBg()`, é limpo por
um `render()` de verdade, e `_refetchAoVoltar` sem sessão não dispara fetch nenhum.

### v424 — correção ESTRUTURAL: SEED_DEMO × DB, senha padrão no import, alerta de erro útil (2026-08-04)

**A doença, não o sintoma.** As versões v416→v423 foram todas o mesmo bug com
roupas diferentes: dado de vitrine vazando pra usuário real. A cada descoberta
zerávamos mais um campo em produção (v416 alunos/turmas/loja · v422 `FOCO_INICIAL`
· v423 `DB.eu`). Cada campo novo com placeholder era um bug futuro agendado.

Agora a vitrine é **opt-in**: `SEED_DEMO` guarda todo o dado fake e só encosta no
`DB` sob `VITRINE` (`?demo=1` ou `?test=1`). O `DB` nasce vazio — vazar virou
impossível por construção, não por lembrança. Os zeramentos reativos do
`_cloudLogin` foram apagados (viraram código morto). Ficam em produção só a
identidade da marca (`academia.nome/kanji/artes`) e o catálogo de 81 técnicas
(fallback do `pullTecnicas` quando offline).

**Senha padrão no import em lote.** O `create-student` dá a cada aluno uma senha
ALEATÓRIA (`gerarSenha()`), que se perde num lote de 158 — ninguém guarda 158
senhas. O professor mandava "sua senha é Yama2026", o aluno não entrava, e o
reset virava `UPDATE` manual no SQL. Agora o import chama `senhaPadraoLote` ao
final (só para quem nunca acessou) e o resumo diz quantos receberam.

**Alerta externo de erro com conteúdo** (`0032_alerta_erros_detalhado.sql`). A
notificação da 0006 dizia só "erro registrado, veja no painel" — inútil sozinha, e
pior quando a janela deslizante de 24h já tinha cortado o erro do painel. Agora
leva `msg` (truncada em 140), `arquivo:linha:coluna` (basename apenas — descarta
host/query onde um token poderia se esconder), `app_version` e o total de 24h.
Continuam de fora: stack completo, `contexto` inteiro e qualquer PII.

### v403–v407 — Loja: confirmação de PIX, Web Share, "meus pedidos", txid de conciliação (2026-08-01)

Check-in do aluno abre a câmera direto no toque (antes exigia 2 toques) e o ícone
de QR perdeu o ruído visual (dots aleatórios que pareciam bugados).

Fluxo de compra da Loja ganhou uma sheet de confirmação PIX antes de pagar —
mostra recebedor/chave/cidade extraídos do próprio BR Code que o professor colou
(sem campo novo pra manter), com aviso de golpe. Botão **"Pagar no meu banco"**
usa a Web Share API (abre a folha nativa do iOS/Android com os apps de banco
instalados); **"Já paguei"** amarra o WhatsApp com um marker de pagamento e
dispara push pro(s) professor(es)/dono via RPC `notificar_pedido_pago` (migration
`0030_pedidos_txid_notificar.sql` — **requer** `supabase functions deploy
send-push` pra o template `pedido_pago` valer em produção). Cada pedido carrega
um **txid** curto gerado no cliente (25 alfanuméricos), injetado no campo 62.05
do BR Code e salvo em `pedidos.txid` — resolve "5 alunos pagaram R$150 no mesmo
dia, qual é qual" no extrato do banco.

Card do produto mostra os tamanhos com estoque (pill riscada = esgotado) —
antes só aparecia ao abrir o produto. Aba "Mais" do aluno ganhou **Meus
pedidos**: histórico das próprias compras com status/valor/ref., reaproveitando
o backend que já existia (`pedidos` + RLS `pedidos_self_rw`, migration 0001/0005).

### v379 — leitor QR resiliente: jsQR vendorizado + câmera pedida primeiro (2026-07-30)

**Bug crítico confirmado hoje:** desde a v374, iPhone em Safari PWA (majoritário na base)
**nunca conseguiu bater presença**. `BarcodeDetector` é API só do Chromium — Safari e
Firefox não têm em versão nenhuma. O `presencaScan` verificava `'BarcodeDetector' in window`
**antes** de pedir câmera; caía direto no toast "Este navegador não lê QR" e saía. Prompt
de câmera nunca aparecia. iOS Safari + PWA = zero funcionalidade de check-in.

**Vendorizado `vendor/jsqr.min.js`** — jsQR 1.4.0 (MIT, sem deps), leitor QR JS puro,
minificado via esbuild (127 KB, ~35 KB gzipped). Baixado do `unpkg`, adicionado ao
`gen_sri.mjs` e incluído no `index.html` com `defer` + SRI
(`sha384-RzK85/…FCV2dG`). Único novo vendor desde o lançamento — necessário porque
o Web Platform não oferece leitor QR nativo em Safari.

**`_fazerDetectorQR()` (novo helper).** Escolhe motor por capability detection:
- Se `BarcodeDetector` existe → usa nativo (Chrome/Android/Edge, mais rápido).
- Senão → jsQR: aloca canvas 2D `willReadFrequently:true` uma vez, amostra o frame
  do video, chama `jsQR(imageData, w, h, {inversionAttempts:'dontInvert'})`.

**`presencaScan` reescrito com ordem invertida.** Antes: (1) checa BarcodeDetector, (2)
pede câmera. Agora: (1) checa token, (2) **pede câmera primeiro** (aluno sempre vê o
prompt nativo do iOS/Chrome — obrigatório no iOS que o `getUserMedia` seja resposta
direta ao clique), (3) escolhe motor, (4) roda o loop. Fallback pra
`facingMode:'user'` (ou `video:true`) se `environment` quebrar em `OverconstrainedError`
(laptop sem câmera traseira).

**Mensagens específicas por erro** (`_presencaCameraErro`) — em vez do "Sem acesso à
câmera" único da v374:
- `NotAllowedError` / `SecurityError` → **"Você bloqueou a câmera. Vai em Ajustes do
  celular → Yama Jiu-Jitsu → Câmera → Permitir, e tente de novo."** (era o caso mais
  comum e tinha mensagem inútil).
- `NotFoundError` / `DevicesNotFoundError` → "Este aparelho não tem câmera disponível".
- `NotReadableError` / `TrackStartError` → "A câmera está sendo usada por outro app".
- Default → "Câmera indisponível".

**Verificação:** selfTest 160/160 headless. Chromium headless (sem BarcodeDetector, sem
câmera) cai corretamente em: `jsQR: function` ✓, `_fazerDetectorQR() → function` ✓,
ordem `getUserMedia` antes de `_fazerDetectorQR` ✓. Chamada real do `presencaScan` sem
câmera devolveu toast `NotFoundError` traduzido corretamente.

`app.js?v=379`. `index.html` ganha uma linha nova (`vendor/jsqr.min.js`). Nenhuma mudança
de backend/RPC/RLS.

### v378 — auto-heal de subscription push zombie (2026-07-30)

**Bug real observado hoje:** subscription no banco vira "zombie silencioso" — provedor
Web Push (APN da Apple, FCM do Chrome) invalida o endpoint mas **não devolve HTTP 410**
pra Edge. A Edge continua achando que o endpoint tá vivo, entrega push com sucesso
(`sent:2, removed:0`), mas o navegador do aluno descarta silenciosamente. Sintoma:
`enviar_push_teste` reporta 200 OK, nada chega em NENHUM aparelho, ninguém sabe por quê.

Aconteceu hoje ao testar o botão 🧪 do sheet 🔔. Fix imediato foi `delete from
push_subscriptions where user_id=meu_uuid` + re-ativar o sino no PWA. Este release
automatiza esse fluxo no boot de cada aparelho.

**`sbPush.healSubscription()` (novo em supabase.js?v=52).** Roda no `_pushBoot`
(fire-and-forget dentro de `setTimeout(800ms)`, silencioso — nunca borbulha erro pro
usuário). Três estados, guards triplos (suporte + `Notification.permission==='granted'`
+ sessão ativa):

- **Navegador tem subscription + banco a conhece** → no-op.
- **Navegador tem subscription + banco NÃO conhece o endpoint** → upsert (cobre o
  cenário pós-wipe do professor: aparelho ainda tem sub válida mas o banco foi zerado).
- **Navegador PERDEU a subscription** (zombie do provedor) + aparelho já ativou push
  antes (flag `localStorage['yama.push.ativou']`) → chama `pushManager.subscribe()` e
  upsert. Endpoint novo, banco atualizado, aluno volta a receber sem tocar em nada.

**Flag `yama.push.ativou`** (novo em `sbPush.ativar`/`desativar`): marca "esse aparelho
já foi opt-in explícito". Impede o auto-heal de pedir permissão pra quem nunca ligou
(seria surpresa/agressivo). Se `subscribe()` falhar dentro do heal, a flag é removida
pra não retentar em loop no próximo boot.

**Verificação:** selfTest 160/160. Método existe (`typeof healSubscription === 'function'`),
retorna `{ok:false, motivo:'sem_permissao'}` em contexto sem permissão de notificação
(comportamento esperado do headless). Boot referencia com `setTimeout(800)` + `.catch(()=>{})`.

Não substitui o wipe manual em casos extremos (aluno que "não recebe nada" — pedir pra
desligar/religar o sino segue sendo o primeiro passo). Cobre o cenário mais comum:
aparelho ficou dias sem abrir o PWA e a subscription venceu silenciosamente.

### v376 / migration 0028 — gestão de push (aparelhos + teste) + WhatsApp com 8 templates (2026-07-30)

**Migration 0028 · duas RPCs pequenas.**

- `push_subs_academia()` — retorna `{user_id, criado_em, user_agent}` da academia. Gated
  `is_professor()` + join com `profiles` filtra academia. **Endpoint/p256dh/auth ficam
  invisíveis** — o professor sabe QUEM ativou, não COMO chegar no aparelho. Preserva o
  princípio da RLS self-only da 0014 (aparelho = identificador privado).
- `enviar_push_teste(p_user_id uuid)` — dispara push tipo `'teste'` via `pg_net.http_post`,
  reusando 100% da stack do `enviar_avisos_checkin` (0014/0018). Gated `is_professor()` +
  mesma academia. Retorno `{ok, motivo}` cobre `sem_aparelho` e `push_nao_configurado`.

**Sheet `_avisoCheckinSheet` reescrito — corpo real** com 4 seções:

1. **Aparelhos ativos** — lista carregada de `sbProf.getPushSubs()`. Mostra nome
   (cruza com roster local, sem ida extra à API), plataforma inferida do `user_agent`
   (iOS/Android/Windows/Mac/Linux) e "há N dias" desde a ativação. Toque num aluno
   destaca a linha e habilita o botão de teste.
2. **Push de teste** — botão dispara `enviarPushTeste(userId)` pro aluno selecionado.
   Toast contextual: `sem_aparelho` (roster desatualizado) · `push_nao_configurado`
   (`app_config.push_function_url` vazio) · sucesso ("deve chegar em segundos").
3. **Push personalizada** — botão **desabilitado** com explicação: "Precisa expandir a
   Edge Function `send-push`". Ver ROADMAP · Notificações.
4. **Regras do disparo automático** — mesmo bloco read-only da v375 (endurecimento em
   01/10).

**Novo `_waTemplatesSheet` (💬 Mensagens WhatsApp)** — 8 slots editáveis persistidos em
`academies.config.waTemplates` (JSONB, sem migration — reusa o merge `remoto+patch` da
v359). Navegação em chips numerados 1–8; editor com ícone/rótulo/mensagem por slot;
preview em tempo real com `{nome}` substituído por "Fulano da Silva". Defaults hard-coded
mantêm os 6 textos originais (abrir, sumido7, sumido30, aniv, gradProx, bemVindo) +
2 slots vazios ("Personalizada 1/2"). Slot vazio não aparece na lista pro aluno (exceto
"Só abrir chat" que é vazio por design).

**Runtime `_waTpls()` + `_waResolve(body, a)`** substituem a constante `WA_TEMPLATES`
hard-coded. `_waSend` e `_waSheet` passam a consumir o array mesclado. Placeholder
`{nome}` (case-insensitive) → `_waNome(a)` — mesma regra de "primeiro nome do responsável
se menor de 18" que já existia.

**Fix UX pequeno:** `.btn-cad:disabled` ganha `opacity:.45; cursor:not-allowed; filter:none`.
Antes os botões desabilitados ficavam visualmente iguais aos ativos (só o `disabled` do
HTML travava o clique). Achado durante verificação. `app.css?v=224`.

**Adapter (`supabase.js?v=51`):** `sbProf.getPushSubs()` e `sbProf.enviarPushTeste(userId)`
plugam nas duas RPCs novas — wrappers de 3 linhas cada.

**Verificação:** selfTest 160/160 headless. Sheets renderizados em `?demo=1&visaocompleta`:
aviso com 4 seções + 8 slots WhatsApp funcionais + navegação entre slots + preview em
tempo real. `abrirConfigAcademia` (v375) segue não existindo — hub YAMA é caminho único.

> **Deploy:** 0028 aplicada em prod 2026-07-30 pelo SQL Editor. Confirmação via REST anon:
> `push_subs_academia` e `enviar_push_teste` devolvem `42501 permission denied for function`
> (função encontrada, RLS/grant nega anon = esperado). Ledger CLI segue defasado até
> `migration repair`.

### v375 — aba YAMA · hub de configurações (2026-07-29)

Antes, tudo caía em `abrirConfigAcademia` — um único sheet com PIX+WhatsApp+senha, alcançado
por um caminho tortuoso (`Alunos → 🔑 Acesso → ⚙️`). Vira uma aba própria no professor.

**Nova aba `yama` na `tabbarProf`** (wide-only — desktop mostra na sidebar; mobile acessa pelo
botão **⚙️** discreto no canto direito do header do Painel, `.erp-yama-btn`). Ícone `icoYama`:
silhueta estilizada de montanha (山, a marca do app). `renderProfessor` ganha o case
`nav==='yama'` → `profYama()`.

**`profYama()` — view do hub** (`.yama-hub` · max-width 720 · centrada). Hero com o nome da
academia (`DB.academia.nome`, vem de `academies.nome`) + chips de status
(WhatsApp/PIX/QR PIX/QR presença — `on` em verde, `off` cinza tracejado). Quatro grupos:

- **Academia** — 🏢 Dados da academia · 🔑 Senha padrão dos alunos
- **QR Codes** — 📷 QR de presença · 💸 QR do PIX
- **Notificações** — 🔔 Aviso de check-in
- **Conta** — 👤 Meu perfil (linka `nav='perfil'` que era o antigo "Mais")

**Refatoração dos sheets:** `abrirConfigAcademia` **removida** (era o único sheet que juntava
PIX+WhatsApp+senha). Substituída por:

- `_dadosAcademiaSheet()` — só nome (read-only, vem do cadastro) + Telefone/WhatsApp + PIX
- `_senhaPadraoSheet()` — só a senha padrão (LGPD: fica local no `user_state` do professor, não
  em `academies.config`, que qualquer membro lê)
- `_qrTokenSheet()` — já existia (v374), agora entra pela linha do hub
- `_pixQrSheet()` — **novo**: cola o "Copia e Cola" PIX (BR Code EMV), salva em
  `academies.config.pixBrCode`, botão 🖨️ **Gerar QR pra imprimir** abre `api.qrserver.com`
  em nova aba (mesmo padrão do QR de presença, zero dep no app)
- `_avisoCheckinSheet()` — **stub honesto**: mostra os valores atuais (`push_ocorr_min=0`,
  `push_presencas_min=0`) e explica que editar exige SQL no painel (`app_config` sem policy).
  Vira editável quando a RPC de escrita for criada — anotado no ROADMAP.

Callsite legado: o botão "⚙️ Configurações da academia" dentro de `profAcessoAlunos`
(linha 5088) agora chama `_senhaPadraoSheet` direto — antes ia pro sheet monolítico.

**app.css:** novo bloco `.yama-*` (hub, hero, chips, grupos, linhas com chevron) + tratamento
flex no `.erp-dash-hd` pra caber o botão `⚙️` sem quebrar layout. `app.css?v=223`.

**Verificação:** selfTest 160/160 headless. Render de `profYama` em `?demo=1&visaocompleta`
inspecionado: hero, status (4 chips), 4 grupos, 6 linhas todas presentes; tabbar mostra
YAMA como aba ativa no desktop; botão `.erp-yama-btn` presente no Painel mobile.

### v374 — check-in só por QR + token estático da academia (2026-07-29)

Fim do teclado numérico e do código `'0000'` universal. A Fase 1 do flow vira uma única
tela: ilustração do QR + botão **📷 Abrir câmera** + rodapé "Sem câmera? Peça ao
professor pra registrar sua presença." Só isso.

**Token da academia:** o QR válido é o `academies.config.qrToken` (JSONB, sem migration
— reusa o mesmo config das v312–v343). Comparação estrita no `presencaScan`: aceita o
token puro OU URL terminando em `?qr=<token>`/`&qr=<token>` (pra QR impresso que abre o
app direto). Qualquer outro payload → toast "QR não é da academia — peça ao professor
pra conferir" e o scanner continua rodando.

**Gerar/renovar (professor):** Alunos → 🔑 Acesso → ⚙️ Configurações da academia → nova
linha **📷 QR de presença**. Sheet mostra o token atual, botão **📋 Copiar**, botão
**🖨️ Gerar QR pra imprimir** (`api.qrserver.com`, abre em nova aba — zero dep no app,
zero mudança de CSP) e **🔄 Renovar QR** com confirmação clara: "renovar invalida todos
os cartazes atuais". `crypto.randomUUID()` no cliente, `_salvarAcademyConfig({qrToken})`
faz o resto (roda pelo merge `remoto+patch` da v359, sem race).

**Câmera/scanner indisponível (plano A):** `_presencaSemCamera(msg)` fecha o flow com
toast honesto em quatro casos: token ainda não configurado, sem `BarcodeDetector` no
navegador, câmera negada, leitor de QR falhou. Nada de "tenta o código" — batch do
professor em **Turmas → Adicionar frequência** cobre o edge case.

**Card "Presença dessa aula" da Home:** segue passando pelo QR (regra "apenas QR" sem
exceção). A pré-seleção da sessão continua economizando o toque do seletor de turmas.

**Removido do código:** `PRESENCA_CODE`, `_otp`, `_atualizaOtp`, `presencaDigit`,
`presencaBack`, `confirmarPresenca` (98 linhas do bloco totem). CSS: `.otp-row`,
`.otp-box`, `.keypad`, `.key`, `.or-div`, keyframe `otpShake` (17 linhas). Nada fora do
bloco fazia referência a nenhuma dessas.

**Verificação:** selfTest 160/160 headless (Chrome puppeteer). Render de `_renderPhase1`
em `?demo=1` inspecionado: `.qr-card`, `.btn-scan`, `.qr-title`, `.qr-foot` presentes;
zero resíduo de `.otp-row/.keypad/.or-div`. `app.css?v=222`.

### v373 / migration 0027 — presença exige turma E aula (fim das avulsas e do fantasma) (2026-07-29)

Complementa a 0026: aquela fechou a porta de trás (DELETE de turma/aula com filho aborta),
esta fecha a da frente (INSERT sem os dois amarres aborta).

**CHECK constraint `checkins_fato`:** `check (turma_id is not null and aula_id is not null)`.
Fecha de uma vez três portas que estavam entreabertas:
1. A RLS `checkins_self_insert` da 0024 aceitava `turma_id is null` "por back-compat" — a
   permissividade foi removida junto (policy simplificada, matrícula ativa é obrigatória).
2. `sbProf.lancarPresenca` (adapter) fazia INSERT direto com `enrollments.limit(1)`: se o
   aluno não tinha matrícula, gravava `turma_id=null`; e **nunca** populava `aula_id`. Foi
   ela que produziu os 3 órfãos históricos que a v363 tratou.
3. SQL Editor / service_role: livre pra criar avulsa. Não é mais.

**Cleanup pré-migration:** 2 check-ins órfãos remanescentes de 2026-07-23 (Raquel Rutinha e
Victória Leles · FEMININO · 23:23 · `via='professor'` · `aula_id=NULL`) apagados via
`DELETE ... WHERE turma_id IS NULL OR aula_id IS NULL RETURNING`. Eram lançamentos do batch
antigo (pré-0025) em horário/dia sem grade real — teste, não histórico legítimo. A v363 já
os havia marcado como descartáveis.

**Fantasma no `salvar()` (app.js):** as 2 linhas que forçavam `checkinHoje.feito=true` sem
sessão quando o aluno chegava à Fase 2 sem check-in prévio foram removidas. Como não há
caminho de UI que leve à Fase 2 sem draft (e draft só nasce de check-in real), era código
morto — mas defensivo demais: mentia localmente e faria "presente" viajar entre dispositivos
via dump sem correspondente no banco. `app.js?v=373`.

> **Deploy:** aplicada em prod 2026-07-29 pelo SQL Editor (mesmo caminho das 0023–0026);
> ledger CLI segue defasado até `migration repair`. Confirmação via `pg_get_constraintdef`
> devolveu `CHECK (((turma_id IS NOT NULL) AND (aula_id IS NOT NULL)))`.

### migration 0026 — `turma_id`/`aula_id` do check-in viram FATO imutável (2026-07-29)

As FKs `checkins.turma_id → turmas` e `checkins.aula_id → aulas` eram `on delete set null`
desde a 0001. Um DELETE hard em `turmas` ou `aulas` (SQL Editor, migration futura, Edge
Function distraída) transformava o check-in em órfão total — os dois campos NULL, descartado
por `_ocupacaoSessoes` e mostrado como "Sem turma" nos relatórios.

Na prática o adapter só faz soft-delete (`sbProf.deletarTurma` → `turmas.ativo=false`), então
o cenário nunca era exercido — mas a promessa "presença é fato histórico" não estava garantida
**pelo banco**, só por convenção do código.

Agora `on delete restrict`. DELETE hard com check-in filho aborta com `23503`. Soft-delete
segue como caminho normal. Se um dia precisar apagar de verdade (LGPD "esquecer turma de
teste"), é decisão consciente: apaga/reatribui os check-ins antes.

Zero mudança no app.js/supabase.js — a promessa vira invariante do schema.

> **Deploy:** aplicada em prod 2026-07-29 pelo SQL Editor (mesmo caminho das 0023/0024/0025;
> ledger CLI segue defasado até `migration repair` — ver §"Reconciliação" no runbook).
> Smoke test: `DELETE FROM turmas` com check-in filho devolveu `23503 update or delete on
> table "turmas" violates foreign key constraint "checkins_turma_id_fkey"`, como esperado.

### v372 — janelas históricas capadas em 2026-07-20 + pace por semanas com treino (2026-07-28)

O app começou a operar em **20/07/2026** (`APP_INICIO_ISO`). Toda janela "N dias atrás"
(freq4, base4, ocupação 120 d, tendência 28/56 d) puxava datas anteriores a isso, inflando
denominador e deprimindo médias — aluno com 3 semanas de histórico parecia inativo porque o
divisor era 120 d de vazio.

**Cap dinâmico:** `janela_efetiva = max(N, 2026-07-20)`. A partir de nov/2026 (quando 120 d
couberem depois da data) o cap deixa de morder sozinho — sem manutenção. Aplicado em
`_diasAtrasISO` (relatórios) e nos dois `_dISO` inline (`_selfAluno`, `_perfilTreinoNode`) do
`app.js`, e em `_diasAtras` do adapter (`getAlunos`, `_loadRelData`). `APP_INICIO_ISO` é
exposto em `window` pro adapter compartilhar (com fallback literal se o adapter carregar sem o app).

**`paceSemanal()`:** denominador vira **semanas distintas com ≥1 treino**. Antes dividia o total
de treinos por "semanas desde o 1º treino", então férias/lesão/afastamento derrubavam o pace como
se o aluno tivesse sumido. Mesmo princípio de `_ocupacaoSessoes` (divide por dias **com aula**).
`supabase.js?v=50`.

### v371 — texto do rodapé de "Ocupação por horário" (2026-07-28)

`_ocupacaoSessoes` agrupa por `turma|dow|hora` desde a v366, mas o rodapé ainda dizia "sessões da
mesma turma no mesmo dia dividem a média" (resquício de quando agrupava só por turma+dia). Só
texto — nenhuma mudança de cálculo. `supabase.js?v=49`.

### v370 — "Data último grau" na Base completa (2026-07-28)

A âncora de crédito de aulas (`ref`, data do evento de grau mais recente — ou de faixa, se
grau = 0) já era calculada no adapter para `aulasNoGrau`, mas não era exposta. Agora
`base.grauDesde` sai no `supabase.js` e vira coluna **"Data último grau"** em
`_alunosBuildRowsCompleta`, com fallback pra `faixaDesde` quando grau = 0. Motivação: montar a
planilha de import de presença do app antigo com a data-âncora vinda da timeline do Yama.

### v369 — hotfix: `const dias` shadowed quebrava o `node --check` (2026-07-28)

A v368 introduziu `const dias` pra guardar a janela do toggle, mas `_viewHeatmap` já tinha um
`const dias` (colunas dia-da-semana) declarado depois — redeclaração no mesmo escopo derruba o
parser e o CI. Janela renomeada pra `janelaDias`.

### v368 — heatmap ganha janelas de 7 d e 14 d (2026-07-28)

`_ocupacaoSessoes` passa a aceitar janela em **dias** (era só múltiplo de 7). Toggle: 7 d · 14 d ·
4 · 8 · 12 · 16 semanas (padrão 8 semanas). Com base recém-inaugurada, 4+ semanas diluem demais a
média com segundas sem lançamento.

### v367 — heatmap de presenças: contagem dupla + toggle de janela (2026-07-28)

**Bug (validado em prod):** heatmap mostrava 6 presenças/aula onde o SQL cru dava 5.3.
`_ocupacaoSessoes` somava dois galhos que ficaram sobrepostos depois da 0025 — `real` (presenças
com `aula_id`, por sessão) + `legado/nMesmoDia` (sem `aula_id`, rateado pelo dia). Como o backfill
da 0025 preencheu `aula_id` em quase tudo, o galho legado virou **eco** do real e a soma inflava.
Passa a usar só o real. Segunda 19:30 vira 5.3/20 (16 presenças / 3 aulas nas últimas 4 semanas).
Toggle de janela (4/8/12/16 semanas) voltou junto.

### v366 / migration 0025 — fim da ambiguidade de `checkins.tipo` (2026-07-28)

**Raiz (auditada em prod):** a coluna tinha **três escritores com semânticas diferentes**, e o
relatório descartava os `NULL`:

| escritor | gravava | linhas |
|---|---|---|
| `marcar_presenca_lote` (professor) | `NULL` | 20 |
| `checkin_self_registrar` (app) | `variacao` \| `'Aula'` | 10 |
| `pushCheckin` legado (pré-v359) | label da sessão (`"Adulto · 19:30"`) | 2 |

Efeito visível: "Presença por tipo de aula" mostrava **12 de 32** check-ins — as presenças
lançadas pelo professor sumiam do relatório.

**Decisão:** `aula_id` é a fonte única; `checkins.tipo` vira **cache derivado** da variação da
sessão, preenchido igual pelos dois escritores. (`aulas.tipo` — judo/ne-waza — é outro conceito e
segue livre.)

**Migration 0025:** helper `_variacao_da_aula(aula_id)` (casa turma × dia-da-semana × hora na
grade) · `marcar_presenca_lote` v2 grava `tipo` · `checkin_self_registrar` v2 deriva `tipo` **no
servidor** e ignora o `p_tipo` do cliente (era por onde o label vazava) · backfill reescreve as 32
linhas (antes 20 NULL + 10 `'Aula'` + 2 label; depois 26 `'Aula'` + 5 LIVRE + 1 NO-GI, zero NULL).

**Leitura:** `getRelatorios` traz `turmas(nome)` no JOIN — a turma **nunca mais** é inferida de
`tipo`; `_presencaPorTipo` agrupa por turma (do JOIN) + variação e não descarta linha nenhuma.
Títulos viram "Presença por turma". Validado em prod: 32 check-ins — ADULTO 22 / ADULTO·LIVRE 5 /
FEMININO 4 / ADULTO·NO-GI 1. `supabase.js?v=48`.

### app.css?v=221 — card de turmas seguia o tema do SO (2026-07-28)

`.erp-class-card` (strip de horários do dia no painel inicial) era a **única** regra do CSS usando
`@media (prefers-color-scheme: dark)`; todo o resto usa `[data-theme="dark"]`, controlado pelo
toggle manual + `localStorage['yama.theme']`. Com o SO em dark e o app no tema claro escolhido pelo
usuário, esse card sozinho ficava escuro. (Commit rotulado "v221" = a versão do **CSS**, não do app.)

### v365 — card "Inativos" no painel inicial do professor (2026-07-28)

Mesmo grid `.stat-card` dos demais KPIs, cor gray (já existia no CSS, sem uso nesse grid) pra não
competir com o vermelho de "Vencidos". Usa `_statusAluno()` (0023). O clique navega pra Alunos com
o chip "Inativos" pré-selecionado — o padrão do card de Aniversariantes (`DB._pendingAlunosAniv`)
generalizado em **`DB._pendingAlunosFiltro`** pra qualquer chip da lista.

### v364 — chip-KPI "Inativos" na lista de Alunos (2026-07-28)

Novo chip usando `_statusAluno()` (0023: automática 90 d + override manual). Antes só dava pra ver
quem era inativo abrindo Alunos (Excel) e filtrando lá. Clique filtra a lista como os demais chips.

### v363 — histórico de presenças mostra a turma + backfill dos `aula_id` órfãos (2026-07-27)

O histórico na ficha do aluno exibia **"Aula"** fixo pra todo check-in (default do payload da RPC
sem variação). Agora mostra o nome da turma — "ADULTO", "ADULTO · No-Gi", "FEMININO".
`getAlunoDetalhe` traz `turma_id` + `turmas(nome)` e achata como `{turmaId, turmaNome}`;
`_erpPresencas` monta `"TURMA · variação"`.

> **Backfill em prod** (`supabase db query`): 19 check-ins órfãos (`via='app'` pré-v359, `aula_id`
> NULL apesar de `turma_id` preenchido) casados com a sessão mais próxima do horário — **16
> tratados** (duplicatas do mesmo aluno na mesma aula apagadas pelo UNIQUE `user_id, aula_id` da
> 0010); **3 restantes** são check-ins de teste em dias/horas sem grade cadastrada, mantidos como
> legado. `supabase.js?v=47`.

### v362 — `APP_VERSION` deriva do `?v=` do `<script>` (2026-07-27)

`APP_VERSION` era uma const `'vNNN'` separada do `?v=N` do `index.html` — duas fontes de verdade
batidas à mão a cada release. Estava travada em `v353` havia vários commits (o mesmo tipo de furo
achado na v347). Agora lê do próprio `<script src="app.js?v=N">` em runtime
(`document.currentScript`, com fallback por regex nos `<script>` da página): **uma fonte de verdade
só**, o `?v=N`, que já é bumpado em todo commit. `supabase.js?v=46`.

### v361 — import de alunos aceita coluna Status (2026-07-27)

Template `yama-modelo-import-alunos.xlsx` ganha a coluna **"Status"** com exemplo "Ativo" na linha
modelo — antes não havia nada indicando que a planilha suportava isso. `_COL_MAP` aceita
Status/Situação/Ativo (fuzzy); `_normStatus` normaliza Ativo/Inativo/A/I/1/0 pro shape da 0023
(`ativo|inativo|null`, valor estranho vira null → regra automática). No modo **criar**, o patch de
`nascimento_data` + `status_manual` vai num round-trip só depois do `criarAluno`; no modo
**atualizar**, entra no patch da ficha existente.

> **Backfill em prod:** `update profiles set status_manual='ativo' where role='aluno' and
> status_manual is null` → **129 alunos** marcados como Ativo. Ninguém ficou na regra automática,
> pra que nenhum cadastro antigo vire Inativo sozinho ao bater 90 d.

### v360 — lista A-Z em "Adicionar frequência" (2026-07-27)

`profBatchCheckin` recebia os alunos na ordem do backend. Sort por `_nomeInst` com
`localeCompare('pt-BR')` (respeita acentuação).

### v359 / migration 0024 — check-in do aluno em turma alheia (2026-07-27)

**Investigação:** aluno adulto conseguia bater presença em KODOMO 2 (turma infantil) — confirmado
no banco. **Três camadas** deixavam passar:

1. **Cliente** (`sessoesDeHoje`): listava todas as turmas da academia no card de check-in em vez das
   do aluno → passa a filtrar por `DB._minhasTurmasIds` (o adapter já carregava).
2. **Adapter** (`pushCheckin`): mandava o `turma_id` do cliente sem checar → trocado pela RPC
   **`checkin_self_registrar`** (0024), `security definer`, que resolve/cria a aula no servidor e
   confere matrícula ativa.
3. **RLS** (`checkins_self_insert`, 0001): validava `user_id`/`academy_id`/`via`/`data` mas **não**
   `turma_id` → endurecida na 0024: exige matrícula ativa quando `turma_id` não é null. Última
   linha de defesa fechada.

**Bônus:** 16 de 20 check-ins históricos estavam sem `aula_id` porque o aluno não tem policy pra
escrever em `aulas` e o `pushCheckin` engolia o erro num catch silencioso — a 0010 nunca chegou a
funcionar pro aluno. A RPC atravessa isso via `security definer`; check-ins novos nascem com
`aula_id`. A migration apagou o check-in órfão do dia (KODOMO 2) e qualquer outro do dia atual em
turma não matriculada — zero toque em histórico. **Aplicada em prod** via `supabase db push`.

> **Nota de versionamento:** este lote saiu no mesmo `app.js?v=359` da correção de race abaixo (o
> bump foi esquecido); a mensagem do commit diz "v358" por engano.

### v359 — race no `salvarConfig` (2026-07-27)

`_salvarAcademyConfig` fazia `remoto ∪ DB.academyConfig ∪ patch`: a cache local (possivelmente
velha, se outro professor editou desde o boot) sobrescrevia o valor fresco recém-lido do
`getConfig`. Prof A abre com `metaAulas={azul:48}`, prof B grava `{azul:60}`, prof A salva o PIX →
o merge do A jogava 48 por cima de 60. Agora o merge é **só remoto + patch**; `DB.academyConfig`
segue atualizado otimisticamente (UI responde na hora) e o `merged` do sucesso corrige divergência.
Com um dono só não mudava nada; com professor múltiplo era corrupção silenciosa.

### v358 — tela de metas por faixa apagava as metas infantis (2026-07-27)

`academies.config.metaAulas` tem **dois** editores: `_regrasFaixaSheet` (5 faixas adultas) e
`_profMetaAulasSheet` (qualquer faixa, incl. infantis, chamada da tela de Graduação). Como
`_salvarAcademyConfig` faz merge **raso**, o `metaAulas` enviado substitui o objeto inteiro — e
`_regrasFaixaSheet` montava o objeto do zero só com as adultas, apagando amarela/laranja/verde/
cinza. Agora parte do `metaAulas` atual e só sobrescreve/remove as faixas da própria tela (campo
vazio segue voltando ao padrão), como `_profMetaAulasSheet` já fazia.

### v357 — `icoBelt` duplicada · nome completo read-only pro aluno · quem graduou (2026-07-27)

- `icoBelt()` estava definida **duas vezes**; a segunda sobrescrevia a primeira silenciosamente. A
  primeira (sem uso) virou `icoMedal`.
- "Editar perfil" do aluno não edita mais **Nome completo** — esse campo é do cadastro (ficha do
  professor); só o **Apelido** segue editável pelo aluno. `pushProfile` parou de mandar
  `nome_completo` no self-update, fechando o caminho de drift em que o aluno sobrescrevia a ficha.
- Timeline de graduação do aluno (`evoluirGraduacao`) mostra **"· por Fulano"** — o dado já vinha do
  backend e só a timeline do professor exibia.

### v356 / migration 0023 — status de atividade do aluno (2026-07-27)

Conceito **novo e separado** de "Ativos (14 d)": **Status (Ativo/Inativo)** com regra automática
(≥ 90 dias sem treinar = Inativo) e override manual tri-state do professor
(`null` = automático · `'ativo'` · `'inativo'`). O carimbo `status_manual_em` é feito **no banco**
(trigger, dentro do `guard_profile_update` estendido), nunca pelo relógio do cliente — e só o
professor muda a flag.

`supabase.js`: `statusManual`/`statusManualEm` em `getAlunos` + wrapper `setStatusAluno()`.
`app.js`: helpers `_statusAluno()`/`_statusAlunoTxt()`; coluna **Status** + filtro em Alunos
(Excel) e no CSV/XLSX exportado; filtro no painel avançado; ação "Status" na ficha abre sheet de 3
opções. **Migration aplicada em prod** via `supabase db push`. `supabase.js?v=45`.

### v355 — modal de exportar Excel não abria (2026-07-27)

`_alunosExportXLSXSheet` montava o `.sheet-overlay` **sem a classe `.open`** — e é ela que tira o
`opacity:0`. O modal existia no DOM, invisível, ainda bloqueando o clique por cima da tela.

### v354 — busca exposta no desktop · faixa etária à direita (2026-07-27)

O painel de filtros avançados tinha um campo "Nome" redundante com a busca do topo (que só existia
no mobile). Campo duplicado removido; a mesma var `busca` ganha um input também no desktop, à
esquerda da barra de faixa etária, que migra pra direita. Chip **"Sem data" removido** — varredura
confirmou que nenhum aluno cadastrado está sem data de nascimento.

### v349–v353 — filtros/KPI da lista · nome institucional · graduação consistente (2026-07-26)

- **v349** — botão "✕ Limpar" ao lado de "Filtros avançados", visível só com filtro ativo.
- **v350** — subtítulo da lista vira KPI responsivo ("47 de 131 · 3 presentes · 12 inativos · 5
  vencidos" com filtro; total absoluto sem). Botão Excel abre sheet com **base resumida (15 col)**
  ou **base completa (31 col:** + endereço, responsável, LGPD, aulas no grau, faixa etária,
  frequência, aptidão a grau). Excel e PDF exportam **a lista filtrada**. Refactor: `_aplicarFiltros()`
  extraída do `renderList` (fonte única).
- **v351** — **regra global:** exibição institucional do aluno usa o **nome completo** da ficha, não
  o apelido. Helper `_nomeInst(a)` com fallback, trocado em ~20 pontos (batch de presença,
  aniversariantes, header da ficha, diálogos de excluir/promover, listas de graduação/aptos,
  aria-label do WhatsApp, coluna Nome do Excel). Preservados: chaves técnicas `a.id||a.nm`, o campo
  "Apelido" da ficha, a barra de busca (casa apelido também) e o perfil do próprio usuário.
- **v352** — KPI "Graduações" na ficha só conta `faixa|grau` (era `grads.length` cru, incluindo
  `inicio`, que não é graduação: um aluno com 1 graduação real mostrava "3"). Timeline **deduplica**
  visualmente (mesmo dia + tipo + faixa + grau = mesmo evento, quando dois professores registraram
  por engano); helper `_gradsDedup` usado no KPI **e** na lista, senão os dois divergiam.
- **v353** — "Acesso dos alunos" parou de alternar Carregando/lista: a tela era reconstruída a cada
  `render()` (o refetch dispara render a cada 10 s) e cada reconstrução chamava a Edge Function.
  Cache global de 60 s, invalidado ao clicar "Aplicar senha". *Backend (fora do repo):* Edge
  `senha-padrao` deixou de contar `dry_run` no rate-limit de 5/h da execução real.

### v348 — fim da seleção múltipla e da presença em lote na lista de Alunos (2026-07-26)

Checkbox por linha, barra flutuante (`.bulk-bar`) e `_bulkPresenca` removidos: o lançamento em lote
dali criava check-in **sem turma** — o oposto da regra de que presença é sempre atrelada a uma turma
(fechada nas v332–v346). O lançamento em lote **com** turma continua em Presenças
(`sbProf.marcarPresencaLote`). Removidos junto: `_selAlunos`, `_alunoKey`, `updateBulk`,
`.row-check`, `.bulk-bar`, `.bb-n/.bb-btn/.bb-x`, `.st-row.sel` e a coluna `erp-c-check` (30 px) do
grid. `app.css?v=218`. selfTest 160/160.

### v347 / migration 0022 — graduação com fonte única no banco (2026-07-26)

As v344–v346 fecharam os caminhos paralelos de escrita **no app**, mas o furo era
**estrutural, no banco** — e por isso os bugs voltavam.

**Causa raiz 1 — a RPC apagava o tipo do evento.** `graduar_aluno` v2 (0003) tinha
`case when p_tipo = 'grau' then 'grau' else 'faixa' end`: os tipos que a 0011 criou
(`inicio`, `honra`, `retroativo`) **nunca chegavam ao banco**. O app registrava
"Início na academia" e o banco gravava "graduação para faixa branca". É a origem dos
~125 eventos `faixa branca` semeados e do "aluno graduado aparecendo branca".

**Causa raiz 2 — cache derivado que nada derivava.** `profiles.faixa/graus` era
documentado como derivado de `graduations`, mas a sincronização morava *dentro* da RPC,
à mão. Todo caminho que escrevia por fora (Edge Function, importação em lote, SQL no
editor) gerava faixa sem evento ou evento sem faixa — toda divergência perfil×timeline
nascia daí.

**Correção (`0022_graduacao_fonte_unica.sql`):**
- `graduar_aluno` **v3**: preserva o `p_tipo` (validado contra o CHECK da 0011) e deixa
  de escrever em `profiles`.
- Trigger `graduations_sync` (after insert/update/delete, row-level) →
  `sync_faixa_derivada(user_id)`: `profiles.faixa/graus` vira derivada de verdade,
  convergente por **qualquer** caminho de escrita. Vale o evento mais recente de tipo
  `inicio|faixa|grau|retroativo` (desempate `data, created_at, id`); `honra` não move a
  faixa; timeline vazia preserva o valor técnico.
- **Dados históricos corrigidos na própria migration** (era SQL manual no editor):
  apaga os eventos `por='cadastro'` de quem não tem nenhum outro evento (os ~125
  "brancos" passam a "Sem graduação"), reclassifica para `inicio` o evento semeado de
  quem tem graduação real (os 4 casos), e reconcilia `profiles` de todo mundo.
- `revoke update (faixa, graus) on profiles` de `authenticated`/`anon` — fecha a porta.

**App (v347):** `sbSync.pushProfile` parou de mandar `faixa`/`graus` no update do próprio
perfil (era um caminho de drift e agora bate na revogação). Edge `create-student` semeia
`tipo: 'inicio'` em vez de `'faixa'` quando a faixa é conhecida — move a faixa igual
(o trigger conta `inicio`), mas para de posar como a graduação em si.
`supabase.js?v=45`. selfTest 160/160.

**Bug de versão exibida (achado nesta v347).** `APP_VERSION` (app.js) estava travado em
`'v311'` enquanto o `index.html` já carregava `app.js?v=346` — a tela de Perfil e o rodapé
mostravam a versão errada há 35 releases, e `sbSync.logError` carimbava `client_errors`
com `v311` (ou seja, a telemetria de erro apontava a versão errada esse tempo todo).
Alinhados: `APP_VERSION = 'v347'` + `app.js?v=347`.

> **Deploy (2026-07-26):** `supabase db push --linked` aplicado em prod — ledger estava
> limpo em `0001`–`0021`, só a 0022 pendente. Output: **123 perfis sem nenhum evento**
> (passam a "Sem graduação"), **8 alunos com timeline real reconciliados**, 30 eventos
> restantes (`inicio`/`faixa`/`grau`, por Tavares/Rebeca/cadastro). Edge
> `create-student` redeployada. **Pendente: publicar `index.html` + `supabase.js?v=45`.**

### v346 — "Graduar em lote" removido (2026-07-26)

Último caminho paralelo de escrita em faixa/grau: a barra de seleção múltipla da lista
de Alunos tinha um botão "🥋 Graduar" que aplicava a mesma faixa/grau a todos os
selecionados, direto em `profiles`, sem passar pela timeline nem pela sugestão do
"+ Novo evento" (v345). Removido o botão e a função órfã `_bulkGraduar` (48 linhas).
Restou só a graduação por aluno, um evento de cada vez, sempre com a sugestão deduzida
da timeline — fecha o funil que começou com a remoção do "Graduar" da ficha (v344).
selfTest 156 → 160 (contagem herdada do bloco anterior).

### v345 — "+ Novo evento" deduz o próximo passo + estado "sem graduação" (2026-07-26)

**Botão inteligente.** `_proximoEventoGrad(a)` lê a timeline e decide o próximo evento;
o professor só confirma a data. Regras: vazia → **Início na academia · branca · 0 graus**;
último `inicio`/`faixa` → **1º grau** na mesma faixa; último `grau` abaixo do máximo →
**próximo grau**; último `grau` no máximo (4, ou 6 na preta) → **próxima faixa · 0 graus**
via `proximaFaixaCBJJ` (respeita a cadeia infantil por idade); faixa máxima pra idade →
sem sugestão, campos abertos. O sheet mostra um resumo ("1º grau · Branca" + o motivo)
com "Alterar" pra abrir os selects. **Campo "nota" removido** e `inicio`/`faixa` agora
**travam** graus em 0 (era só sugestão).

**"Sem graduação" (decisão B do dono).** A timeline é a fonte da verdade; `profiles.faixa`
segue como valor técnico (virar `null` exigiria passada defensiva em 43 leituras de
`BELTS[faixa]` + deploy da Edge Function). O adapter marca `semGrad` quando o aluno não
tem nenhum evento, e a UI mostra "Sem graduação" na lista, no cabeçalho da ficha e, no
app do aluno, um card explicando que o professor ainda não registrou a entrada — em vez
de exibir uma faixa branca lisa que ninguém deu.

**Menu:** "Configurações da academia" saiu da Loja — entrada única em Alunos
(🔑 Acesso → ⚙️ Configurações da academia). Estava em dois menus pro mesmo sheet.

**Pendente (exige deploy):** `create-student` ainda semeia um evento `faixa branca` em
todo cadastro/importação — enquanto ela não mudar, aluno importado nasce COM graduação
e não aparece como "sem graduação".

### v345 — "+ Novo evento" deduz a sequência · importação não gradua ninguém (2026-07-26)

**Botão inteligente:** `_proximoEventoGrad(a)` lê a timeline e propõe o próximo evento;
o professor só confirma a **data**. Regras: vazia → *Início na academia · branca · 0*;
último `inicio|faixa` → *1º grau na mesma faixa*; `grau` abaixo do máximo → *próximo
grau*; `grau` no máximo (4, ou 6 na preta) → *próxima faixa · 0 graus* via
`proximaFaixaCBJJ` (respeita a idade, cadeia adulto **e** infantil); faixa máxima pra
idade → sem sugestão, campos abertos. A sheet mostra um resumo de uma linha + "Alterar"
(revela tipo/faixa/grau). `inicio` e `faixa` têm **0 graus travado**, não sugerido.
Campo **"Nota" removido**.

**Importação não gradua:** o payload manda `sem_graduacao:true` e a Edge Function
`create-student` **pula o seed em `graduations`**. O aluno entra com timeline vazia.
⚠️ **Exige redeploy da função** — sem isso o flag é ignorado e o seed branca continua.

**"Sem graduação" na UI (decisão B):** `profiles.faixa` **não** virou null — 43 pontos
leem `BELTS[faixa]`. Quem não tem nenhum evento é marcado por `semGrad` (adapter, do
`gradByUser` que o `getAlunos` já carregava) e a UI mostra "Sem graduação" na lista, no
cabeçalho da ficha e na Jornada do aluno, em vez de uma faixa branca lisa que ninguém
registrou.

**selfTest 156 → 160:** as quatro transições da sequência (vazia → início → 1º grau →
grau intermediário → topo vira próxima faixa).

### v344 — graduação com fonte única: perfil, timeline e Jornada amarrados (2026-07-26)

**Bug do aluno ("Sem data de graduacao registrada" mesmo com histórico):** quatro
pontos do lado do aluno procuravam **só** `tipo==='faixa'`, mas o cadastro semeia
`tipo==='inicio'` (Edge Function `create-student`) — nenhum casava, e o app dizia que
não havia data. Todos passam a usar o helper canônico `_faixaDesde` (faixa | inicio |
1º grau da faixa), o mesmo que a gestão já usava: `elegibilidadeCBJJ`,
`_refDataFaixaAtual`, `_refDataGrauAtual` e `evoluirGraduacao`. Os dois renderizadores
de timeline do aluno também ganharam o rótulo "Início · Faixa X" (antes um evento
`inicio` aparecia como "0º grau").

**Ficha cadastral enxuta (fonte única por fato):**
- "Ano de nascimento" **removido** — o ano é derivado de `nascData` (obrigatória no
  cadastro e na importação desde a v311). Dois campos para o mesmo fato divergiam.
  O adapter (`mapAluno` e `pullAll`) também deriva o ano quando a coluna `nascimento`
  está vazia, senão quem só tem `nascimento_data` ficava sem idade/faixa etária.
- "Início na academia" **removido do form** — passa a ser derivado da linha do tempo
  (`_inicioAcademia`: evento `inicio` → evento mais antigo → `cad.dataInicio` legado).
  A ficha mostra o valor em modo leitura apontando pra aba Graduação. O KPI "Desde"
  usa a mesma função.

**Um caminho só pra graduar:** botão "Graduar" do cabeçalho da ficha removido — sobra
"+ Novo evento" na timeline (que já decide entre `graduarAluno` e append retroativo).

**Aviso de divergência:** quando `profiles.faixa/graus` não bate com o último evento da
timeline (caso típico: faixa alterada por SQL ou importação, que fixa `branca`), a aba
Graduação mostra um alerta comparando os dois e um atalho pra registrar o evento que
falta. É o que explicava aluno Laranja na lista e Branca na Graduação.

**Código morto removido (154 linhas):** `_profEditarFichaSheet` (ficha em sheet,
substituída pela edição inline) e `_profGraduarSheet` (órfã após tirar o botão) — os
dois eram caminhos paralelos de escrita nos mesmos campos.

**selfTest 154 → 156:** aluno com só evento `inicio` tem data de faixa e tempo na faixa.

### v343 — uma única porta de escrita em academies.config (2026-07-26)

`salvarConfig` substitui o JSONB **inteiro**, e havia três call sites mandando cada um
a sua parte: salvar a meta de aulas por faixa (`_metaAulaSheet`) enviava só
`{metaAulas}` e **apagava pix/whatsapp**; o inverso também valia. Agora tudo passa por
`_salvarAcademyConfig(patch)`, que relê o remoto (`getConfig`), faz merge e só então
grava. As metas continuam chegando ao aluno: `academyConfig` **não** está em
`USER_KEYS` (não vai no dump do aluno) — vem sempre fresco de `academies.config` no
`pullAll`, e `aulasStats` lê de lá.

### v342 — senha padrão em lote nunca funcionou + config da academia vai pra nuvem (2026-07-26)

- **Bug crítico (senha padrão):** o botão "Aplicar senha padrão" chamava
  `sbProf.senhaPadraoLote(SENHA_PADRAO, false)` — e `SENHA_PADRAO` **não existe** em
  lugar nenhum do código (a constante é `SENHA_PADRAO_DEFAULT`, e o valor certo vem de
  `_senhaPadrao()`). Todo clique morria em `ReferenceError`, caía no `catch` e mostrava
  "Falha: SENHA_PADRAO is not defined" — nenhuma senha era gravada. Por isso a única
  saída era resetar no SQL editor. O dry-run (que monta a lista) sempre usou a senha
  certa, o que dava a impressão de que a tela funcionava.
- **PIX/WhatsApp não chegavam ao aluno:** `abrirConfigAcademia` gravava tudo em
  `DB.loja.config`, que vive no **user_state privado do professor**. O aluno lia o
  mesmo caminho no dump DELE — sempre vazio — e caía nas constantes `LOJA_PIX`/
  `LOJA_WHATSAPP`. Agora PIX e WhatsApp vão pra `academies.config` (via
  `getConfig`+`salvarConfig`, com **merge** — mandar só os dois campos apagaria
  `metaAulas`), que todo membro já lê no boot (`pullAll` → `DB.academyConfig`).
  `_lojaPix`/`_lojaWa` leem nuvem → local → constante.
- **`senhaPadrao` fica de propósito FORA da nuvem:** `academies.config` é legível por
  qualquer membro da academia; a senha de quem ainda não acessou não pode ficar à
  vista dos alunos. Continua no user_state do professor (por aparelho).

### v341 — selfTest cobre "presença exige turma" (150 → 154) (2026-07-26)

4 asserções novas para a regra da v340: dia sem grade não registra; 2 aulas na janela
abrem o seletor com 2 opções; seletor aberto ainda não gravou nada; cancelar não grava.
Os horários do fixture são derivados do "agora" com clamp em `[00:00, 23:59]`, então
`dt` fica sempre em -20..0 min — dentro da janela em qualquer hora que o CI rodar, sem
flake na virada do dia. Verificado por mutação: revertendo o guard do cancelar, o
selfTest cai pra 153/154 e aponta a asserção certa.

### v340 — presença sempre atrelada a uma turma (2026-07-26)

O picker "Qual aula você fez?" já existia quando havia 2+ sessões na janela, mas tinha
duas saídas que gravavam check-in **sem turma**: o botão "Não sei / pular" e fechar a
sheet pelo backdrop. E, sem grade no dia, `_flowCheckin` chamava `_finalizarCheckin(null)`
direto. Check-in solto não entra em nenhuma ocupação por turma/sessão e suja o histórico.
Agora: "pular" virou **Cancelar**, fechar por fora cancela igual, e dia sem grade avisa
("Sem aula na grade de hoje — a presença precisa de uma turma") em vez de registrar.
Uma sessão elegível continua entrando direto, com a turma no toast de confirmação.

### v339 — ocupação por SESSÃO real (aproveita a 0010) (2026-07-26)

Com a 0010 em produção, `checkins.aula_id` aponta pra `aulas(turma_id, data, hora)` —
dá pra saber o horário exato de cada presença. `getRelatorios` passa a embutir
`aulas(hora)` (achatado em `aulaHora`; RLS `aulas_read` já liberava a leitura ao
professor) e `_ocupacaoSessoes` usa dois agregados: `turma|dow|horaAula` (real, por
sessão) e `turma|dow` (legado sem `aula_id`, ainda rateado entre as sessões do dia).
Resultado: dois horários da mesma turma no mesmo dia deixam de exibir o mesmo número —
17:30 vazio e 19:30 lotado aparecem como são. **A nota de "aproximação documentada"
some conforme os check-ins legados (pré-0010) saem da janela de 120 dias.**
Célula do heatmap segue somando o slot: a academia tem um tatame só, então nunca há
duas turmas no mesmo dia+horário (confirmado pelo dono).

### v338 — aba/PWA volta ao foco e já chega atualizada (2026-07-26)

Complemento da v337: invalidar cache na escrita resolve o dispositivo que fez a
alteração, mas a **outra aba** continuava com a foto antiga até um F5 (no PWA, fechar
e abrir). Agora `visibilitychange` + `focus` chamam `onDadosMudaram()` com piso de 10s
(evita rajada de query no alt-tab e serve de dedupe entre os dois eventos). Decisão:
**não** usar Supabase Realtime — exigiria migration na publicação `supabase_realtime`,
`REPLICA IDENTITY FULL`, auditoria de RLS de canal (fora das 22 atuais) e uma WS por
aba, e ainda precisaria de um refetch de reconexão como rede de segurança. Limite
aceito: duas abas visíveis lado a lado só atualizam ao receber foco.

### v336-337 — export do "Alunos (Excel)" vira .xlsx + escrita invalida cache (2026-07-26)

- **Exportar Excel** (antes "Exportar CSV"): `_xlsExportCSV` monta a planilha com
  `XLSX.utils.aoa_to_sheet` e baixa `.xlsx` real (mesmas 18 colunas, larguras
  automáticas). O vendor `xlsx.min.js` já estava carregado — nenhuma dependência nova.
- **Dado velho na tela (root cause):** `_alunosMemo`/`_relMemo` (supabase.js) e
  `_profTs`/`_relTs` (app.js) são caches de 30s que **nenhuma escrita invalidava** —
  apagar uma presença exigia F5 (no PWA, fechar e abrir o app). Agora, ao montar o
  `sbProf`, todo método que **não** começa com `get` é embrulhado: ao resolver, limpa
  os dois memos e chama `window.onDadosMudaram()`, que zera `_profTs`/`_relTs` e refaz
  o fetch. Um ponto só — nenhum call site precisa lembrar de limpar cache.

### v335 — heatmap de ocupação volta com toggle Matrículas ↔ Presenças (2026-07-26)

O toggle (`DB._heatMode`) tinha sido removido na v288 junto com o heatmap mock. Volta
agora com **dado real**: "Presenças" reusa `_ocupacaoSessoes()` (média de check-ins por
sessão, mesma aproximação documentada — o checkin guarda a turma, não a sessão) somada
por `dia|hora`; "Matrículas" segue `_turmaAlunos × capacidade_max`. Segmented control
reusa a classe `.seg` (sem CSS novo). Enquanto `_relData` não chega, a aba de presenças
mostra "Carregando presenças…".

### v334 — badge de filtros ativos + WhatsApp usa nome completo (2026-07-26)

- **Filtros avançados:** o botão agora mostra um badge com a quantidade de filtros
  ativos (e borda vermelha), mesmo com o painel fechado — antes, filtro ligado +
  painel colapsado parecia lista completa.
- **WhatsApp:** `_waNome` passa a usar `cad.nomeCompleto` (primeiro + segundo nome)
  em vez do apelido — "Dudu" virava saudação de mensagem formal. Mesmo critério no
  título da sheet e no nome do responsável (menor de 18).

### v333 — sheet não fecha ao arrastar de dentro pro backdrop (2026-07-26)

Pressionar dentro da sheet, mover o mouse pra fora e soltar disparava `click` no
`.sheet-overlay` (alvo comum do press+release) e fechava a sheet — perdendo o que
estava preenchido. Guard global em captura (`app.js`, junto do focus trap): grava o
alvo do `mousedown` e cancela o `click` no overlay quando o press começou em outro
lugar. Cobre os ~47 handlers `if(e.target===sheet) close()` sem tocar em nenhum.

### v332 — KPI de alunos bate com a lista (2026-07-26)

A home mostrava **129** ("Alunos totais") e a tela de Alunos **131** ("cadastrados"):
`getKPIs` filtrava `role === 'aluno'` enquanto `getAlunos` devolve todo profile ativo
da academia (aluno + professor + dono). Decisão: **contar todo cadastro ativo**, sem
distinção de papel. `soAlunos` em `supabase.js` passa a ser a lista inteira e o chip
"Ativos (14d)" da lista adota o mesmo critério do KPI (`diasSem <= 14`, antes
`!diasSem || diasSem < 14`, que contava `diasSem` ausente como ativo).

### Backend — 0020: fecha `academy_matricula_seq` (Advisor CRITICAL) (2026-07-26)

Supabase Advisor sinalizou `public.academy_matricula_seq` como *"RLS Disabled in
Public"*. A tabela é o **contador de matrícula por academia** usado pelo trigger
`gen_matricula()` da 0011 — não é uma sequence do Postgres, é tabela real. Sem
RLS, qualquer `authenticated` podia dar `UPDATE` no `proximo` de outra escola e
colidir matrículas.

Fix mínimo, mesmo padrão de `public.rate_limits` (0001):

```sql
alter table public.academy_matricula_seq enable row level security;
revoke all on public.academy_matricula_seq from anon, authenticated;
```

RLS habilitada **sem policy** = nega tudo pra anon/authenticated. O trigger
`gen_matricula()` segue funcionando porque roda como `security definer` (dono da
função tem bypass).

**Aplicado em prod** via `supabase db push`. Advisor deve limpar no próximo scan.

### Push — teste em massa validado ponta a ponta em prod (2026-07-26)

Primeiro disparo real além do `no_subscription`. `net.http_post` para os 3 devices cadastrados (Rebeca iOS + Gabriel Windows + Gabriel iOS) com `tipo:'teste'` (template já em `send-push` desde a 0018): **6 linhas em `net._http_response`, todas 200**, `content` `{"ok":true,"sent":1|2,"removed":0|1}`. O `removed:1` é o auto-clean de uma subscription expirada (410 gone) — comportamento correto do endpoint. Notificação chegou no PWA.

Fica documentado como bypass de regra pra teste manual: `select net.http_post((select value from app_config where key='push_function_url'), body:=jsonb_build_object('user_id', <uuid>::text, 'tipo','teste','turma','teste'), headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select value from app_config where key='push_auth_token')))` no SQL Editor. Zero código novo; o template `teste` já vivia na Edge Function.

### v312–v314 + CSS v211/v212: card do aluno mais limpo no mobile, tabela respira no desktop, WhatsApp em 1 toque (2026-07-26)

**Alunos — card mobile.** Meta inline usava `beltPill` (foto da faixa + nome + "0º"),
que competia visualmente com o nome do aluno. Trocado por `beltMini` puro — a faixa
já mostra os graus como listras, sem texto redundante.

**Alunos — tabela desktop.** Faixa cortava em "Amarela · (" e o ícone do WhatsApp
ficava espremido em 32px. `.view` do professor sobe de 1120→1280 (1024+) e ganha
degrau 1440 (1440+); colunas Faixa (138/140→172/176), WA (32→44), Turmas e Pgto
levemente maiores. Zero conteúdo escondido, zero overflow.

**WhatsApp — botão visível no mobile.** `.erp-c-wa-btn` deixou de ser
`display:none` abaixo de 1024px e vira quadrado 34×34 clicável. Abre o sheet de
templates já existente (`_waSheet`).

**Templates — "Só abrir chat".** Nova primeira opção no sheet
(`💬 Só abrir chat`, body vazio) — `_waLink` sem `?text=` abre a conversa em
branco. Cobre o caso mais comum (professor quer só chamar, sem texto pronto).

### Backend — 0017/0018: consentimento opt-out, regra parametrizada e push só por template (2026-07-26)

**0017 — `aceita_contato` vira opt-OUT + regra de padrão parametrizada.**
- Default `true` + backfill (5/5 alunos). O aluno sai pelo toggle "Avisos no celular" (apaga a
  subscription) ou pedindo ao professor, que desmarca "Recebe mensagens" na ficha — o filtro na regra
  continua, é ele que faz o desmarcar surtir efeito. `cadFromProfile` passou a ler `!== false`
  (perfil antigo em cache não vira "não autorizado" por omissão).
  Nota LGPD: pra push o consentimento real é duplo e explícito (permissão do navegador + toggle);
  `aceita_contato` é o freio do professor. Pra WhatsApp ele segue sendo o consentimento primário.
- Regras 6 e 7 viraram números em `app_config`: `push_ocorr_min` e `push_presencas_min`, **ambos 0**
  na fase de formação de hábito. Decisão do dono: "aluno está matriculado, então tem que ir" — faltar
  é desvio mesmo sem histórico. Os check-ins seguem sendo gravados, então em **01/10/2026** basta
  girar os dois números pra 4 e 3 e a regra de padrão passa a valer sobre a base já acumulada.
  Zero código, zero deploy.
- **`JOIN` → `LEFT JOIN` em `padrao`**: com mínimo 0, aluno sem nenhuma ocorrência passada precisa
  passar. O `INNER JOIN` original o descartaria antes da comparação e o zero seria inócuo.

**0018 — payload por template (resposta a "como proteger pra ninguém fazer push aleatório?").**
Antes o corpo do POST levava `title`/`body`/`url` livres: quem tivesse o token mandaria qualquer
texto com qualquer link pros alunos. O risco não é "push aleatório" — é *"Yama Jiu-Jitsu: atualize
seu pagamento aqui"* apontando pra phishing, com o ícone da academia.
- O banco manda só `{user_id, tipo, turma}`; a Edge Function renderiza de um catálogo fechado
  (`TEMPLATES`). Com o token vazado, o atacante no máximo **reenvia uma mensagem legítima**.
- Nome da turma entra sanitizado (sem quebra de linha, ≤60 chars) — evitaria empurrar o texto real
  pra fora da área visível da notificação.
- Comparação do token em **tempo constante**.
- **`sw.js`: só navega para a própria origem.** URL externa no payload cai na home. Defesa em
  profundidade — vale mesmo com o token intacto.

**Verificado em prod:** phishing **com token válido** → `tipo_desconhecido` (bloqueado) · template
legítimo → `200 {"sent":0,"reason":"no_subscription"}` · token errado → `401` · função revogada de
anon após o `CREATE OR REPLACE`. selfTest 150/150.

### Backend — 0016: token dedicado no lugar da service_role (2026-07-26)

A 0014 previa guardar a **SERVICE_ROLE** em `app_config` pra o `pg_net` se autenticar na Edge
Function. Trocado por um **token aleatório dedicado** (`PUSH_SHARED_SECRET`, 32 bytes base64url):
a service_role é admin total do banco e ignora toda a RLS, então um vazamento de `app_config`
viraria comprometimento completo em vez de "consegue disparar push". Escopo mínimo.

- `app_config.push_service_key` → **`push_auth_token`**. O nome importa: `push_service_key`
  convida o próximo a colar a service_role ali.
- `enviar_avisos_checkin()` recriada lendo a chave nova — e **revogada de novo** de
  `anon`/`authenticated`/`public`, porque `CREATE OR REPLACE FUNCTION` reseta os grants
  (lição direta da 0015; sem isso a correção teria sido desfeita em silêncio).
- A service_role continua sendo usada **dentro** da função (env injetado pelo Supabase) pra ler
  `push_subscriptions` — isso é normal e nunca sai do runtime da função.

**Ativado em prod e verificado ponta a ponta:** token errado → `401` · token certo → `200
{"sent":0,"reason":"no_subscription"}` (chegou ao banco e consultou a tabela) · `cron.job`
`yama-avisos-checkin` ativo em `5 * * * *` · as duas funções → `42501` pra anon · `GET
/app_config` como anon → `[]`.

### Backend — 0015: fecha o EXECUTE das funções de push (2026-07-26)

**Correção de segurança da 0014, achada e corrigida no mesmo dia**, antes de configurar o envio.

O `revoke all on function ... from public` da 0014 **não bastava**: o Supabase concede `EXECUTE`
nominalmente a `anon` e `authenticated` (default privileges do projeto), e revogar de `public` não
toca nesses grants. Verificado em prod com a chave anônima (que é pública — vai no bundle JS):

```
POST /rpc/avisos_checkin_pendentes → 200 []   ← lista de quem faltou ao treino
POST /rpc/enviar_avisos_checkin    → 200 0    ← dispararia os envios
```

Impacto se tivesse passado: vazamento de `user_id` + turma de quem faltou, e — assim que
`push_function_url` fosse gravada na `app_config` — push em massa disparável por qualquer um,
queimando o `push_log` e o backoff dos alunos. Só não era explorável ainda porque a config
não existia (daí o `0`).

`0015` revoga das três origens (`public`, `anon`, `authenticated`). Pós-fix: `42501 permission
denied` nas duas. As funções são chamadas só pelo `pg_cron` (roda como `postgres`), que não perde acesso.

**Regra que fica:** função `security definer` que agrega dados de outros usuários nunca pode ficar
com `EXECUTE` pra `anon`/`authenticated` — revogar só de `public` engana.

### v311 — Data de nascimento obrigatória + reimportação ATUALIZA + filtro etário fixo (2026-07-26)

`app.js?v=311` · `app.css?v=210`. Sem migration.

- **Data de nascimento virou obrigatória na importação** (era só aviso). Ela define faixa etária,
  turma e regras CBJJ — sem ela o aluno entra cego no sistema. Formato errado agora **bloqueia**
  em vez de passar batido.
- **Ano derivado da data.** A coluna "Ano nascimento" saiu do modelo (a leitura ainda aceita, p/
  planilhas antigas). Manter os dois campos livres deixava divergirem sem ninguém perceber
  (ano 1998 + data 15/03/1999). Auditoria do banco na hora da mudança: 0 divergências.
- **E-mail já cadastrado deixou de ser erro → virou status `atualizar`.** A linha é aplicada como
  patch no aluno existente; **só campos preenchidos entram** — célula em branco não apaga dado bom.
  Motivo: 53 alunos ficaram sem `nascimento_data` por causa do ReferenceError do v308 (a data é
  gravada numa 2ª chamada, depois do `criarAluno` retornar; como a criação estourava, a 2ª nunca
  rodava e o ano — que ia no payload — sobrevivia sozinho). Sem o modo atualizar não havia como
  consertar pela UI.
- **Filtro de faixa etária virou barra permanente**, com a opção extra "Sem data" (acha cadastro
  incompleto). Os chips já existiam mas ficavam atrás do botão "Filtros". O select duplicado
  introduzido no v309 foi **removido** — dois controles disputando o mesmo estado é bug esperando.

**Validação testada em 5 casos:** ano derivado da data · já-cadastrado → `atualizar` com id certo ·
sem data → bloqueia · formato errado → bloqueia · planilha antiga com ano+data → a data vence.

### v310 — ReferenceError que derrubava a importação + Pgto fora da tabela (2026-07-26)

`app.js?v=310` · `app.css?v=209`. Sem migration.

- **Causa raiz do erro de importação — introduzida no v308.** Ao remover a escolha automática de
  turma, ficou uma referência órfã no retorno da Edge Function:
  `return json({ ..., turma_id: turma?.id ?? null })`. A variável `turma` não existia mais →
  **ReferenceError depois de todo o trabalho já estar gravado**. Sintoma exato: o aluno ERA criado
  (logs do Supabase mostravam `200`/`201` em `auth/v1/admin/users`, `profiles`, `graduations`), mas
  a função morria antes de responder e o navegador recebia *"Failed to send a request to the Edge
  Function"*. Daí "0 criados / 10 falhas" enquanto o total subia de 106 → 116.
  **As três hipóteses anteriores estavam erradas** (rate-limit, CORS, rede instável) — foi o log do
  Supabase, pedido pelo dono, que apontou o caminho certo.
- **Banco auditado após o incidente:** 114 alunos, 0 e-mail duplicado, 0 cadastro parcial. O retry
  não duplicou porque a 2ª tentativa bate em "already registered".
- **Coluna Pgto saindo da tabela.** O grid tem colunas fixas em px e a linha não tem scroll
  horizontal: o que não cabe some em silêncio. Com a coluna nova estourava em 1280 (−48px) e
  **já estourava em 1024 antes** (−49px) — estava cortada havia tempos, sem ninguém notar.
  Agora as colunas entram em degraus: **1024+** 8 colunas · **1200+** + Turmas · **1320+** + Faixa
  etária. FAIXA nunca desce de 138px (abaixo disso "Marrom · 3º" corta o "º" — bug do v288).
  Verificado em 1024 / 1240 / 1440: Pgto dentro, folga 52px.

### v309 — Nome completo na tabela + coluna Faixa etária + filtro ao vivo (2026-07-26)

`app.js?v=309` · `app.css?v=208`. Sem migration.

- **Coluna NOME passou a mostrar o nome COMPLETO.** O cabeçalho dizia "Nome" mas a célula trazia o
  apelido — divergência entre rótulo e conteúdo. A ordenação da coluna também migrou p/ o nome
  completo (ordenar por um campo que não está na tela dá uma ordem inexplicável).
- **Nova coluna Faixa etária**, ordenável por **idade** e não pelo alfabeto do rótulo (senão
  "Adulto" viria antes de "Kids"); sem data vai pro fim nas duas direções.
- **Busca da barra passou a procurar no nome completo também** — com a coluna mostrando
  "Arthur Lobato De Almeida", digitar "Lobato" não achava nada.
- **Botão "Pesquisar" removido dos filtros.** A lista já refiltrava a cada alteração; o botão só
  sugeria que era preciso clicar pra valer.

### v308 — Acesso dos alunos (senha padrão + convite em lote) + import resiliente (2026-07-26)

`app.js?v=308` · `app.css?v=207` · `supabase.js?v=39` · Edge Function `senha-padrao`.

- **Problema:** a senha provisória individual só aparece uma vez, no retorno do cadastro. Na
  importação em lote ela se perde e o professor fica sem como dar acesso a ninguém — e o aluno
  não sabe nem o link do app.
- **Edge Function `senha-padrao`** — aplica uma senha aos alunos que **nunca acessaram**
  (`auth.users.last_sign_in_at IS NULL`). Quem já entrou nunca é tocado (trocar senha de conta em
  uso é sequestro). `must_change_pw` segue `true` → troca forçada no 1º login. Rate-limit 5/h +
  trilha em `admin_audit`. Usa `listUsers` **paginado**: `getUserById` por aluno estourava o tempo
  limite com 100+ alunos.
- **Tela "🔑 Acesso"** na gestão: lista quem nunca acessou, aplica a senha e tem botão de WhatsApp
  por linha com o convite pronto (link + e-mail + senha + dica de instalar na tela de início).
- **Limite aceito pelo dono, documentado no código e avisado na tela:** senha compartilhada
  significa que quem souber a senha + o e-mail de um colega entra na conta dele até ele fazer o
  1º acesso, e vê o diário privado. **O login é e-mail+senha, não exige acesso à caixa de entrada**
  — o dono decidiu com base na premissa contrária, foi corrigido, e manteve a decisão. A janela
  fecha sozinha no 1º acesso de cada aluno.
- **Import: `create-student` não adivinha mais turma.** Só matricula com `turma_id` explícito. A
  escolha por idade (v307) era só p/ corrigir o bug das 33 crianças; a pedido do dono a importação
  voltou a ser "limpa". **Regra que fica: cadastro não chuta turma.**
- **Retry em falha de rede** (3×, espera crescente) + 150 ms entre chamadas. Erro determinístico
  (e-mail repetido, dado inválido, rate-limit) não é retentado. *(Nota: não era a causa real do
  erro que o dono via — ver v310 — mas protege contra falha de rede de verdade.)*

### v307 — Import em lote: rate-limit + turma por idade + banner de avisos (2026-07-26)

`app.js?v=307` · `supabase.js?v=38`. Sem migration.

Dois bugs reais da importação, achados com 62 alunos já em produção.

- **Importação falhava acima de 30 alunos/hora.** O teto da `create-student` era 30/h por professor
  — pensado p/ cadastro avulso, quebrava o lote (que aceita até 200 linhas). Subiu p/ **250/h**.
  Pior que a falha era o silêncio: o `catch` do laço era mudo e a tela só dizia "N falhas". Agora
  agrupa os **motivos**, traduz p/ português (`_impMotivoPT`), aborta na hora se bater rate-limit e
  explica o que fazer. `criarAluno` passou a extrair o código real de `error.context` — antes vinha
  o genérico "non-2xx status code" (mesmo padrão que `excluirAluno` já usava).
- **Todo aluno importado caía na turma ADULTO.** `create-student` escolhia a turma com `.limit(1)`
  **sem `ORDER BY`** — literalmente qualquer uma. Em prod: **33 crianças de 3 a 15 anos na turma de
  adulto**. O ano de nascimento estava correto no banco; o furo era só na matrícula.
  **Dados corrigidos:** 32 movidos + 1 duplicata removida. A turma **FEMININO** (sem rótulo de
  idade) foi preservada de propósito — 2 alunas adultas estão lá por escolha do professor, não por
  bug; a regra por idade as teria arrastado p/ ADULTO.
- **Banner "Ative os avisos"** na Home enquanto o push não estiver ligado. Nenhum app consegue
  ativar push sem toque do usuário (regra do navegador) — o banner é a alternativa. Reaparece a
  cada visita (dismiss vale só p/ a sessão) e some de vez quando o aluno ativa. Não aparece se
  bloqueado no navegador ou sem suporte: insistir onde não dá p/ agir só irrita.

### v306 — Web Push + aviso de check-in pendente (2026-07-26)

`app.js?v=306` · `supabase.js?v=36` · `sw.js` · **migration 0014** · Edge Function `send-push`.

Primeira notificação do app que chega com o **app fechado**. O desenho central (decidido com o dono):
**silêncio é o estado normal** — o app só fala com quem quebrou o próprio padrão. Quem fez check-in
nunca recebe nada.

- **`sw.js` deixa de ser kill-switch e vira push-only.** A decisão de "online-only, sem cache offline"
  continua valendo: o SW **não tem handler de `fetch`**, então não intercepta requisição nenhuma. Ele
  existe só porque Web Push exige um SW vivo. Continua limpando caches de instalações antigas, mas não
  se desregistra mais.
- **Migration 0014** — `push_subscriptions` (RLS self-only; o professor não lê endpoint de aparelho) +
  `push_log` (base do backoff e trava anti-duplicata via UNIQUE parcial `(user_id, aula_id)`), função
  `avisos_checkin_pendentes()` com as 10 regras, `enviar_avisos_checkin()` e agendamento `pg_cron` horário.
- **Edge Function `send-push`** — VAPID via `web-push` (criptografia RFC 8291 **não** implementada à mão:
  é caminho de segurança). Subscription morta (404/410) é apagada na hora.
- **`sbPush` no adapter** — registrar/remover o próprio aparelho. O cliente **nunca** dispara push; quem
  decide o que enviar é o cron. Desligar = apagar a subscription.
- **Toggle "Avisos no celular"** no Perfil, com estados honestos: ligado · desligado · bloqueado no
  navegador · não suportado · ainda não configurado pela academia.

**As 10 regras** (todas precisam passar): aula aconteceu (≥1 check-in — feriado não vira spam em massa) ·
consentimento `aceita_contato` (0013, LGPD) · sem check-in no dia (qualquer aula) · aluno ativo e role
`aluno` · sem lesão ativa · ≥4 ocorrências de histórico · presente em ≥3 das últimas 4 daquela sessão ·
não está em backoff (4 avisos sem abrir → pausa **15 dias**) · janela 08:00–22:30 · tem aparelho registrado.
**Sem cota semanal** (decisão do dono): 3 faltas atípicas na mesma semana são 3 informações legítimas.

- **Bug estrutural pego antes de subir: a janela de check-in impedia atender o próprio aviso.**
  `CHECKIN_JANELA_MIN` era **±30 min** do início da aula, mas a notificação sai 30–120 min **depois do
  fim** — ao tocar nela o app responderia "fora do horário da aula". A janela virou **assimétrica**:
  30 min antes do início, **240 min depois** (`CHECKIN_JANELA_POS`). O 240 não é arbitrário: o app conta
  do início e o aviso conta do fim, então precisa cobrir `duração + 120` — cabe aula de até 2h. Vale pra
  todo mundo, não só pra quem tocou na notificação. Continua só no mesmo dia (o check-in grava em
  `CURRENT_DATE`).
- **`?checkin=1`** (URL da notificação) abre direto o check-in e marca o aviso como lido — é o sinal que
  alimenta o backoff.

**Não é possível e não foi prometido:** Live Activity / Ilha Dinâmica (aviso persistente que se atualiza
na tela de bloqueio) **não tem API web** — exige app nativo. O que existe é notificação comum.

**selfTest 150/150 verde.** Janela validada no browser: 20min antes ✔ · 40min antes ✗ · 60min depois ✔ ·
175min depois ✔ · 200min depois ✗ (com `POS=180`; hoje 240). SW registra, ativa e limpa caches; `_b64`
decodifica chave VAPID real em 65 bytes iniciando em `0x04` (ponto EC não-comprimido).

### v305 — Excluir presença (2 caminhos) + Graduação com semáforo de graus e KPIs clicáveis (2026-07-26)

`app.js?v=305` · `app.css?v=206` · `supabase.js`. Zero migration.

**Excluir presença** — antes não existia caminho nenhum (removido no v292 pra ter um só ponto de gravação). Agora dois, ambos reusando a UI que já existia:
- **No batch check-in:** a flag "Já presente" virou **"Presente · remover"** clicável → `confirm()` → apaga. Novo `sbProf.removerPresencaBatch(userId, turmaId, data, hora)` — resolve o `aula_id` real por (turma, data, hora) e apaga por ele; se não achar aula, cai no legado (`turma_id + data` com `aula_id IS NULL`).
- **No histórico da ficha do aluno:** botão `×` por linha. `getAlunoDetalhe` passou a trazer `checkins.id`; novo `sbProf.removerCheckinId(id)` apaga direto pelo id. Remove da lista em memória sem re-fetch.

**Menu Graduação:**
- **Semáforo real no chip de graus** — antes era sempre verde (`ok:true` fixo). Agora: neutro em 0-2, **amarelo** em 3 (a partir daí o professor pode pular pra nova faixa, regra CBJJ), verde no máximo da faixa. Novo estado `'warn'` no `_semChip` + `.sem-chip.warn` no CSS.
- **Faixa maior na lista** — escala **proporcional** das 4 vars do `belt-mini` (~100px × 15.5px, contra 84 × 13 do default), pra os graus ficarem legíveis. Regra confirmada pelo dono: **nunca alongar sem engrossar** — alongar só o comprimento distorce o desenho.
- **KPI cards clicáveis** — "Aptos agora" e "Próximos" rolam pras respectivas seções (reusa `.stat-card.kpi-click` do painel).
- **Card "Sem data de faixa" removido** — a informação já aparece como chip na linha de cada aluno.
- **"Aptos agora" fica cinza quando é 0** (novo `.si.gray`) — verde com valor zero era enganoso.
- **Botão "Definir data"** nos alunos sem `faixaDesde`, abrindo a ficha direto na aba Graduação. Antes o professor via o problema sinalizado mas não tinha atalho pra corrigir.
- **Seção "Alunos" deixa de cortar em 10** — o `.slice(0,10)` escondia o resto da lista sem aviso. Alunos sem data de faixa entram na seção (antes só contavam no KPI removido).

**selfTest 150/150 verde.**

### v288 — Pill "Marrom·3º" não corta + remove abas mock (Instrutores, Heatmap) da aba Turmas (2026-07-24)

`app.js?v=288` · `app.css?v=196`. Zero migration.

- **Bug: pill "Marrom · 3º" cortava o "º" na lista de alunos** — a coluna FAIXA da tabela ERP tinha largura fixa de `140px`, insuficiente pra faixas com nome longo + graus. `text-overflow:ellipsis` comia o `º`. Aumentei a coluna pra `170px` (cabe até "Vermelha e Preta · 6º" quando um dia chegar).
- **Removida a aba "Timeline por instrutor" e "Heatmap de ocupação" (mocks)** da tela Turmas, a pedido do dono. Dependiam de `_MOCK_INSTRUTORES=['Prof. Gabriel','Prof. Bruno','Prof. Rafa']` — instrutores fictícios que confundiam a leitura. Também removido o helper `_ocupacaoMock` (função hash pseudoaleatória pra ocupação). Voltam quando houver dados reais (`instrutor_id` da 0012 já existe mas nenhum aluno tem check-ins reais ainda).
- **Código deletado (≈213 linhas de JS + 70 de CSS):** `_MOCK_INSTRUTORES`, `_instrutorMock`, `_duracaoMock`, `_capacidadeMock`, `_hashSeed`, `_ocupacaoMock`, `_viewGantt`, `_viewCalendarioMes`, `_viewHeatmap`, `_viewConflitos`, `DB._turmasTab`, `DB._heatMode`, `DB._heatSemanas`. E os blocos CSS `.turmas-tabs`, `.gantt-*`, `.cal-*`, `.heat-*`, `.conf-*`. Aba Turmas fica só com a **Grade de horários** — o que é dado real.
- **selfTest 150/150 verde.** Nenhum mock mencionado na UI (`mock_count=0`).

### v287 — Reverte SVG, unifica com o HTML+CSS antigo aprovado (2026-07-24)

Correção do v286: SVG novo mudava a estética que já estava aprovada (proporções, gradientes, graus mais finos). Feedback do dono: "não aprovo, unifique usando o que estava funcionando". `app.js?v=287` · `app.css?v=195`. Zero migration.

- **Objetivo do item 3 preservado: UMA implementação de faixa em todo o app.** Agora é `beltMini(f, g)` com o HTML+CSS antigo (v285-pre-svg), aprovado visualmente. `beltPill` e `.belt-rank` (Jornada) viraram wrappers finos que reutilizam `beltMini` com overrides de `--bm-h`/`--bm-body`/`--bm-tip`/`--bm-end`. Zero SVG, zero duplicação de renderer.
- **Tamanhos por contexto (só overrides de var):** `.belt-pill .belt-mini{--bm-h:10px}` (pill nas linhas), `.belt-field .belt-mini{--bm-h:20px}` (seletor), `.belt-pick .belt-mini{--bm-h:15px}` (lista do seletor), `.belt-rank .belt-mini{--bm-h:20px}` (Jornada). Tudo escalado proporcionalmente às vars antigas (34/43/7).
- **CSS antigo aprovado restaurado** — gradientes de profundidade (highlight topo, sombra base), listra bicolor 40% central, box-shadow interno.
- **selfTest 150/150 verde** — restaurado o check antigo (procura `.bm-tip` + `red-tip` + `getComputedStyle`).
- **Verificação visual:** faixa preta 13px com ponteira vermelha (229,57,53) e 3 graus brancos; azul com ponteira preta (20,22,27); cinza_branca bicolor com listra central. 26 pills na lista = 26 `belt-mini` dentro (bijeção).
- **Nota interna:** o registro do v286 no CHANGELOG fica como aviso — SVG parametrizado é elegante em teoria, mas quando o CSS já resolve com um único wrapper HTML e o visual está aprovado, unificar é preservar o que existe, não reinventar.

### v286 — Faixa em SVG único (item 3, pré-requisito da graduação) (2026-07-24)

`app.js?v=286` · `app.css?v=194`. Zero migration. Substitui as três renderizações antigas de faixa (`beltPill`, `beltMini`, `.belt-rank`) por um componente vetorial parametrizado, pré-requisito do redesenho de graduação (itens 1+2).

- **Nova função `beltSvg(faixa, graus, opts)` — fonte única da verdade.** SVG parametrizado com viewBox 6:1: corpo colorido → ponteira preta (vermelha na preta, regra CBJJ) → ponta colorida. Graus como quadradinhos brancos (pretos na branca), alinhados à direita. Bicolor (kids `_branca`/`_preta`, corais) desenha a listra `--bar` sobre corpo e ponta. Nítido em qualquer densidade/zoom (era pixelado no zoom da timeline).
- **`beltPill`/`beltMini` agora são wrappers finos** — chamam `beltSvg`. Os 22 usos (pills nas linhas de aluno, timeline, Perfil, Jornada, cadastro, seletor de faixa) continuam sem mudança na assinatura.
- **`.belt-rank` da Jornada também migrado** — o único uso HTML+CSS restante na tela grande foi trocado por `beltSvg(f, g, {height:20})`.
- **CSS enxugado — 22 regras deletadas.** Todos os `.bm-body`/`.bm-tip`/`.bm-end`/`.br-body`/`.br-tip`/`.br-end`/`.belt-bar`/`.bicolor` sumiram (0 residuais confirmado). Sobra só o wrapper (`display:inline-flex; height; overflow:hidden; svg{height:100%}`).
- **selfTest atualizado (150/150):** os 4 checks antigos (`.bm-tip` + `red-tip` + `getComputedStyle`) viraram checks de `fill` do SVG (`#e53935` na preta, `#141414` nas demais). Ganhou também "sem ponteira preta na preta" e "sem ponteira vermelha nas demais" — regressão explícita.
- **Verificação:** 26 pills na lista de alunos, 26 SVGs (1:1), zero HTML antigo residual. 11 faixas testadas: preta com ponteira vermelha, demais com preta, bicolores (`cinza_branca`/`laranja_preta`/`coral`) com 8 rects (2 extras da listra).

### v285 — Bloco UX pós-v284 + FAB centralizado (2026-07-24)

`app.js?v=285` · `app.css?v=192`. Sem migration.

- **Data BR sem calendário do OS (item 4):** helper `dateBRField(id, iso)` + `bindDateBR(sheet)` (máscara `dd/mm/aaaa` no input, ao digitar formata) + `dateBRRead(el)` (converte pra ISO no submit). Aplicado nos 4 campos (`ca-nascdata`, `ca-inicio`, `fe-nascdata`, `fe-inicio`). Preserva ISO no banco; troca só a UI.
- **Minha Turma: legenda + célula só cor com 2+ turmas (item 5):** ao aluno com 1 turma o comportamento é idêntico (chip 2 linhas com nome+sub, sem legenda). Com 2+, legenda no topo (cor + nome + faixa etária) e células viram bloco sólido (`.mt-gc-solid`) — nome/sub no `title` (tooltip). Verificado: 2 turmas → 14 células sólidas; 1 turma → 11 células com texto.
- **Ficha ERP completa + turmas inline (item 6):** `_erpFicha` ganhou Nome completo, Apelido, Ano nascimento + Data completa (BR), Responsável parentesco (era só nome/tel), início em formato BR, e o bloco Turmas com chips clicáveis (matricular/desmatricular inline; salva junto com o resto). Salvar dispara `atualizarAluno` (perfil + `nascimento_data`) e `sincronizarTurmas` em paralelo. ViaCEP e máscara de data ligados no edit inline.
- **Painel: cards brancos + faixa de cor (item 9):** `.erp-class-card` deixou o preto (`#334155`) e virou card branco (`--surface-1`), 1px de borda + faixa esquerda 6px na cor da turma, sombra suave, dark-mode respeitado.
- **FAB "Registrar" centralizado (bug reportado no meio do lote):** era caractere `+` com `margin-top:-14px` no fluxo — dependia de fonte/kerning e ficava descentrado em alguns viewports. Refeito com `.fb` `position:absolute; left:50%; transform:translateX(-50%); top:-22px` + `<svg>` inline pro `+` (`icoPlus()`). Verificado: FAB 52x52, SVG 28x28, ambos com diff 0 do centro do container.

### v284 — 4 bugs da varredura pós-v283 (2026-07-24)

Lote de correções triviais mas de alto impacto na percepção do professor. `app.js?v=284`. Sem migration.

- **Bug: sheet órfã ao navegar no menu lateral** — sheets vivem no `<body>` fora do `#root`; navegação no menu do professor limpava o root mas deixava o overlay pendurado. Novo helper `_closeAllSheets()` chamado no `render()` quando `!sameView`.
- **Bug: Lesões não mostrava a nota (regressão do ERP v2)** — o dado sempre esteve disponível (`getAlunoDetalhe` faz `select('*')` de `lesoes`), mas `_lesoesPanelNode` não a renderizava. Linha `.li-nota` reaproveitando estilo já usado na sheet do aluno.
- **Bug: "Mais praticadas" listava zeros** — passava impressão de app quebrado. Agora filtra `treinos>0`; se ninguém praticou nada, mostra "O aluno ainda não registrou prática de nenhuma técnica."
- **Bug: filtros da aba Alunos eram só visuais** — os 8 inputs em `profAlunos()` não tinham `id` nem handler; o botão "Pesquisar" não fazia nada. Adicionado objeto `advF` + filtragem no `renderList` (matrícula, nome, ativos, aguardando faixa, recebe mensagens, faixa, turma, plano) + filtro ao vivo (change/input) + botão "Limpar" funcional.
- Verificação no preview (demo): sheet fechada na troca de view · nota renderizada · painel de técnicas com aviso adequado · filtro por faixa reduz 13→5 linhas e "Limpar" restaura para 13.

### v283 — Censo do banco + migration 0013 (matrícula, fato de matrícula, consentimento) (2026-07-24)

Censo via probe REST revelou o estado REAL de prod: `0001`–`0009` ✓ · **0010 ✗** · **0011 ✗** · `0012` ✓ — migrations vinham entrando à mão e fora de ordem. `app.js?v=283` · `supabase.js?v=34` · migration **0013** nova (aplicar 0011 → 0013; runbook §"Reconciliação").

- **Bug "capacidade não salva" (root cause):** `getTurmas` não selecionava `capacidade_max`/`duracao_min`/`instrutor_id` — coluna write-only: salvava e a recarga descartava. Select+map completos; de quebra o heatmap de ocupação (`_capacidadeMock`/`_duracaoMock`) passa a receber dados reais.
- **Matrícula ligada de ponta a ponta (item 1):** 0011 (aplicar) + backfill na 0013 (numera perfis antigos por ordem de cadastro, offset anti-colisão, `unique (academy_id, matricula)`) + `mapAluno` expõe `matricula` (UI `00042` já existia).
- **Matrícula/desmatrícula viram FATO (item 2):** tabela `enrollment_events` (append-only, RLS staff-read, sem FK de user/turma — sobrevive à exclusão LGPD, padrão admin_audit) alimentada por trigger em `enrollments` — base futura de retenção/churn. História começa na 0013 (sem eventos fabricados).
- **`tipos_aula` aposentada (item 4):** zero usos em código desde a 0001; drop na 0013.
- **Consentimento de contato (item 5):** `profiles.aceita_contato` (opt-in, default false) + campo "Recebe mensagens" na ficha ERP (ver + editar) + `_cadToDB`/`cadFromProfile`.
- **Fix na 0011 (não aplicada em lugar nenhum):** as policies `grad_prof_update`/`grad_prof_delete` usavam `create policy if not exists` — sintaxe inexistente no Postgres (42601 na primeira tentativa real de aplicar; o lote reverteu inteiro). Corrigido p/ `drop policy if exists` + `create policy`. Mais um argumento pro staging.
- **Processo (item 6):** runbook ganhou §"Reconciliação de migrations" (censo, ordem 0011→0013, `migration repair` p/ o CLI virar fonte de verdade) e a **0010 ganhou aviso de NÃO APLICAR** no cabeçalho — ela derruba a UNIQUE `(user_id,data)` que `pushCheckin`/`lancarPresenca` ainda usam; entra só com o adapter redesenhado.

### v282 — Escritas de gestão com erro checado (incidente: sessões de turma apagadas) (2026-07-23)

Incidente real: professor editou uma turma e os horários sumiram. Causa: migration **0012 não aplicada em prod** (`capacidade_max`/`duracao_min`/`instrutor_id` inexistentes — verificado via probe REST: prod está na 0011) combinada com o padrão `await SB.from(...)` **sem checar `error`** no adapter — o update falhou silencioso, o delete das sessões passou, o re-insert falhou silencioso. `app.js?v=282` · `supabase.js?v=33`.

- **Adapter:** TODAS as escritas de gestão agora checam e propagam `error`: `salvarTurma` (3 passos — schema velho aborta ANTES do delete das sessões), `deletarTurma`, `salvarProduto` (mesma mina delete+insert nas variantes), `deletarProduto`, `atualizarAluno`, `setMensalidade`, `lancarPresenca`, `removerPresenca`, `salvarGraduacao` (branch update).
- **UI turmas:** toasts de sucesso ("Turma salva ✔"/"Turma excluída") só depois da confirmação do backend — antes o app dizia sucesso e engolia a falha.
- **Sequela do incidente:** os horários da turma editada foram apagados do banco (irrecuperáveis) — re-cadastrar pela UI após aplicar a 0012.
- **Correção de registro:** docs diziam "0006–0012 aguardando staging→prod"; o probe provou 0001–0011 aplicadas. Só a 0012 falta.

### v281 — Gate de senha: current_password + recovery + erros em PT (2026-07-23)

Incidente real: aluno recém-cadastrado travado no 1º acesso — "Current password required when setting new password" (painel Auth com *require current password*, endurecido em 2026-07-14) e link de reset caindo em `localhost:3000` (Site URL de fábrica, nunca configurado). `app.js?v=281` · `supabase.js?v=32`.

- **Adapter:** a senha do login agora fica SÓ em memória (`_loginPw`; limpa no signOut e após o uso) e é enviada como `current_password` no `updateUser` — suportado desde supabase-js 2.102 (vendor: 2.110). Novos: `sbAuth.hasLoginPw()` e assinatura `changePassword(newPw, currentPw?)`.
- **Gate (`renderTrocarSenha`):** valida **letras+dígitos** no cliente (espelha a política do painel) · campo "Senha provisória (atual)" aparece só se o app foi recarregado entre login e gate (stash vazio) · erros do GoTrue traduzidos pra PT (`pwErrMsg`) · falha agora loga em `client_errors` (antes era invisível na observabilidade).
- **Recovery ligado:** evento `PASSWORD_RECOVERY` abre o gate em modo "Redefinir senha" — antes o link de "esqueci a senha" logava silenciosamente sem nunca pedir a senha nova. Sessão de recovery segue sem `current_password` (o servidor dispensa nesse fluxo).
- **Painel (feito pelo dono, 2026-07-23):** Site URL → `https://tavaressg.github.io/tavaressg/` (+ conferir Redirect URLs). Pendência nova no ROADMAP: SMTP próprio p/ e-mails em nome da Yama.

### Varredura — perímetro de deploy + SRI dos vendors novos (2026-07-23)

Lote de manutenção sem mudança de comportamento — nenhum `?v=N` bumpa.

- **Perímetro de deploy:** `supabase/.temp/linked-project.json` (artefato do Supabase CLI criado na raiz, com project ref + org id) estava trackeado no git — removido do índice e `/supabase/` (raiz) adicionado ao `.gitignore`. O backend real segue em `confidencial/supabase/`.
- **SRI estendido aos vendors novos (M-5):** `xlsx.min.js`, `jspdf.min.js` e `jspdf-autotable.min.js` ganham `integrity=` no `index.html` (antes só o supabase-js tinha). `gen_sri.mjs` agora lista os 4 vendors; hash do supabase-js re-verificado — bate com o `integrity` em produção.
- **Docs sincronizadas:** `CLAUDE.md` (fase v280 · vendors reais · pasta `loja/` no mapa · migrations criadas até `0012` · drill de backup marcado como feito) e `DEPLOY.md` (allowlist do `vendor/` completa; passo 10 cobre qualquer vendor).

### Backup/restore — drill executado em produção (2026-07-18)

Item #1 da matriz de auditoria 2026-07-15 ("único risco existencial em aberto"). **Nenhuma mudança no app** — trabalho puro de infraestrutura/validação.

- **Projeto descartável `yama-restore-drill`** criado no ecossistema Supabase da Yama (mesma org, `sa-east-1`) — deletado ao fim.
- **Estratégia sem Docker/pg_dump** (nenhum dos dois instalado): Node + `pg` — `scratchpad/rls/drill.mjs`. `SELECT * → INSERT` em batches por tabela, com `session_replication_role = replica` no restore pra silenciar triggers/FKs durante o insert. Serialização por tipo (`information_schema`): `object → JSON.stringify` para colunas `jsonb`/`json`; arrays JS diretos para `text[]`.
- **Cobertura:** 24 tabelas — `auth.users` + `public.academies/profiles/turmas/turma_sessoes/enrollments/tipos_aula/aulas/graduations/lesoes/technique_progress/checkins/user_state/produtos/produto_variantes/stock_movements/pedidos/mensalidades/notifications/member_notes/client_errors/admin_audit/app_config/rate_limits`. **Gap conhecido:** arquivos binários do bucket `fotos` (só 1 foto hoje) — Storage API à parte quando fizer sentido.
- **Validações no restore:** contagens 24/24 idênticas · hashes `md5(encrypted_password)` byte-a-byte iguais (3 usuários) · `email_confirmed_at`/`created_at` iguais · **RLS 22/22 PASS** via `rls_audit.sql` no restore.
- **Tempo:** dump+restore net ~3s + migrations ~1min. Bem abaixo da meta de 1h.
- **Runbook atualizado:** README §"Backup & restore" ganhou seção "Execuções" documentando o método sem Docker.
- **Nota operacional:** senha do banco de prod foi redefinida antes e depois do drill (a temporária era fraca demais para postgres direto).

### v224 — Trilha de auditoria administrativa (admin_audit) (2026-07-16)

Item #10 da matriz da auditoria 2026-07-15 ("quem excluiu/alterou, sem resposta"). `app.js?v=224` · `supabase.js?v=27` · migration **0008** (staging → prod) · **redeployar as 4 Edge Functions junto**.

- **Migration 0008:** tabela **`admin_audit`** — append-only por construção (RLS sem policy de escrita; INSERT só via trigger SECURITY DEFINER/service_role), **denormalizada de propósito** (`actor_nome`/`alvo_nome` snapshotados, sem FK — a trilha sobrevive à exclusão de qualquer conta). Leitura: professor/dono da própria academia.
- **Triggers:** `ficha_update` (professor editou profile de TERCEIRO — grava só os **nomes** dos campos alterados, nunca valores: LGPD/minimização; auto-edição não loga) · `mensalidade_set` (mês + de→para) · `presenca_remove` (professor apagou check-in de aluno; aluno removendo o próprio não loga). Trilha nunca derruba a operação (`exception → return`).
- **Edge Functions (4):** gravam a trilha explicitamente (`aluno_create`, `professor_create`, `professor_promote`, `aluno_delete`) — service_role tem `auth.uid()` nulo, trigger não veria o ator. Best-effort (falha só loga no console da function). **Self-delete LGPD não é logado** — não deixa nome para trás. No delete, o snapshot dos nomes é capturado ANTES do `deleteUser`.
- **Visor (`app.js?v=224` + `sbProf.getAuditoria`):** painel do professor ganhou a linha "📜 Atividade da gestão" (abaixo dos Beta KPIs) → sheet com as últimas 50 ações ("Fulano editou a ficha de Sicrano · 16 jul 14:02 · telefone, cep"). Demo/offline: estado vazio.
- Complementa trilhas já existentes: `graduations` (append-only, `por`), `stock_movements` (estoque, `por`), `checkins.via`. RPCs de pedido (confirmar/cancelar) ficaram de fora por ora — `stock_movements` + `status` já dão rastro; incluir na fase gateway.
- Validação: `node --check` OK · **selfTest 150/150** (ao vivo) · demo verificado (linha no painel; sheet abre com estado vazio; console limpo).

### v223 — Fotos de perfil privadas (bucket + signed URLs) (2026-07-16)

Item "signed URLs nas fotos" da auditoria 2026-07-15 (compliance/LGPD — bucket público expunha foto por link, inclusive de menores). `app.js?v=223` · `supabase.js?v=26` · migration **0007** (criada, ⚠️ **staging primeiro**, depois prod — STAGING.md).

- **Migration 0007:** `storage.buckets.fotos.public=false` · derruba `fotos_public_read` · novas policies de SELECT: `fotos_self_read` (dono do prefixo) e `fotos_prof_read` (professor/dono lê fotos de perfis da própria academia — a API de signed URL respeita essas policies) · backfill defensivo `foto_url` URL→path. Escrita self (0001) intacta.
- **Modelo de dado:** `profiles.foto_url` agora guarda o **PATH** (`{uid}/profile.jpg`) — signed URL expira, path não. **Bug latente corrigido de graça:** NENHUM código gravava `foto_url` (só leitura) — o roster do professor nunca teve foto de aluno; agora `uploadFoto` grava o path (e `deleteFoto` limpa).
- **Adapter (`supabase.js?v=26`):** `signFoto`/`_fotoPath` (TTL 24h; normaliza URL legada) · `pullAll` assina a foto do próprio aluno (fallback base64 do dump preservado) · `getAlunos` assina **em lote** (`createSignedUrls`) p/ o roster — nunca deixa path cru em `a.foto` (fallback = iniciais).
- **`app.js?v=223`:** fim do `+'?t='+Date.now()` no upload — signed URL é única por assinatura (cache-bust natural) e o `?t=` extra **quebraria o token**. URL assinada no dump pode expirar entre sessões → `data-fallback` mostra iniciais e o próximo boot reassina.
- Loja NÃO afetada (fotos de produto são estáticas `loja/` do host, não usam o bucket).
- Validação: `node --check` OK · **selfTest 150/150** (ao vivo). Teste com backend real (upload→roster) fica p/ o staging após a 0007.

### Staging separado de prod — projeto yama-staging + override localhost (2026-07-16)

Item "staging" da fundação p/ gateway (auditoria 2026-07-15). `supabase.js?v=25` (só o adapter bumpa — app.js intacto).

- **Projeto `yama-staging` criado via CLI** (ref `gknwlpfmwkgaagrcorla`, `sa-east-1`, free tier — 2º slot do plano; free pausa após ~1 semana sem uso). Senha do banco gerada (CSPRNG) em `supabase/.staging_db_password` (fora do git). **O CLI continua linkado na PRODUÇÃO** — staging é sempre alvo explícito (`--db-url`/`--project-ref`), nunca relink.
- **`supabase/staging_setup.sh` (one-shot, a rodar):** migrations 0001–0006 no staging + deploy das 4 Edge Functions + imprime API keys e os `secrets set` prontos (`SERVICE_ROLE_KEY`, `ALLOWED_ORIGIN=http://localhost:5179`). A execução direta pelo agente foi bloqueada pelo classificador de permissões (comando com credencial embutida) — decisão correta, fica com o dono.
- **Override de ambiente no adapter (`supabase.js?v=25`):** `localStorage['yama.env']={url,key}` aponta o app pro staging **só em localhost** (gate por hostname — inerte em produção) e loga `ambiente OVERRIDE ativo` no boot. Elimina o risco clássico de editar credenciais no arquivo trackeado e deployar env errado. `const→let` nas duas constantes.
- **`supabase/STAGING.md`:** runbook com checklist do setup restante (script, bucket, Auth espelhado, dono de teste, rls_audit 22/22), a **regra de ouro** (migration nova: staging primeiro → prod) e avisos (free pausa; staging nunca recebe dado real de aluno — LGPD).
- **Regra de processo:** README do runbook de prod passa a referenciar o STAGING.md.

### CI — node --check + selfTest headless a cada push (2026-07-16)

Item "CI" da fundação p/ gateway (auditoria 2026-07-15). **Sem mudança no app** — nenhum `?v=N` bumpa. Arquivos novos: `.github/workflows/ci.yml` + `.github/ci/selftest.mjs` (allowlist do DEPLOY.md atualizada — `.github/` sobe por necessidade do Actions; conteúdo público inofensivo).

- **Workflow (push + PR, ubuntu-latest):** 1) `node --check` em `app.js`/`supabase.js`/`sw.js`; 2) `python3 -m http.server 5179` + `puppeteer-core@23` (sem download de browser — usa o **Chrome pré-instalado do runner**) + `selftest.mjs`.
- **`selftest.mjs`:** abre `?test=1` headless (mesmo ambiente do teste manual — jsdom quebraria nos APIs de browser), captura o console e **falha o job** se não vier `Yama selfTest: N/N OK` (ou se vier `FALHARAM`), listando os asserts reprovados (`FALHOU: <nome>`). Espera ativa pelo servidor + até 20s pelo resultado; `pageerror` logado p/ diagnóstico de boot quebrado. Env `CHROME_PATH`/`TEST_URL` p/ rodar local.
- **Validação local PARCIAL (honestidade):** no Windows, o Edge headless **não lança** a partir do shell sandboxed do agente (3 tentativas: direto, `--user-data-dir` em Temp e em pasta gravável — processo morre antes do handshake CDP; limitação do ambiente, não do script). O que FOI validado localmente: espera ativa do servidor, tratamento de erro de launch (mensagem limpa + exit 1) e o parse do resultado (regex casa com o formato real `%cYama selfTest: 150/150 OK` observado no console). O launch será provado na primeira execução no runner Linux (Chrome pré-instalado — combinação canônica do puppeteer); se falhar lá, o log do job mostra o diagnóstico.
- **Doc:** ARCHITECTURE.md corrigido de novo ("106 asserções" → 150) + nota do CI; CLAUDE.md ("Como rodar") ganhou a linha do CI.

### Backend — 0006: alerta externo de erros (client_errors → webhook push) (2026-07-16)

Migration **0006_alerta_erros_webhook.sql** criada (⚠️ **aguarda `supabase db push`** + config do webhook). **Sem mudança no app** — nenhum `?v=N` bumpa; selfTest inalterado.

- **Trigger `client_errors_notify`** (AFTER INSERT em `client_errors`) → `net.http_post` (extensão **pg_net**, assíncrono — não bloqueia nem derruba o INSERT) para a URL em `app_config['error_webhook_url']`. Sem URL configurada = no-op (aplicar a migration é inofensivo).
- **Tabela nova `app_config`** (key/value; RLS on **sem policy** — invisível pro cliente, mesmo padrão da `rate_limits`).
- **Throttle:** 1 notificação por janela de 15 min (reusa `rate_limits` com subject fixo) — loop de erro vira 1 push, não centenas.
- **Privacidade:** a notificação leva só "houve erro + horário local" — **nenhum conteúdo de erro** (msg/stack podem ter contexto de usuário) sai para o serviço de push; detalhes ficam no card 🐞 do painel (v222), RLS-gated.
- **Canal:** payload multi-chave (`content` Discord · `text` Slack · `message`/headers ntfy) — recomendado **ntfy.sh** (push no celular, sem conta, tópico de nome imprevisível). Setup + teste + debug (`net._http_response`): README §"Alerta externo de erros (0006)". Alerta nunca quebra o registro do erro (`exception when others → return new`).
- Fecha o ciclo de observabilidade da auditoria 2026-07-15: captura (0001) → painel (v222) → **aviso ativo (0006)**. Sentry no cliente foi descartado: CSP `script-src 'self'` + zero-dependências.

### v222 — Erros reais no painel do professor + runbook de backup/restore (2026-07-15)

Itens 1–4 das "correções imediatas" da auditoria de maturidade (2026-07-15). `app.js?v=222` · `supabase.js?v=24`. **Sem migration** (a policy `client_errors_prof_read` da 0001 já autorizava a leitura).

- **KPI "Erros" real (era `0` hardcoded):** `sbProf.getKPIs` agora conta `client_errors` das últimas 24h (`count exact head`; timestamp completo em ISO/UTC — C1 só vale p/ data-calendário). A linha dos Beta KPIs virou **"Erros de app (24h)"**. Demo segue com mock `erros:0`.
- **Alerta acionável no painel:** com `erros > 0`, "O que fazer hoje" ganha o card **"🐞 N erros de app nas últimas 24h"** → abre `_profErrosSheet` (novo, padrão `openSheet`): lista msg + hora + `app_version` via novo `sbProf.getErros` (últimos 50, 24h, RLS da academia). Demo/offline: estado vazio. Fecha o ciclo de observabilidade que já existia pela metade (captura `window.onerror`→`client_errors` desde a auditoria pré-lançamento, mas ninguém lia).
- **Runbook de backup/restore (drill):** nova seção **"Backup & restore — drill"** em `supabase/README.md` — dump em 3 arquivos (roles/schema/data) via CLI, restore em projeto vazio (`psql --single-transaction` + `session_replication_role=replica`), validação (contagens + `rls_audit.sql` 22/22 + login do dono no restaurado) e rotina (dump semanal, drill trimestral). **Execução pendente:** `supabase db dump` falhou nesta máquina com `LegacyDockerRunError` (exige Docker Desktop); alternativa documentada com `pg_dump` nativo. `confidencial/backups/` fica fora do git (o `.gitignore` já cobre `confidencial/`).
- **Doc corrigida:** ARCHITECTURE.md dizia "app.js ~3900 linhas" — são ~8300. Contrato do adapter no README ganhou `getErros`.
- Validação: `node --check` OK · **selfTest 150/150** (rodado ao vivo) · demo verificado (painel renderiza, "Erros de app (24h)" nos Beta KPIs, sem card de alerta com 0 erros, console limpo).

### v221 — Botão da página de produto vira inline (fim do "retângulo branco") (2026-07-14)

`app.js?v=221`. Continuação do ajuste visual v220.

- **Página "Novo produto" — barra branca flutuante removida:** mesmo alinhada (v220), a `.save-bar` (fundo branco + borda) ainda parecia um retângulo solto em volta do botão no desktop. Agora o botão "Criar produto"/"Salvar" é **inline no fim do formulário** (mesmo padrão da página de cadastro de aluno, que nunca teve o problema por já usar botão inline). O "Excluir produto" foi remontado em JS após o Salvar (ordem: Visível → Salvar → Excluir); `padding-bottom` do form reduzido de 120→40px (não há mais barra fixa a compensar).
- Validação: `node --check` OK · **selfTest 150/150** · demo verificado (novo: sem save-bar, botão inline, salva e volta; edição: sem save-bar, ordem Salvar antes de Excluir).

### v220 — Alinhamento da save-bar nas páginas cheias do professor (desktop) (2026-07-14)

`app.js?v=220` · `app.css?v=144`. Ajuste visual do lote v219.

- **"Quadrado branco" solto na página de Novo produto (desktop):** a `.save-bar` (fixa, fundo branco) ficava mais estreita (430px) que o formulário (680px) e desalinhada — a `.phone` do professor mantém `padding-left:208/232px` reservado à sidebar, que não existe nessas páginas. Fix: `render()` marca `body.prof-fullpage` quando uma página cheia está aberta; CSS zera o padding fantasma da `.phone` e a save-bar passa a `width:100%;max-width:680px` centrada no mesmo eixo do form. A view normal do professor (com sidebar) não é afetada — o toggle sai ao fechar a página. Mobile inalterado.
- Validação: **selfTest 150/150** · demo verificado (form e save-bar alinhados à esquerda no mesmo eixo; lista normal mantém `padding-left:208px`; toggle entra/sai correto).

### v219 — Novo produto e cadastro de aluno viram páginas cheias (fim dos menus suspensos) (2026-07-14)

Fase 2 do lote de gestão pedido pelo dono. `app.js?v=219` · `app.css?v=142`.

- **"Novo produto" (loja) agora é página cheia** (`renderProdutoForm`/`abrirProdutoForm`), não mais sheet suspenso. Rota própria no roteador (`DB.produtoFormOpen`), seta ‹ no topo (com guarda anti-perda se editado), save-bar fixa. Mesmos campos e lógica de antes (categorias, estoque por tamanho, add/remove tamanho, visível/oculto, excluir). A confirmação de exclusão segue como sheet (diálogo pequeno).
- **Cadastro de aluno agora é página cheia** (`renderCadastroAluno`/`abrirCadastroAluno`), não mais wizard em menu suspenso. Rota própria (`DB.cadastroAlunoOpen`), seta ‹ no topo, mesmos 4 passos (Dados → Endereço → Responsável → Graduação) e validações. No sucesso, invalida o cache e volta pra lista com a senha provisória por cima. (O cadastro de *professor* — só do dono — segue como sheet.)
- **Desktop do professor:** as duas páginas ganham `.prof-page` — centralizadas em 680px e sem o deslocamento `left:208px` da save-bar da gestão (elas não têm a sidebar).
- **Acessibilidade:** `#route-announce` já anuncia "Produto" e "Cadastro de aluno" ao abrir.
- Validação: `node --check` OK · **selfTest 150/150** · demo verificado ponta a ponta (produto: view não-sheet, back, campos, salva, volta; cadastro: 4 passos, cadastra, volta, senha sheet; layout centrado 680px no desktop; console limpo).

### v218 — Nota da lesão no relatório + botão da loja visível + 3 fixes de acessibilidade (2026-07-14)

Fase 1 do lote de gestão/a11y pedido pelo dono. `app.js?v=218` · `app.css?v=141` · `supabase.js?v=23`. Sem migration (RLS já permitia).

- **Nota clínica da lesão no relatório do professor:** a coluna `lesoes.nota` já era "visível ao professor" por design (policy `lesoes_prof_read`, migration 0001), mas o `getRelatorios` só selecionava `parte,status,data`. Agora inclui `nota`; `_lesoesComAluno` a carrega e a lista "Quem está / esteve lesionado" mostra `🩹 <nota>` (`.les-nota`) quando houver.
- **Botão "＋ Novo produto" invisível (bug):** `.btn-cad` tinha `color:#fff` mas **nenhum `background`** no estado base — só nos modificadores `.primary`/`.dark`. O botão da loja usava a classe base → texto branco sobre fundo claro. Fix: `background:var(--red)` no `.btn-cad` base (default seguro; `.dark` ainda sobrepõe).
- **A11y #1 — contraste:** `--muted` era `#9aa0a6` (~2.7:1 sobre fundo claro, reprova WCAG AA). Agora `#6b7178` (~4.6:1). Só o tema claro mudou.
- **A11y #2 — toast "Desfazer" anunciado:** `toastUndo` ganhou `role="status" aria-live="polite"` (antes o leitor de tela não avisava a opção de desfazer).
- **A11y #3 — troca de tela na SPA anunciada:** nova live-region `#route-announce` (`.sr-only`) escrita no `render()` via `_announceRoute()` quando a view muda — leitor de tela passa a anunciar "Relatórios", "Loja", "Check-in" etc.
- Validação: **selfTest 150/150** · demo verificado (botão vermelho, `--muted` #6b7178, route-announce="Relatórios", nota da lesão mapeada).

### v217 — Fix foco não persiste + OTP visual + rascunho só no mesmo dia (2026-07-14)

Três bugs reportados pelo dono. `app.js?v=217` · `app.css?v=140`.

- **Foco sumindo no reload (bug real):** o `estado` (foco/guardada/...) era salvo no dump (`user_state`) corretamente, mas o overlay de `pullAll()` ([supabase.js:253](../supabase.js)) reaplica `estado` a partir da tabela `technique_progress` **depois** do `applyDump`. As funções que mudam foco (`rsAddFoco`/`rsRemoverFoco`/`bibVoltarFoco`) chamavam só `scheduleSave()` (dump) e nunca `pushProgress()` (tabela) — então a tabela ficava com o valor antigo e o overlay apagava o foco no boot. Fix: novo helper `_syncEstado()` (chama `pushProgress`) disparado junto do `scheduleSave` nos 3 pontos.
- **Animação do OTP "atrasada" (visual):** `.filled` só ganhava borda vermelha fina enquanto `.active` (caixa vazia seguinte) levava o anel vermelho forte — o destaque parecia trailing. `.filled` agora ganha fundo `--red-tint` + dígito em `--red-strong`: cada dígito digitado "fecha" na hora. (`app.css?v=140`)
- **Rascunho de treino persistindo até o dia seguinte:** `_loadDraft` aceitava `diasEntre<=1` (hoje + ontem). Passou a exigir `date===HOJE_ISO` (só mesmo dia); rascunho de dias anteriores é descartado no `_clearDraft`. Presença (`checkinHoje`) já zerava por dia via `_resetDiario`.
- Validação: **selfTest 150/150** · OTP verificado no preview (caixa preenchida com fundo vermelho no 1º dígito).

### v200 — Loja real Yama (fotos) + interatividade nos Relatórios + regras por faixa + retroativa + anti-perda global (2026-07-10)

Lote grande aprovado pelo dono ("faça os dois" + varredura + loja). `app.js?v=200` · `app.css?v=129` · `supabase.js?v=17` · migration **0003** (criada, ⚠️ **aguarda push**) · `seed_loja_yama.sql` (aguarda 0003).

- **Enquadramento das fotos (app.css?v=129):** as fotos são retrato de modelo — `object-fit:cover` centralizado cortava no meio (cabeça cortada). Cards da grade e strip do perfil viraram **proporção 3:4** e o hero do detalhe **1:1** (max 300px), todos com `object-position:top center` (enquadra a estampa/peça no peito). Fundo neutro `#f3f3f5` no container. Verificado no preview (grade + detalhe).

- **Loja oficial Yama importada** (marketplace.youdraw.com.br): 8 produtos reais (nome/preço/tamanhos/descrição do Shopify JSON) no **seed** e no `seed_loja_yama.sql` (backend). **Fotos locais em `loja/`** (novo diretório no allowlist de deploy — CSP `'self'`); render com `_prodImgHTML` nos 4 pontos (card/hero/carrinho/destaque), fallback emoji via `data-fallback`, dark-mode sem o esmaecido em `.has-img`. Adapter: `produtos.img_url` (0003) em `salvarProduto`/`_produtoToApp`.
- **Bug kimono**: tamanhos do produto agora são **por categoria** (Kimonos→A0–A4 · Vestuário→P–GG · Acessórios→Único) e **100% editáveis** (adicionar/remover tamanho no sheet). De passagem: editar produto **não persistia `tam`** — corrigido.
- **Anti-perda GLOBAL**: `openSheet` compara snapshot dos campos ao clicar fora — mexeu → `_confirmDescartar`. Sheet de produto (fora do openSheet) ganhou flag própria. Verificado: digitar + clicar fora abre "Descartar?".
- **Cadastro**: só **nome + e-mail** obrigatórios (e-mail = login da conta); nascimento/telefone/responsável opcionais (validados se preenchidos). Decisão do dono.
- **Relatórios interativos**: distribuição de faixas **clicável** → sheet com os alunos da faixa (`_alunosPorFaixaSheet`) → detalhe. **Lesões com aluno**: nova lista "Em recuperação — quem" (`_lesoesComAluno`, junta `user_id` do getRelatorios com a lista de alunos) → clica abre o aluno. **"Coortes de entrada"** → **"Entradas por mês"** (linguagem clara).
- **Regras por faixa** (`_regrasFaixaSheet`, sub-aba Graduação): meta de aulas POR FAIXA; semáforo/aptos usam `_metaAulasFaixa()`. Persiste em `academies.config` (0003; offline fica em memória).
- **Graduação retroativa** (`_gradRetroSheet`, detalhe do aluno): faixa+graus+tipo+**data passada** → monta a linha do tempo; perfil só muda se for a graduação mais recente. Online via `graduarAluno(...,data)` (RPC v2 na 0003).
- **Backlog 1–4**: WhatsApp no detalhe do aluno (aparece só com telefone na ficha) · filtro **"Sumidos"** na lista de alunos (ordena por dias sem treinar) · turma nova **reabre na edição** (horários/matrícula) · `pullMatricula` no boot.
- **Migration `0003_loja_img_regras_retroativa.sql`**: `produtos.img_url` + `academies.config jsonb` + policy `academies_prof_update` + `graduar_aluno` v2 (retroativa livre no passado, futuro bloqueado, perfil só na mais recente). ⚠️ O push foi **bloqueado pelo classificador** (mudança de RLS em produção pede confirmação do dono) — comando: `supabase db push` em `confidencial/`.
- Validação: `node --check` OK · **selfTest 150/150** · demo exercitado (dist. faixas→sheet→aluno, lesões-quem, "Entradas por mês", regras row, Sumidos, tamanhos por categoria + add/remove, retro sheet, 8/8 fotos carregadas, guarda anti-perda) · console limpo.

### v199 — Popup de horários no aluno (grade sincronizada) + fix sub-abas de Relatórios (2026-07-10)

Varredura da aba Relatórios + pedidos do dono sobre fluxo de turmas:

- **Popup "Horários das turmas" no aluno** (`abrirMinhasTurmas`): a linha **Turma** do Perfil (Minha academia) virou botão → sheet com a **grade semanal** (reuso de `_gradeHorarios` — literalmente a mesma visão do professor) + card por turma com chips de sessão (dia/hora/variação/🇺🇸) e badge **"sua turma"**. Online, ao abrir, re-baixa a grade na hora (`pullTurmas` + novo `pullMatricula`) — **resolve o "criei turma na gestão e não atualizou no app"**: o aluno sempre vê o que o professor acabou de salvar, sem re-login.
- **`sbSync.pullMatricula` (novo, supabase.js?v=16):** busca TODAS as matrículas ativas do aluno (o `pullAll` do boot pegava só a 1ª) e atualiza o rótulo "Turma" do Perfil (`nomes.join(' + ')`); popula `DB._minhasTurmasIds`.
- **Fix "card espremido" nos Relatórios:** `.rel-seg` deixou de quebrar linha/espremer — virou linha de chips **rolável horizontal** (overflow-x, scrollbar oculta, padding 8×13, nowrap).
- **Header dos Relatórios:** "N pessoas" → "**N alunos**" (não conta professor/dono — antes o próprio professor inflava a contagem).

Versões: `app.js?v=199` · `app.css?v=127` · `supabase.js?v=16`. `node --check` OK · **selfTest 150/150**.

### Ops/Go-live — migration 0002 aplicada · auditoria RLS 22/22 · delete-student v2 · MFA descartado (2026-07-10)

Lote operacional (sem mudança de `app.js`/`app.css` — versões seguem v198/126/15):

- **Migration `0002_relatorios_gestao.sql` APLICADA** no banco real via `supabase db push` — antes, `supabase migration repair --status applied 0001` (a 0001 tinha sido aplicada pelo SQL Editor e não constava no histórico do CLI). Histórico agora sincronizado (0001+0002 registradas no remoto). `member_notes` + `profiles.nascimento_data` no ar.
- **Edge `delete-student` v2 deployada**: guard do caller aceita `role in ('professor','dono')` (antes recusava o dono com 403 `forbidden_not_professor`). Proteção "não excluir professor por esta via" mantida de propósito.
- **Auditoria RLS ao vivo: 22/22 PASS** (`rls_audit.sql` via `supabase db query --linked`, transacional/rollback — banco intacto). Script **estendido** com 7 checks da 0002: PROF cria/lê `member_notes`; ALUNO não lê nem apaga observações sobre si; observação cross-academia bloqueada; PROF grava `nascimento_data`; ALUNO lê a própria. Privacidade §4 (ADR 0002) provada no banco real.
- **MFA TOTP UI DESCARTADO** (decisão do dono) — registrado no ADR 0001; contrato `sbAuth.mfa.*` fica inerte no adapter. Runbook/ROADMAP/CLAUDE.md/memória atualizados.
- **Docs reorganizados** (lote anterior do mesmo dia): `confidencial/docs/` com CHANGELOG (este arquivo, reordenado data↓/versão↓) + ROADMAP + ADRs (`decisions/`) + `reference/`; FUTURO.md e HANDOFF removidos; links validados (0 quebrados).

### v198 — Relatórios gerenciais (5 abas) + semáforo de graduação + matrícula real + entender o aluno (2026-07-09)

Lote aprovado pelo dono após pesquisa de mercado (Gymdesk/Zen Planner/Kicksite/BJJLINK). **Detalhe completo em `RELATORIOS.md`** (o que foi feito/validado/analisado/pendências). Resumo:

- **Aba "Relatórios" na tabbar do professor** (6 abas) com sub-nav `DB.relTab`: Visão geral · Retenção · Técnicas · Graduação · Loja.
- **Semáforo de graduação 3 eixos** (`_semaforoGrad`): tempo CBJJ (`faixaDesde`+`min_months`+idade) · aulas (`aulasNoGrau`/META_GRAU) · técnicas (META_TEC=8 em nível ≥ treinando, aproximação até existir currículo). `_aptosGraduar()` unificado (antes só contava aulas e divergia da `elegibilidadeCBJJ`).
- **Risco de evasão v2**: ausência ≥14d OU queda ≥50% (`freq4` vs `base4` — adapter agora puxa 120d de checkins) + **botão WhatsApp em 1 toque** (`_waLink`; responsável p/ menores; wa.me com DDI).
- **Camada 1 do progresso técnico agregado** (§7.1-C): domínio por categoria, mais/menos treinadas, ativos sem registro de técnica — via `sbProf.getRelatorios` (checkins/graduations/technique_progress/lesoes da academia).
- **Relatórios novos**: ocupação por horário (aprox. documentada — checkin guarda turma, não sessão), presença por tipo (real: `pushCheckin` grava `tipo=variacao||'Aula'`; coluna já existia), retenção por faixa, coortes de entrada, tempo na faixa, lesões agregadas, loja (valor parado em estoque; "mais vendidos" aguarda pedidos).
- **Matrícula REAL**: `sbProf.matricular/desmatricular/sincronizarTurmas` (a policy `enroll_prof_write` já existia na 0001 — **sem migration**). Fecha o "passo 2-backend" da v194.
- **Entender o aluno** no `_profAlunoSheet`: painel **Perfil de treino** (28d + tendência, dias/horário/tipo habituais, só de checkins) e **Observações do professor** (timeline datada, tabela `member_notes` — aluno sem policy de leitura).
- **Migration `0002_relatorios_gestao.sql` (NOVA — ⚠️ rodar no SQL Editor)**: `member_notes` + `profiles.nascimento_data` (data completa opcional → aniversariantes do mês; ano continua canônico p/ CBJJ).
- **Bugs corrigidos**: `_progressoPanelNode` contava `estado` como nível (cards sempre 0 → `_nivelDeProg`); cadastro online usava `r.id` (Edge retorna `user_id`) — matrícula pós-cadastro nunca rodava; guards `!DEMO` em `_loadProfData`/`criarAluno`/`_profSet*`/matrícula (demo disparava a nuvem e a gestão do demo carregava vazia).
- **Achado corrigido (2026-07-10)**: Edge `delete-student` passou a aceitar caller `role='dono'` (guard `role in ('professor','dono')`; antes checava `'professor'` literal e dava 403). **Redeployado** → `delete-student` ACTIVE **version 2** no projeto real.

Versões: `app.js?v=198` · `app.css?v=126` · `supabase.js?v=15`. `node --check` OK · **selfTest 150/150** · demo exercitado no preview (semáforo, wa.me, observações add/del, 5 abas, lado do aluno intacto, console limpo).

### v197 — Card de check-in ±30 min + dedup por turma (2026-07-09)

Check-in por SESSÃO com janela de tolerância, tratando o caso das aulas próximas.

- **Constante `CHECKIN_JANELA_MIN=30`.** Regra: uma sessão só é "elegível" nos ±30 min do horário de início. Fora disso, bloqueia.
- **Helpers puros novos:** `_minutosAte(HH:MM)`, `_sessoesNaJanela(min)` (ordena por proximidade ao "agora" — resolve aulas próximas priorizando a mais atual), `_turmasComCheckin()` (Set), `_sessoesElegiveis()` (janela ∩ sem check-in feito).
- **Card na Home** (`alunoInicio`, depois do streak): mostra até 2 sessões elegíveis (`.checkin-card`) com borda colorida por turma, horário grande, "começa em X min / começou há Y min / começando agora", nome da turma e CTA "Fazer check-in →". Se não há elegível, o card não aparece.
- **Dedup por TURMA** (não por dia): `DB.checkinHoje.porTurma[turmaId] = {hora,label}` — campo **aditivo** dentro de `checkinHoje` (já persistido em `USER_KEYS`); dump não muda de shape (chave nova opcional). Se o aluno fez check-in na Adulto 19:00 e há Kodomo 19:15 na janela, o card ainda mostra Kodomo.
- **`_flowCheckin` (Registrar):**
  - 0 sessões hoje → check-in sem sessão (retrocompat com quem não tem grade).
  - Todas as turmas do dia já feitas → toast "Você já fez check-in em todas as aulas de hoje".
  - Fora da janela em todas → toast "Fora do horário da aula (±30 min)".
  - 1 elegível → check-in direto.
  - **2+ elegíveis → pré-popup** `_sessaoPickSheet` (aulas próximas: aluno escolhe onde).
- **Compat mantida:** `checkinHoje.feito` e `.sessao` seguem preenchidos (o resto do app depende deles).

Versões: `app.js?v=197`, `app.css?v=125`. `node --check` OK. Preview classifier fora no momento; validação por leitura + reuso do `_sessaoPickSheet` coberto no selfTest v196.

### v196 — Painéis gerenciais de lesões e progresso + estado honesto no relatório (2026-07-09)

Fecha a "academia entende o aluno" (§7.1) no que a §4 já autoriza — sem tocar em privado.

- **Estado honesto** no relatório: "Presença por tipo de aula" trocou barras mock (Judô 38 / Ne-waza 57 / …) por texto explicativo ("Disponível assim que os check-ins registrarem o tipo da aula"). Elimina o único bloco de placeholder que restava em `profRelatorios`.
- **Detalhe do aluno** (`_profAlunoSheet`) ganhou **dois painéis gerenciais**, alimentados pela mesma chamada `sbProf.getAlunoDetalhe` que já servia a timeline (v194):
  - **Lesões** (`_lesoesPanelNode`): stat-cards (Registradas / Em recuperação) + lista com chip de status colorido (`.status-chip.red|.green`) e data. Empty state honesto.
  - **Progresso de técnica** (`_progressoPanelNode`): stat-cards (Técnicas · Aprendendo · Treinando · Dominadas) + **top 8 mais praticadas** (nome, treinos, %acerto, última prática, dot por estado). Nome resolvido via `tecByKey(id)`. Empty state honesto.
- **Data "desde YYYY-MM"** removida do cabeçalho do sheet (era ruído no cabeçalho).
- **Self** (professor logado): lesões vêm de `DB.lesoes`; progresso via helper `_selfProgresso()` derivado de `DB.tecnicas`. Zero requisição extra.
- **§4 respeitada:** só dado objetivo (parte/status/data da lesão; estado/nível/treinos/acerto% do progresso). Nada de texto livre, mood ou nota — não passam pelo adapter (professor não tem policy de leitura).

Versões: `app.js?v=196`, `app.css?v=124`. `selfTest 150/150` · funções novas exercitadas em memória sem exceção.

### v194 — Vínculo aluno↔turma (UI), timeline de graduação no professor, cadastro largo (2026-07-09)

Lote "seguro" (client-side, sem tocar schema/migration) do pedido do dono. `selfTest 150/150` · funções novas exercitadas no preview sem exceção.

- **Item 1 — Cadastro mais largo + guarda de descarte:** `_profCadastrarSheet` ganhou `.sheet-overlay.cad-wide` (máx 640px no desktop do professor). Clique **fora** com campo preenchido → `_confirmDescartar` ("Descartar preenchimento?") em vez de fechar direto (rastreia `input` → dirty). Mesmo guarda em `_profEditarFichaSheet`.
- **Item 6 — Linha do tempo de graduação (só professor):** `_gradTimelineNode(grads)` (reuso do componente da Jornada) renderizada no `_profAlunoSheet`. Dados: `_self`→`DB.graduacoes`; outros→`sbProf.getAlunoDetalhe` (backend) ou `a.graduacoes`. **Não** ativado na visão do aluno (decisão do dono — o import/edição segue bloqueado lá).
- **Item 2-UI — Vínculo aluno↔turma pelos dois lados (UI):** chips de turma (`_turmaChips`, multi-seleção) na etapa Graduação do cadastro e na ficha; **roster + mini-relatório dentro da turma** (`_turmaRosterNode`: matriculados, freq. média, em risco, aptos + lista com remover) e `_turmaMatricularSheet` (picker de alunos fora da turma). Offline muta `a.turmas`; seam pronto p/ `sbProf.matricular/desmatricular` (guardados). Indicadores derivam só de agregado objetivo (freq/diasSem/aptoGrad) — respeita §4.
- **Pendente (2-backend):** persistência real em `enrollments` (métodos `sbProf.matricular/desmatricular` + policies de professor) — exige migration nova (a discutir item a item).

Versões: `app.js?v=194`, `app.css?v=123`.

### Reconciliação de doc ↔ código (2026-07-09)

Varredura do estado real do código (build `app.js?v=193` · `supabase.js?v=14` · `app.css?v=122`) — a doc estava desatualizada (parava em v177). Fatos corrigidos em `CLAUDE.md`/`PROFESSOR.md`:

- **Backend Supabase PROVISIONADO:** credenciais reais em `supabase.js` (`ckjggpudinmzyabxejlo.supabase.co` + anon key) → `LIGADO=true`. Não é mais "placeholder / desligado".
- **Loja configurada:** `LOJA_WHATSAPP='5531996248909'` e `LOJA_PIX='31996248909'` preenchidos ([app.js:597](../../app.js:597)).
- **Módulo Turmas ENTREGUE** (não documentado antes): aba "Turmas" com **grade semanal** + CRUD de turmas e **sessões** (`profTurmas`/`_gradeHorarios`/`_turmaSheet`/`_sessaoSheet`); backend `getTurmas`/`salvarTurma`/`deletarTurma` + tabelas `turmas`/`turma_sessoes`; check-in por sessão no lado do aluno (`pullTurmas`→`sessoesDeHoje`).
- **Gap real (pendente):** **não há seletor de turma** no cadastro/ficha do aluno — matrícula (`enrollments`) só automática na turma-semente via `create-student`. Falta UI para matricular/mover aluno numa turma específica.
- **Pendências de go-live remanescentes:** `og:image`/`og:url` ainda `SEU_DOMINIO` (index.html); auditoria RLS ao vivo (`rls_audit.sql`); MFA TOTP UI; Fase F financeiro.

> ⚠️ **Changelog v178–v192 não reconstruído:** sem histórico git aqui, não dá para detalhar essas ~15 versões a partir do código. Esta entrada registra só os fatos de estado verificados por varredura, não o diff versão a versão.

### v177 — Auditoria de segurança pré-lançamento · itens bloqueantes (2026-07-08)

Correções dos itens **bloqueantes de go-live** da auditoria AppSec (backend ainda não provisionado — migration editável):

- **A-1 — CSP + headers (alta):** `index.html` ganhou `Content-Security-Policy` via `<meta>`: `script-src 'self'` (defesa em profundidade sobre o escaping manual; supabase-js **não** usa eval/Function → seguro), `style-src 'self' 'unsafe-inline'` (exigido pelos estilos inline), `img-src 'self' data: blob: https://*.supabase.co`, `connect-src` p/ REST+realtime (`https`/`wss://*.supabase.co`), `object-src/base-uri 'none'`. Para viabilizar `script-src 'self'`: (1) removido o `<script>` inline de registro do SW (movido p/ `app.js`, dentro do bloco `serviceWorker`); (2) removidos **todos** os `onerror=` inline de `<img>` (9 ocorrências) — substituídos por `data-fallback="logo"|"remove"` + **um** listener global em captura (`document.addEventListener('error', …, true)`). `frame-ancestors`/HSTS/`X-Content-Type-Options` **não** valem em `<meta>` → documentados como HTTP headers do host (DEPLOY.md).
- **M-1 — Escopo de tenant nas escritas self (média):** policies `checkins_self_insert/update` agora exigem `academy_id = my_academy_id()` e `via='app'`; `pedidos_self_rw` exige `academy_id = my_academy_id()` no `WITH CHECK`. Fecha a escrita cross-tenant (aluno plantando check-in/pedido em outra academia e poluindo os KPIs dela, ou forjando `via='professor'`). O app já grava a própria academia + `via='app'` — fluxo legítimo intacto.
- **M-2 — Política de senha (média):** mínimo do cliente subiu de 6 → **8** caracteres (troca de senha do 1º acesso). Settings do Supabase Auth a ativar no painel (não versionáveis): min-length ≥ 8, **leaked-password protection** (HaveIBeenPwned), rate-limit de login e **self-signup desabilitado** — documentados no runbook.
- **M-3 — `ALLOWED_ORIGIN` / CORS (média):** Edge Functions `create-student`/`delete-student` agora aceitam **allowlist** (múltiplas origens separadas por vírgula), ecoam a origem que casa e enviam `Vary: Origin` (origem resolvida por request via wrapper em `Deno.serve`). Sem o secret continua caindo em `*` (só dev). Definir o secret com o domínio real segue **obrigatório** no go-live.
- **Validação de RLS ao vivo (bloqueante, manual):** não executável sem backend provisionado. Entregue `supabase/rls_audit.sql` — script pronto que simula tokens de aluno A/B e professor (via `request.jwt.claims`) e **asserta** o isolamento (user_state self-only inclusive vs. professor, anti-escalonamento S1, escopo M-1) com rollback. Rodar no SQL Editor após o provisionamento; qualquer "FALHOU" bloqueia o lançamento.

Versões: `app.js?v=177`, `supabase.js?v=6` (inalterado), `sw.js` CACHE `yama-v180`.

### Hardening pós-launch — auditoria AppSec (2026-07-08)

Itens de endurecimento (não bloqueantes) da auditoria, aplicados na sequência dos bloqueantes:

- **M-5 — SRI:** `<script>` da lib de terceiros (`vendor/supabase-js.min.js`, supabase-js **2.110.0**) ganhou `integrity="sha384-…"` — o browser recusa a lib se adulterada. Helper `gen_sri.mjs` regenera o hash (rodar ao re-vendorizar). First-party churny (app.js/css) ficou de fora de propósito: hash desatualizado = app não carrega, e sob mesma origem o atacante que altera app.js também altera o index.html (SRI não agrega). **Verificado:** a lib carrega com o integrity presente (hash correto) — se estivesse errado, `window.supabase` seria `undefined`.
- **M-4 — `must_change_pw` blindado:** novo caminho único `mark_password_changed()` (RPC security-definer, self-only) seta o GUC transacional `yama.pw_changed`; o `guard_profile_update` passou a **bloquear** qualquer update direto da coluna `must_change_pw` sem esse GUC. `sbAuth.changePassword` chama a RPC após o `updateUser`. Fecha o flip casual da flag (residual: chamar a RPC direto é self-only e sem impacto — mantém a senha provisória CSPRNG forte).
- **MFA (TOTP) do professor:** contrato completo no adapter — `sbAuth.mfa.{listFactors,enroll,challengeAndVerify,unenroll,aal}`. Habilitar TOTP no dashboard (Authentication → MFA). **Restante:** UI de ativação (QR + código) no Perfil do professor e enforcement de AAL2 — a construir/testar com o backend ligado.
- **Pin de dependências:** Edge Functions passaram a importar `@supabase/supabase-js@2.110.0` (era `@2`) — casa com a lib vendorizada, builds reprodutíveis, sem drift de patch/minor.
- **Rate-limit nas Edge Functions:** tabela `rate_limits` (RLS on, sem policy) + RPC `rate_hit(bucket, limite, janela_secs)` (Postgres-backed, atômico via upsert). `create-student` = 30/h por professor; `delete-student` = 20/h por caller. Retorna 429 ao estourar. Contém abuso de token comprometido.

Versões: `app.js?v=177` (inalterado), `supabase.js?v=7`, `sw.js` CACHE `yama-v181`. `selfTest 144/144` · console limpo · lib com SRI carregando.

### Bugfix — ordem de criação na migration (2026-07-08, achado no 1º provisionamento real)

`my_academy_id()`/`my_role()`/`is_professor()` (helpers `language sql` usados nas policies) estavam definidas **antes** das tabelas `academies`/`profiles` existirem. Diferente de `plpgsql` (que só checa sintaxe na criação), funções `language sql` são validadas contra o catálogo **na hora do `CREATE FUNCTION`** — o deploy falhava com `relation "public.profiles" does not exist` no 2º statement do script. Corrigido: os 3 helpers movidos para **depois** da criação de `academies`+`profiles`. Bug pré-existente (não introduzido pelo hardening), só apareceu ao rodar a migration pela 1ª vez de verdade. Nenhuma outra função do arquivo tem esse risco (as demais são `plpgsql`, checadas só na execução).

### v176 — Fecha itens residuais da auditoria (2026-07-07)

- **Denominador de frequência unificado:** `_selfAluno()` agora usa `PROF_METAS.META_MES` (12) — antes calculava `meta*4` e dava número diferente do painel para o próprio professor. Fonte única: `window.PROF_METAS = { META_MES, META_GRAU, RISCO_DIAS }` no app.js; adapter lê via `_METAS()` lazy (fallback aos defaults).
- **`RISCO_DIAS` no app.js** passou a referenciar `PROF_METAS.RISCO_DIAS` (elimina duplicação por completo).
- **SW fallback honesto:** assets que 404am não mais devolvem `index.html` — antes escondia bugs (imagens quebradas apareciam como HTML). O fallback só continua para HTML/navigation.
- **`og:image` absoluta:** placeholder `https://SEU_DOMINIO/yama-logo.png` + `og:url` no `index.html` — substituir na publicação. Comentário explicando por que caminho relativo não gera preview no WhatsApp.
- **Foto → Storage:** `sbSync.uploadFoto/deleteFoto` sobem para o bucket `fotos` (path `{user_id}/profile.jpg`; upsert; URL pública com cache-buster). `editarFotoPerfil` tenta Storage; **fallback base64** no dump se o bucket não existir/upload falhar — nada quebra em demo/offline. Migration cria as policies (`fotos_self_write/update/delete/public_read`). Runbook atualizado.
- **Observabilidade mínima:** tabela `client_errors(user_id, msg, ctx, app_version, criado_em)` com RLS insert-self / read-professor-da-academia; `sbSync.logError` best-effort (nunca falha UX); handler de erros do cliente agora envia em paralelo ao track local, com dedupe de 3s contra spam. `APP_VERSION` exposto em `window`.

Versões: `app.js?v=176`, `supabase.js?v=6`, `sw.js CACHE yama-v179`. `selfTest 144/144` verde.

### v174 — Plataforma para todas as idades + faixas CBJJ por idade + itens da auditoria (2026-07-07)

**Liberação para menores de 18 + sistema infantil CBJJ completo (pedido do dono):**
- Constante `CBJJ` ganhou `youth_belts` (grupos Cinza/Amarela/Laranja/Verde com idade mínima 4/7/10/13), `master_belts` (Coral/Vermelha por idade) e `youth_max_age=15`. Cadeia completa em `CBJJ_CHAIN`.
- Helpers novos: `faixasPorIdade(idade)` (faixas atribuíveis por idade — infantil ≤15, adulto ≥16), `faixasParaAluno(idade, faixaAtual)` (garante a faixa atual), `proximaFaixaCBJJ(faixa, idade)`.
- **Professor atribui faixa por idade:** `_profGraduarSheet` (mostra idade+categoria e filtra faixas), `_bulkGraduar` (interseção das faixas válidas p/ todos os selecionados + aviso se mistura infantil/adulto), `_profCadastrarSheet` (faixas reconstroem ao digitar o nascimento). Ex.: 14 anos → faixas infantis; 18 → adulto.
- **Lado do aluno:** onboarding (nascimento antes da faixa; faixas por idade; **gate "18+" removido**, consentimento agora prevê aceite do responsável p/ menores), editar perfil (faixas reativas à idade), importar histórico (`_sugerirGraduacoes` escolhe cadeia infantil ou adulta; dropdown com cadeia CBJJ completa). `elegibilidadeCBJJ` passou a tratar faixas infantis (antes devolvia "faixa máxima" p/ qualquer faixa infantil); `aptoMsg` usa `proximaFaixaCBJJ`.
- **Política de Privacidade:** "restrito a maiores de 18" → todas as idades, com consentimento do responsável p/ menores (coletado pela academia no cadastro).
- `nascimento` propagado aos objetos de aluno do professor (`mapAluno`, `_selfAluno`, mock do cadastro).
- Validação de faixas no backend (migration `graduar_aluno` + Edge `create-student`) já cobria todas as faixas infantis — sem mudança necessária.

**Itens restantes da auditoria:**
- **`ALLOWED_ORIGIN` (alta):** elevado a **obrigatório** no runbook, DEPLOY.md e PROFESSOR.md §11 (secret com o domínio real; sem ele CORS cai em `*`).
- **`pushLesoes` transacional (médio):** RPC `replace_lesoes(p_rows jsonb)` (delete+insert atômico) na migration; adapter passou a usá-la.
- **KPI R$ 0,00 (médio):** painel do professor troca "Mensalidades pagas" (sempre R$ 0,00 até a Fase F) por "Ativos (14d)" (retenção). O financeiro segue na aba Financeiro.
- **Ícones SVG no painel (baixo):** ✅ **feito (v175)** — KPIs do painel e dos relatórios trocaram emoji por SVG de traço (novos `icoRoster/icoPulse/icoAlert/icoBelt/icoBox`, mesmo estilo dos ícones da tabbar). CSS `.stat-card .si svg{21px}` + cor por variante (`.si.red/blue/green/gold`). Verificado claro/escuro + mobile; `selfTest 144/144`.

Versões: `app.js?v=174`, `supabase.js?v=5`, `sw.js` CACHE `yama-v177`. Regras de idade validadas por smoke test; `selfTest` verde.

### v173 — Guard multi-dispositivo + Edge delete-student (2026-07-07)

Itens pós-Sprint 2 adiantados (banco ainda não provisionado — migration editável):

- **Guard multi-dispositivo (médio → resolvido):** `pushState` agora grava via RPC atômica `push_user_state(p_data, p_base)` — só sobrescreve `user_state` se a nuvem ainda estiver na base (`updated_at`) que este cliente carregou no `pullState`. Se outro aparelho gravou antes, a RPC levanta `state_conflict`; o adapter rejeita com `err.conflict=true` e `save()` chama `_resolveStateConflict()` (re-baixa + `applyDump` + re-baseline + toast "Dados atualizados a partir de outro aparelho"). Fim do last-write-wins silencioso. `_stateTs` no adapter rastreia a base; setado no `pullState`.
- **Edge `delete-student` (LGPD completo):** exclusão total de conta + cascade no servidor (`auth.users → profiles → todas as tabelas do aluno`; `pedidos.user_id` vira NULL). Dois chamadores: professor excluindo aluno da academia (valida papel/tenant no servidor; não exclui outro professor) ou self-delete (corpo vazio). Adapter: `sbProf.excluirAluno(id)` e `sbAuth.deleteAccount()`. UI de gestão: ação "🗑️ Excluir aluno" em `_profAlunoSheet` (offline remove do mock; online chama a Edge Function) via `_profExcluirAlunoSheet` com confirmação. **`limparDados` (aluno) segue como está** — clean slate + signOut, sem apagar a conta; o self-delete via `deleteAccount` fica disponível no contrato para quando/onde o dono decidir expor (não rewired agora: toca fluxo LGPD, requer decisão).
- **Migration:** `push_user_state` RPC (security definer, self-only, revoke/grant). **Edge:** `supabase/functions/delete-student/index.ts` (mesmo padrão da create-student; usa os mesmos secrets). Runbook atualizado (deploy das 2 funções + teste do guard em 2 abas).
- Versões: `app.js?v=173`, `supabase.js?v=4`, `sw.js` CACHE `yama-v176`. `selfTest 139/139` · console limpo.

### v172 — Auditoria pré-lançamento · Sprint 1 (correções no cliente) (2026-07-07)

Correções de segurança/coerência apontadas na auditoria pré-lançamento (lado cliente, sem tocar backend/migration):

- **XSS armazenado no painel do professor (C2 · crítico):** todas as views do professor (`profPainel`, `profAlunos`, `profRelatorios`, `profFinanceiro`, `_profAlunoSheet`, `_profGraduarSheet`) e a **Loja** (`renderLoja`, `abrirProduto`, `abrirCarrinho`, `profLoja`) passaram a escapar **todo** campo derivado do backend (`a.ini`, `a.cor`, `a.pres`, `a.graus`, `a.faixa`, `a.diasSem`, `a.mensVenc`, `a.desde`, `p.emoji`, `p.cor`, `i.tam`) com `safeTxt`/`safeAttr`. Antes, `checkins.hora` (gravável pelo aluno via API) executava HTML na sessão do professor. `beltPill`/`beltMini` agora têm guard para faixa desconhecida (não crasha nem injeta). **Verificado com payloads reais nas 4 views + loja: nenhum script disparou.**
- **Backdoor `?visaocompleta`/`?pro` (alta):** o atalho de gestão agora só funciona com `DEMO || !SUPABASE_CONFIGURADO`. Em produção (backend ligado), o único gate do Modo professor é `profiles.role` (servidor). Verificado.
- **`RISCO_DIAS` divergente (médio):** unificado para **14** no app.js (== adapter `supabase.js`). Antes 10 vs 14 davam números contraditórios no painel.
- **Textos pós-cutover:** toast offline ("dados salvos localmente" → "sincronizam quando a internet voltar"), sheet de métricas ("ficam só no seu aparelho, sem servidor" → "viajam na sua conta"), Política e "Apagar dados" agora explicam que registros de gestão (presença/graduação/ficha) são excluídos via academia.
- **Copy:** toast pós-treino "Fase 1 + Fase 2 registradas" → "Treino registrado — Oss 🥋".
- **Código morto:** removido o branch de signup inalcançável em `renderAuth` (self-signup desabilitado — A4) + flag `authTab`. Login ganhou hint de 1º acesso.
- **`window.DB = DB`:** exposto explicitamente (o adapter lê `global.DB`; `const` não cria propriedade em `window`).
- `selfTest 139/139` verde · console limpo · Home/painel intactos (demo).

**Pendente (próximos sprints da auditoria):** ~~C1 (fuso horário no adapter — Sprint 2)~~ ✅ · ~~guard multi-dispositivo~~ ✅ · ~~Edge `delete-student` (LGPD completo)~~ ✅ (ver abaixo) · provisionamento Supabase + smoke test + auditoria RLS · Storage de fotos.

### Backend — Auditoria pré-lançamento · Sprint 2 (C1 fuso horário) (2026-07-07) · só artefatos

O bug: o adapter usava `toISOString()` (UTC) para datas-calendário enquanto o app usa data local — no Brasil (UTC-3), **das 21h à meia-noite o dia UTC já é "amanhã"**: check-in do treino noturno caía no dia seguinte no painel do professor, e a policy `data = current_date` mascarava o erro. Correções (banco ainda não provisionado — migration editável):

- **`supabase.js?v=3`:** `_isoLocal()` novo; `HOJE()`, `_diasAtras()` e `mesAtual()` agora usam a **data local do aparelho** (mesmo calendário de `HOJE_ISO` do app). Timestamps completos (`updated_at`, `atualizado_em`) seguem timestamptz/ISO. `graduarAluno` envia `p_data` local à RPC.
- **`migrations/0001_init.sql`:** policies de check-in self (insert/update/delete) → janela `data between current_date - 1 and current_date + 1` (bloqueio de retroativos preservado); `graduar_aluno(p_user, p_faixa, p_graus, p_tipo, p_por, p_data date default null)` com validação da mesma janela e `coalesce(p_data, current_date)`; revoke/grant atualizados p/ a nova assinatura.
- **`create-student/index.ts`:** default de `data_inicio` calculado em `America/Sao_Paulo` (fallback — o app sempre envia).
- **Runbook** (`supabase/README.md`): passo 9 da auditoria RLS atualizado + item de smoke test noturno (registrar treino às 21h+ e conferir a data no painel).
- Versões: `supabase.js?v=3` em `index.html` + `sw.js` (CACHE `yama-v175`). `selfTest 139/139` · console limpo.

### v167 — A3 wiring da Loja no app.js (fecha o A3 ponta-a-ponta) (2026-06-28)

- **`_profProdutoSheet`**: ao salvar, chama `sbProf.salvarProduto(alvo)` (guardado → no-op offline; persiste no backend no cutover).
- **Boot** (sessão + SIGNED_IN): `sbSync.pullLoja()` carrega o catálogo do backend; RLS filtra por papel (aluno = só ativos; professor = todos). `renderLoja` já esconde inativos.
- Comentário do bloco da loja atualizado (persiste local + sincroniza com backend).
- `node --check` app.js/supabase.js OK · loja offline intacta · `selfTest 134/134` · console limpo.

### v166 — Correções da auditoria arquitetural pré-Supabase (2026-06-28)

- **S1 (crítico, RLS):** trigger `guard_profile_update` em `profiles` impede aluno mudar `role`/`academy_id` (escalonamento) e `faixa`/`graus`/`ativo` (só professor). Service role/migration liberados.
- **A1:** `mensalidades` ganhou `unique (user_id, mes)` + `mes not null` + `check status` → o `setMensalidade` (upsert onConflict) passa a funcionar.
- **A2/M1:** `create-student` agora **matricula o aluno na turma** (`enrollments`) e **semeia a graduação inicial** (faixa + grau) → dedup de presença funciona (turma_id não-nulo) e a timeline não nasce vazia. Adapter `lancarPresenca` resolve `turma_id` do enrollment.
- **A4:** self-signup **desabilitado** na UI (`renderAuth` login-only) — conta do aluno é criada pelo professor (§0).
- **M2:** `sbSync.pushLesoes` (incluso no `pushAll`) → lesões do aluno sobem ao backend.
- **M3:** RPC `graduar_aluno` (security definer, transacional) — `sbProf.graduarAluno` chama via `rpc` (sem estado parcial faixa×timeline).
- **B2:** CHECKs em `graduations.tipo`, `mensalidades.status`, `checkins.via`. **B4:** `trackEvent` limpo (no-op).
- **Deferidos (decisão/escopo):** **A3 Loja** fica **local/Fase E** (não wirada ao backend — produtos/variantes/stock_movements/pedidos permanecem como Fase E; sem falsa impressão de suporte). **M5** (catálogo de técnicas só no código — denormalização consciente). **M6** (denormalizar `academy_id` em checkins/graduations + paginação server-side) — otimização de performance para a Fase 1/5.
- `selfTest 134/134` · `node --check` em app.js/supabase.js OK · console limpo.

### v165 (app.js) — Editar ficha cadastral de aluno existente (2026-06-28)

- **`_profEditarFichaSheet`**: no detalhe do aluno, opção "✏️ Editar ficha cadastral" → formulário pré-preenchido (dados, endereço, responsável, administrativo; faixa/grau ficam no "Graduar"). Atualiza `a.cad` + apelido/nome.
- **Próprio professor (self):** edição grava em `DB.eu.cad` (persistente via `USER_KEYS`); `_selfAluno` passou a carregar `cad`.
- **Adapter:** `sbProf.atualizarAluno(id, campos)` (profiles update sob RLS) + `_cadToDB` mapeia a ficha para colunas snake_case.
- `selfTest 134/134` · console limpo.

### v164 (app.js) — Ficha cadastral completa no cadastro do professor (2026-06-28)

- **Cadastro de aluno virou ficha de gestão** (`_profCadastrarSheet`), em seções: **Dados** (nome, e-mail, telefone/WhatsApp, nascimento, apelido opcional), **Endereço** (CEP, logradouro, número, bairro, cidade, UF), **Responsável/ponto de apoio** (nome, telefone, parentesco — para **todos** os alunos), **Graduação & administrativo** (faixa, graus, data de início, observações). Obrigatórios: nome, e-mail, nascimento, telefone, responsável(nome+telefone). **Sem CPF/RG nem dado de saúde** (mantém o "coletamos o mínimo" do LGPD).
- **Detalhe do aluno** (`_profAlunoSheet`) exibe a **Ficha cadastral** (telefone, e-mail, endereço, responsável, início, observações) — só na gestão, não no app do aluno.
- **Schema/Edge Function:** colunas cadastrais em `profiles` (telefone, cep, logradouro, numero, bairro, cidade, uf, resp_*, data_inicio, observacoes) + inseridas pela `create-student`.
- **Bug corrigido:** cadastro offline gravava em `_profData.alunos` (array recriado a cada load por causa do self-entry) → o aluno sumia no refresh. Agora grava em `DB.alunos`.
- `selfTest 134/134` · console limpo.

### v162 (app.js) — Correções da auditoria QA (2026-06-28)

- **M1** Onboarding: sem apelido → usa o nome (completo/curto) em vez de "Atleta"; aluno define apelido depois no Perfil (`renderOnboarding` + `_onboardingMinimal`).
- **M2** Loja: produto com todos os tamanhos em estoque 0 → botão "Adicionar" desabilitado ("Esgotado"); não pré-seleciona tamanho esgotado (`abrirProduto` + `.btn-save:disabled`).
- **B1** `aplicarCleanSlate` zera `DB.loja.carrinho`/cat.
- **B2** `abrirCarrinho` remove itens de produtos ocultos/removidos; `carrinhoTotal` ignora inativos (sem crash).
- **B3** Consentimento do onboarding minimal = só aceite dos termos (idade vem do cadastro do professor).
- **B5** A11y: foco move para o `.sheet` ao abrir qualquer modal (observer global em `_setupBodyLock`).
- **Cadastro do professor:** adicionado **Ano de nascimento** (obrigatório) + apelido marcado opcional; `nascimento` enviado em `criarAluno` (a Edge Function já aceitava).
- `selfTest 134/134` · console limpo.

### v160 (app.js) — Hardening + loja persistente + onboarding minimal v2 + a11y/demo (2026-06-28)

- **Escape `safeTxt`** nos dados editáveis: nome/descrição de produto (loja do aluno) e nome de aluno nas telas do professor (lista, sheets, relatórios, painel). Blinda contra HTML/XSS (importante quando o backend trouxer dados de terceiros).
- **Loja persiste** (`USER_KEYS` += `loja`): produtos/estoque editados pelo professor viram a fonte da verdade (não recarregam do código). Comentário de persistência atualizado.
- **Onboarding minimal v2** (conta provisionada): apelido **opcional** + **foto opcional** (avatar tocável → `editarFotoPerfil`); aceite LGPD obrigatório; faixa/grau/nome vêm do professor. Reflete o fluxo "professor cadastra".
- **Limpeza:** removido `DB._checkinLocal` (escrito, nunca lido).
- **Wiring Fase 0:** Config ganhou "Rever introdução" (`abrirOnboarding`) e "Sair da conta" (`_sairDaConta`, só aparece com `DB.sbUser`).
- **UX/a11y:** linha do próprio professor na lista marcada (`.dt-self`, "(você)"); `role=button`/teclado em `.pro-entry` e nos alertas do painel.
- **Demo/QA:** +6 alunos no mock com dados variados (frequência, dias sem treinar, aptidão) p/ relatórios e paginação.
- `selfTest 134/134` · console limpo.

### v159 (app.js) — Otimização: seleção de aluno incremental (2026-06-28)

- **DataTable de alunos:** clicar no checkbox agora atualiza **só aquela linha** (`.sel`/`.on` + bulk bar via `updateBulk`), sem reconstruir a lista inteira. Antes, cada clique re-renderizava todas as linhas. Medido: 50 toggles em **9ms** com 307 linhas (era o gargalo do stress). `selfTest 134/134`.

### v158 (app.js) — Integração presença/graduação (offline) + login wirado + dead-code (2026-06-28)

- **Aluno logado na lista do professor** (`_selfAluno`, entrada `_self` no topo de `_loadProfData`): derivada de `DB.eu`/`DB.checkinHoje`/treinos. Faz presença e graduação **conversarem** no mesmo aparelho.
- **Roteadores** `_profSetPresenca`/`_profSetPago`/`_profGraduarApply`: ação no `_self` escreve nos dados REAIS (`DB.checkinHoje`, `DB.eu.faixa/graus`, `DB.graduacoes`); no mock, escreve no mock. Usados por `_profAlunoSheet`, `_profGraduarSheet`, `_bulkPresenca`, `_bulkGraduar`. Bidirecional: aluno faz check-in → professor vê; professor gradua → timeline da Jornada do aluno reflete.
- **Login wirado** (`render()`): faltava o branch `if(DB.authOpen) renderAuth()` — a tela de login nunca apareceria no cutover. Adicionado (offline `authOpen` é sempre false → inerte).
- **Dead-code (varredura completa, manual):** nenhuma chamada `sb*` sem guard restante (F1/F2 já corrigidos); todas as rotas de nav (prof e aluno) têm branch. Órfãs intencionais de Fase 0 ainda não wiradas: `_sairDaConta` (logout), `abrirOnboarding` (rever intro) — sem impacto offline.
- `selfTest 134/134` · stress 0 erros.

### v156 (app.js) — Varredura: correção de fios mortos do professor (2026-06-28)

- **Bug F1** (`_profAlunoSheet`): lançar/remover presença e marcar mensalidade chamavam `sbProf.*` **sem guard** → `ReferenceError` offline (clique não fazia nada). Corrigido: guard `typeof sbProf!=='undefined'` + fallback que muta o mock + `render()` (igual ao lote).
- **Bug F2** (`_profGraduarSheet`): graduar individual chamava `sbProf.graduarAluno` sem guard → erro offline. Mesmo fix.
- **Caminho morto** (`renderProfessor`): aba "Mais" (`navProf==='perfil'`) não tinha branch → tela quase vazia. Agora roteia para `alunoPerfil()` (o professor é o mesmo `DB.eu`).
- **Limpeza**: removidos 2 resquícios textuais de "técnica do dia" (comentário de cabeçalho + string de empty-state do diário).
- Validado por **varredura com agente** + **selfTest 134/134** + **teste de estresse** (606 alunos, 108 produtos, 400 treinos, 0 erros).

### v154 (app.js) — Onboarding minimalista (conta provisionada) + faixa/grau read-only (2026-06-28)

- **Flag `DB.eu.provisionedByProf`** (vem do backend via `sbSync.pullAll`; offline=false). Marca conta criada pela academia.
- **Onboarding minimalista** (`_onboardingMinimal`): quando provisionado, mostra só boas-vindas + identidade read-only (apelido/faixa) + **aceite LGPD/18+** — **sem nenhum campo** (o professor já preencheu). Conta local mantém o fluxo completo (até desligar conta local em produção).
- **Faixa/grau read-only no Perfil** (`abrirEditarPerfil`): quando provisionado, edição de faixa/grau/data sai (professor controla a graduação); aluno ainda edita apelido/nome/nascimento/foto. Idem para os controles de "Importar/Corrigir histórico" na Jornada.
- `selfTest 134/134`.

### v153 (app.js) — Tela de troca de senha (1º acesso) + presença por tipo de aula (2026-06-28)

- **Troca de senha no 1º acesso (Fase 4 UI):** `renderTrocarSenha` (branch `DB.trocarSenhaOpen` no roteador) — nova senha + confirmar → `sbAuth.changePassword`. Disparada por `sbAuth.mustChangePassword()` no login e no boot. Offline valida e fecha.
- **Presença por tipo de aula (§7.1):** seção de barras em `profRelatorios` (judô/ne-waza/específico/livre/técnica). **Mock/exemplo** até o checkin ter o campo `tipo` (backend).
- `selfTest 134/134`.

### v152 (app.js) — Toggle aluno↔professor + QR scan + Relatórios/Dashboard (2026-06-28)

- **Toggle aluno↔professor:** flag de capacidade `DB.eu.isProfessor` (vem de `profiles.role` no backend; offline via `?visaocompleta`). Entrada "Gerir academia / Modo professor" no Perfil do aluno (`.pro-entry`) — **só** para quem tem a flag. `roleSeg` volta pra Aluno.
- **QR scan real no totem:** `presencaScan` usa `BarcodeDetector` (nativo, zero-dep) + câmera; lê QR e confirma presença se bater com `PRESENCA_CODE`. Fallback gracioso (sem suporte/câmera → usa o código).
- **Relatórios (Fase 1 / §7.1, com mock):** `profRelatorios` — frequência média, aptos a graduar, **risco de evasão** (churn por dias sem treinar), distribuição de faixas (barras). Mock enriquecido com `freq`/`diasSem`/`aptoGrad`.
- **Dashboard "o que fazer hoje"** no painel: aptos a graduar + em risco + estoque baixo (acionáveis).
- `selfTest 134/134`.

### v151 (app.js) — Loja+Estoque admin (Fase E) + paginação + painel de detalhe lateral (2026-06-28)

- **Fase E — Loja + Estoque admin:** aba "Loja" (`profLoja`/`_profProdutoSheet`) — CRUD de produtos, preço, categoria, visibilidade e **estoque por tamanho**; alerta de estoque baixo no painel. Reflete na loja do aluno (oculto some; tamanho 0 = "esgotado"). Offline edita `DB.loja.produtos` em memória.
- **Paginação** do DataTable de alunos (20/página, "Ver mais").
- **Painel de detalhe lateral** no desktop (≥1024px): detalhe do aluno vira painel à direita (`.aluno-detail`).
- `selfTest 134/134`.

### v150 (app.js) — Totem reconstruído + DataTable/Cadastro do professor + remoção da técnica do dia (2026-06-28)

- **Técnica do dia REMOVIDA** (decisão do dono): seed `tecnicaDoDia`, card do aluno, aba "Técnica" do professor (`profTecnica`/`salvarTecnica`/`_gerarCodigo`), `pull/pushTecnicaDoDia` (supabase.js) e tabela `technique_of_day` (migration). Não reintroduzir sem pedido.
- **Totem de presença RECONSTRUÍDO:** é a Fase 1 do flow (botão +) — `_renderPhase1` com QR + 4 dígitos + keypad; código `PRESENCA_CODE` ('0000') → `_flowCheckin()`. Reusa o CSS do totem que estava órfão.
- **Painel admin refinado (Fase 4 client-side):** `profAlunos` virou DataTable — busca, filtros, **seleção múltipla** e **ações em lote** (presença/graduação via `_bulkPresenca`/`_bulkGraduar`). Offline muta os mocks; com backend chama `sbProf`.
- **Cadastrar aluno (Fase 4 client-side):** `_profCadastrarSheet` (nome/apelido/e-mail/faixa/graus) → senha provisória copiável (`_senhaProvisoriaSheet`). Offline adiciona ao mock; com backend chama `sbProf.criarAluno`.
- **Shell responsivo do professor** (v146): `body[data-role="professor"]` → sidebar + conteúdo amplo ≥768px; mobile inalterado.
- `selfTest 134/134`.

### Backend — A3 (Loja adapter) + M6 (performance) aplicados (2026-06-28) · só artefatos

- **A3 — Loja no adapter:** `sbProf.getProdutos/salvarProduto/deletarProduto/ajustarEstoque` + `sbSync.pullLoja`; mapeamento `tam[]/estoque{}` ↔ `produto_variantes` (`_produtoToApp`); auditoria em `stock_movements`. Falta só o wiring no `app.js` (no cutover).
- **M6 — Performance:** `academy_id` denormalizado em `checkins`/`graduations` + índices `(academy_id,data)`/`(academy_id)`; `getAlunos` filtra por `academy_id`; `getKPIs` reusa `getAlunos` memoizado (4s) — sem 2ª rodada das 5 queries. Escritas preenchem `academy_id` (pushCheckin/lancarPresenca/RPC/seed). Paginação server-side fica para refactor coordenado (cliente paginando até lá).
- `node --check supabase.js` OK · `app.js` inalterado (`selfTest 134/134`).

### Backend (Fase 0) — preparação plug-and-play (2026-06-28) · só artefatos, app.js inalterado

- **`profFinanceiro`: DECIDIDO** — fica como placeholder; financeiro pleno só na Fase F (registrado em PROFESSOR.md §8.1).
- **Adapter (`supabase.js`):** `getAlunos`/`getAlunoDetalhe` agora mapeiam a **ficha cadastral** (`cad`) de `profiles`; `sbProf.atualizarAluno` adicionado; `cadFromProfile()` mapeia colunas→ficha.
- **Migration:** `profiles` ganhou `email` (denormalizado p/ a ficha) + colunas cadastrais (telefone/endereço/responsável/data_inicio/observacoes).
- **Edge Function `create-student`:** insere `email` + ficha cadastral no profile.
- **`supabase/seed.sql` (novo):** bootstrap idempotente — academia + professor + turma + tipos_aula.
- **README:** runbook ordenado (migration → login → seed → deploy → ativar adapter → wire → Storage → smoke test → auditoria RLS).
- **Fase 1 — agregados no adapter (implementado):** `getAlunos` computa `freq`/`diasSem`/`aptoGrad` de `checkins`+`graduations`; `getKPIs` traz `treinosTotal` (check-ins do mês) e `ativos` (≤14d). Constantes `META_MES=12`/`META_GRAU=40`/`RISCO_DIAS=14` a calibrar; `aptoGrad` é aproximação por nº de aulas. Inerte offline (só roda com backend).
- ⚠️ **Bloqueio externo:** criar o projeto Supabase exige a sua conta — não consigo provisionar daqui.

### v145 (app.js) — Auditoria do professor: remoção do totem morto + visão de BI (2026-06-21)

- **Removido código morto:** totem de presença (`renderPresenca`/`openPresenca`/`presencaConfirm`/`confirmarPresenca`/`atualizaOtp`/`presencaScan`/`presencaDigit`/`presencaBack`/`closePresenca`) + ícones `icoQR`/`icoQRbig`. Estava fora do roteador (`openPresenca` nunca chamado); presença real é `_flowCheckin()`. CSS do totem ficou órfão (remover depois, baixa prioridade).
- **Mantido (auditado):** scaffold do professor (painel/alunos/técnica/graduação), auth e stubs Supabase — é a fundação/contrato do módulo robusto, não lixo.
- **PROFESSOR.md ampliado:** §7.1 Inteligência/Retenção/Evolução (presença por **tipo de aula** judô/ne-waza/específico, churn, evolução por graduação/faixa/grau, aptidão CBJJ); modelo de dados ganhou `aulas`/`tipos_aula`/`tipo` no checkin; §8.1 auditoria do scaffold (fica/sai).

### v144 (app.js) — Entrada oculta da gestão + plano do Professor robusto (2026-06-21)

- **Entrada oculta do professor (dev/preview):** `?visaocompleta` · `?pro` · `#visaocompleta` → seta `DB.role='professor'` (não persiste; recarregar sem o parâmetro volta ao Aluno). Renderiza o scaffold existente do professor com seed local (`sbProf` indefinido → fallback em `_loadProfData`); ações que dependem do backend ainda não funcionam.
- **PROFESSOR.md ampliado:** módulo do professor reposicionado como **aplicação de gestão robusta** (DataTable, busca/filtros/ordenação/paginação, ações em lote, painéis de detalhe) e adicionado **Estoque** (tabelas `produtos`/`produto_variantes`/`stock_movements`/`pedidos`, Fase E). Estratégia responsiva detalhada (PC/Tablet ricos, celular enxuto).

### v143 (app.js) — Loja funcional (WhatsApp + PIX) + plano do Professor (2026-06-21)

- **Loja (Fase L)** — reativada no Perfil (vitrine com preços reais via `moneyBR`). Catálogo e produto mostram preço; carrinho mostra subtotal/total. Checkout: **chave PIX copiável** + botão **"Enviar pedido no WhatsApp"** (`wa.me` com itens+total+PIX). Sem backend. Config a preencher: `LOJA_WHATSAPP` e `LOJA_PIX` (placeholders marcados `>>> EDITAR`). `finalizarCompra` reescrito; `abrirCarrinho` usa `openSheet`.
- **Indicador de versão** → `APP_VERSION='v143'`.
- **PROFESSOR.md** — plano mestre do Módulo do Professor + backend Supabase (decisões P1–P6, RLS/privacidade, Edge Functions, contrato do adapter, estratégia responsiva, roadmap em fases). Documento de referência; nada do backend foi implementado ainda.

### v143 — Tabbar compacto (rótulos na base) (2026-06-21)

- **Tabbar mais baixo** — `align-items:flex-end` cola ícones/rótulos na base (no escuro parecia flutuar porque o fundo do tabbar some no preto e havia espaço morto abaixo dos rótulos); padding `4px 0 calc(safe-area + 4px)`; FAB reduzido (50→46) e elevado via `margin-top:-14px` (em vez de `top:-6`) para **não inflar** a altura da barra; `.phone` padding-bottom 78→70. Sobra abaixo dos rótulos = só a zona obrigatória do home indicator. Verificado em modo escuro com safe-area simulada.

### v142 (app.js) — Fix CRÍTICO restauração de backup + indicador de versão (2026-06-21)

- **🔴 Fix raiz do "backup não restaura"** — na restauração, `doRestore` gravava o backup no `localStorage` e dava `location.reload()`, mas o `reload` disparava `pagehide`/`visibilitychange→hidden` → `flushSave()` → `save()`, que **regravava o `localStorage` com o `DB` antigo em memória** antes do boot ler o backup (clobber). Reproduzido no preview (STORE_KEY: import `NOVO` → após flushSave `ANTIGO`). Bug existia desde a 1ª implementação (sempre `setItem`+`reload`), independente do método de export — por isso "nunca funcionou". **Correção mínima:** flag `_restoring` (guarda em `save()`); setada em `#ci-ok` antes do `setItem`, com reset no `catch`.
- **Indicador de versão** — `APP_VERSION` ('v142', casado com `app.js?v=N`) exibido no canto superior esquerdo do Perfil (`.pf-version`), para confirmar qual build está rodando no aparelho (diagnóstico de cache do PWA).

### v142 — Backup Copiar/Colar + remoção do zoom (fix tabbar/flicker) (2026-06-21)

- **Backup à prova de iOS** — `abrirBackup` ganhou **Copiar backup** (`navigator.clipboard`, fallback textarea selecionável) e **Colar backup** (textarea → restaura), que não dependem do sistema de arquivos do iOS (onde download/seleção de `.json` falhavam). "Salvar como arquivo" (share/download) e "Abrir arquivo" ficam como secundários. Lógica de restauro inalterada (validada).
- **Removido `zoom:.92` do `.phone`** (+ fallback `@supports` transform) — era a raiz do tabbar "flutuando" e do flicker no iOS: o tabbar `position:fixed` ficava preso ao fundo do `.phone` zoomado. Sem zoom, o tabbar é fixo em relação à viewport (fundo real, comportamento normal de app). Responsividade revalidada: sem overflow de 320px a 430px (telas e sheets densos).
- **Trava de scroll por CSS removida** (`html.sheet-open{overflow:hidden}`) — o overlay (`touch-action:none; inset:0`) já bloqueia o fundo. Abrir/fechar sheet não muda mais o layout → sem flicker.
- **Tabbar padrão** — removido `align-items:flex-end`; padding `6px 0 calc(safe-area + 6px)`; `.phone` padding-bottom 82→78px.

### v141 — Fix backup export/import no iOS PWA (2026-06-21)

- **Export robusto** — `abrirBackup` passou a usar `navigator.share({files})` (salvar em Arquivos/enviar) quando disponível, com fallback para download `<a download>` (desktop/Android). No iOS standalone o download via blob era instável → backup não saía corretamente. Lógica de dados estava OK (verificado: export→wipe→import restaura foto, graduação, treinos, técnicas/custom, meta, notas, lesões).
- **Import tolerante** — `accept` ampliado (`application/json,.json,text/plain,*/*`) para o seletor do iOS Files; conteúdo passa por `.trim()` (remove BOM/espaços) antes do `JSON.parse`.

### v140 — Tabbar mais baixo (2026-06-21)

- **Tabbar com menos espaço vazio na base** — `align-items:flex-end` aproxima ícones/rótulos da base; `padding` reduzido (`6px 0 calc(safe-area + 5px)`, era `8px / +9px`); `.phone` padding-bottom 95→82px. No iPhone, a faixa caía ~15% da tela com ~66px vazios abaixo dos rótulos; a parte mandatória (≈34px da safe-area do home indicator) é preservada, o excedente foi removido. Verificado via simulação da safe-area no preview.

### v139 — Meta no card de Frequência, foto por toque longo, fix barra preta/data (2026-06-21)

- **Meta semanal saiu do "Editar perfil"** → agora é editada tocando no card **"Frequência (mês)"** do Perfil (`abrirMetaSemanal()`, dois modos quantidade/dias). O subtítulo do card mostra a meta + "toque para editar".
- **Foto por toque (longo ou toque) na própria foto** — em Início (`.profile-photo`) e Perfil (`.pa`): abre `editarFotoPerfil()` (escolher/remover foto). Removida a seção de foto do "Editar perfil". O `<input file>` é acionado no gesto (compatível iOS).
- **Fix barra preta + flicker (regressão v138)** — `_setupBodyLock` deixou de usar `body{position:fixed}` (que no PWA iOS deixava a barra preta na base e piscava ao fechar). Trava de scroll agora é só `html.sheet-open{overflow:hidden}`; o overlay (`touch-action:none`) já bloqueia o fundo.
- **Fix rolagem horizontal no Perfil** — `input[type=date]` (data da faixa) com `min-width:0;max-width:100%;appearance:none` + `.sheet{overflow-x:hidden}`, impedindo que a largura nativa do seletor de data estoure o sheet.

### v138 — Reversão A5 + meta semanal por dias + correções de sheet/flicker (2026-06-21)

- **Reversão A5** — removidos os campos "Aulas para o próximo grau/faixa" do Editar perfil; volta ao comportamento anterior (metas de aula fixas 40/160, não editáveis).
- **Meta semanal em dois modos** — no Editar perfil, seletor "Por quantidade" (2–6x, como antes) **ou** "Dias específicos" (chips Seg→Dom). No modo dias, a meta semanal = nº de dias marcados; `DB.semana.metaMode`/`metaDias` persistidos. Decisão do usuário: dia escolhido sem treino fica **neutro** (sem "Faltou", mantém a filosofia A1). Subtítulo do Perfil reflete o modo (`metaSemanalTxt()`).
- **Flicker da base (iOS):** `_setupBodyLock()` agora alterna `html.sheet-open`; CSS esconde `.tabbar`/`.save-bar` (com fade) enquanto há sheet aberto — some o "pulo" do tabbar causado por `body{position:fixed}` + `.phone{zoom:.92}` no iOS. (Não reproduzível no Chrome desktop; verificar no device.)
- **Editar perfil + teclado:** `html.kb-open .sheet` deixou de usar `margin-bottom` (empurrava o sheet inteiro) e passou a estender `padding-bottom`/`scroll-padding-bottom` pela altura do teclado — o campo focado rola pra vista sem o sheet saltar.

### v137 — Sprint 2 pré-lançamento MVP (M1,M3,M4,M5,M6,B1,B3,B4,B5,B6) (2026-06-20)

- **M1 · Ícones PWA reais** — gerados `icon-180/192/512.png` (transparentes) + `icon-512-maskable.png` (fundo opaco `#f4f4f6`, logo a 66% dentro da safe-zone). `manifest.json` (icons/shortcuts/screenshot) e `index.html` (favicon/apple-touch-icon) apontam para os tamanhos corretos; ícones adicionados ao precache do `sw.js`. `logo.png`/`yama-logo.png` (640²) seguem usados na UI.
- **M3 · confirm() da lesão → sheet** — exclusão de lesão usa sheet de confirmação padrão (via helper `openSheet`), no lugar do `confirm()` nativo.
- **M4 · Contagem por dia unificada** — `freqStats()` (Treinos por mês, Meta do mês, Por dia da semana) e o contador "Frequência (mês)" do Perfil agora contam **dias distintos** (igual a heatmap/streak). Heatmap (semana/mês) ganhou marcador **"N×"** nos dias com 2+ treinos (helper `_treinosNoDia`).
- **M5 · Data de calendário válida no import** — `_brToIso()` rejeita datas inexistentes (ex.: 31/02) checando o `Date` reconstruído.
- **M6 · Rascunho na virada de meia-noite** — `_loadDraft()` mantém rascunho de até 1 dia (não descarta o registro de quem completa após 00h).
- **B1 · `FOCO_INICIAL`** — `Niju-garami` (removida) trocada por `Juji-gatame` (existe no catálogo).
- **B3 · Helper único de sheet** — `openSheet(node, cancelSel)` formalizado (liga cancelar + fecha ao tocar fora). Adotado no novo sheet do M3; migração ampla dos demais sheets deferida para preservar comportamento.
- **B4 · Comunicação streak × meta** — selo de streak com `title` por número (semanas seguidas vs treinos/meta da semana) e `aria-label` descritivo.
- **B5 · Técnica custom duplicada** — bloqueia criação/edição com `jp` já existente (case-insensitive).
- **B6 · Onboarding "o que esperar"** — bloco de valor (3 itens) antes do formulário, comunicando o benefício antes do 1º treino.

### v136 — Sprint 1 pré-lançamento MVP (A1–A5) (2026-06-20)

- **A1 · Semântica de "Faltou"/presença** — `diaTreino()` não exige mais dia de aula presumido para contar presença (treino em qualquer dia, inclusive fim de semana, conta). `hmCellClass()` virou mapa de **atividade**: só destaca dias treinados (técnica/livre), sem células "Faltou"/"futuro". `freqStats()` calcula "Presença no mês" como % da **meta mensal** (meta semanal × 4, teto 100%), não dias de aula presumidos. Legenda do heatmap sem "Faltou".
- **A2 · Loja oculta no MVP** — bloco `loja-destaque` removido do Perfil (única porta de entrada). `renderLoja()`/`openLoja()`/`abrirProduto()` permanecem dormentes (não removidos).
- **A3 · Mensalidade oculta no MVP** — linha "Mensalidade (teste)" removida do Perfil; Frequência e Turma mantidas.
- **A4 · Aviso de armazenamento indisponível** — `_warnNoStorage()` no boot mostra banner fixo quando `STORAGE_OK` é falso (modo anônimo/storage bloqueado), evitando perda silenciosa. Estilo inline (sem mudança de CSS); dispensável via ✕.
- **A5 · Metas de aulas configuráveis** — "Editar perfil" ganhou os campos "Aulas para o próximo grau" (`me.aulasGrau.meta`) e "Aulas para a próxima faixa" (`me.aulasGraduacao`), com validação de faixa. Fluem por `aulasStats()`. Defaults (40/160) inalterados.

### v130 — Teste end-to-end completo de backup/restore (2026-06-17)

87. **selfTest E2E completo: 111 → 126** — 15 novas asserções num único cenário cobrindo o ciclo `modificar tudo → save → wipe → load → verificar`. Áreas testadas: `DB.eu` (faixa, graus, peso novo, nomeCompleto), `treinos` (novo + det.nota), `graduacoes`, `notas`, `lesoes`, `semana.meta`, `links`, técnica do catálogo (nota/nivel/treinos), técnica customizada nova. Garante que importar JSON restaura tudo idêntico.

### v129 — Fix CRÍTICO save/load: técnicas customizadas e catálogo editados (2026-06-17)

84. **🔴 Bug crítico: técnicas customizadas EDITADAS perdidas no import** — `load()` só ADICIONAVA tecnicasCustom novas (`!have.has(c.id)`), nunca atualizava as existentes. Resultado: usuário cria técnica custom, edita jp/pt/cat, exporta backup, importa em outro device — edições eram descartadas porque o id já existia em memória.
   **Fix:** trocado `Set` por `Map<id,index>`. Se id existe → `Object.assign(DB.tecnicas[idx], {jp,pt,cat,oficial})`. Se não → push novo.
85. **🔴 Bug alto: edições do catálogo Kodokan/Kosen/Outros perdidas** — TEC_PROG não incluía `jp`, `pt`, `cat`, `oficial`. Usuário editava nome/tradução de uma técnica (ex: Juji-gatame → "Chave de braço"), save() persistia apenas `estado/dias/treinos/nota/nivel`, load() restaurava do seed (volta a Juji-gatame). Custo de armazenar 4 campos × 41 técnicas: ~3KB. Custo do bug: edições perdidas.
   **Fix:** TEC_PROG agora inclui `jp, pt, cat, oficial`. Save/load via id mantém edições.
86. **selfTest 106 → 111** — 5 novas asserções: custom-editada round-trip (jp/pt/cat preservados), catalog-editada round-trip (jp/pt preservados via TEC_PROG).

### v128 — Fix import perfil + botão instalar universal + auditoria PWA (2026-06-17)

80. **🔴 Fix: import JSON com perda de campos do perfil** — `load()` fazia `DB.eu = data.eu` (substituição), perdendo campos que não estavam no backup (ex: `aulasGrau`, `foto`, `consentimento`). Trocado por `Object.assign({}, DB.eu, data.eu)` (merge). Stress-test: backup com 4 campos restaurado em DB.eu de 14 campos → todos preservados.
81. **Backup inclui tema + draft** — `dump.theme` (de `localStorage['yama.theme']`) e `dump.draft` (de `localStorage[DRAFT_KEY]`) agora vão no JSON. Import restaura ambos.
82. **Botão Instalar app universal** — antes só aparecia em Android Chrome (`_yamaCanInstall()`). Agora aparece sempre que não está em modo standalone, abrindo `abrirInstalarPWA()` que detecta SO (iOS/Android/desktop) e mostra instruções específicas (Safari Share → Adicionar à Tela de Início, etc).
83. **Manifest sem cache-busting** — removido `?v=2` de `manifest.json` em index.html e sw.js. Network-first do SW garante atualização sem versionamento manual.

### v126–v127 — Fix crítico PWA + extensão selfTest + lesões↔treinos (2026-06-17)

75. **🔴 Fix crítico: manifest com caminhos absolutos** — `manifest.json` usava `/` em `id`, `start_url`, `scope` e `shortcuts.url`. Em GitHub Pages (`user.github.io/repo/`) isso resolve para o domínio principal, não o subpath. Trocado para `./` em todos. Sem isso, PWA registrava no escopo errado.
76. **🔴 Fix crítico: `skipWaiting()` restaurado no install** — removido na v123 quando movi para `message` handler, fazendo o novo SW ficar em estado `installed` aguardando para sempre, e o velho continuando a servir cache stale. Restaurado no install para auto-update no background. `message` handler mantido como fallback.
77. **Estratégia network-first para HTML/manifest** — `index.html` e `manifest.json` agora vão sempre buscar versão nova; cai no cache só se offline. Assets versionados (`app.js?v=N`, `app.css?v=N`, fonts) continuam cache-first. Resolve "abre site já acessado e não pega última versão".
78. **selfTest 93 → 106** — 13 novas asserções: `_viewKey` (3 combinações), `_focusableInSheet` (filtra disabled/hidden), `_topmostSheet` (sheets aninhadas), `toastUndo` (cria + dispara undo), existência de `_attachLongPress` / `_attachSheetDrag` / `_openActionSheet` / `haptic`, query params dos manifest shortcuts.
79. **Lesões ↔ treinos** — `lesaoAtivaEm(dataISO)` retorna lesão `status==='recuperando'` cujo `data <= dataISO`. `histItem()` adiciona 🤕 ao título + classe `.has-lesao` (borda lateral laranja). Aplica em Início (últimos treinos) e Histórico. Insight clínico real para o aluno ver quantos treinos teve durante recuperação.

### v124–v125 — Polish UX + bug fix tabbar (2026-06-17)

62. **Bug fix: padding tabbar 70→95px** — tabbar real ocupa 78.2px; padding de 70px cortava 8px de conteúdo. Aumentado para 95px (24px de respiro confortável). `calc(95px + env(safe-area-inset-bottom, 0px))`.
63. **Debounce 150ms na busca da Biblioteca** — `searchInp.oninput` aciona `_doSearch` via `setTimeout(150)`; evita re-filter por keystroke. Compatível com clear button.
64. **CSS containment em cards repetidos** — `contain:layout style; content-visibility:auto; contain-intrinsic-size:auto 90px` em `.rep-card, .tec-row, .notif-item, .nota-item, .history-item, .timeline-item, .rs-pcard`. Reduz reflow em listas longas.
65. **iOS keyboard avoidance** — Visual Viewport API; `--kb-h` CSS var atualizada via `vv.resize`; `html.kb-open .sheet{margin-bottom:var(--kb-h)}` sobe sheets para fora do teclado.
66. **Manifest shortcuts** — long-press no ícone do PWA abre "Registrar treino" (`?flow=registrar`) e "Biblioteca" (`?go=biblioteca`). Handler no boot processa query params.
67. **Manifest refinado** — `display_override:["standalone","minimal-ui"]`, `categories:["lifestyle","sports","health"]`.
68. **Toast com Desfazer** — `toastUndo(msg, undoFn)`. Aplicado em exclusão de treino (detail + long-press) — 5s para reverter.
69. **Sheet drag-to-dismiss** — `_attachSheetDrag()` via MutationObserver; arrastar grip para baixo 100px+ fecha sheet. Gesto iOS-nativo.
70. **Skip link a11y** — `<a class="skip-link" href="#root">` pulando para conteúdo principal via teclado (visível só com `:focus`).
71. **Focus trap audit completo** — `_focusableInSheet()` filtra `[disabled]`, `[hidden]`, `offsetParent !== null`. `_topmostSheet()` lida com sheets aninhadas. Auto-focus no primeiro focusable quando sheet abre (MutationObserver com delay 280ms). Tecla `Esc` fecha sheet topmost (procura `.sheet-cancel` → `[id$="-close"]` → fallback overlay remove).
72. **Long-press menu em cards (técnica + treino)** — `_attachLongPress()` genérico (500ms timer, 10px movement cancel, haptic 15ms). `_openActionSheet()` mostra menu. Em técnica (`bibCardNode`): Revisar, Editar, Voltar foco, Excluir (se custom). Em treino (`histItem`): Abrir, Excluir (com toastUndo).
73. **Skeleton loader no Histórico** — 3 `.skel-row` injetadas no clique de "Carregar mais" por 120ms enquanto re-render acontece. Feedback visual antes da paginação. CSS `.skel{animation:skel-shimmer 1.4s infinite}` respeitando `prefers-reduced-motion`.
74. **Streak clicável → Histórico** — `.streak-badge` com `role="button" tabindex="0" aria-label="Ver histórico de aulas"`. Click/Enter/Space navega para Jornada → Histórico.

### v123 — Capacidades PWA expandidas (2026-06-17)

50. ~~**Service Worker update detection**~~ — **REMOVIDO (2026-07)**: o app deixou de usar cache offline (online-only via Supabase). `sw.js` virou kill-switch e o toast de atualização saiu. Sem SW não há "versão em cache" para atualizar; o navegador sempre busca a nova (os `?v=N` cuidam do cache HTTP).
51. **Indicador offline persistente** — `html.offline` classe adicionada/removida via `online`/`offline` events; CSS `body::before` mostra badge "📡 offline" fixo no topo. Toast em transições. Crítico para uso no tatame com sinal instável.
52. **Wake Lock no flow de treino** — `navigator.wakeLock.request('screen')` adquirido em `_startPhase1()`; liberado em `closeFlow()` e após `salvar()`. Re-adquire em `visibilitychange` se flow ainda ativo. Mantém tela acesa durante o registro. Funciona em iOS 16.4+ e Android.
53. **Haptic feedback** — `navigator.vibrate()` em ações importantes: `[10,30,10]` (pulso duplo) ao concluir treino, `8ms` em cada acerto/erro do stepper. Android responde; iOS Safari ignora silenciosamente (sem erro).
54. **prefers-color-scheme** — primeira abertura sem preferência salva detecta tema do sistema iOS/Android e aplica. Atualiza `theme-color` junto.
55. **prefers-reduced-motion** — `matchMedia` listener; aplica `html.reduced-motion` que suprime todas animações (`animation-duration:.01ms!important`). Respeita configuração de acessibilidade.
56. **Resume detection após suspend** — `visibilitychange` agora compara timestamps; gap >5min recarrega via `_checkMidnight()` + `render()`. iOS suspende PWAs agressivamente; ao reabrir dias depois, estado fica atualizado.
57. **`navigator.storage.persist()`** — solicita ao navegador para NÃO limpar localStorage automaticamente em low-storage. Crítico enquanto não há backend.
58. **Botão "Instalar app"** — aparece em Perfil → Conta apenas quando `_yamaCanInstall()` retorna true (Android Chrome com `beforeinstallprompt`). Chama `_yamaInstall()` que dispara prompt nativo.
59. **Scroll restoration por view** — `_scrollMem[viewKey]` memoriza `scrollY` quando troca de view; `_restoreScroll()` disponível (uso opcional por view).
60. **Long-press menu prevention em canvas** — `contextmenu` listener previne menu "Salvar imagem" do iOS em canvas/`.share-canvas-wrap`.
61. **Web Share API confirmada** — `navigator.canShare({files})` + `navigator.share()` no botão "Compartilhar no story" (já existia em [app.js:1699](../../app.js:1699)). Abre sheet nativo iOS direto para Instagram/WhatsApp.

### v122 — Correções de scroll em PWA iOS (2026-06-17)

41. **Momentum scroll liberado** — removida regra `html{overscroll-behavior:none}` (linha 19) que bloqueava o "bounce" elástico natural do iOS. Substituída por `-webkit-overflow-scrolling:touch` em `html` e `body` para garantir inércia em PWA standalone.
42. **Padding-bottom dinâmico** — `.phone` agora usa `padding-bottom:calc(70px + env(safe-area-inset-bottom, 0px))` (era fixo `92px`). Resolve bug onde conteúdo passava por baixo da tabbar em iPhones com notch (safe-area-inset-bottom = 34px adicionado dinamicamente).

### v122 — Polish iOS PWA: 7 melhorias de feel (2026-06-17)

43. **Body scroll lock em sheets** — `_setupBodyLock()` via MutationObserver detecta `.sheet-overlay` no DOM; ao abrir, `body{position:fixed; top:-${scrollY}px}` preserva posição. Ao fechar, restaura. Resolve "doom-scroll" acidental atrás da sheet em iOS.
44. **Pull-to-refresh contain** — `body{overscroll-behavior-y: contain}` mantém bounce elástico mas previne reload acidental ao puxar pra baixo no topo (Safari).
45. **Tap responsivo em cards** — `touch-action: manipulation` adicionado em `.rep-card`, `.sc-card`, `.cat-acc`, `.tec-row`, `.rev-row`, `.kpi`, `.info-row`, `.cfg-row`, `.notif-item`, `.nota-item`, `.prod-card`, `.ld-card`, `.ci-row`, `.dow-bar`, `.rs-pcard`, `.foco-card`, `.prog-mini`. Remove delay residual de 300ms.
46. **User-select disciplinado** — `body{user-select:none}` previne seleção acidental em UI; exceções para `input, textarea, [contenteditable], .det-nota, .notif-item .nt-t, .nota-item .ni-tx, .rep-nm, .cn, .rs-pcard, .tec-sheet-meta, .bib-srch-inp` (texto de conteúdo permanece selecionável).
47. **Theme-color dinâmico** — `_updateThemeColor()` sincroniza `<meta name="theme-color">` com o tema atual (`#f4f4f6` light / `#0a0b0d` dark). Barra de status do iPhone reflete o tema correto após alternar. Tag única (sem media queries).
48. **viewIn condicional** — `_viewKey()` gera chave única por view (`'al:inicio:progresso:historico'`, `'flow:tecnica'`, etc); `#root.no-anim` aplicado quando view não mudou, suprimindo `viewIn .18s ease`. Elimina piscadinha em re-renders frequentes (mesma view).
49. **apple-touch-startup-image** — adicionado em `index.html` apontando para `yama-logo.png` (best-effort sem gerar PNGs em múltiplos tamanhos). Splash mais nativo no PWA standalone iOS.

### v121 — Kanji delicado + recuo hierárquico (2026-06-17)

39. **Kanji com traços finos** — font-weight 700 → 300, font-size 21px → 19px, fonte serif Mincho mantida com fallback. Visual mais delicado e institucional. Renderiza limpo em light e dark.
40. **Recuo destacando abertura da categoria** — técnicas renderizadas em `<div class="cat-children">` com border-left vertical (cor neutra para Kodokan, dourada para Kosen, verde para Outros). Header mantém curvatura completa (sem hack de border-radius) e fica separado por 6px do container das técnicas. Hierarquia visual ficou tipo "árvore de pastas" sem bug de pixel no canto.

### v120 — Ícones kanji + nomenclatura Kodokan oficial (2026-06-17)

36. **Ícones do catálogo: kanji oficial** — emojis genéricos (⬆️🔒🌀🦾🥋🧩) substituídos por kanji semânticos: 投 (nage/lançar), 押 (osaekomi/pressionar), 絞 (shime/estrangular), 関 (kansetsu/articulação), 寝 (kosen/solo), 柔 (outros/jū = Judô/Jiu-Jitsu). Fonte serif japonesa (Yu Mincho / Hiragino Mincho / Noto Serif JP) com fallback. Background tintado: gold-tint para Kosen, green-tint para Outros, neutro para os 4 Kodokan oficiais.
37. **Subtítulos Kodokan documentados** — substituídos por terminologia técnica oficial (referência CBJ / Kodokan Judo Institute): "Técnicas de projeção" (nage), "Técnicas de imobilização (solo)" (osaekomi), "Técnicas de estrangulamento" (shime), "Técnicas de luxação articular" (kansetsu), "Tradição Kosen · técnicas de solo" (kosen), "BJJ moderno · guardas e raspagens" (outros).
38. **Renomeação `renshuCardNode` → `tecnicaFocoCard`** — nome descritivo do que faz (card de técnica em foco com stepper +/-). `det.renshu` (campo persistido em treinos) mantido como está para preservar dados existentes. `DB._checkinLocal` mantido por decisão do usuário.

### v118–v119 — Reversão tipografia, limpeza de código órfão (2026-06-17)

33. **Tipografia Progresso revertida** — `corPct` voltou para 2 níveis (≥60 verde, senão cinza). `sc-big` voltou ao formato baseline (`<b>57%</b> <span>de acerto</span> <i>136/240 tentativas</i>`). Mantida só a alteração de wording de "136 de 240" para "136/240 tentativas".
34. **Renshū removido** — função órfã `evoluirRenshu()` deletada; redirect defensivo `if(tab==='renshu')` removido; classes CSS órfãs `.rs-addfoco` e `.rs-rm` deletadas. `renshuCardNode()` mantida (usada na Fase 2 do registro).
35. **CSS órfão removido** — `.bib-card`, `.cat-head`, `.cat-sub` (com filhos `.cs-nm`, `.cs-n`), `.det-counters`, `.det-c`/`.det-c.on`, `.dc-v`, `.dc-l` deletadas. Auditoria via grep duplo confirmou zero referências em JS/HTML.

### v116–v117 — Polimento Progresso, busca, dark mode sweep (2026-06-17)

28. **Campo de busca Biblioteca** — fundo `var(--card)` (não mais `--field` quase invisível), borda + shadow, ícone SVG monocromático (substituiu emoji 🔍 colorido), focus state com cor vermelha.
29. **Aba Progresso polida** — header reformulado (`prog-head` com label uppercase + número grande); card com border + radius padrão; botão ✕ circular 28px; "57%" usa nova `corPct` (3 faixas: verde ≥70, dourado 50-69, cinza <50); `sc-big` reorganizado em coluna meta/tentativas; legenda do gráfico com swatches (acima/abaixo/média).
30. **Dark mode: Frequência** — `.dow-fill` usa `var(--blue-tint)` com border azul translúcido (não mais lavanda hardcoded sumindo no fundo escuro).
31. **Dark mode: Loja** — filter `brightness(.32) saturate(.6)` em `.prod-img/.prod-hero/.ld-img/.ci-img` esmaece os pastéis hardcoded do seed, harmonizando com tema escuro.
32. **selfTest 90 → 93** — 3 asserções visuais para heatmap dark: `hm-tec` é vermelho, `hm-liv` é azul, `hm-empty` transparente. Captura regressões CSS futuras.

---

## Melhorias — Curto prazo

**Filtros no histórico — período selecionável**
Completar o sistema de filtros com seleção de período temporal (últimos 7d / 30d / 3m / ano). Diferente do filtro por mês via gráfico de frequência. Chips ou segmented control.

**Faixas infantis na UI** — ✅ ENTREGUE (v174). Seletor por idade no onboarding/perfil/graduação do professor (13 faixas infantis em 4 grupos + adultas), via `faixasPorIdade()`. Plataforma liberada para menores (consentimento do responsável). Ref: `GRADUACAO_CBJJ.md`.

---

## Futuro — Horizonte distante

**Sistema de graus infantil**
3 modalidades IBJJF: trimestral (3 graus), quadrimestral (2), mensal (11). Configurável. Sistema especial Branca + Cinza/Branca (6 graus cada, 1 ano). Depende de Faixas infantis (acima). Ref: Anexo I.

**Notificações inteligentes**
Revisão espaçada: push quando técnica está vencida. Streak: alerta se vai perder a sequência. Graduação: aviso quando elegível para grau/faixa. Requer Notification API local + lógica de scheduling no SW.

---

### v115 — Fix heatmap dark mode (2026-06-17)

27. **Heatmap dark mode** — bug de especificidade CSS: `[data-theme="dark"] .hm-cell{background:var(--field)}` sobrescrevia `.hm-cell.hm-tec`/`.hm-liv` (mesma especificidade, ordem ganha). Adicionados overrides explícitos para `.hm-tec` (red), `.hm-liv` (blue), `.hm-future` (border). Células de treino voltam a aparecer no dark.

### v114 — Dark mode, dedupe export, exclusão custom, selfTest estendido (2026-06-17)

23. **Dark mode sweep** — `.bib-fchip`, `.cat-tag.mod`, `.rep-dot` agora usam variáveis CSS (`--gold-tint`, `--blue-tint`, `--green-tint`, `--line`) que já têm versão dark. Sem cores hardcoded.
24. **Dedupe export** — duplicação entre Configurações ("Exportar dados") e Perfil ("Backup") removida. `cfg-export` agora abre o mesmo `abrirBackup()`. Função `exportarDados()` removida (obsoleta).
25. **Excluir técnica customizada** — `bibExcluirCustom(id)` apresentado no card expandido só para id começando com `usr-`. Confirma antes, remove técnica + links + progresso, persiste.
26. **selfTest 81 → 90** — 9 novas asserções: `tecByKey` (id, jp, null, inexistente), `save inclui tecnicasCustom`, `tecnicasCustom só usr-`, `load restaura def`, `load restaura progresso`, `load não duplica seed`.

### v111–v112 — Backup, polimento Biblioteca (2026-06-17)

17. **Backup do perfil** — sheet em Perfil → Backup com Exportar / Importar JSON. Inclui `STORE_KEY` completo + técnicas customizadas. Validação de schema, confirmação antes de substituir.
18. **Persistência de técnicas customizadas** — `save()`/`load()` agora serializam `tecnicasCustom` (id começa com `usr-`). Definições sobrevivem reload.
19. **Lookup unificado por id** — helper `tecByKey(k)` aceita id ou jp; substituiu todos os `find(x=>x.jp===…)` críticos (Renshu stepper, foco, edição).
20. **Filtros na Biblioteca** — chips por nível (Catálogo / Aprendendo / Treinando / Dominadas) com contadores; categorias mostram `filtrados/total`; vazias ficam esmaecidas.
21. **Cards de técnica** — dot colorido por nível à esquerda; subtítulo simplificado (sem repetir nome da categoria).
22. **Campo de busca refeito** — pill rounded, lupa 🔍 inline, botão ✕ para limpar, focus state, alinhamento com padding lateral.

### v107–v110 — Categoria Outros, IDs estáveis, auditoria (2026-06-17)

13. **Categoria `outros`** — 6ª categoria oficial em `CATS`/`CAT_ORDER` com tag visual "BJJ moderno".
14. **16 técnicas em Outros** — guardas (fechada, aberta, meia, tartaruga, borboleta, aranha, De La Riva, Z-guard) + raspagens (pêndulo, tesoura, borboleta, aranha, De La Riva, berimbolo, X-guard, balão). Currículo até faixa roxa.
15. **IDs estáveis** — todas as técnicas ganharam `id` (chave de persistência); `jp` virou só display. Renomeio em runtime preserva progresso.
16. **Auditoria histórica** — 14 nomes japoneses inventados removidos da categoria Outros (substituídos por PT/EN consagrado). Kani-basami, Obi-tori-gaeshi, Tawara-gaeshi reclassificadas de kosen → nage (Kodokan oficial). Niju-garami e Sangaku-garami removidas (sem fonte).

### v104–v106 — Histórico, performance, correções (2026-06-17)

8. **Filtros de período no histórico** — chips 7d / 30d / 3m / ano + paginação (20 por página).
9. **Bug fix do heatmap** — `_attendedSet()` deriva só de `DB.treinos` (não inclui mais `checkinHoje.feito`); excluir treino remove o dia do heatmap.
10. **Toast "Treino concluído"** — confirma quando Fase 1 + Fase 2 são salvas.
11. **Mensagem "apto" reformulada** — `aptoMsg()` com texto específico para grau / faixa colorida / Preta (com singular/plural correto).
12. **Contador de aulas sem cap** — `aulasStats()` não trava mais em `Math.min(meta, noGrau)`.

### v103 — Melhorias (2026-06-16)

6. **PWA offline completo** — `sw.js` com cache-first strategy, install/activate/fetch handlers, fallback para `index.html`. Manifest + SW registrado.
7. **Filtros no histórico (tipo + sensação + randori)** — Chips toggle para filtrar por tipo (técnica/livre), sensação (1–5), com/sem randori. Botão "Limpar filtros".

### v100 — Correções imediatas (2026-06-16)

1. **Editar treinos salvos** — Sheet de edição em `renderTreinoDetalhe()` com sensação (1–5), randori, vestimenta (gi/nogi) e anotações. Salva no treino existente via mutação direta + render().
2. **Busca/filtro na Biblioteca** — Input em `evoluirBiblioteca()` filtra técnicas por nome japonês ou português em tempo real. Esconde catálogo durante busca.
3. **Empty state com guia contextual** — Textos orientadores nos 3 empty states (início, histórico, frequência) explicando o que vai aparecer e como começar.
4. **Lesão: editar/excluir** — Cada lesão na lista tem botões "Editar" (abre sheet preenchido com parte, status, nota) e "Excluir" (com confirm()). Função `abrirEditarLesao()`.
5. **Confirmar ao sair do registro** — `closeFlow()` verifica se está na fase 2 com dados (nota, mood, randori, feel ou draft) e mostra sheet de confirmação antes de fechar.

## Avaliação de produto (2026-06-16)

### Pontos fortes
- Registro bifásico (check-in → completar depois) é diferencial real — respeita o fluxo do praticante
- Renshū (hit/miss por técnica) com revisão espaçada é sofisticado para um app vanilla JS
- Share stories com 6 templates glassmorphism em canvas — resultado visual profissional
- CBJJ v3.2 integrada com elegibilidade automática — raro em apps de BJJ
- Zero dependências, ~3900 linhas, performance excelente
- selfTest com 93 assertions cobrindo funções puras, write paths, todas as views, `tecByKey`, round-trip de técnicas customizadas e regressões visuais do heatmap dark

### Pontos de atenção
- `render()` recria DOM inteiro — ok até ~500 treinos, monitorar depois
- localStorage como única persistência — banco na nuvem planejado

### KPIs sugeridos
- **Retenção D7/D30**: % de usuários que registram treino na semana 1 e mês 1
- **Frequência de registro**: treinos/semana por usuário ativo
- **Engajamento Renshū**: % de treinos com hit/miss preenchido
- **Share rate**: % de treinos compartilhados via story
- **Streak médio**: semanas consecutivas dos usuários ativos

### Recomendação
App maduro para uso pessoal. Próximo milestone: melhorias de UX (filtros, faixas infantis) + banco na nuvem antes de abrir para outros alunos.

---

