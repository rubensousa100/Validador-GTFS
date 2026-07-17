/* ═══════════════════════════════════════════════════════════════
   app.js — Validador GTFS (leitura, validação, relatório, export)
   Depende de: js/config.js (regras) e JSZip (CDN).
   ═══════════════════════════════════════════════════════════════ */
'use strict';

/* ═══════════════════════════════════════════════════════════════
   PARSER CSV (RFC 4180: aspas, vírgulas embebidas, CRLF, BOM)
   ═══════════════════════════════════════════════════════════════ */
function parseCSV(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQ = false;
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"')  { inQ = true; i++; continue; }
    if (c === ',')  { row.push(field); field = ''; i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];

  const header = rows[0].map(h => h.trim());
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length === 1 && rows[r][0] === '') continue; // linha vazia
    const o = {};
    header.forEach((h, idx) => o[h] = (rows[r][idx] ?? '').trim());
    out.push(o);
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════
   MODELO DO RELATÓRIO
   ═══════════════════════════════════════════════════════════════ */
class Relatorio {
  constructor() { this.erros = []; this.avisos = []; this.notas = []; this.overview = {}; }
  erro(regra, msg, det, ref)  { this.erros.push({ regra, msg, det, ref }); }
  aviso(regra, msg, det, ref) { this.avisos.push({ regra, msg, det, ref }); }
  nota(regra, msg, det, ref)  { this.notas.push({ regra, msg, det, ref }); }
}

/* ═══════════════════════════════════════════════════════════════
   UTILITÁRIOS DE LEITURA DO ZIP
   ═══════════════════════════════════════════════════════════════ */
async function lerCSV(zip, nome) {
  const f = zip.file(nome) || zip.file(new RegExp('(^|/)' + nome.replace('.', '\\.') + '$'))[0];
  if (!f) return null;
  return parseCSV(await f.async('string'));
}
function temFicheiro(zip, nome) {
  return !!(zip.file(nome) || zip.file(new RegExp('(^|/)' + nome.replace('.', '\\.') + '$')).length);
}
function fmtData(s) {
  return s && s.length === 8 ? `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}` : (s || '—');
}

/* ═══════════════════════════════════════════════════════════════
   VALIDAÇÃO
   ═══════════════════════════════════════════════════════════════ */
