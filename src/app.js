(function () {
  'use strict';
  document.documentElement.lang = 'pt-BR';
  const P = JSON.parse(document.getElementById('payload').textContent);
  const N = P.n, D = P.dims, M = P.mun, A = D.age.length, KM = D.km, KS = D.ks;
  const YEARS = P.meta.years, HAS22 = YEARS.indexOf('2022') >= 0;
  const SITE = (() => { try { return JSON.parse(document.getElementById('site').textContent) || {}; } catch (e) { return {}; } })();
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const svg = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

  // ---------------------------------------------------------------- labels
  const SEX = ['Mulheres', 'Homens'];
  const MARITAL = { labels: ['Solteiros', 'Casados', 'Divorciados ou separados', 'Viúvos'], name: 'estado civil',
    group: [['solteiras', 'casadas', 'divorciadas ou separadas', 'viúvas'], ['solteiros', 'casados', 'divorciados ou separados', 'viúvos']] };
  const SCHOOL = { labels: ['Sem instrução formal', 'Ensino fundamental', 'Ensino médio', 'Ensino superior'], name: 'escolaridade',
    group: ['sem instrução formal', 'com ensino fundamental', 'com ensino médio', 'com ensino superior'] };
  const REG_KEYS = ['N', 'NE', 'CO', 'SE', 'S'], REG_NAME = ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'];
  const UF = M.uf, NUF = D.ufs.length, UF_REG = D.uf_region.map(r => REG_KEYS.indexOf(r));
  const ageText = a => a === A - 1 ? '80 anos ou mais' : D.age[a].replace('–', ' a ') + ' anos';
  const groupText = (dim, s, a, k) => dim === 'marital' ? SEX[s].toLowerCase() + ' ' + MARITAL.group[s][k] + ' de ' + ageText(a) : SEX[s].toLowerCase() + ' de ' + ageText(a) + ' ' + SCHOOL.group[k];

  // ---------------------------------------------------------------- numbers (pt-BR)
  const LOC = d3.formatLocale({ decimal: ',', thousands: '.', grouping: [3], currency: ['R$ ', ''] });
  const fInt = LOC.format(','), f1 = LOC.format('.1f'), f2 = LOC.format('.2f');
  const compact = v => v >= 1e6 ? (v >= 1e7 ? f1 : f2)(v / 1e6) + ' mi' : v >= 1e4 ? Math.round(v / 1e3) + ' mil' : fInt(Math.round(v));
  const tickFmt = v => v >= 1e6 ? LOC.format('~f')(v / 1e6) + ' mi' : v >= 1e3 ? LOC.format('~f')(v / 1e3) + ' mil' : String(v);
  const sign = v => v >= 0 ? '+' : '−';
  const pts = v => Math.abs(v) < 2 ? ' ponto' : ' pontos';
  const fmtR = r => !isFinite(r) ? '–' : sign(r) + f2(Math.abs(r));

  // ---------------------------------------------------------------- data
  function unpack(b64, len) {
    const bin = atob(b64), out = new Uint32Array(len);
    let v = 0, shift = 0, j = 0;
    for (let i = 0; i < bin.length; i++) {
      const b = bin.charCodeAt(i);
      v += (b & 127) * Math.pow(2, shift);
      if (b & 128) shift += 7; else { out[j++] = v; v = 0; shift = 0; }
    }
    return out;
  }
  const pc = (a, b) => b > 0 ? 100 * a / b : NaN;
  const FEATS = [
    ['women', 'Mulheres', '% dos eleitores'], ['age', 'Idade média dos eleitores', 'anos'], ['young', '16 a 24 anos', '% dos eleitores'],
    ['a2544', '25 a 44 anos', '% dos eleitores'], ['a4559', '45 a 59 anos', '% dos eleitores'], ['old', '60 anos ou mais', '% dos eleitores'],
    ['single', 'Solteiros', '% dos eleitores'], ['married', 'Casados', '% dos eleitores'], ['divsep', 'Divorciados ou separados', '% dos eleitores'],
    ['widowed', 'Viúvos', '% dos eleitores'], ['noschool', 'Sem instrução formal', '% dos eleitores'], ['primary', 'Ensino fundamental', '% dos eleitores'],
    ['secondary', 'Ensino médio', '% dos eleitores'], ['higher', 'Ensino superior', '% dos eleitores'],
    ['bio', 'Cadastro biométrico', '% dos eleitores'], ['size', 'Porte do município', 'eleitores, escala logarítmica']
  ];
  const FLABEL = {}, FUNIT = {}; for (const [k, l, u] of FEATS) { FLABEL[k] = l; FUNIT[k] = u; }
  const XPHRASE = { age: 'idade média dos eleitores', size: 'porte do município', women: 'proporção de mulheres no eleitorado', young: 'proporção de eleitores de 16 a 24 anos',
    a2544: 'proporção de eleitores de 25 a 44 anos', a4559: 'proporção de eleitores de 45 a 59 anos', old: 'proporção de eleitores de 60 anos ou mais',
    single: 'proporção de eleitores solteiros', married: 'proporção de eleitores casados', divsep: 'proporção de eleitores divorciados ou separados',
    widowed: 'proporção de eleitores viúvos', noschool: 'proporção de eleitores sem instrução formal', primary: 'proporção de eleitores com ensino fundamental',
    secondary: 'proporção de eleitores com ensino médio', higher: 'proporção de eleitores com ensino superior', bio: 'proporção de eleitores com biometria' };
  const VOTE_KEYS = ['margin', 'a', 'lu', 'third', 'turnout', 'bn'], CHANGE_KEYS = HAS22 ? ['swing', 'dturn'] : [];
  const YKEYS = FEATS.map(f => f[0]).concat(VOTE_KEYS);

  function newAgg(sc) {
    const g = { cm: new Float64Array(2 * A * KM), cs: new Float64Array(2 * A * KS), n: 0 };
    for (const k of sc) g[k] = 0;
    return g;
  }
  function metrics(g) {
    let tot = 0, women = 0, ageSum = 0; const mar = [0, 0, 0, 0], ageT = new Float64Array(A);
    for (let s = 0; s < 2; s++) for (let a = 0; a < A; a++) for (let k = 0; k < KM; k++) {
      const v = g.cm[(s * A + a) * KM + k]; tot += v; if (!s) women += v; ageSum += v * D.age_mid[a]; mar[k] += v; ageT[a] += v;
    }
    let st = 0; const sch = [0, 0, 0, 0];
    for (let j = 0; j < 2 * A * KS; j++) { st += g.cs[j]; sch[j % KS] += g.cs[j]; }
    const span = (a, b) => { let t = 0; for (let i = a; i <= b; i++) t += ageT[i]; return t; };
    return {
      women: pc(women, tot), age: tot ? ageSum / tot : NaN, young: pc(span(0, 2), tot), a2544: pc(span(3, 6), tot),
      a4559: pc(span(7, 9), tot), old: pc(span(10, A - 1), tot),
      single: pc(mar[0], tot), married: pc(mar[1], tot), divsep: pc(mar[2], tot), widowed: pc(mar[3], tot),
      noschool: pc(sch[0], st), primary: pc(sch[1], st), secondary: pc(sch[2], st), higher: pc(sch[3], st),
      bio: pc(g.bio, g.pel), size: g.el > 0 ? Math.log10(g.el) : NaN,
      margin: pc(g.a - g.lu, g.valid), a: pc(g.a, g.valid), lu: pc(g.lu, g.valid), third: pc(g.valid - g.a - g.lu, g.valid),
      turnout: pc(g.comp, g.el), bn: pc(g.blank + g.nul, g.comp)
    };
  }
  function loadYear(yr) {
    const raw = P.years[yr], meta = P.meta.y[yr], cands = meta.cands;
    const sc = ['el', 'comp', 'valid', 'blank', 'nul', 'pel', 'bio'].concat(cands.map(c => c.key));
    const U = {}; for (const k of sc) U[k] = unpack(raw[k], N);
    const CM = unpack(raw.cm, N * 2 * A * KM), CS = unpack(raw.cs, N * 2 * A * KS);
    const add = (g, i) => {
      for (const k of sc) g[k] += U[k][i];
      let o = i * 2 * A * KM; for (let j = 0; j < 2 * A * KM; j++) g.cm[j] += CM[o + j];
      o = i * 2 * A * KS; for (let j = 0; j < 2 * A * KS; j++) g.cs[j] += CS[o + j];
      g.n++;
    };
    const F = {}; for (const k of YKEYS) F[k] = new Float32Array(N);
    const BR = newAgg(sc), STATE = D.ufs.map(() => newAgg(sc));
    for (let i = 0; i < N; i++) {
      const g = newAgg(sc); add(g, i);
      const m = metrics(g); for (const k of YKEYS) F[k][i] = U.el[i] > 0 ? m[k] : NaN;
      add(BR, i); add(STATE[UF[i]], i);
    }
    const cand = {}; for (const c of cands) cand[c.key] = c;
    return { yr, meta, cands, cand, sc, U, CM, CS, F, add, BR, BRM: metrics(BR), STATEM: STATE.map(metrics),
      cube: { marital: { c: CM, k: KM }, school: { c: CS, k: KS } } };
  }
  const Y = {}; for (const yr of YEARS) Y[yr] = loadYear(yr);
  const FX = {};
  if (HAS22) {
    FX.swing = new Float32Array(N); FX.dturn = new Float32Array(N);
    for (let i = 0; i < N; i++) { FX.swing[i] = Y['2026'].F.margin[i] - Y['2022'].F.margin[i]; FX.dturn[i] = Y['2026'].F.turnout[i] - Y['2022'].F.turnout[i]; }
  }
  const ORDER = Array.from({ length: N }, (_, i) => i).sort((a, b) => Y['2026'].U.el[b] - Y['2026'].U.el[a]);

  // one domain per measure, pooled over the years, so a colour or an axis position means the same thing everywhere
  const DOM = {};
  for (const k of YKEYS.concat(CHANGE_KEYS)) {
    let vals = []; if (FX[k]) vals = Array.from(FX[k]); else for (const yr of YEARS) vals = vals.concat(Array.from(Y[yr].F[k]));
    vals = vals.filter(isFinite).sort(d3.ascending);
    let lo = d3.quantileSorted(vals, 0.001), hi = d3.quantileSorted(vals, 0.999);
    if (k === 'margin' || FX[k]) { const m = Math.max(Math.abs(lo), Math.abs(hi)); lo = -m; hi = m; }
    DOM[k] = d3.scaleLinear().domain([lo, hi]).nice(6).domain();
  }
  const CHG = {}; for (const k of CHANGE_KEYS) { const v = Array.from(FX[k]).filter(isFinite).map(Math.abs).sort(d3.ascending); CHG[k] = Math.max(5, Math.ceil(d3.quantileSorted(v, 0.97) / 5) * 5); }

  // ---------------------------------------------------------------- state
  const S = { view: 'simple', year: YEARS[0], region: -1, uf: -1, size: 'all', lens: 'margin', x: 'higher', stack: 'marital', mode: 'count', heat: 'marital', pin: -1, sort: 'el', dir: -1, q: '', rows: 25 };
  const cur = () => Y[S.year], other = () => HAS22 ? Y[S.year === '2026' ? '2022' : '2026'] : null;
  const V = key => FX[key] || cur().F[key];
  const short26 = () => Y['2026'].cand.a.short;
  function lens(key) {
    const c = cur().cand.a;
    switch (key) {
      case 'margin': return { label: 'Margem ' + c.short + ' − Lula', unit: 'pontos percentuais dos votos válidos', kind: 'div' };
      case 'a': return { label: 'Votação de ' + c.name, unit: '% dos votos válidos', kind: 'blue' };
      case 'lu': return { label: 'Votação de Lula', unit: '% dos votos válidos', kind: 'red' };
      case 'third': return { label: 'Votação dos outros candidatos', unit: '% dos votos válidos', kind: 'seq' };
      case 'turnout': return { label: 'Comparecimento', unit: '% do eleitorado', kind: 'seq' };
      case 'bn': return { label: 'Brancos e nulos', unit: '% do comparecimento', kind: 'seq' };
      case 'swing': return { label: 'Mudança da margem, 2022 → 2026', unit: 'pontos percentuais', kind: 'div', change: true };
      default: return { label: 'Mudança do comparecimento, 2022 → 2026', unit: 'pontos percentuais', kind: 'alt', change: true };
    }
  }
  const signed = key => key === 'margin' || key === 'swing' || key === 'dturn';
  function fmtLens(key, v, yr) {
    if (!isFinite(v)) return '–';
    const s = (yr ? Y[yr] : cur()).cand.a.short;
    if (key === 'margin') return Math.abs(v) < 0.05 ? 'Empate' : (v > 0 ? s : 'Lula') + ' +' + f1(Math.abs(v));
    if (key === 'swing') return Math.abs(v) < 0.05 ? 'Sem mudança' : '+' + f1(Math.abs(v)) + ' p.p. para ' + (v > 0 ? short26() : 'Lula');
    if (key === 'dturn') return sign(v) + f1(Math.abs(v)) + ' p.p.';
    return f1(v) + '%';
  }
  function cellLens(key, v) {
    if (!isFinite(v)) return '';
    if (key === 'margin' || key === 'swing') return Math.abs(v) < 0.05 ? '0' : (v > 0 ? (key === 'swing' ? short26() : cur().cand.a.short)[0] : 'L') + ' +' + f1(Math.abs(v));
    if (key === 'dturn') return sign(v) + f1(Math.abs(v));
    return f1(v) + '%';
  }
  const fmtFeat = (k, v) => !isFinite(v) ? '–' : k === 'age' ? f1(v) + ' anos' : k === 'size' ? compact(Math.pow(10, v)) : f1(v) + '%';
  const fmtAny = (k, v) => FLABEL[k] ? fmtFeat(k, v) : fmtLens(k, v);

  const SIZES = [['all', 'Todos os portes', 'todos os portes'], ['s', 'Até 10 mil eleitores', 'municípios com até 10 mil eleitores'], ['m', '10 mil a 50 mil eleitores', 'municípios de 10 mil a 50 mil eleitores'],
    ['l', '50 mil a 200 mil eleitores', 'municípios de 50 mil a 200 mil eleitores'], ['xl', 'Mais de 200 mil eleitores', 'municípios com mais de 200 mil eleitores'], ['cap', 'Somente capitais', 'capitais']];
  const sizeOK = i => {
    const e = Y['2026'].U.el[i];
    switch (S.size) { case 's': return e < 1e4; case 'm': return e >= 1e4 && e < 5e4; case 'l': return e >= 5e4 && e < 2e5; case 'xl': return e >= 2e5; case 'cap': return M.cap[i] === 1; default: return true; }
  };
  const MASK = new Uint8Array(N), SIZEMASK = new Uint8Array(N);
  let SEL = {}, SELM = {}, NSEL = N;
  const filtered = () => S.region >= 0 || S.uf >= 0 || S.size !== 'all';
  function recompute() {
    NSEL = 0; for (const yr of YEARS) SEL[yr] = newAgg(Y[yr].sc);
    for (let i = 0; i < N; i++) {
      SIZEMASK[i] = sizeOK(i) ? 1 : 0;
      const ok = SIZEMASK[i] && (S.uf >= 0 ? UF[i] === S.uf : S.region >= 0 ? UF_REG[UF[i]] === S.region : true);
      MASK[i] = ok ? 1 : 0;
      if (ok) { NSEL++; for (const yr of YEARS) Y[yr].add(SEL[yr], i); }
    }
    for (const yr of YEARS) SELM[yr] = metrics(SEL[yr]);
  }
  function selName() {
    const place = S.uf >= 0 ? D.uf_name[S.uf] : S.region >= 0 ? REG_NAME[S.region] : 'Brasil';
    return S.size === 'all' ? place : place + ', ' + SIZES.find(s => s[0] === S.size)[2];
  }

  // ---------------------------------------------------------------- statistics
  function wstats(x, y, mask, within, weights) {
    const w = weights || cur().U.el; let sw = 0, sx = 0, sy = 0, n = 0;
    const gw = new Float64Array(NUF), gx = new Float64Array(NUF), gy = new Float64Array(NUF);
    for (let i = 0; i < N; i++) {
      if (!mask[i] || !isFinite(x[i]) || !isFinite(y[i])) continue;
      const wi = w[i]; sw += wi; sx += wi * x[i]; sy += wi * y[i]; n++;
      gw[UF[i]] += wi; gx[UF[i]] += wi * x[i]; gy[UF[i]] += wi * y[i];
    }
    if (n < 3 || !sw) return { r: NaN, slope: NaN, icpt: NaN, n };
    const mx = sx / sw, my = sy / sw; let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < N; i++) {
      if (!mask[i] || !isFinite(x[i]) || !isFinite(y[i])) continue;
      const u = UF[i], dx = x[i] - (within ? gx[u] / gw[u] : mx), dy = y[i] - (within ? gy[u] / gw[u] : my);
      sxx += w[i] * dx * dx; syy += w[i] * dy * dy; sxy += w[i] * dx * dy;
    }
    const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN, slope = sxx > 0 ? sxy / sxx : NaN;
    return { r, slope, icpt: my - slope * mx, n };
  }

  // ---------------------------------------------------------------- colour
  let CSS = {};
  function readTheme() { const cs = getComputedStyle(document.documentElement); CSS = new Proxy({}, { get: (t, k) => t[k] || (t[k] = cs.getPropertyValue(k).trim()) }); }
  const five = (m, names) => d3.scaleLinear().domain([-m, -m * 0.42, 0, m * 0.42, m]).range(names.map(n => CSS[n])).interpolate(d3.interpolateLab).clamp(true);
  const DIV = ['--div-n2', '--div-n1', '--div-0', '--div-p1', '--div-p2'], ALT = ['--alt-n2', '--alt-n1', '--div-0', '--alt-p1', '--alt-p2'];
  function lensScale(key) {
    const kind = lens(key).kind;
    if (kind === 'div') return five(key === 'swing' ? CHG.swing : 60, DIV);
    if (kind === 'alt') return five(CHG[key], ALT);
    const pair = kind === 'blue' ? ['--blue-0', '--blue-1'] : kind === 'red' ? ['--red-0', '--red-1'] : ['--seq-0', '--seq-1'];
    return d3.scaleLinear().domain(DOM[key]).range([CSS[pair[0]], CSS[pair[1]]]).interpolate(d3.interpolateLab).clamp(true);
  }
  function scaleEnds(key, m) {   // labels under a colour bar
    if (key === 'margin') return ['Lula +' + m + ' ou mais', 'empate', cur().cand.a.short + ' +' + m + ' ou mais'];
    if (key === 'swing') return [m + ' p.p. para Lula', 'sem mudança', m + ' p.p. para ' + short26()];
    return ['−' + m + ' p.p.', 'sem mudança', '+' + m + ' p.p.'];
  }
  function drawScale(node, sc, labels) {
    const dom = sc.domain(), lo = dom[0], hi = dom[dom.length - 1], bar = el('div', 'bar'), ticks = el('div', 'ticks');
    bar.style.background = 'linear-gradient(90deg,' + d3.range(0, 1.0001, 0.1).map(t => sc(lo + t * (hi - lo))).join(',') + ')';
    for (const l of labels) ticks.append(el('span', null, l));
    node.replaceChildren(bar, ticks);
  }
  const onColor = bg => d3.lab(bg).l > 62 ? '#10161d' : '#ffffff';

  // ---------------------------------------------------------------- tooltip
  const tip = $('tip');
  function showTip(x, y, title, rows) {
    tip.replaceChildren(el('b', null, title));
    for (const [k, v] of rows) { const d = el('div'); d.append(el('span', null, k), el('span', null, v)); tip.append(d); }
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, x + 14 + r.width > innerWidth ? x - r.width - 14 : x + 14) + 'px';
    tip.style.top = Math.max(8, y + 14 + r.height > innerHeight ? y - r.height - 10 : y + 14) + 'px';
  }
  const hideTip = () => { tip.hidden = true; };
  function bindTip(node, fn) {
    node.addEventListener('pointermove', e => { const t = fn(); showTip(e.clientX, e.clientY, t[0], t[1]); });
    node.addEventListener('pointerleave', hideTip);
    node.addEventListener('focus', () => { const b = node.getBoundingClientRect(), t = fn(); showTip(b.left + b.width / 2, b.bottom, t[0], t[1]); });
    node.addEventListener('blur', hideTip);
  }
  const munTitle = i => M.name[i] + ' · ' + D.ufs[UF[i]];
  function munRows(i, extra) {
    const c = cur(), F = c.F;
    const rows = [['Eleição', c.yr], ['Eleitorado', fInt(c.U.el[i])], ['Comparecimento', fmtLens('turnout', F.turnout[i])], [c.cand.a.name, fmtLens('a', F.a[i])],
      ['Lula', fmtLens('lu', F.lu[i])], ['Margem', fmtLens('margin', F.margin[i])]];
    if (HAS22) rows.push(['Mudança desde 2022', fmtLens('swing', FX.swing[i])]);
    return extra ? rows.concat(extra) : rows;
  }

  // ---------------------------------------------------------------- controls
  function seg(node, options, get, set) {
    node.replaceChildren();
    for (const [value, label] of options) {
      const b = el('button', null, label); b.type = 'button'; b.setAttribute('aria-pressed', String(get() === value));
      b.addEventListener('click', () => { set(value); update(); });
      node.append(b);
    }
  }
  function option(value, label) { const o = el('option', null, label); o.value = value; return o; }
  function renderControls() {
    $('ctl-year').hidden = !HAS22;
    seg($('f-view'), [['simple', 'Leitura rápida'], ['full', 'Explorar os dados']], () => S.view, v => { setView(v, null, true); });
    $('view-simple').hidden = S.view !== 'simple'; $('view-full').hidden = S.view !== 'full'; $('crow-adv').hidden = S.view !== 'full';
    seg($('f-year'), YEARS.map(y => [y, y]), () => S.year, v => { S.year = v; });
    seg($('f-region'), [[-1, 'Todas']].concat(REG_NAME.map((n, i) => [i, n])), () => S.region, v => { S.region = v; if (S.uf >= 0 && UF_REG[S.uf] !== v) S.uf = -1; });
    const uf = $('f-uf'); uf.replaceChildren(option('-1', S.region >= 0 ? 'Todas as UFs: ' + REG_NAME[S.region] : 'Todas as UFs'));
    D.ufs.map((u, i) => i).filter(i => S.region < 0 || UF_REG[i] === S.region).sort((a, b) => D.uf_name[a].localeCompare(D.uf_name[b], 'pt'))
      .forEach(i => uf.append(option(String(i), D.uf_name[i])));
    uf.value = String(S.uf);
    const ls = $('f-lens'); ls.replaceChildren(); for (const k of VOTE_KEYS.concat(CHANGE_KEYS)) ls.append(option(k, lens(k).label));
    $('f-size').value = S.size; ls.value = S.lens; $('f-x').value = S.x;
    seg($('t-stack'), [['marital', 'Estado civil'], ['school', 'Escolaridade']], () => S.stack, v => { S.stack = v; });
    seg($('t-mode'), [['count', 'Eleitores'], ['share', 'Proporções']], () => S.mode, v => { S.mode = v; });
    seg($('t-heat'), [['marital', 'Estado civil'], ['school', 'Escolaridade']], () => S.heat, v => { S.heat = v; });
    $('lede').textContent = 'Quem são os eleitores do Brasil, município por município, e como cada lugar votou para presidente no primeiro turno de 2026' + (HAS22 ? ' e de 2022' : '') +
      '. Um painel para investigar: escolha um recorte, levante uma hipótese e veja se os dados a sustentam.';
  }
  function initControls() {
    for (const [v, l] of SIZES) $('f-size').append(option(v, l));
    for (const [k, l] of FEATS) $('f-x').append(option(k, l));
    $('f-uf').addEventListener('change', e => { S.uf = +e.target.value; if (S.uf >= 0) S.region = UF_REG[S.uf]; update(); });
    $('f-size').addEventListener('change', e => { S.size = e.target.value; update(); });
    $('f-lens').addEventListener('change', e => { S.lens = e.target.value; update(); });
    $('f-x').addEventListener('change', e => { S.x = e.target.value; update(); });
    $('f-reset').addEventListener('click', () => { S.region = -1; S.uf = -1; S.size = 'all'; update(); });
    $('f-q').addEventListener('input', e => { S.q = e.target.value; S.rows = 25; renderTable(); });
    $('tb-more').addEventListener('click', () => { S.rows += 25; renderTable(); });
  }

  // ---------------------------------------------------------------- tally
  function renderTally() {
    const all = !filtered(), tot = c => all ? Object.assign({}, c.meta.national, c.meta.national.cands) : SEL[c.yr];
    const c = cur(), g = tot(c), o = other(), h = o ? tot(o) : null;
    const tiles = $('tiles'); tiles.replaceChildren();
    const tile = (code, value, sub, before) => { const t = el('div', 'tile'); t.append(el('span', 'mono', code), el('b', null, value), el('small', null, sub)); if (o && before) t.append(el('em', null, o.yr + ': ' + before)); tiles.append(t); };
    tile('Eleitorado apto', compact(g.el), 'eleitores aptos', h && compact(h.el));
    tile('Comparecimento', f1(pc(g.comp, g.el)) + '%', compact(g.comp) + ' compareceram', h && f1(pc(h.comp, h.el)) + '%');
    tile('Votos válidos', compact(g.valid), f1(pc(g.valid, g.comp)) + '% do comparecimento', h && compact(h.valid));
    tile('Brancos', f1(pc(g.blank, g.comp)) + '%', compact(g.blank) + ' votos em branco', h && f1(pc(h.blank, h.comp)) + '%');
    tile('Nulos', f1(pc(g.nul, g.comp)) + '%', compact(g.nul) + ' votos nulos', h && f1(pc(h.nul, h.comp)) + '%');
    tiles.append(el('div', 'scope', 'Eleição de ' + c.yr + ' · ' + (all
      ? 'Brasil inteiro, incluindo ' + fInt(c.meta.abroad.el) + ' eleitores no exterior. As figuras abaixo cobrem os ' + fInt(N) + ' municípios.'
      : selName() + ' · ' + fInt(NSEL) + ' municípios')));
    const box = $('cands'); box.replaceChildren();
    const votes = c.cands.map(k => [k.key, k.name, g[k.key], k.party]);
    votes.sort((p, q) => q[2] - p[2]);
    votes.push(['oth', 'Outros candidatos', g.valid - d3.sum(votes, d => d[2]), '']);
    for (const [k, name, v, party] of votes) {
      const share = pc(v, g.valid), row = el('div', 'cand'), nm = el('span', 'nm', name + ' ');
      if (party) nm.append(el('small', null, party));
      const trk = el('span', 'trk'), bar = el('i');
      bar.style.width = Math.min(100, share / 60 * 100) + '%';
      bar.style.background = k === 'a' ? 'var(--blue)' : k === 'lu' ? 'var(--red)' : 'var(--other)';
      const half = el('u'); half.style.left = (50 / 60 * 100) + '%';
      trk.append(bar, half);
      row.append(nm, trk, el('span', 'pc', isFinite(share) ? f2(share) + '%' : '–'));
      bindTip(row, () => [name, [['Votos', fInt(v)], ['% dos votos válidos', f2(share) + '%']]]);
      box.append(row);
    }
    box.append(el('p', 'note', 'O traço marca 50%: vence no primeiro turno quem passa dessa marca no total nacional.'));
  }

  // ---------------------------------------------------------------- canvas helpers
  function fit(cv, w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px';
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); return ctx;
  }
  const radius = (e, k) => (0.9 + Math.sqrt(e) / 150) * k;
  function drawDots(ctx, px, py, k, scale, vals, mask, pin) {
    const E = cur().U.el;
    ctx.fillStyle = CSS['--dot-off']; ctx.globalAlpha = 0.55;
    for (const i of ORDER) { if (mask[i] || px[i] !== px[i]) continue; ctx.beginPath(); ctx.arc(px[i], py[i], Math.max(0.8, radius(E[i], k) * 0.7), 0, 6.2832); ctx.fill(); }
    ctx.globalAlpha = 0.88; ctx.lineWidth = 1; ctx.strokeStyle = CSS['--surface'];
    for (const i of ORDER) {
      if (!mask[i] || px[i] !== px[i] || !isFinite(vals[i])) continue;
      const r = radius(E[i], k); ctx.fillStyle = scale(vals[i]); ctx.beginPath(); ctx.arc(px[i], py[i], r, 0, 6.2832); ctx.fill();
      if (r > 3.5) ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (pin >= 0 && px[pin] === px[pin]) {
      ctx.lineWidth = 2.5; ctx.strokeStyle = CSS['--accent']; ctx.beginPath(); ctx.arc(px[pin], py[pin], radius(E[pin], k) + 4, 0, 6.2832); ctx.stroke();
    }
  }
  function hoverLayer(cv, getPts, extra) {
    const pick = e => {
      const pts = getPts(); if (!pts) return -1;
      const b = cv.getBoundingClientRect(), found = pts.tree.find(e.clientX - b.left, e.clientY - b.top, 18);
      return found == null ? -1 : found;
    };
    cv.addEventListener('pointermove', e => { const i = pick(e); if (i < 0) { hideTip(); cv.style.cursor = 'default'; return; } cv.style.cursor = 'pointer'; showTip(e.clientX, e.clientY, munTitle(i), munRows(i, extra ? extra(i) : null)); });
    cv.addEventListener('pointerleave', hideTip);
    cv.addEventListener('click', e => { const i = pick(e); S.pin = i === S.pin ? -1 : i; update(); });
  }
  const tree = (px, py, keep) => d3.quadtree().x(i => px[i]).y(i => py[i]).addAll(Array.from({ length: N }, (_, i) => i).filter(i => px[i] === px[i] && keep(i)));

  // ---------------------------------------------------------------- map
  const RAD = Math.PI / 180, mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2));
  const FULL = { x0: -74.3 * RAD, x1: -34.5 * RAD, y0: mercY(5.6), y1: mercY(-34.1) };
  let MAPPTS = null;
  function mapBounds() {   // zoom to the selected region or state
    if (S.region < 0 && S.uf < 0) return FULL;
    const b = { x0: Infinity, x1: -Infinity, y0: -Infinity, y1: Infinity };
    for (const st of P.states) {
      const u = D.ufs.indexOf(st.uf); if (S.uf >= 0 ? u !== S.uf : UF_REG[u] !== S.region) continue;
      for (const ring of st.rings) for (const p of ring) { const x = p[0] * RAD, y = mercY(p[1]); if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y > b.y0) b.y0 = y; if (y < b.y1) b.y1 = y; }
    }
    return b;
  }
  function drawMap(cv, key) {
    const w = cv.parentElement.clientWidth; if (!w) return null;
    const ratio = (FULL.y0 - FULL.y1) / (FULL.x1 - FULL.x0), h = Math.min(w * ratio, 620), b = mapBounds();
    const base = Math.min(w / (FULL.x1 - FULL.x0), h / (FULL.y0 - FULL.y1));
    const scale = Math.min(base * 9, Math.min(w / (b.x1 - b.x0), h / (b.y0 - b.y1)) * (b === FULL ? 1 : 0.9)), zoom = scale / base;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const X = lon => w / 2 + (lon * RAD - cx) * scale, Yp = lat => h / 2 - (mercY(lat) - cy) * scale;
    const ctx = fit(cv, w, h);
    ctx.lineJoin = 'round'; ctx.lineWidth = 1;
    for (const st of P.states) {
      const u = D.ufs.indexOf(st.uf), on = S.uf >= 0 ? u === S.uf : S.region >= 0 ? UF_REG[u] === S.region : true;
      ctx.fillStyle = on ? CSS['--surface-2'] : CSS['--surface']; ctx.strokeStyle = CSS['--axis'];
      ctx.beginPath();
      for (const ring of st.rings) { ring.forEach((p, j) => j ? ctx.lineTo(X(p[0]), Yp(p[1])) : ctx.moveTo(X(p[0]), Yp(p[1]))); ctx.closePath(); }
      ctx.fill(); ctx.stroke();
    }
    const px = new Float32Array(N), py = new Float32Array(N);
    for (let i = 0; i < N; i++) { px[i] = X(M.lon[i]); py[i] = Yp(M.lat[i]); }
    const k = Math.max(0.55, Math.min(1.25, w / 520)) * Math.min(2.4, Math.sqrt(zoom));
    drawDots(ctx, px, py, k, lensScale(key), V(key), MASK, S.pin);
    return { tree: tree(px, py, () => true) };
  }
  function renderMap() {
    MAPPTS = drawMap($('cv-map'), S.lens);
    const L = lens(S.lens), sc = lensScale(S.lens);
    $('map-title').textContent = L.label + ' por município' + (L.change ? '' : ' · ' + S.year);
    $('map-count').textContent = (NSEL === N ? fInt(N) : fInt(NSEL) + ' de ' + fInt(N)) + ' municípios · pontos maiores = mais eleitores';
    drawScale($('map-scale'), sc, L.kind === 'div' || L.kind === 'alt' ? scaleEnds(S.lens, S.lens === 'margin' ? 60 : CHG[S.lens]) : [f1(DOM[S.lens][0]) + '%', L.unit, f1(DOM[S.lens][1]) + '%']);
  }

  // ---------------------------------------------------------------- regional rows
  function tugRow(label, sub, a, b, on, go, tipRows) {
    const o = 100 - a - b, btn = el('button', 'tug'); btn.type = 'button'; if (on) btn.setAttribute('aria-current', 'true');
    const lab = el('span', 'lab', label); lab.append(el('small', null, sub));
    const trk = el('span', 'trk');
    if (isFinite(a)) [[a, 'var(--blue)'], [o, 'var(--other)'], [b, 'var(--red)']].forEach(([v, c]) => { const s = el('i'); s.style.flex = v + ' 0 0'; s.style.background = c; trk.append(s); });
    btn.append(lab, el('span', 'v', isFinite(a) ? f1(a) : '–'), trk, el('span', 'v r', isFinite(b) ? f1(b) : '–'));
    if (go) btn.addEventListener('click', () => { go(); update(); }); else { btn.classList.add('plain'); btn.tabIndex = -1; }
    bindTip(btn, tipRows);
    return btn;
  }
  function breakdown() {   // the selection's total first, then its regions or states, strongest margin first
    const U = cur().U, zoom = S.region >= 0;
    const light = keep => { const g = { el: 0, valid: 0, a: 0, lu: 0, n: 0 }; for (let i = 0; i < N; i++) if (SIZEMASK[i] && keep(i)) { g.el += U.el[i]; g.valid += U.valid[i]; g.a += U.a[i]; g.lu += U.lu[i]; g.n++; } return g; };
    const rows = [];
    if (zoom) {
      rows.push({ label: REG_NAME[S.region], g: light(i => UF_REG[UF[i]] === S.region), on: S.uf < 0, go: () => { S.uf = -1; } });
      D.ufs.forEach((u, ui) => { if (UF_REG[ui] === S.region) rows.push({ label: D.uf_name[ui], g: light(i => UF[i] === ui), on: S.uf === ui, go: () => { S.uf = ui; } }); });
    } else {
      rows.push({ label: 'Brasil', g: light(() => true), on: true, go: () => { S.region = -1; S.uf = -1; } });
      REG_NAME.forEach((n, r) => rows.push({ label: n, g: light(i => UF_REG[UF[i]] === r), on: false, go: () => { S.region = r; S.uf = -1; } }));
    }
    const head = rows.shift(); rows.sort((p, q) => pc(q.g.a - q.g.lu, q.g.valid) - pc(p.g.a - p.g.lu, p.g.valid)); rows.unshift(head);
    return { zoom, rows };
  }
  function renderTug() {
    const c = cur(), bd = breakdown(), zoom = bd.zoom, rows = bd.rows, node = $('tug'); node.replaceChildren();
    $('tug-title').textContent = (zoom ? 'UFs da região ' + REG_NAME[S.region] : 'Por região') + ' · ' + c.yr;
    const key = $('tug-key'); key.replaceChildren();
    [[c.cand.a.name, 'var(--blue)'], ['Outros', 'var(--other)'], ['Lula', 'var(--red)']].forEach(([t, col]) => { const s = el('span'), i = el('i'); i.style.background = col; s.append(i, document.createTextNode(t)); key.append(s); });
    for (const r of rows) {
      const g = r.g, a = pc(g.a, g.valid), b = pc(g.lu, g.valid);
      node.append(tugRow(r.label, g.n ? compact(g.el) + ' eleitores' : 'sem municípios', a, b, r.on, r.go,
        () => [r.label, [[c.cand.a.name, f1(a) + '%'], ['Lula', f1(b) + '%'], ['Outros', f1(100 - a - b) + '%'], ['Margem', fmtLens('margin', a - b)], ['Municípios', fInt(g.n)]]]));
    }
    node.append(el('p', 'note', '% dos votos válidos; a linha central marca 50%.' + (S.size !== 'all' ? ' Apenas ' + SIZES.find(s => s[0] === S.size)[2] + '.' : '')));
  }
  function renderBig() {
    const c = cur(), node = $('big'), top = []; for (const i of ORDER) { if (MASK[i]) top.push(i); if (top.length === 6) break; }
    node.replaceChildren(el('h3', null, 'Maiores municípios · ' + selName()));
    const rows = el('div', 'rows');
    for (const i of top) rows.append(tugRow(M.name[i], D.ufs[UF[i]] + ' · ' + compact(c.U.el[i]) + ' eleitores', c.F.a[i], c.F.lu[i], S.pin === i, () => { S.pin = S.pin === i ? -1 : i; }, () => [munTitle(i), munRows(i)]));
    node.append(rows);
  }
  function renderPin() {
    const node = $('pin'); node.hidden = S.pin < 0; if (S.pin < 0) return;
    const i = S.pin, c = cur(), F = c.F, top = el('div', 'top'), un = el('button', 'link', 'Desafixar'); un.type = 'button';
    un.addEventListener('click', () => { S.pin = -1; update(); });
    top.append(el('h3', null, munTitle(i) + ' · ' + c.yr), un);
    const dl = el('dl'), items = [['Eleitorado', fInt(c.U.el[i])], ['Comparecimento', fmtLens('turnout', F.turnout[i])], [c.cand.a.name, fmtLens('a', F.a[i])], ['Lula', fmtLens('lu', F.lu[i])],
      ['Margem', fmtLens('margin', F.margin[i])], ['Mulheres', fmtFeat('women', F.women[i])], ['Idade média', fmtFeat('age', F.age[i])], ['Casados', fmtFeat('married', F.married[i])],
      ['Ensino superior', fmtFeat('higher', F.higher[i])]];
    if (HAS22) items.splice(5, 0, ['Margem em ' + other().yr, fmtLens('margin', other().F.margin[i], other().yr)], ['Mudança da margem', fmtLens('swing', FX.swing[i])]);
    items.forEach(([k, v]) => { const d = el('div'); d.append(el('dt', null, k), el('dd', null, v)); dl.append(d); });
    node.replaceChildren(top, dl);
  }

  // ---------------------------------------------------------------- pyramid
  function renderPyramid() {
    const box = $('pyr'), W = box.clientWidth; if (!W) return;
    const info = S.stack === 'marital' ? MARITAL : SCHOOL, K = S.stack === 'marital' ? KM : KS, g = S.stack === 'marital' ? SEL[S.year].cm : SEL[S.year].cs;
    const key = $('pyr-key'); key.replaceChildren();
    info.labels.forEach((l, k) => { const s = el('span'), sw = el('i'); sw.style.background = 'var(--stack-' + (k + 1) + ')'; s.append(sw, document.createTextNode(l)); key.append(s); });
    $('pyr-title').textContent = 'Eleitores por sexo, idade e ' + info.name + ' · ' + selName() + ' · ' + S.year;
    const gut = 52, rowH = 19, gap = 4, top = 22, bottom = 26, side = 18, half = (W - gut) / 2, H = top + A * (rowH + gap) + bottom;
    const tot = [new Float64Array(A), new Float64Array(A)]; let grand = 0;
    for (let s = 0; s < 2; s++) for (let a = 0; a < A; a++) for (let k = 0; k < K; k++) { tot[s][a] += g[(s * A + a) * K + k]; grand += g[(s * A + a) * K + k]; }
    const max = S.mode === 'share' ? 1 : Math.max(1, d3.max(tot[0]), d3.max(tot[1]));
    const sc = d3.scaleLinear().domain([0, max]).range([0, half - side]); if (S.mode !== 'share') sc.nice(4);
    const root = svg('svg', { width: W, height: H, role: 'img', 'aria-label': 'Pirâmide etária do eleitorado' });
    const text = (x, y, t, anchor, cls) => { const n = svg('text', { x, y, 'text-anchor': anchor || 'middle', 'font-size': 11.5, fill: cls === 'ink' ? CSS['--ink'] : CSS['--muted'] }); n.textContent = t; root.append(n); return n; };
    const sexTot = [d3.sum(tot[0]), d3.sum(tot[1])];
    text(half - 6, 13, 'Mulheres · ' + compact(sexTot[0]) + ' (' + f1(pc(sexTot[0], grand)) + '%)', 'end', 'ink');
    text(half + gut + 6, 13, 'Homens · ' + compact(sexTot[1]) + ' (' + f1(pc(sexTot[1], grand)) + '%)', 'start', 'ink');
    for (const t of sc.ticks(S.mode === 'share' ? 2 : 4)) {
      for (const dir of [-1, 1]) {
        const x = dir < 0 ? half - sc(t) : half + gut + sc(t);
        root.append(svg('line', { x1: x, x2: x, y1: top, y2: H - bottom + 2, stroke: CSS['--grid'], 'stroke-width': 1 }));
        text(x, H - 8, S.mode === 'share' ? Math.round(t * 100) + '%' : tickFmt(t), 'middle');
      }
    }
    for (let a = 0; a < A; a++) {
      const y = top + (A - 1 - a) * (rowH + gap);
      text(half + gut / 2, y + rowH / 2 + 4, D.age[a], 'middle', 'ink');
      for (let s = 0; s < 2; s++) {
        let acc = 0;
        for (let k = 0; k < K; k++) {
          const v = g[(s * A + a) * K + k], denom = S.mode === 'share' ? (tot[s][a] || 1) : 1, x0 = sc(acc / denom), x1 = sc((acc + v) / denom); acc += v;
          const wseg = x1 - x0; if (wseg < 0.4) continue;
          const draw = Math.max(0.6, wseg - (wseg > 3 ? 2 : 0)), x = s === 0 ? half - x1 + (wseg - draw) : half + gut + x0;
          const rect = svg('rect', { x, y, width: draw, height: rowH, rx: 1.5, fill: CSS['--stack-' + (k + 1)], tabindex: -1 });
          bindTip(rect, () => [SEX[s] + ' de ' + ageText(a) + ' · ' + info.labels[k], [['Eleitores', fInt(v)], ['% ' + (s ? 'dos homens' : 'das mulheres') + ' desta idade', f1(pc(v, tot[s][a])) + '%'], ['% dos eleitores da seleção', f2(pc(v, grand)) + '%']]]);
          root.append(rect);
        }
      }
    }
    box.replaceChildren(root);
  }

  // ---------------------------------------------------------------- comparison strips
  const STRIPS = ['women', 'age', 'young', 'old', 'single', 'married', 'divsep', 'widowed', 'noschool', 'higher', 'turnout', 'a', 'lu'];
  const SLABEL = k => k === 'age' ? 'Idade média' : k === 'a' ? 'Votação de ' + cur().cand.a.short : FLABEL[k] || lens(k).label;
  function renderStrips() {
    const c = cur(), o = other(), node = $('strips'); node.replaceChildren();
    const key = $('strip-key'); key.replaceChildren();
    const item = (cls, text, style) => { const s = el('span'), i = el('i', cls); if (style) i.style.cssText = style; s.append(i, document.createTextNode(text)); key.append(s); };
    item('ring', 'Seleção atual', 'border-color:var(--accent)'); item('tick', 'Brasil'); item('dot', 'UFs da seleção'); item('dot', 'Outras UFs', 'background:var(--dot-off)');
    if (o) item('dia', 'Mesma seleção em ' + o.yr);
    for (const k of STRIPS) {
      const vals = c.STATEM.map(m => m[k]), pool = vals.concat([c.BRM[k], SELM[c.yr][k]]).concat(o ? [SELM[o.yr][k]] : []).filter(isFinite);
      const ext = d3.extent(pool), pad = (ext[1] - ext[0]) * 0.07 || 1;
      const sc = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).range([0, 100]).clamp(true);
      const row = el('div', 'strip'), trk = el('div', 'trk');
      vals.forEach((v, u) => {
        const dot = el('b', (S.uf >= 0 ? u === S.uf : S.region >= 0 ? UF_REG[u] === S.region : true) ? 'in' : ''); dot.style.left = sc(v) + '%'; dot.tabIndex = 0; dot.setAttribute('role', 'button'); dot.setAttribute('aria-label', D.uf_name[u] + ' ' + fmtAny(k, v));
        bindTip(dot, () => [D.uf_name[u] + ' · ' + c.yr, [[SLABEL(k), fmtAny(k, v)], ['Brasil', fmtAny(k, c.BRM[k])]].concat(o ? [[D.uf_name[u] + ' em ' + o.yr, FLABEL[k] ? fmtFeat(k, o.STATEM[u][k]) : fmtLens(k, o.STATEM[u][k], o.yr)]] : [])]);
        const go = () => { S.uf = u; S.region = UF_REG[u]; update(); };
        dot.addEventListener('click', go); dot.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
        trk.append(dot);
      });
      const br = el('u'); br.style.left = sc(c.BRM[k]) + '%'; trk.append(br);
      if (o && isFinite(SELM[o.yr][k])) { const was = el('q'); was.style.left = sc(SELM[o.yr][k]) + '%'; trk.append(was); }
      if (isFinite(SELM[c.yr][k])) { const me = el('s'); me.style.left = sc(SELM[c.yr][k]) + '%'; trk.append(me); }
      row.append(el('span', 'lab', SLABEL(k)), trk, el('span', 'val', fmtAny(k, SELM[c.yr][k])));
      node.append(row);
    }
    node.append(el('p', 'note', 'Cada linha tem escala própria. Os pontos das UFs mostram sempre a UF inteira, na eleição de ' + c.yr + '.'));
  }

  // ---------------------------------------------------------------- scatter
  let SCPTS = null;
  function axes(ctx, x, y, w, h, m, xl, yl, yKey, small) {
    ctx.font = (small ? 10 : 11.5) + 'px ' + CSS['--f-body']; ctx.textBaseline = 'middle'; ctx.lineWidth = 1;
    const xt = x.ticks(small ? 3 : 6), yt = y.ticks(small ? 3 : 6), zero = signed(yKey);
    ctx.strokeStyle = CSS['--grid']; ctx.fillStyle = CSS['--muted'];
    for (const t of yt) { const yy = Math.round(y(t)) + 0.5; ctx.beginPath(); ctx.moveTo(m.l, yy); ctx.lineTo(w - m.r, yy); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(zero ? (t > 0 ? '+' : t < 0 ? '−' : '') + Math.abs(t) : String(t), m.l - 6, yy); }
    ctx.textAlign = 'center';
    for (const t of xt) { const xx = Math.round(x(t)) + 0.5; ctx.beginPath(); ctx.moveTo(xx, m.t); ctx.lineTo(xx, h - m.b); ctx.stroke(); ctx.fillText(xl.fmt(t), xx, h - m.b + 12); }
    if (zero) { ctx.strokeStyle = CSS['--axis']; const y0 = Math.round(y(0)) + 0.5; ctx.beginPath(); ctx.moveTo(m.l, y0); ctx.lineTo(w - m.r, y0); ctx.stroke(); }
    if (!small) {
      ctx.fillStyle = CSS['--ink-2']; ctx.textAlign = 'center'; ctx.fillText(xl.title, m.l + (w - m.l - m.r) / 2, h - 9);
      ctx.save(); ctx.translate(11, m.t + (h - m.t - m.b) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yl, 0, 0); ctx.restore();
      const ends = yKey === 'margin' ? [cur().cand.a.short + ' à frente', 'Lula à frente'] : yKey === 'swing' ? ['Rumo a ' + short26(), 'Rumo a Lula'] : yKey === 'dturn' ? ['Comparecimento subiu', 'Comparecimento caiu'] : null;
      if (ends) { ctx.fillStyle = CSS['--muted']; ctx.textAlign = 'left'; ctx.fillText(ends[0], m.l + 6, m.t + 9); ctx.fillText(ends[1], m.l + 6, h - m.b - 9); }
    }
  }
  const xAxisSpec = k => ({ title: FLABEL[k] + ' (' + FUNIT[k] + ')', fmt: t => k === 'size' ? compact(Math.pow(10, t)) : String(t) });
  function plot(cv, w, h, mask, small) {
    const m = small ? { l: 30, r: 6, t: 6, b: 20 } : { l: 48, r: 12, t: 10, b: 44 }, ctx = fit(cv, w, h);
    const xv = cur().F[S.x], yv = V(S.lens), L = lens(S.lens);
    const x = d3.scaleLinear().domain(DOM[S.x]).range([m.l, w - m.r]).clamp(true), y = d3.scaleLinear().domain(DOM[S.lens]).range([h - m.b, m.t]).clamp(true);
    axes(ctx, x, y, w, h, m, xAxisSpec(S.x), L.label + ' (' + L.unit + ')', S.lens, small);
    const px = new Float32Array(N).fill(NaN), py = new Float32Array(N).fill(NaN);
    for (let i = 0; i < N; i++) if (isFinite(xv[i]) && isFinite(yv[i]) && (!small || mask[i])) { px[i] = x(xv[i]); py[i] = y(yv[i]); }
    drawDots(ctx, px, py, small ? 0.5 : Math.max(0.6, Math.min(1.1, w / 600)), lensScale(S.lens), yv, mask, small ? -1 : S.pin);
    const st = wstats(xv, yv, mask, false);
    if (isFinite(st.slope)) {
      const xs = []; for (let i = 0; i < N; i++) if (mask[i] && isFinite(xv[i])) xs.push(xv[i]); xs.sort(d3.ascending);
      const a = Math.max(DOM[S.x][0], d3.quantileSorted(xs, 0.01)), b = Math.min(DOM[S.x][1], d3.quantileSorted(xs, 0.99)), yy = y.copy().clamp(false);
      ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, w - m.l - m.r, h - m.t - m.b); ctx.clip();
      ctx.lineCap = 'round';
      const line = () => { ctx.beginPath(); ctx.moveTo(x(a), yy(st.icpt + st.slope * a)); ctx.lineTo(x(b), yy(st.icpt + st.slope * b)); ctx.stroke(); };
      ctx.strokeStyle = CSS['--surface']; ctx.lineWidth = small ? 4 : 5; line(); ctx.strokeStyle = CSS['--ink']; ctx.lineWidth = 2; line(); ctx.restore();
    }
    return { st, px, py };
  }
  const effect = slope => S.lens === 'margin' ? f2(Math.abs(slope)) + ' p.p. a mais para ' + (slope >= 0 ? cur().cand.a.short : 'Lula')
    : S.lens === 'swing' ? f2(Math.abs(slope)) + ' p.p. a mais rumo a ' + (slope >= 0 ? short26() : 'Lula') : sign(slope) + f2(Math.abs(slope)) + ' p.p.' + ({ a: ' na votação de ' + cur().cand.a.short, lu: ' na votação de Lula', third: ' na votação dos outros candidatos', turnout: ' de comparecimento', bn: ' de brancos e nulos', dturn: ' na mudança do comparecimento' })[S.lens];
  function renderScatter() {
    const cv = $('cv-sc'), w = cv.parentElement.clientWidth; if (!w) return;
    const out = plot(cv, w, Math.round(Math.min(520, Math.max(300, w * 0.82))), MASK, false);
    SCPTS = { tree: tree(out.px, out.py, i => MASK[i] === 1) };
    $('sc-title').textContent = lens(S.lens).label + ' e ' + XPHRASE[S.x] + ' · ' + S.year;
    const st = out.st, wi = wstats(cur().F[S.x], V(S.lens), MASK, true), read = $('sc-read'); read.replaceChildren();
    const add = (label, value) => { const s = el('span', null, label + ' '); s.append(el('b', null, value)); read.append(s); };
    add('Correlação', fmtR(st.r)); if (S.uf < 0) add('Dentro das UFs', fmtR(wi.r));
    if (isFinite(st.slope)) add(S.x === 'size' ? 'Dez vezes mais eleitores acompanham' : S.x === 'age' ? 'Cada ano a mais acompanha' : 'Cada ponto percentual a mais acompanha', effect(st.slope));
    add('Municípios', fInt(st.n));
  }
  function renderMulti() {
    const node = $('multi'); node.replaceChildren();
    REG_NAME.map((name, r) => {
      const fig = el('figure'), cap = el('figcaption'), cv = el('canvas'), mask = new Uint8Array(N);
      for (let i = 0; i < N; i++) mask[i] = SIZEMASK[i] && UF_REG[UF[i]] === r ? 1 : 0;
      fig.tabIndex = 0; fig.setAttribute('role', 'button'); if (S.region === r) fig.setAttribute('aria-current', 'true');
      fig.append(cap, cv); node.append(fig);
      const go = () => { S.region = r; S.uf = -1; update(); };
      fig.addEventListener('click', go); fig.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      return () => { const st = plot(cv, fig.clientWidth - 18, 128, mask, true).st; cap.append(el('b', null, name), el('span', null, 'r ' + fmtR(st.r))); };
    }).forEach(draw => draw());
  }

  // ---------------------------------------------------------------- ranking
  function renderRank() {
    const node = $('rank'), y = V(S.lens), F = cur().F; node.replaceChildren();
    const rows = FEATS.map(([k]) => ({ k, a: wstats(F[k], y, MASK, false).r, w: wstats(F[k], y, MASK, true).r }))
      .sort((p, q) => (isFinite(q.a) ? Math.abs(q.a) : -1) - (isFinite(p.a) ? Math.abs(p.a) : -1));
    const pos = r => (50 + 50 * Math.max(-1, Math.min(1, r))) + '%', showW = S.uf < 0;
    for (const r of rows) {
      const btn = el('button', 'rank'); btn.type = 'button'; if (r.k === S.x) btn.setAttribute('aria-current', 'true');
      const trk = el('span', 'trk');
      if (isFinite(r.a)) {
        if (showW && isFinite(r.w)) { const link = el('em'); link.style.left = pos(Math.min(r.a, r.w)); link.style.width = (50 * Math.abs(r.a - r.w)) + '%'; trk.append(link); const ring = el('i', 'w'); ring.style.left = pos(r.w); trk.append(ring); }
        const dot = el('i'); dot.style.left = pos(r.a); trk.append(dot);
      }
      btn.append(el('span', 'lab', FLABEL[r.k]), trk, el('span', 'num', fmtR(r.a) + (showW ? ' · ' + fmtR(r.w) : '')));
      btn.addEventListener('click', () => { S.x = r.k; update(); });
      bindTip(btn, () => [FLABEL[r.k], [['Correlação na seleção', fmtR(r.a)]].concat(showW ? [['Dentro das UFs', fmtR(r.w)]] : [])]);
      node.append(btn);
    }
    const a = cur().cand.a.short;
    if (S.lens === 'margin') node.append(el('p', 'note', 'Positivo: mais da característica acompanha margem maior de ' + a + '. Negativo: margem maior de Lula.'));
    if (S.lens === 'swing') node.append(el('p', 'note', 'Positivo: onde há mais da característica, a margem se moveu mais na direção de ' + short26() + ' entre 2022 e 2026. Negativo: na direção de Lula.'));
  }

  // ---------------------------------------------------------------- joint model
  const MODEL = ['women', 'young', 'old', 'married', 'divsep', 'widowed', 'noschool', 'higher', 'size'];
  function fitModel(keys, yv, mask) {
    const p = keys.length, w = cur().U.el, F = cur().F, rows = [];
    for (let i = 0; i < N; i++) if (mask[i] && isFinite(yv[i]) && keys.every(k => isFinite(F[k][i]))) rows.push(i);
    if (rows.length < 40) return null;
    const gw = new Float64Array(NUF), gm = Array.from({ length: p + 1 }, () => new Float64Array(NUF));
    for (const i of rows) { const u = UF[i]; gw[u] += w[i]; for (let j = 0; j < p; j++) gm[j][u] += w[i] * F[keys[j]][i]; gm[p][u] += w[i] * yv[i]; }
    const Z = rows.map(i => { const u = UF[i], z = new Float64Array(p + 1); for (let j = 0; j < p; j++) z[j] = F[keys[j]][i] - gm[j][u] / gw[u]; z[p] = yv[i] - gm[p][u] / gw[u]; return z; });
    const sd = new Float64Array(p + 1); let sw = 0;
    rows.forEach((i, r) => { sw += w[i]; for (let j = 0; j <= p; j++) sd[j] += w[i] * Z[r][j] * Z[r][j]; });
    for (let j = 0; j <= p; j++) sd[j] = Math.sqrt(sd[j] / sw);
    if (!(sd[p] > 0) || Array.from(sd.slice(0, p)).some(v => !(v > 0))) return null;
    const Am = Array.from({ length: p }, () => new Float64Array(p + 1));
    rows.forEach((i, r) => { for (let a = 0; a < p; a++) { const za = Z[r][a] / sd[a]; for (let b = 0; b < p; b++) Am[a][b] += w[i] * za * Z[r][b] / sd[b]; Am[a][p] += w[i] * za * Z[r][p] / sd[p]; } });
    for (let c = 0; c < p; c++) {   // Gauss-Jordan with partial pivoting
      let piv = c; for (let r = c + 1; r < p; r++) if (Math.abs(Am[r][c]) > Math.abs(Am[piv][c])) piv = r;
      if (Math.abs(Am[piv][c]) < 1e-9) return null;
      [Am[c], Am[piv]] = [Am[piv], Am[c]];
      for (let r = 0; r < p; r++) if (r !== c) { const f = Am[r][c] / Am[c][c]; for (let k = c; k <= p; k++) Am[r][k] -= f * Am[c][k]; }
    }
    const beta = Am.map((row, j) => row[p] / row[j]); let ssr = 0;
    rows.forEach((i, r) => { let fitv = 0; for (let j = 0; j < p; j++) fitv += beta[j] * Z[r][j] / sd[j]; const e = Z[r][p] / sd[p] - fitv; ssr += w[i] * e * e; });
    return { beta, raw: beta.map((b, j) => b * sd[p] / sd[j]), r2: 1 - ssr / sw, n: rows.length };
  }
  function renderModel() {
    const node = $('model'), note = $('model-note'); node.replaceChildren(); note.replaceChildren();
    $('model-title').textContent = 'Mantendo as demais características constantes · ' + selName() + ' · ' + S.year;
    const m = fitModel(MODEL, V(S.lens), MASK), partisan = S.lens === 'margin' || S.lens === 'swing';
    if (!m) { $('model-fit').textContent = ''; node.append(el('p', 'note', 'Há poucos municípios nesta seleção para ajustar o modelo.')); return; }
    $('model-fit').textContent = 'explica ' + Math.round(m.r2 * 100) + '% da variação ' + (S.uf < 0 ? 'dentro das UFs' : 'na UF') + ' · ' + fInt(m.n) + ' municípios';
    const max = Math.max(0.3, d3.max(m.beta, Math.abs));
    MODEL.map((k, j) => ({ k, b: m.beta[j], raw: m.raw[j] })).sort((a, b) => Math.abs(b.b) - Math.abs(a.b)).forEach(r => {
      const row = el('div', 'coef'), trk = el('span', 'trk'), bar = el('i', r.b >= 0 ? 'pos' : 'neg'), wd = 50 * Math.abs(r.b) / max;
      bar.style.width = wd + '%'; bar.style.left = (r.b >= 0 ? 50 : 50 - wd) + '%';
      if (partisan) bar.style.background = r.b >= 0 ? 'var(--blue)' : 'var(--red)';
      trk.append(bar);
      const per = r.k === 'size' ? 'por 10× eleitores' : 'por ponto', value = sign(r.raw) + f2(Math.abs(r.raw)) + ' p.p. ' + per;
      row.append(el('span', 'lab', FLABEL[r.k]), trk, el('span', 'num', value));
      row.tabIndex = 0;
      bindTip(row, () => [FLABEL[r.k], [['Coeficiente padronizado', fmtR(r.b)], ['Na unidade original', value]]]);
      node.append(row);
    });
    const who = S.lens === 'swing' ? short26() : cur().cand.a.short;
    note.append(
      el('p', null, 'Uma única regressão ponderada com as nove características ao mesmo tempo, comparando cada município apenas com os da mesma UF. O comprimento da barra é o coeficiente padronizado, o que permite comparar características medidas em escalas diferentes.'),
      el('p', null, S.lens === 'margin' ? 'Barras azuis: mais da característica acompanha margem maior de ' + who + ', com o resto igual. Barras vermelhas: margem maior de Lula.'
        : S.lens === 'swing' ? 'Barras azuis: mais da característica acompanha um movimento maior rumo a ' + who + ' desde 2022, com o resto igual. Barras vermelhas: rumo a Lula.'
          : 'Barras para a direita: mais da característica acompanha um valor mais alto, com o resto igual.'),
      el('p', null, 'Ficam de fora, de propósito, os solteiros e as faixas intermediárias de idade e escolaridade: são a referência contra a qual cada proporção é lida.'));
  }

  // ---------------------------------------------------------------- exposure grid
  function renderHeat() {
    const info = S.heat === 'marital' ? MARITAL : SCHOOL, cube = cur().cube[S.heat], K = cube.k, C = cube.c, y = V(S.lens), L = lens(S.lens);
    const num = new Float64Array(2 * A * K), den = new Float64Array(2 * A * K); let tot = 0, totNum = 0;
    for (let i = 0; i < N; i++) {
      if (!MASK[i] || !isFinite(y[i])) continue;
      const o = i * 2 * A * K; for (let j = 0; j < 2 * A * K; j++) { const v = C[o + j]; if (v) { num[j] += v * y[i]; den[j] += v; tot += v; totNum += v * y[i]; } }
    }
    const node = $('heat'); node.replaceChildren(); let best = null;
    // group averages sit in a much narrower band than single municipalities, so the grid gets its own scale
    const solid = []; for (let j = 0; j < 2 * A * K; j++) if (den[j] / tot >= 0.002) solid.push(num[j] / den[j]);
    let sc, legend;
    if (L.kind === 'div' || L.kind === 'alt') {
      const m = Math.max(2, Math.ceil(d3.max(solid, Math.abs) || 2));
      sc = five(m, L.kind === 'div' ? DIV : ALT); legend = scaleEnds(S.lens, m).map(t => t.replace(' ou mais', ''));
    } else {
      const lo = Math.floor(d3.min(solid) || 0), hi = Math.max(lo + 1, Math.ceil(d3.max(solid) || 1));
      sc = lensScale(S.lens).copy().domain([lo, hi]); legend = [lo + '%', L.unit, hi + '%'];
    }
    drawScale($('heat-scale'), sc, legend);
    const overall = tot ? totNum / tot : NaN;
    for (let s = 0; s < 2; s++) {
      const wrap = el('div', 'scroll'), tb = el('table'), hr = el('tr'); hr.append(el('th', 'age', SEX[s]));
      for (const l of info.labels) hr.append(el('th', null, l));
      const head = el('thead'); head.append(hr); const body = el('tbody');
      for (let a = A - 1; a >= 0; a--) {
        const tr = el('tr'); tr.append(el('th', 'age', D.age[a]));
        for (let k = 0; k < K; k++) {
          const j = (s * A + a) * K + k, v = den[j] ? num[j] / den[j] : NaN, share = pc(den[j], tot), td = el('td', share < 0.2 ? 'thin' : '', cellLens(S.lens, v));
          if (isFinite(v)) { const bg = sc(v); td.style.background = bg; td.style.color = onColor(bg); td.tabIndex = 0; }
          bindTip(td, () => [SEX[s] + ' de ' + ageText(a) + ' · ' + info.labels[k], [['Eleitores', fInt(den[j])], ['% da seleção', f2(share) + '%'], ['Média dos municípios do grupo', fmtLens(S.lens, v)]]]);
          if (share >= 1 && isFinite(v) && (!best || Math.abs(v - overall) > Math.abs(best.v - overall))) best = { v, text: groupText(S.heat, s, a, k) };
          tr.append(td);
        }
        body.append(tr);
      }
      tb.append(head, body); wrap.append(tb); node.append(wrap);
    }
    $('heat-title').textContent = L.label + ': média dos municípios onde cada grupo está cadastrado · ' + selName() + (L.change ? '' : ' · ' + S.year);
    const a = cur().cand.a.short;
    const phrase = v => S.lens === 'margin' ? (v > 0 ? a : 'Lula') + ' ficou ' + f1(Math.abs(v)) + pts(v) + ' à frente'
      : S.lens === 'swing' ? 'a margem se moveu ' + f1(Math.abs(v)) + pts(v) + ' na direção de ' + (v > 0 ? short26() : 'Lula')
        : S.lens === 'dturn' ? 'o comparecimento ' + (v >= 0 ? 'subiu ' : 'caiu ') + f1(Math.abs(v)) + pts(v)
          : ({ a: 'a votação de ' + cur().cand.a.name, lu: 'a votação de Lula', third: 'a votação dos outros candidatos', turnout: 'o comparecimento', bn: 'a soma de brancos e nulos' })[S.lens] + ' foi de ' + f1(v) + '%';
    $('heat-sub').textContent = 'Para cada grupo, o resultado dos lugares onde seus integrantes estão cadastrados. O eleitor médio desta seleção vive em um município onde ' + phrase(overall) + '.' +
      (best && Math.abs(best.v - overall) >= 0.5 ? ' O grupo mais distante disso: ' + best.text + ', que vivem, em média, onde ' + phrase(best.v) + '.' : '');
  }

  // ---------------------------------------------------------------- table
  const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const FOLDED = M.name.map(fold);
  function renderTable() {
    const c = cur(), F = c.F, a = c.cand.a.short;
    const cols = [['name', 'Município'], ['uf', 'UF'], ['el', 'Eleitores'], ['turnout', 'Comparec.'], ['a', a], ['lu', 'Lula'], ['margin', 'Margem']]
      .concat(HAS22 ? [['swing', 'Δ margem']] : []).concat([['women', 'Mulheres'], ['age', 'Idade média'], ['married', 'Casados'], ['higher', 'Superior']]);
    const q = fold(S.q.trim()), idx = []; for (let i = 0; i < N; i++) if (MASK[i] && (!q || FOLDED[i].includes(q))) idx.push(i);
    const val = S.sort === 'name' ? i => FOLDED[i] : S.sort === 'uf' ? i => D.ufs[UF[i]] : S.sort === 'el' ? i => c.U.el[i] : i => { const v = V(S.sort)[i]; return isFinite(v) ? v : -Infinity; };
    idx.sort((p, r) => { const x = val(p), y = val(r); return (x < y ? -1 : x > y ? 1 : 0) * S.dir || c.U.el[r] - c.U.el[p]; });
    const hr = el('tr');
    for (const [k, l] of cols) {
      const th = el('th'), b = el('button', null, l + (S.sort === k ? (S.dir > 0 ? ' ↑' : ' ↓') : '')); b.type = 'button';
      if (S.sort === k) b.setAttribute('aria-sort', S.dir > 0 ? 'ascending' : 'descending');
      b.addEventListener('click', () => { if (S.sort === k) S.dir = -S.dir; else { S.sort = k; S.dir = k === 'name' || k === 'uf' ? 1 : -1; } renderTable(); });
      th.append(b); hr.append(th);
    }
    $('tb').tHead.replaceChildren(hr);
    const body = $('tb').tBodies[0]; body.replaceChildren();
    const lead = (v, who) => !isFinite(v) ? '–' : Math.abs(v) < 0.05 ? '0' : (v > 0 ? who[0] : 'L') + ' +' + f1(Math.abs(v));
    for (const i of idx.slice(0, S.rows)) {
      const tr = el('tr'), cells = [M.name[i], D.ufs[UF[i]], fInt(c.U.el[i]), fmtLens('turnout', F.turnout[i]), fmtLens('a', F.a[i]), fmtLens('lu', F.lu[i]), lead(F.margin[i], a)]
        .concat(HAS22 ? [lead(FX.swing[i], short26())] : []).concat([fmtFeat('women', F.women[i]), isFinite(F.age[i]) ? f1(F.age[i]) : '–', fmtFeat('married', F.married[i]), fmtFeat('higher', F.higher[i])]);
      cells.forEach(t => tr.append(el('td', null, t)));
      tr.addEventListener('click', () => { S.pin = i; update(); $('map').scrollIntoView({ behavior: 'smooth' }); });
      body.append(tr);
    }
    $('tb-count').textContent = fInt(Math.min(S.rows, idx.length)) + ' de ' + fInt(idx.length) + ' municípios · ' + selName() + ' · ' + c.yr +
      (HAS22 ? ' · Δ margem: mudança desde 2022 (' + short26()[0] + ' ou L indica a direção)' : '');
    $('tb-more').hidden = idx.length <= S.rows;
  }


  // ---------------------------------------------------------------- plain-language view
  const IN_REGION = ['no Norte', 'no Nordeste', 'no Centro-Oeste', 'no Sudeste', 'no Sul'];
  const IN_UF = { AC: 'no Acre', AL: 'em Alagoas', AM: 'no Amazonas', AP: 'no Amapá', BA: 'na Bahia', CE: 'no Ceará', DF: 'no Distrito Federal', ES: 'no Espírito Santo',
    GO: 'em Goiás', MA: 'no Maranhão', MG: 'em Minas Gerais', MS: 'em Mato Grosso do Sul', MT: 'em Mato Grosso', PA: 'no Pará', PB: 'na Paraíba', PE: 'em Pernambuco',
    PI: 'no Piauí', PR: 'no Paraná', RJ: 'no Rio de Janeiro', RN: 'no Rio Grande do Norte', RO: 'em Rondônia', RR: 'em Roraima', RS: 'no Rio Grande do Sul',
    SC: 'em Santa Catarina', SE: 'em Sergipe', SP: 'em São Paulo', TO: 'no Tocantins' };
  const inPlace = () => S.uf >= 0 ? IN_UF[D.ufs[S.uf]] : S.region >= 0 ? IN_REGION[S.region] : 'no Brasil';
  const qty = (v, noun) => v >= 2e6 ? f1(v / 1e6) + ' milhões de ' + noun : v >= 1e6 ? f1(v / 1e6) + ' milhão de ' + noun : v >= 1e3 ? fInt(Math.round(v / 1e3)) + ' mil ' + noun : fInt(Math.round(v)) + ' ' + noun;
  const nPts = v => { const n = Math.round(Math.abs(v)); return n === 1 ? '1 ponto' : n + ' pontos'; };
  function per100(parts) {   // whole numbers that add up to exactly 100
    const tot = d3.sum(parts) || 1, raw = parts.map(p => 100 * p / tot), out = raw.map(Math.floor);
    let left = 100 - d3.sum(out);
    raw.map((r, i) => [r - out[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
    return out;
  }
  const totals = yr => filtered() ? SEL[yr] : Object.assign({}, Y[yr].meta.national, Y[yr].meta.national.cands);
  function card(title, wide) {
    const c = el('section', 'card' + (wide ? ' wide' : '')), txt = el('div', 'txt'), vis = el('div', 'vis');
    txt.append(el('h2', null, title)); c.append(txt); if (!wide) c.append(vis);
    return { node: c, txt, vis: wide ? txt : vis,
      big: t => txt.append(el('p', 'big', t)), p: t => txt.append(el('p', null, t)), how: t => txt.append(el('p', 'how', t)),
      more: (label, anchor, before) => { const b = el('button', 'more', label + ' →'); b.type = 'button'; b.addEventListener('click', () => { if (before) before(); setView('full', anchor); }); txt.append(b); } };
  }
  function keyRow(items) { const k = el('div', 'key'); for (const [text, color] of items) { const s = el('span'), i = el('i'); i.style.background = color; s.append(i, document.createTextNode(text)); k.append(s); } return k; }
  function band(title, parts, labels) {
    const n = per100(parts), wrap = el('div', 'band'), bar = el('div', 'bar');
    wrap.append(el('span', null, title));
    n.forEach((v, i) => { const s = el('i'); s.style.flex = Math.max(v, 0.5) + ' 0 0'; s.style.background = 'var(--stack-' + (i + 1) + ')'; bar.append(s); });
    wrap.append(bar, keyRow(labels.map((l, i) => [l + ': ' + n[i], 'var(--stack-' + (i + 1) + ')'])));
    return { node: wrap, n };
  }
  function halves(key) {   // two groups of municipalities holding the same number of voters each
    const c = cur(), U = c.U, x = c.F[key], idx = [];
    for (let i = 0; i < N; i++) if (MASK[i] && isFinite(x[i]) && U.valid[i] > 0) idx.push(i);
    if (idx.length < 20) return null;
    idx.sort((p, q) => x[p] - x[q]);
    const tot = d3.sum(idx, i => U.el[i]), mk = () => ({ valid: 0, a: 0, lu: 0, n: 0 }), lo = mk(), hi = mk(); let acc = 0, cut = NaN;
    for (const i of idx) { const g = acc < tot / 2 ? lo : hi; if (g === hi && cut !== cut) cut = x[i]; acc += U.el[i]; g.valid += U.valid[i]; g.a += U.a[i]; g.lu += U.lu[i]; g.n++; }
    return { lo, hi, cut };
  }
  const plainRow = (label, sub, g, who) => tugRow(label, sub, pc(g.a, g.valid), pc(g.lu, g.valid), false, null, () => [label, [[who || cur().cand.a.name, f1(pc(g.a, g.valid)) + '%'], ['Lula', f1(pc(g.lu, g.valid)) + '%'], ['Outros', f1(pc(g.valid - g.a - g.lu, g.valid)) + '%']]]);

  function renderSimple() {
    const root = $('view-simple'), c = cur(), a = c.cand.a, g = totals(c.yr), where = inPlace(); root.replaceChildren();
    root.append(el('p', 'lede', 'Um resumo em linguagem simples da eleição de ' + c.yr + ' ' + where + '. Para ver todos os gráficos e números, escolha “Explorar os dados” no alto da página.'));

    // who came first
    const [nA, nO, nL] = per100([g.a, g.valid - g.a - g.lu, g.lu]), margin = pc(g.a - g.lu, g.valid), lead = margin >= 0 ? a.name : 'Lula';
    let k = card('Quem ficou na frente?');
    k.big('De cada 100 votos válidos ' + where + ', ' + nA + ' foram para ' + a.name + ', ' + nL + ' para Lula e ' + nO + ' para os outros candidatos.');
    if (!filtered()) k.p(Math.max(pc(g.a, g.valid), pc(g.lu, g.valid)) > 50 ? lead + ' passou da metade dos votos válidos e venceu no primeiro turno.'
      : 'Para vencer no primeiro turno é preciso ter mais da metade dos votos válidos. Como ninguém chegou lá, a decisão ficou para o segundo turno.');
    else k.p(Math.abs(margin) < 0.5 ? 'Aqui os dois ficaram praticamente empatados.' : lead + ' ficou na frente aqui, com ' + nPts(margin) + ' de vantagem.');
    k.how('Votos válidos são os votos dados a algum candidato. Brancos e nulos não entram nessa conta.');
    k.more('Ver o resultado completo', 'resumo');
    const waffle = el('div', 'waffle'); waffle.setAttribute('role', 'img'); waffle.setAttribute('aria-label', nA + ' quadrados para ' + a.name + ', ' + nO + ' para outros e ' + nL + ' para Lula');
    for (let i = 0; i < 100; i++) { const s = el('i'); s.style.background = i < nA ? 'var(--blue)' : i < nA + nO ? 'var(--other)' : 'var(--red)'; waffle.append(s); }
    k.vis.append(waffle, keyRow([[a.name + ': ' + nA, 'var(--blue)'], ['Outros: ' + nO, 'var(--other)'], ['Lula: ' + nL, 'var(--red)']]));
    root.append(k.node);

    // turnout
    const turnout = pc(g.comp, g.el), ten = Math.round(turnout / 10), bn = pc(g.blank + g.nul, g.comp);
    k = card('Quantos foram votar?');
    k.big('De cada 10 eleitores ' + where + ', ' + ten + ' foram votar e ' + (10 - ten) + ' não ' + (10 - ten === 1 ? 'foi' : 'foram') + '.');
    k.p('Foram às urnas ' + qty(g.comp, 'pessoas') + ', de um total de ' + qty(g.el, 'eleitores') + ' (' + Math.round(turnout) + ' de cada 100).');
    k.p('Entre os que foram, ' + Math.round(bn) + ' de cada 100 votaram em branco ou anularam o voto.');
    k.more('Ver o comparecimento em detalhe', 'map', () => { S.lens = 'turnout'; });
    const ppl = el('div', 'people'); ppl.setAttribute('role', 'img'); ppl.setAttribute('aria-label', ten + ' de 10 eleitores foram votar');
    for (let i = 0; i < 10; i++) {
      const s = svg('svg', { viewBox: '0 0 30 52', 'aria-hidden': 'true' }), fill = i < ten ? CSS['--accent'] : CSS['--dot-off'];
      s.append(svg('circle', { cx: 15, cy: 9, r: 8, fill }), svg('path', { d: 'M3 50V30a12 12 0 0 1 24 0v20z', fill })); ppl.append(s);
    }
    k.vis.append(ppl, keyRow([['Foram votar', 'var(--accent)'], ['Não foram', 'var(--dot-off)']]));
    root.append(k.node);

    // where each one was stronger
    const bd = breakdown(), parts = bd.rows.slice(1), wonA = parts.filter(r => r.g.a > r.g.lu).map(r => r.label), wonL = parts.filter(r => r.g.lu > r.g.a).map(r => r.label);
    const list = names => names.length > 1 ? names.slice(0, -1).join(', ') + ' e ' + names[names.length - 1] : names[0];
    let mA = 0, mL = 0, eA = 0, eL = 0, eT = 0;
    for (let i = 0; i < N; i++) if (MASK[i] && c.U.valid[i] > 0) { eT += c.U.el[i]; if (c.U.a[i] > c.U.lu[i]) { mA++; eA += c.U.el[i]; } else if (c.U.lu[i] > c.U.a[i]) { mL++; eL += c.U.el[i]; } }
    k = card('Onde cada um foi mais forte?');
    if (S.uf < 0) {
      const masc = S.region >= 0 && S.region !== 2, unit = S.region < 0 ? '5 regiões' : S.region === 2 ? '4 unidades da região (3 estados e o Distrito Federal)' : parts.length + ' estados da região';
      k.big(wonA.length && wonL.length ? a.short + ' ficou na frente em ' + wonA.length + (masc ? ' dos ' : ' das ') + unit + '; Lula, em ' + wonL.length + '.'
        : (wonA.length ? a.short : 'Lula') + ' ficou na frente ' + (masc ? 'nos ' : 'nas ') + unit + '.');
      if (wonA.length) k.p(a.short + ' na frente: ' + list(wonA) + '.');
      if (wonL.length) k.p('Lula na frente: ' + list(wonL) + '.');
    } else k.big(a.short + ' teve mais votos que Lula em ' + fInt(mA) + ' municípios ' + where + '; Lula teve mais em ' + fInt(mL) + '.');
    k.p((S.uf < 0 ? a.short + ' teve mais votos que Lula em ' + fInt(mA) + ' municípios, e Lula em ' + fInt(mL) + '. ' : '') +
      'Mas município grande pesa mais que município pequeno: nos lugares onde ' + a.short + ' ficou na frente vivem ' + Math.round(pc(eA, eT)) + ' de cada 100 eleitores; onde Lula ficou na frente, ' + Math.round(pc(eL, eT)) + '.');
    k.how('No mapa, cada bolinha é um município e as maiores têm mais eleitores. Azul: ' + a.short + ' na frente. Vermelho: Lula na frente. Quanto mais forte a cor, maior a vantagem.');
    k.more('Explorar o mapa', 'map', () => { S.lens = 'margin'; });
    const cv = el('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Mapa com um ponto por município'); k.vis.append(cv); root.append(k.node);
    const pts = drawMap(cv, 'margin'); hoverLayer(cv, () => pts);

    // change since 2022
    if (HAS22) {
      const g22 = totals('2022'), g26 = totals('2026'), m22 = pc(g22.a - g22.lu, g22.valid), m26 = pc(g26.a - g26.lu, g26.valid), d = m26 - m22;
      const a22 = Y['2022'].cand.a, a26 = Y['2026'].cand.a, say = (m, cand) => Math.abs(m) < 0.5 ? cand.name + ' e Lula ficaram praticamente empatados' : (m > 0 ? cand.name + ' ficou ' + nPts(m) + ' à frente de Lula' : 'Lula ficou ' + nPts(m) + ' à frente de ' + cand.name);
      let same = 0, n = 0; for (let i = 0; i < N; i++) if (MASK[i] && isFinite(FX.swing[i])) { n++; if (FX.swing[i] * d > 0) same++; }
      k = card('O que mudou desde 2022?', true);
      k.big('Em 2022, ' + say(m22, a22) + ' ' + where + '. Em 2026, ' + say(m26, a26) + '.');
      k.p(Math.abs(d) < 0.5 ? 'Ou seja: a disputa quase não mudou de tamanho.' : 'Ou seja: a disputa se moveu ' + nPts(d) + ' na direção de ' + (d > 0 ? a26.name : 'Lula') + '. Isso aconteceu em ' + Math.round(pc(same, n)) + ' de cada 100 municípios.');
      const rows = el('div', 'rows');
      rows.append(keyRow([[a22.party === a26.party ? 'Candidato do ' + a26.party : a22.name + ' / ' + a26.name, 'var(--blue)'], ['Outros', 'var(--other)'], ['Lula', 'var(--red)']]),
        plainRow('2022', a22.name + ' × Lula', g22, a22.name), plainRow('2026', a26.name + ' × Lula', g26, a26.name));
      k.txt.append(rows);
      k.how('Os números são a parcela dos votos válidos no primeiro turno. Lula concorreu nas duas eleições; o outro candidato mais votado mudou: ' + a22.name + ' em 2022 e ' + a26.name + ' em 2026.');
      k.more('Ver a mudança no mapa', 'map', () => { S.lens = 'swing'; });
      root.append(k.node);
    }

    // who the voters are
    const m = SELM[c.yr], cm = SEL[c.yr].cm, cs = SEL[c.yr].cs, ageG = [0, 0, 0, 0], sexG = [0, 0], schG = [0, 0, 0, 0], grp = a0 => a0 <= 2 ? 0 : a0 <= 6 ? 1 : a0 <= 9 ? 2 : 3;
    for (let s = 0; s < 2; s++) for (let a0 = 0; a0 < A; a0++) { for (let j = 0; j < KM; j++) { const v = cm[(s * A + a0) * KM + j]; sexG[s] += v; ageG[grp(a0)] += v; } for (let j = 0; j < KS; j++) schG[j] += cs[(s * A + a0) * KS + j]; }
    k = card('Quem são os eleitores?');
    const bSex = band('Sexo', sexG, ['Mulheres', 'Homens']), bAge = band('Idade', ageG, ['16 a 24 anos', '25 a 44', '45 a 59', '60 ou mais']), bSch = band('Escolaridade', schG, ['Sem instrução', 'Fundamental', 'Médio', 'Superior']);
    k.big('De cada 100 eleitores ' + where + ', ' + bSex.n[0] + ' são mulheres, ' + bAge.n[3] + ' têm 60 anos ou mais e ' + bSch.n[3] + ' chegaram ao ensino superior.');
    if (filtered()) {
      const br = c.BRM, cmp = [['women', 'mulheres'], ['young', 'eleitores de 16 a 24 anos'], ['old', 'eleitores de 60 anos ou mais'], ['noschool', 'eleitores sem instrução formal'], ['higher', 'eleitores com ensino superior']]
        .map(([key, text]) => ({ text, here: m[key], br: br[key], d: m[key] - br[key] })).sort((p, q) => Math.abs(q.d) - Math.abs(p.d))[0];
      if (Math.abs(cmp.d) >= 1.5) k.p('Em comparação com o Brasil, aqui há ' + (cmp.d > 0 ? 'mais ' : 'menos ') + cmp.text + ': ' + Math.round(cmp.here) + ' de cada 100, contra ' + Math.round(cmp.br) + ' no país.');
    }
    if (HAS22 && c.yr === '2026' && Math.abs(SELM['2026'].old - SELM['2022'].old) >= 1) {
      const o22 = SELM['2022'].old, o26 = SELM['2026'].old;
      k.p('O eleitorado ' + (o26 > o22 ? 'envelheceu' : 'ficou mais jovem') + ' desde 2022: os eleitores de 60 anos ou mais eram ' + Math.round(o22) + ' de cada 100 e agora são ' + Math.round(o26) + '.');
    }
    k.how('Os números vêm do cadastro da Justiça Eleitoral e contam todos os eleitores, inclusive quem não foi votar. A escolaridade é a que a pessoa informou ao tirar o título e pode estar desatualizada.');
    k.more('Ver a pirâmide de idades', 'voters');
    k.vis.append(bSex.node, bAge.node, bSch.node); root.append(k.node);

    // similar places, similar vote
    k = card('Municípios parecidos votam parecido?', true);
    const verdict = el('p', 'big'); k.txt.append(verdict);
    k.p('Para mostrar isso sem fórmulas, dividimos os municípios ' + where + ' em dois grupos com o mesmo número de eleitores e comparamos o voto em cada um.');
    const traits = [['higher', 'Escolaridade', 'com menos eleitores com ensino superior', 'com mais eleitores com ensino superior'],
      ['old', 'Idade', 'com menos eleitores de 60 anos ou mais', 'com mais eleitores de 60 anos ou mais'], ['size', 'Tamanho do município', 'menores', 'maiores']];
    let shown = 0; const moved = [];
    for (const [key, title, less, more] of traits) {
      const h = halves(key); if (!h) continue; shown++;
      const lo = Math.round(pc(h.lo.a, h.lo.valid)), hi = Math.round(pc(h.hi.a, h.hi.valid)), pair = el('div', 'pair');
      if (Math.abs(hi - lo) >= 3) moved.push(title.toLowerCase());
      pair.append(el('h3', null, title), el('p', null, lo === hi ? 'Nos dois grupos, ' + a.short + ' teve cerca de ' + hi + ' de cada 100 votos válidos: aqui o resultado quase não muda entre os dois grupos.'
        : 'Nos municípios ' + more + ', ' + a.short + ' teve ' + hi + ' de cada 100 votos válidos. Nos municípios ' + less + ', teve ' + lo + '.'));
      pair.append(plainRow('Municípios ' + less, fInt(h.lo.n) + ' municípios', h.lo), plainRow('Municípios ' + more, fInt(h.hi.n) + ' municípios', h.hi));
      pair.append(el('p', 'how', key === 'size' ? 'A divisão fica em ' + compact(Math.pow(10, h.cut)) + ' eleitores: metade dos eleitores vive em municípios menores que isso.'
        : 'A divisão fica em ' + f1(h.cut) + '% de eleitores ' + (key === 'higher' ? 'com ensino superior' : 'de 60 anos ou mais') + '.'));
      k.txt.append(pair);
    }
    verdict.textContent = !shown ? 'Nesta seleção não dá para dizer.' : moved.length ? 'Em parte, sim. ' + where[0].toUpperCase() + where.slice(1) + ', o resultado é diferente entre municípios que diferem em ' + list(moved.map(t => t === 'idade' ? 'idade dos eleitores' : t === 'escolaridade' ? 'escolaridade' : 'tamanho')) + '.'
      : 'Aqui, quase não: nos grupos comparados o resultado foi parecido.';
    if (!shown) k.p('Há poucos municípios nesta seleção para fazer a comparação.');
    else k.txt.insertBefore(keyRow([[a.name, 'var(--blue)'], ['Outros', 'var(--other)'], ['Lula', 'var(--red)']]), k.txt.querySelector('.pair'));
    k.txt.append(el('p', 'warn', 'Cuidado ao interpretar: isto compara municípios, não pessoas. O voto é secreto. Saber que os municípios com mais idosos votaram mais em um candidato não diz como os idosos votaram. Além disso, os municípios diferem em muitas coisas ao mesmo tempo, como renda e região, que também podem acompanhar o resultado.'));
    k.more('Ver as relações em detalhe', 'relation');
    root.append(k.node);

    // where the numbers come from
    k = card('De onde vêm os números?', true);
    k.p('Os resultados são a contagem oficial do Tribunal Superior Eleitoral (TSE) para presidente, no primeiro turno, município por município. O perfil dos eleitores vem do cadastro eleitoral, também do TSE.');
    k.p('Esta página não é pesquisa de opinião e não estima como cada pessoa ou grupo votou. Ela mostra como votaram os lugares e quem são os eleitores que vivem neles.');
    k.p('É um projeto independente, sem ligação com o TSE, com partidos ou com candidatos.');
    k.more('Ver fontes, créditos e licenças', 'fontes');
    root.append(k.node);

    k = card('Quer investigar por conta própria?', true);
    k.big('Os mesmos dados, com todos os gráficos e um roteiro de perguntas para testar.');
    k.p('Este painel não entrega conclusões prontas. Ele convida você a desconfiar, comparar e procurar o lugar que contraria a regra.');
    k.more('Abrir o roteiro de exploração', 'roteiro');
    root.append(k.node);
  }

  // ---------------------------------------------------------------- the invitation
  const ALL = new Uint8Array(N).fill(1);
  const rich = (node, text) => { text.split('*').forEach((t, i) => node.append(i % 2 ? el('b', null, t) : document.createTextNode(t))); return node; };   // *bold*
  const art = k => k === 'size' ? 'o ' : 'a ';
  function quests() {   // every figure quoted on a card is computed here, for the whole country in 2026
    const y = Y['2026'], F = y.F, U = y.U, a = y.cand.a, keys = FEATS.map(f => f[0]), out = [];
    const st = (k, yv, mask, within) => wstats(F[k], yv, mask, within, U.el).r;
    const both = (yv) => keys.map(k => ({ k, r: st(k, yv, ALL, false), w: st(k, yv, ALL, true) })).filter(d => isFinite(d.r) && isFinite(d.w));
    const margin = both(F.margin);

    const geo = margin.slice().sort((p, q) => Math.abs(q.r - q.w) - Math.abs(p.r - p.w))[0];
    out.push({ tag: 'Geografia ou perfil', title: 'O padrão é do eleitorado ou do endereço?', set: { lens: 'margin', x: geo.k }, anchor: 'relation',
      text: 'Das ' + keys.length + ' características, a que mais muda de figura é ' + art(geo.k) + XPHRASE[geo.k] + '. No país, sua correlação com a margem ' + a.short + ' − Lula é de *' + fmtR(geo.r) + '*. ' +
        (Math.abs(geo.w) < 0.1 ? 'Quando cada município é comparado só com os da própria UF, ela praticamente desaparece: *'
          : geo.r * geo.w < 0 ? 'A relação troca de sinal quando cada município é comparado só com os da própria UF: passa a *' : 'Quando cada município é comparado só com os da própria UF, ela passa a *') + fmtR(geo.w) + '*.',
      test: 'Teste: no ranking, veja em quais características o ponto cheio e o anel mais se afastam.' });

    const masks = REG_NAME.map((_, r) => { const m = new Uint8Array(N); for (let i = 0; i < N; i++) m[i] = UF_REG[UF[i]] === r ? 1 : 0; return m; });
    const simp = keys.map(k => { const rs = masks.map((m, r) => ({ r, v: st(k, F.margin, m, false) })).filter(d => isFinite(d.v)), lo = d3.least(rs, d => d.v), hi = d3.greatest(rs, d => d.v);
      return { k, lo, hi, flip: lo.v < 0 && hi.v > 0 ? Math.min(-lo.v, hi.v) : -1, spread: hi.v - lo.v }; }).sort((p, q) => q.flip - p.flip || q.spread - p.spread)[0];
    out.push({ tag: 'Uma reta não serve para todos', title: 'A relação muda de região para região?', set: { lens: 'margin', x: simp.k }, anchor: 'regioes',
      text: 'Das ' + keys.length + ' características, a que mais varia entre regiões é ' + art(simp.k) + XPHRASE[simp.k] + ': sua correlação com a margem vai de *' + fmtR(simp.lo.v) + '* ' + IN_REGION[simp.lo.r] + ' a *' + fmtR(simp.hi.v) + '* ' + IN_REGION[simp.hi.r] + '. ' +
        (simp.flip > 0 ? 'O sinal se inverte.' : 'A força muda bastante.') + ' Uma única reta para o país esconde isso.',
      test: 'Teste: troque a característica do eixo horizontal e acompanhe os cinco painéis pequenos.' });

    const ahead = v => Math.abs(v) < 0.05 ? 'houve empate' : (v > 0 ? a.short : 'Lula') + ' ficou ' + f1(Math.abs(v)) + pts(v) + ' à frente';
    const expo = k => { let num = 0, den = 0; for (let i = 0; i < N; i++) { if (!isFinite(F.margin[i])) continue; let v = 0; for (let j = 0; j < 2 * A; j++) v += y.CM[(i * 2 * A + j) * KM + k]; num += v * F.margin[i]; den += v; } return num / den; };
    out.push({ tag: 'Estado civil', title: 'Casados e solteiros: voto ou endereço?', set: { lens: 'margin', heat: 'marital' }, anchor: 'groups',
      text: 'Os eleitores casados vivem, em média, em municípios onde *' + ahead(expo(1)) + '*; os solteiros, onde *' + ahead(expo(0)) + '*. Isso mostra onde cada grupo mora, e não como ele votou.',
      test: 'Teste: na grade, compare as mesmas idades entre os estados civis e depois filtre uma única UF.' });

    const wom = margin.find(d => d.k === 'women'), ufW = y.STATEM.map((m, u) => ({ u, v: m.women })), wLo = d3.least(ufW, d => d.v), wHi = d3.greatest(ufW, d => d.v);
    out.push({ tag: 'Sexo', title: 'Mais mulheres no eleitorado, outro resultado?', set: { lens: 'margin', x: 'women' }, anchor: 'relation',
      text: 'Entre as UFs, a proporção de mulheres no eleitorado vai de *' + f1(wLo.v) + '%* ' + IN_UF[D.ufs[wLo.u]] + ' a *' + f1(wHi.v) + '%* ' + IN_UF[D.ufs[wHi.u]] + '. Entre os municípios, sua correlação com a margem é de *' + fmtR(wom.r) + '* no país e de *' + fmtR(wom.w) + '* dentro das UFs.',
      test: 'Teste: a diferença é de poucos pontos. O que mais muda junto com ela? Fixe um município de cada extremo e compare o resto do perfil.' });

    if (HAS22) {
      const m22 = Y['2022'].F.margin, a22 = Y['2022'].cand.a, cnt = v => v === 0 ? 'nenhum' : fInt(v); let n = 0, toA = 0, toL = 0, keepA = 0, keepL = 0, elA = 0, elL = 0, elT = 0;
      for (let i = 0; i < N; i++) {
        if (!isFinite(m22[i]) || !isFinite(F.margin[i])) continue; n++; elT += U.el[i];
        if (m22[i] < 0 && F.margin[i] > 0) { toA++; elA += U.el[i]; } else if (m22[i] > 0 && F.margin[i] < 0) { toL++; elL += U.el[i]; } else if (m22[i] > 0 && F.margin[i] > 0) keepA++; else if (m22[i] < 0 && F.margin[i] < 0) keepL++;
      }
      const who = a22.party === a.party ? 'o candidato do ' + a.party : a22.name + ' e depois ' + a.name, share = v => v > 0 ? ' (' + f1(pc(v, elT)) + '% do eleitorado)' : '';
      out.push({ tag: 'Mudança no tempo', title: 'Onde a liderança mudou entre 2022 e 2026?', set: { lens: 'swing' }, anchor: 'map',
        text: 'Dos ' + fInt(n) + ' municípios com resultado nas duas eleições, Lula ficou à frente nas duas em *' + fInt(keepL) + '* e ' + who + ', em *' + fInt(keepA) + '*. A liderança passou de Lula para ' + a.name + ' em *' + cnt(toA) + '*' + share(elA) +
          ' e de ' + a22.name + ' para Lula em *' + cnt(toL) + '*' + share(elL) + '.',
        test: 'Teste: a mudança acompanha as mesmas características que a margem? Lembre que são primeiros turnos com candidatos diferentes.' });
    }

    const turn = both(F.turnout).sort((p, q) => Math.abs(q.r) - Math.abs(p.r))[0], ufT = y.STATEM.map((m, u) => ({ u, v: m.turnout })), tLo = d3.least(ufT, d => d.v), tHi = d3.greatest(ufT, d => d.v);
    out.push({ tag: 'Comparecimento', title: 'A abstenção tem endereço e perfil?', set: { lens: 'turnout', x: turn.k }, anchor: 'relation',
      text: 'Entre as UFs, o comparecimento variou de *' + f1(tLo.v) + '%* ' + IN_UF[D.ufs[tLo.u]] + ' a *' + f1(tHi.v) + '%* ' + IN_UF[D.ufs[tHi.u]] + '. Entre os municípios, o que mais o acompanha é ' + art(turn.k) + XPHRASE[turn.k] + ' (correlação *' + fmtR(turn.r) + '*).',
      test: 'Teste: o padrão continua dentro das UFs? Lembre que cadastros desatualizados podem inflar a abstenção.' });
    return out;
  }
  function jump(anchor) { requestAnimationFrame(() => { const t = $(anchor); if (t) t.scrollIntoView({ behavior: 'smooth' }); }); }
  function renderRoteiro() {
    $('invite-text').textContent = 'Este painel foi feito para provocar quem trabalha com dados. Ele põe lado a lado o resultado oficial e o perfil do eleitorado de ' + fInt(N) + ' municípios' +
      (HAS22 ? ', em duas eleições,' : '') + ' e deixa as conclusões por conta de quem explora. A proposta é explorar com método: formular uma hipótese, procurar o padrão, tentar derrubá-lo e só então confiar um pouco nele.';
    const steps = [['Pergunte', 'Comece por uma hipótese que possa estar errada. As investigações abaixo sugerem algumas.'],
      ['Observe', 'Procure o padrão no mapa e na dispersão antes de olhar qualquer coeficiente.', 'Ir ao mapa', 'map'],
      ['Compare', 'Mude a região, a UF, o porte e a eleição. O padrão resiste ou era só daquele recorte?'],
      ['Controle', 'Compare cada município com os da própria UF e mantenha as outras características constantes.', 'Ir às relações', 'relation'],
      ['Duvide', 'Leia os cuidados antes de concluir e procure o município que contraria a regra.', 'Antes de concluir', 'methods']];
    const method = $('method'); method.replaceChildren();
    for (const [verb, text, label, anchor] of steps) {
      const li = el('li'); li.append(el('b', null, verb), el('span', null, text));
      if (label) { const b = el('button', 'link', label + ' →'); b.type = 'button'; b.addEventListener('click', () => jump(anchor)); li.append(b); }
      method.append(li);
    }
    const list = quests(), node = $('quests'); node.replaceChildren();
    $('quests-title').textContent = (['Uma', 'Duas', 'Três', 'Quatro', 'Cinco', 'Seis', 'Sete'][list.length - 1] || list.length) + ' investigações para começar';
    for (const q of list) {
      const c = el('article', 'quest'), b = el('button', 'go', 'Investigar →'); b.type = 'button';
      b.addEventListener('click', () => { Object.assign(S, { year: '2026', region: -1, uf: -1, size: 'all' }, q.set); update(); jump(q.anchor); });
      c.append(el('span', 'mono', q.tag), el('h3', null, q.title), rich(el('p'), q.text), el('p', 'try', q.test), b); node.append(c);
    }
    const box = $('roteiro');
    try { if (localStorage.getItem('eeb-roteiro') === '0') box.open = false; } catch (e) { /* stays open */ }
    box.addEventListener('toggle', () => { try { localStorage.setItem('eeb-roteiro', box.open ? '1' : '0'); } catch (e) { /* convenience only */ } });
  }

  // ---------------------------------------------------------------- cautions, sources, credits
  const ext = (text, href) => { const a = el('a', null, text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
  function renderMethods() {
    const cautions = $('cautions'); cautions.replaceChildren();
    const el26 = Y['2026'].U.el, top100 = pc(d3.sum(ORDER.slice(0, 100), i => el26[i]), d3.sum(el26));
    [['Lugares não são pessoas.', 'Tudo aqui compara municípios. Nenhuma figura diz como votou um grupo de eleitores (falácia ecológica). Para isso seriam necessárias pesquisas com indivíduos.'],
      ['Correlação não é causa.', 'Uma característica pode acompanhar o voto apenas porque anda junto com outra, medida ou não pelo painel.'],
      ['Faltam variáveis importantes.', 'O cadastro eleitoral não traz renda, religião nem ocupação, e a cor ou raça está registrada para poucos eleitores. A influência delas, se existe, aparece aqui misturada à das características disponíveis.'],
      ['Quem procura, acha.', 'São ' + FEATS.length + ' características, ' + (VOTE_KEYS.length + CHANGE_KEYS.length) + ' indicadores, ' + YEARS.length + ' eleições e dezenas de recortes. Com tantas combinações, algumas relações aparentes surgem por coincidência, sobretudo em recortes pequenos. Trate cada achado como hipótese e tente derrubá-lo em outro recorte' + (HAS22 ? ' ou na outra eleição.' : '.')],
      ['Vizinhos se parecem.', 'Municípios próximos não são observações independentes. Por isso o painel não mostra valores-p nem intervalos de confiança: calculados da forma usual, pareceriam mais seguros do que são.'],
      ['O cadastro envelhece.', 'Estado civil e escolaridade são os declarados no alistamento e podem estar desatualizados. O perfil descreve todos os eleitores aptos, e não apenas quem compareceu.'],
      HAS22 ? ['Duas eleições, candidatos diferentes.', 'Lula concorreu nas duas; o outro candidato mais votado foi ' + Y['2022'].cand.a.name + ' em 2022 e ' + Y['2026'].cand.a.name + ' em 2026. Parte da mudança pode vir da troca de candidato, e não do eleitorado. E tudo aqui é primeiro turno, com um conjunto diferente de concorrentes em cada ano.']
        : ['Um turno, uma eleição.', 'Tudo aqui é o primeiro turno de uma única eleição, com os concorrentes daquele ano.'],
      ['Modelos simplificam, e os pesos concentram.', 'As retas e a regressão supõem relações lineares: curvas, limiares e interações ficam de fora. Como cada município pesa conforme o seu eleitorado, poucas cidades grandes dominam as contas: as 100 maiores somam ' + Math.round(top100) + '% do peso. Em UFs concentradas na capital, o número reflete quase só a capital contra o resto.']]
      .forEach(([title, text]) => { const li = el('li'); li.append(el('b', null, title), el('span', null, text)); cautions.append(li); });

    const node = $('methods-body'), y26 = P.meta.y['2026'], y22 = HAS22 ? P.meta.y['2022'] : null; node.replaceChildren();
    const item = (title, body) => { const d = el('div'); d.append(el('h3', null, title), el('p', null, body)); node.append(d); };
    item('Resultados', 'Totalização oficial do primeiro turno para presidente. 2026: serviço de divulgação de resultados do TSE, um arquivo por município, contagem final gerada em ' + y26.result_date + '.' +
      (y22 ? ' 2022: dados abertos do TSE (votação nominal e detalhe da apuração por município e zona), na versão do arquivo gerada pelo TSE em ' + y22.result_date + '.' : ''));
    item('Perfil do eleitorado', 'Dados abertos do TSE, perfil do eleitorado, agregado por município a partir das zonas eleitorais. Extração de ' + y26.profile_date + ' para 2026' + (y22 ? ' e de ' + y22.profile_date + ' para 2022' : '') + '.');
    item('O que fica de fora', 'Eleitores sem sexo, idade, estado civil ou escolaridade informados (menos de 0,1%). Votos no exterior entram apenas no resumo nacional. Cor ou raça não é analisada: só ' + f1(y26.race_declared) + '% dos eleitores a têm registrada em 2026.');
    if (y22) item('Comparação entre 2022 e 2026', 'Os municípios são pareados pelo código do TSE. Município criado depois de 2022 fica sem valor naquele ano. A mudança da margem compara o candidato do PL em cada eleição (Jair Bolsonaro em 2022, Flávio Bolsonaro em 2026) com Lula.');
    item('Como ler as relações', 'Correlações, retas e o modelo ponderam cada município pelo seu eleitorado. Comparam lugares, e por isso não permitem dizer como um grupo de pessoas votou.');
    item('Atualização', 'Os números refletem os arquivos do TSE nas datas indicadas. Retotalizações e decisões judiciais posteriores podem alterar os totais oficiais. Em caso de divergência, vale o que o TSE publica.');

    const credits = $('credits'); credits.replaceChildren();
    const row = (what, source, licence) => { const d = el('div'), dd = el('dd'); for (const part of source) dd.append(part); d.append(el('dt', null, what), dd, el('dd', 'lic', licence)); credits.append(d); };
    row('Resultados de 2022 e perfil do eleitorado', ['Tribunal Superior Eleitoral (TSE), ', ext('Portal de Dados Abertos', 'https://dadosabertos.tse.jus.br/')], 'Creative Commons Atribuição (CC BY), como indicado no portal');
    row('Resultados de 2026', ['Tribunal Superior Eleitoral (TSE), ', ext('divulgação de resultados', 'https://resultados.tse.jus.br/')], 'Dados públicos oficiais, citados com atribuição ao TSE');
    row('Coordenadas dos municípios', [ext('kelvins/municipios-brasileiros', 'https://github.com/kelvins/municipios-brasileiros')], 'MIT · © 2016 Kelvin S. do Prado');
    row('Contornos das UFs', ['Malha municipal do IBGE, via ', ext('tbrugz/geodata-br', 'https://github.com/tbrugz/geodata-br'), ', agregada por UF e simplificada'], 'CC0 1.0 no repositório · fonte dos dados: IBGE');
    row('Gráficos', [ext('D3', 'https://d3js.org/'), ' versão ' + d3.version + ', incluída na página'], 'ISC · © 2010–2023 Mike Bostock');
    row('Tipografia', ['Archivo (Omnibus-Type), Public Sans (USWDS) e IBM Plex Mono (IBM), servidas pelo Google Fonts'], 'SIL Open Font License 1.1');
    row('Este painel', ['Código, textos e figuras' + (SITE.author ? ' de ' + SITE.author : '')].concat(SITE.repo ? [': ', ext(SITE.repo.replace(/^https?:\/\//, ''), SITE.repo)] : []), 'Código: MIT · Textos e figuras: CC BY 4.0');
    $('notices-text').textContent = document.getElementById('notices').textContent.trim();

    $('independence').textContent = 'Projeto independente, sem vínculo com o TSE, com partidos, candidatos ou campanhas. Usa apenas resultados oficiais e dados públicos. Não é pesquisa eleitoral nem enquete: não coleta opiniões e não estima intenção de voto. ' +
      'Azul e vermelho são uma convenção visual para distinguir os dois candidatos mais votados, e não uma posição. As análises e interpretações são de responsabilidade de quem as faz, e não do TSE.';
    $('privacy').textContent = 'Privacidade: a página não usa cookies nem ferramentas de medição de audiência. Guarda apenas, no seu navegador, duas preferências de exibição. Os dados são contagens por município, como publicadas pelo TSE, sem nomes nem registros individuais. ' +
      'As únicas requisições externas são as das tipografias, feitas aos servidores do Google Fonts, que recebem o endereço IP e a identificação do navegador de quem abre a página, assim como o serviço que a hospeda.';
    const now = new Date(), month = ['jan.', 'fev.', 'mar.', 'abr.', 'maio', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'][now.getMonth()], span = YEARS.slice().sort().join(' e ');
    $('cite').textContent = (SITE.author ? SITE.author + '. ' : '') + 'Explorador do Eleitorado Brasileiro: primeiro turno das eleições presidenciais de ' + span + '. ' + YEARS.slice().sort().pop() + '. Dados: Tribunal Superior Eleitoral (TSE).' +
      (SITE.site ? ' Disponível em: ' + SITE.site + '.' : '') + ' Acesso em: ' + now.getDate() + ' ' + month + ' ' + now.getFullYear() + '.';
  }
  function renderFoot() {
    const foot = $('foot'), more = el('button', 'link', 'Fontes, créditos e licenças'), second = el('p'); more.type = 'button';
    more.addEventListener('click', () => setView('full', 'creditos'));
    second.append('Projeto independente, sem vínculo com o TSE, partidos ou candidatos. Não é pesquisa eleitoral. ', more);
    if (SITE.repo) second.append(' · ', ext('Código-fonte', SITE.repo));
    foot.replaceChildren(el('p', null, 'Dados: Tribunal Superior Eleitoral (TSE), dados abertos (Creative Commons Atribuição) e divulgação de resultados. Primeiro turno para presidente, ' + YEARS.slice().sort().join(' e ') + '. Contornos das UFs: IBGE.'), second);
  }

  // ---------------------------------------------------------------- orchestration
  function update() {
    recompute(); readTheme(); renderControls();
    if (S.view === 'simple') { renderSimple(); return; }
    renderTally(); renderMap(); renderTug(); renderBig(); renderPin(); renderPyramid(); renderStrips();
    renderScatter(); renderRank(); renderMulti(); renderModel(); renderHeat(); renderTable();
  }
  function redraw() { readTheme(); if (S.view === 'simple') { renderSimple(); return; } renderMap(); renderPyramid(); renderScatter(); renderMulti(); renderHeat(); }
  function setView(view, anchor, quiet) {
    S.view = view; if (view === 'simple') S.size = 'all';
    try { localStorage.setItem('eeb-view', view); } catch (e) { /* storage is a convenience only */ }
    if (!quiet) update();
    if (anchor === 'roteiro') $('roteiro').open = true;
    if (anchor) jump(anchor);
  }
  try { const saved = localStorage.getItem('eeb-view'); if (saved === 'full' || saved === 'simple') S.view = saved; } catch (e) { /* default view */ }
  const HASH = { '#explorar': null, '#roteiro': 'roteiro', '#cuidados': 'methods', '#fontes': 'fontes', '#creditos': 'creditos' }, hashed = location.hash in HASH;
  if (hashed) S.view = 'full'; else if (location.hash === '#leitura') S.view = 'simple';
  initControls(); renderRoteiro(); renderMethods(); renderFoot();
  hoverLayer($('cv-map'), () => MAPPTS);
  hoverLayer($('cv-sc'), () => SCPTS, i => [[FLABEL[S.x], fmtFeat(S.x, cur().F[S.x][i])]]);
  update();
  if (hashed && HASH[location.hash]) setView('full', HASH[location.hash], true);
  let raf = 0, lastW = document.documentElement.clientWidth;
  new ResizeObserver(() => { const w = document.documentElement.clientWidth; if (w === lastW) return; lastW = w; cancelAnimationFrame(raf); raf = requestAnimationFrame(redraw); }).observe(document.documentElement);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw);
})();