async function validar(zip) {
  const rel = new Relatorio();

  /* — Ficheiros mínimos (Memorando §3) — */
  const emFalta = FICHEIROS_MINIMOS.filter(f => !temFicheiro(zip, f));
  emFalta.forEach(f => rel.erro(
    "Ficheiros mínimos", `Falta o ficheiro obrigatório <b>${f}</b>.`, null,
    "Memorando §3 — lista de 10 ficheiros mínimos"
  ));
  if (!temFicheiro(zip, FICHEIRO_AUXILIAR)) {
    rel.aviso("Ficheiro auxiliar",
      `Falta o <b>${FICHEIRO_AUXILIAR}</b> — deve acompanhar cada nova versão do GTFS, com route_id, pattern_name, direction_id e shape_id.`,
      null, "Memorando §3 — ficheiro auxiliar de percursos");
  }

  /* — Leitura em paralelo — */
  const [agency, stops, routes, trips, st, cal, cdates, shapes, feedInfo, transfers] =
    await Promise.all([
      lerCSV(zip, "agency.txt"),   lerCSV(zip, "stops.txt"),          lerCSV(zip, "routes.txt"),
      lerCSV(zip, "trips.txt"),    lerCSV(zip, "stop_times.txt"),     lerCSV(zip, "calendar.txt"),
      lerCSV(zip, "calendar_dates.txt"), lerCSV(zip, "shapes.txt"),
      lerCSV(zip, "feed_info.txt"), lerCSV(zip, "transfers.txt"),
    ]);

  /* — Visão geral — */
  rel.overview = {
    'Paragens':    stops  ? stops.length  : '—',
    'Linhas':      routes ? routes.length : '—',
    'Viagens':     trips  ? trips.length  : '—',
    'Horários':    st     ? st.length     : '—',
    'Calendários': cal    ? cal.length    : '—',
    'Início':  feedInfo && feedInfo[0] ? fmtData(feedInfo[0].feed_start_date) : '—',
    'Fim':     feedInfo && feedInfo[0] ? fmtData(feedInfo[0].feed_end_date)   : '—',
    'Versão':  feedInfo && feedInfo[0] ? (feedInfo[0].feed_version || '—')    : '—',
  };

  /* — agency.txt — */
  if (agency) {
    const v = agency.filter(r => !r.agency_name);
    if (v.length) rel.erro("agency.txt",
      `${v.length} linha(s) com <b>agency_name</b> vazio (deve ser o nome da concessionária).`,
      null, "Memorando §3(1)");
  }

  /* — stops.txt — */
  if (stops) {
    const inval = stops.filter(r => !REGEX_STOP_ID.test(r.stop_id || ''));
    if (inval.length) rel.erro("stops.txt — stop_id",
      `<b>${inval.length}</b> stop_id não seguem o formato "acrónimo do município em minúsculas + _ + código numérico" (ex.: pnf_896).`,
      { tipo: 'tabela', cab: ['stop_id', 'stop_name'], linhas: inval.map(r => [r.stop_id, r.stop_name]) },
      "Memorando §3(2)");

    const semZona = stops.filter(r => !r.zone_id);
    if (semZona.length) rel.aviso("stops.txt — zone_id",
      `${semZona.length} paragens sem <b>zone_id</b> (código da zona tarifária, ex.: PNF1).`,
      { tipo: 'lista', itens: semZona.map(r => r.stop_id) }, "Memorando §3(2)");

    const foraPT = stops.filter(r => {
      const la = parseFloat(r.stop_lat), lo = parseFloat(r.stop_lon);
      return isNaN(la) || isNaN(lo) || la < LAT_MIN || la > LAT_MAX || lo < LON_MIN || lo > LON_MAX;
    });
    if (foraPT.length) rel.erro("stops.txt — coordenadas",
      `<b>${foraPT.length}</b> paragens com coordenadas fora de Portugal continental ou inválidas (verificar WGS84 decimal).`,
      { tipo: 'tabela', cab: ['stop_id', 'lat', 'lon'], linhas: foraPT.map(r => [r.stop_id, r.stop_lat, r.stop_lon]) },
      "Memorando §3(2) — WGS84");

    const cont = {};
    stops.forEach(r => cont[r.stop_id] = (cont[r.stop_id] || 0) + 1);
    const dups = Object.keys(cont).filter(k => cont[k] > 1);
    if (dups.length) rel.erro("stops.txt — duplicados",
      `<b>${dups.length}</b> stop_id duplicados.`,
      { tipo: 'lista', itens: dups }, "Norma GTFS — chave única");
  }

  /* — routes.txt — */
  if (routes) {
    ["route_id", "route_short_name", "route_long_name", "agency_id", "route_color", "route_text_color"].forEach(c => {
      const v = routes.filter(r => !r[c]);
      if (v.length) rel.aviso("routes.txt",
        `${v.length} linha(s) com <b>${c}</b> vazio.`,
        { tipo: 'lista', itens: v.map(r => r.route_id || '(sem id)') }, "Memorando §3(3)");
    });
  }

  /* — trips.txt — */
  if (trips) {
    const semDir   = trips.filter(r => !r.direction_id);
    const semShape = trips.filter(r => !r.shape_id);
    const semHead  = trips.filter(r => !r.trip_headsign);

    if (semDir.length) rel.erro("trips.txt — direction_id",
      `<b>${semDir.length}</b> viagens sem direction_id (obrigatório).`,
      { tipo: 'lista', itens: semDir.map(r => r.trip_id) }, "Memorando §3(4)");

    if (semShape.length) rel.erro("trips.txt — shape_id",
      `<b>${semShape.length}</b> viagens sem shape_id (obrigatório).`,
      { tipo: 'lista', itens: semShape.map(r => r.trip_id) }, "Memorando §3(4)");

    if (semHead.length) {
      const porRota = {};
      semHead.forEach(r => porRota[r.route_id] = (porRota[r.route_id] || 0) + 1);
      rel.erro("trips.txt — trip_headsign",
        `<b>${semHead.length}</b> de ${trips.length} viagens sem trip_headsign (destino/referência, como na bandeira do autocarro).`,
        { tipo: 'tabela', cab: ['route_id', 'viagens afetadas'],
          linhas: Object.entries(porRota).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, String(v)]) },
        "Memorando §3(4)");
    }
  }

  /* — stop_times.txt — */
  if (st) {
    ["arrival_time", "departure_time", "stop_id", "shape_dist_traveled"].forEach(c => {
      const v = st.filter(r => !r[c]);
      if (v.length) rel.erro("stop_times.txt",
        `<b>${v.length}</b> registos com <b>${c}</b> vazio (obrigatório).`,
        { tipo: 'lista', itens: [...new Set(v.map(r => r.trip_id))] }, "Memorando §3(5)");
    });

    const horaMa = st.filter(r => r.arrival_time && r.departure_time &&
      (!REGEX_HORA.test(r.arrival_time) || !REGEX_HORA.test(r.departure_time)));
    if (horaMa.length) rel.erro("stop_times.txt — formato de hora",
      `<b>${horaMa.length}</b> registos com hora fora do formato HH:MM:SS.`,
      { tipo: 'tabela', cab: ['trip_id', 'arrival', 'departure'],
        linhas: horaMa.map(r => [r.trip_id, r.arrival_time, r.departure_time]) }, "Norma GTFS");

    // stop_sequence sem repetições por viagem
    const porTrip = {};
    st.forEach(r => { (porTrip[r.trip_id] = porTrip[r.trip_id] || []).push(parseInt(r.stop_sequence)); });
    const seqMa = Object.keys(porTrip).filter(t => new Set(porTrip[t]).size !== porTrip[t].length);
    if (seqMa.length) rel.erro("stop_times.txt — stop_sequence",
      `<b>${seqMa.length}</b> viagens com stop_sequence repetida.`,
      { tipo: 'lista', itens: seqMa }, "Norma GTFS");
  }

  /* — calendar.txt — */
  if (cal) {
    const pfLote = cal.filter(r => PREFIXO_LOTE.test(r.service_id || ''));
    if (pfLote.length) rel.erro("calendar.txt — service_id",
      `<b>${pfLote.length}</b> service_id usam prefixo de lote/operador (UT1–UT4) em vez do acrónimo do <b>município</b> em maiúsculas (ex.: BAO_E-U).`,
      { tipo: 'lista', itens: pfLote.map(r => r.service_id) }, "Memorando §3(6)");

    const todosDias = cal.filter(r => DIAS.every(d => (r[d] || '0') === '1'));
    if (todosDias.length) rel.erro("calendar.txt — separação U/S/DF",
      `<b>${todosDias.length}</b> service_id circulam os 7 dias sem estarem separados em três calendários (ex.: X-U, X-S, X-DF).`,
      { tipo: 'lista', itens: todosDias.map(r => r.service_id) }, "Memorando §3(6)");
  }

  /* — calendar_dates.txt — */
  if (cdates) {
    const inval = cdates.filter(r => !["1", "2"].includes(r.exception_type));
    if (inval.length) rel.erro("calendar_dates.txt — exception_type",
      `<b>${inval.length}</b> registos com exception_type fora de {1, 2}.`,
      { tipo: 'tabela', cab: ['service_id', 'date', 'exception_type'],
        linhas: inval.map(r => [r.service_id, r.date, r.exception_type]) }, "Memorando §3(7)");
  }

  /* — shapes.txt — */
  if (shapes) {
    const semDist = shapes.filter(r => !r.shape_dist_traveled);
    if (semDist.length) rel.erro("shapes.txt — shape_dist_traveled",
      `<b>${semDist.length}</b> pontos sem shape_dist_traveled (obrigatório, em metros).`,
      { tipo: 'lista', itens: [...new Set(semDist.map(r => r.shape_id))] }, "Memorando §3(8)");
  }

  /* — feed_info.txt — */
  if (feedInfo && feedInfo.length) {
    feedInfo.forEach(r => {
      ["feed_start_date", "feed_end_date", "feed_version"].forEach(c => {
        if (!r[c]) rel.erro("feed_info.txt", `Campo <b>${c}</b> vazio (obrigatório).`, null, "Memorando §3(10)");
      });
    });
  } else if (temFicheiro(zip, "feed_info.txt")) {
    rel.aviso("feed_info.txt", "Ficheiro presente mas vazio ou ilegível.", null, "Memorando §3(10)");
  }

  /* — transfers.txt — */
  if (transfers && transfers.length === 0) {
    rel.aviso("transfers.txt",
      "Ficheiro presente mas sem registos — confirmar se de facto não existem transbordos com ordem de ligação.",
      null, "Memorando §3(9)");
  }

  /* — Integridade referencial entre ficheiros — */
  if (stops && trips && st && routes && cal && shapes) {
    const sIds  = new Set(stops.map(r => r.stop_id));
    const rIds  = new Set(routes.map(r => r.route_id));
    const svIds = new Set(cal.map(r => r.service_id));
    const shIds = new Set(shapes.map(r => r.shape_id));
    const tIds  = new Set(trips.map(r => r.trip_id));

    const stBadStop = st.filter(r => !sIds.has(r.stop_id));
    if (stBadStop.length) rel.erro("Referências — stop_times → stops",
      `<b>${stBadStop.length}</b> registos referem stop_id inexistente em stops.txt.`,
      { tipo: 'lista', itens: [...new Set(stBadStop.map(r => r.stop_id))] }, "Integridade referencial");

    const stBadTrip = st.filter(r => !tIds.has(r.trip_id));
    if (stBadTrip.length) rel.erro("Referências — stop_times → trips",
      `<b>${stBadTrip.length}</b> registos referem trip_id inexistente em trips.txt.`,
      { tipo: 'lista', itens: [...new Set(stBadTrip.map(r => r.trip_id))] }, "Integridade referencial");

    const trBadRoute = trips.filter(r => !rIds.has(r.route_id));
    if (trBadRoute.length) rel.erro("Referências — trips → routes",
      `<b>${trBadRoute.length}</b> viagens referem route_id inexistente.`,
      { tipo: 'lista', itens: [...new Set(trBadRoute.map(r => r.route_id))] }, "Integridade referencial");

    const trBadSv = trips.filter(r => !svIds.has(r.service_id));
    if (trBadSv.length) rel.erro("Referências — trips → calendar",
      `<b>${trBadSv.length}</b> viagens referem service_id não definido em calendar.txt.`,
      { tipo: 'lista', itens: [...new Set(trBadSv.map(r => r.service_id))] }, "Integridade referencial");

    const trBadSh = trips.filter(r => r.shape_id && !shIds.has(r.shape_id));
    if (trBadSh.length) rel.erro("Referências — trips → shapes",
      `<b>${trBadSh.length}</b> viagens referem shape_id inexistente.`,
      { tipo: 'lista', itens: [...new Set(trBadSh.map(r => r.shape_id))] }, "Integridade referencial");

    if (cdates) {
      const cdBad = cdates.filter(r => !svIds.has(r.service_id));
      if (cdBad.length) rel.erro("Referências — calendar_dates → calendar",
        `<b>${cdBad.length}</b> exceções referem service_id não definido em calendar.txt.`,
        { tipo: 'lista', itens: [...new Set(cdBad.map(r => r.service_id))] }, "Integridade referencial");
    }

    /* — Notas informativas — */
    const svUsados = new Set(trips.map(r => r.service_id));
    const svNaoUsados = [...svIds].filter(s => !svUsados.has(s));
    if (svNaoUsados.length) rel.nota("calendar.txt — calendários não usados",
      `${svNaoUsados.length} calendários definidos mas nunca usados em trips.txt. Não é erro (podem vir do catálogo comum), mas convém confirmar.`,
      { tipo: 'lista', itens: svNaoUsados.sort() }, "Informativo");

    const rotasComViagens = new Set(trips.map(t => t.route_id));
    const rtSemViagens = [...rIds].filter(r => !rotasComViagens.has(r));
    if (rtSemViagens.length) rel.nota("routes.txt — linhas sem viagens",
      `${rtSemViagens.length} linhas definidas sem qualquer viagem associada.`,
      { tipo: 'lista', itens: rtSemViagens.sort() }, "Informativo");
  }

  return rel;
}

/* ═══════════════════════════════════════════════════════════════
   RENDERIZAÇÃO DO RELATÓRIO
   ═══════════════════════════════════════════════════════════════ */
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

function renderDet(det) {
  if (!det) return '';
  if (det.tipo === 'lista') {
    const itens = det.itens.slice(0, LIMITE_LISTA);
    const resto = det.itens.length - itens.length;
    return `<details class="det"><summary>Ver os ${det.itens.length} registos</summary>
      <div class="idlist">${itens.map(i => `<span class="chip">${esc(i)}</span>`).join('')}
      ${resto > 0 ? `<div>… e mais ${resto}.</div>` : ''}</div></details>`;
  }
  if (det.tipo === 'tabela') {
    const linhas = det.linhas.slice(0, LIMITE_LISTA);
    const resto = det.linhas.length - linhas.length;
    return `<details class="det"><summary>Ver os ${det.linhas.length} registos</summary>
      <div class="idlist" style="padding:0">
      <table class="dtl"><thead><tr>${det.cab.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${linhas.map(l => `<tr>${l.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
      ${resto > 0 ? `<div style="padding:8px 12px">… e mais ${resto}.</div>` : ''}</div></details>`;
  }
  return '';
}

function renderItem(it, cls) {
  return `<article class="item ${cls}">
    <span class="item-rule">${esc(it.regra)}</span>
    <span class="msg">${it.msg}</span>
    ${renderDet(it.det)}
    ${it.ref ? `<span class="item-ref">${esc(it.ref)}</span>` : ''}
  </article>`;
}

let ultimoRel = null, ultimoNome = '';

function render(rel, nome) {
  ultimoRel = rel; ultimoNome = nome;
  const el = document.getElementById('report');
  const nE = rel.erros.length, nA = rel.avisos.length, nN = rel.notas.length;

  let verdict;
  if (nE) {
    verdict = `<div class="verdict fail"><span class="dot"></span><div>
      <strong>Não conforme com o memorando</strong>
      <small>${nE} erro(s) e ${nA} aviso(s) nas regras verificadas automaticamente</small></div></div>`;
  } else if (nA) {
    verdict = `<div class="verdict warn"><span class="dot"></span><div>
      <strong>Sem erros, mas com ${nA} aviso(s)</strong>
      <small>Rever antes de publicar</small></div></div>`;
  } else {
    verdict = `<div class="verdict pass"><span class="dot"></span><div>
      <strong>Conforme nas regras verificadas automaticamente</strong>
      <small>Regras qualitativas (nomes de paragens, catálogo de calendários…) exigem revisão humana</small></div></div>`;
  }

  const overview = `<div class="overview">${Object.entries(rel.overview)
    .map(([l, n]) => `<div class="metric"><div class="metric-value">${esc(n)}</div><div class="metric-label">${esc(l)}</div></div>`)
    .join('')}</div>`;

  const tabs = `<div class="tabs" role="tablist">
    <button type="button" class="tab t-err active" data-p="p-err">Erros<span class="badge">${nE}</span></button>
    <button type="button" class="tab t-warn" data-p="p-warn">Avisos<span class="badge">${nA}</span></button>
    <button type="button" class="tab" data-p="p-note">Notas<span class="badge">${nN}</span></button>
  </div>`;

  const pErr = `<div class="panel active" id="p-err">${
    nE ? rel.erros.map(i => renderItem(i, 'err')).join('')
       : '<div class="empty-panel">Nenhum erro encontrado nas regras verificadas.</div>'}</div>`;
  const pWarn = `<div class="panel" id="p-warn">${
    nA ? rel.avisos.map(i => renderItem(i, 'warn')).join('')
       : '<div class="empty-panel">Sem avisos.</div>'}</div>`;
  const pNote = `<div class="panel" id="p-note">${
    nN ? rel.notas.map(i => renderItem(i, 'note')).join('')
       : '<div class="empty-panel">Sem notas informativas.</div>'}</div>`;

  const actions = `<div class="actions">
    <button type="button" class="btn btn-primary" id="exportBtn">Descarregar relatório (.md)</button>
    <button type="button" class="btn btn-ghost" id="printBtn">Imprimir / PDF</button>
  </div>`;

  const foot = `<div class="footnote">
    Este relatório cobre as regras automatizáveis do Memorando de Gestão de Alterações GTFS (V12.2025).
    Regras qualitativas — convenções de <i>stop_name</i>, correspondência com o catálogo de calendários (Anexo I),
    composição do <i>trip_id</i>, conteúdo do <i>patterns_shapeid.txt</i> — exigem revisão humana.
    Complementar com o validador oficial da norma:
    <a href="https://gtfs-validator.mobilitydata.org/" target="_blank" rel="noopener">gtfs-validator.mobilitydata.org</a>.
  </div>`;

  el.innerHTML = verdict + overview + tabs + pErr + pWarn + pNote + actions + foot;
  el.style.display = 'block';

  // Interação dos separadores
  el.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    el.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    el.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    el.querySelector('#' + t.dataset.p).classList.add('active');
  }));
  document.getElementById('exportBtn').addEventListener('click', exportarMD);
  document.getElementById('printBtn').addEventListener('click', () => window.print());
}

/* ═══════════════════════════════════════════════════════════════
   EXPORTAÇÃO PARA MARKDOWN
   ═══════════════════════════════════════════════════════════════ */
function exportarMD() {
  if (!ultimoRel) return;
  const r = ultimoRel;
  const strip = s => s.replace(/<[^>]+>/g, '');

  let md = `# Relatório de Validação — Memorando GTFS (CIM Tâmega e Sousa)\n\n`;
  md += `**Feed:** ${ultimoNome}\n**Data:** ${new Date().toLocaleString('pt-PT')}\n\n`;
  md += `| | |\n|---|---|\n`;
  Object.entries(r.overview).forEach(([l, n]) => md += `| ${l} | ${n} |\n`);
  md += `\n- 🔴 Erros: **${r.erros.length}**\n- 🟠 Avisos: **${r.avisos.length}**\n- ℹ️ Notas: **${r.notas.length}**\n\n`;

  const sec = (titulo, arr, icone) => {
    if (!arr.length) return '';
    let s = `## ${icone} ${titulo}\n\n`;
    arr.forEach(it => {
      s += `### ${it.regra}\n${strip(it.msg)}\n`;
      if (it.ref) s += `_${it.ref}_\n`;
      if (it.det) {
        if (it.det.tipo === 'lista') s += `\nRegistos: ${it.det.itens.join(', ')}\n`;
        if (it.det.tipo === 'tabela') {
          s += `\n| ${it.det.cab.join(' | ')} |\n|${it.det.cab.map(() => '---').join('|')}|\n`;
          it.det.linhas.forEach(l => s += `| ${l.join(' | ')} |\n`);
        }
      }
      s += '\n';
    });
    return s;
  };

  md += sec('Erros', r.erros, '🔴') + sec('Avisos', r.avisos, '🟠') + sec('Notas', r.notas, 'ℹ️');
  md += `\n---\n_Relatório das regras automatizáveis do Memorando V12.2025. Complementar com o validador oficial: https://gtfs-validator.mobilitydata.org/_\n`;

  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `relatorio_${ultimoNome.replace(/\.zip$/i, '')}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ═══════════════════════════════════════════════════════════════
   UPLOAD E FLUXO PRINCIPAL
   ═══════════════════════════════════════════════════════════════ */
async function processar(file) {
  document.getElementById('loading').style.display  = 'block';
  document.getElementById('report').style.display   = 'none';
  document.getElementById('filebar').style.display  = 'flex';
  document.getElementById('filename').textContent   = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
  document.getElementById('dropzone').style.display = 'none';
  try {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const rel = await validar(zip);
    render(rel, file.name);
  } catch (e) {
    document.getElementById('report').innerHTML =
      `<article class="item err"><span class="item-rule">Erro de leitura</span>
       Não foi possível processar o ficheiro: ${esc(e.message)}. Confirme que é um .zip GTFS válido.</article>`;
    document.getElementById('report').style.display = 'block';
  } finally {
    document.getElementById('loading').style.display = 'none';
  }
}

const dz = document.getElementById('dropzone');
const fi = document.getElementById('fileInput');

dz.addEventListener('click', () => fi.click());
dz.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); }
});
fi.addEventListener('change', e => { if (e.target.files[0]) processar(e.target.files[0]); });

dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('drag');
  if (e.dataTransfer.files[0]) processar(e.dataTransfer.files[0]);
});

document.getElementById('clearBtn').addEventListener('click', () => {
  document.getElementById('filebar').style.display  = 'none';
  document.getElementById('dropzone').style.display = 'block';
  document.getElementById('report').style.display   = 'none';
  fi.value = '';
});
