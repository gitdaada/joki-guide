/* Joki guide: perhosolmujen animaatiot. Piirretään SVG:nä koodista, joten ne toimivat ilman verkkoa.
 * Vaiheet: Orvis (blood knot), Animated Knots ja Bass Pro (improved clinch). Piirrokset ovat omia. */
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var CY = 100;
  var COL = { peruke: '#f0a24e', tippet: '#4cc3d9', koukku: '#c3cdd1', tausta: '#0b1519', nuoli: '#ffd166', teksti: '#a9bcc2' };
  var REV = { a: 1, b: 1, t: 1 }; // paljastusparametrit etenevät tasaisesti, muut pehmeästi

  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  // --- Geometria: pisteet [x, y, z], z > 0 edessä, z < 0 takana ---------------------------

  function line(p0, p1, n) {
    var out = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      out.push([lerp(p0[0], p1[0], t), lerp(p0[1], p1[1], t), lerp(p0[2], p1[2], t)]);
    }
    return out;
  }
  function bez(p0, c1, c2, p1, n) {
    var out = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      out.push([0, 1, 2].map(function (j) { return a * p0[j] + b * c1[j] + c * c2[j] + d * p1[j]; }));
    }
    return out;
  }
  function helix(x0, len, core, r, turns, n) {
    var out = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, th = 2 * Math.PI * turns * t, x = x0 + len * t;
      out.push([x, core(x) + r * Math.cos(th), Math.sin(th)]);
    }
    return out;
  }
  function last(a) { return a[a.length - 1]; }
  /** Yhdistää peräkkäiset osat yhdeksi (yhteinen liitospiste kerran). */
  function join() { var out = []; Array.prototype.forEach.call(arguments, function (a) { a.forEach(function (p, i) { if (i > 0 || !out.length) out.push(p); }); }); return out; }
  function reflect(pieces, cx) {
    return pieces.map(function (pc) { return pc.map(function (p) { return [2 * cx - p[0], 2 * CY - p[1], p[2]]; }); });
  }

  /** Näkyvä osa siimasta: rev kokonaista osaa ja seuraavasta osa, perään vapaa pää tangentin suuntaan. */
  function visible(pieces, rev, stubMax, wrapIx) {
    rev = Math.max(0, rev);
    var n = pieces.length, full = Math.min(Math.floor(rev), n), frac = rev - Math.floor(rev), pts = [];
    function add(arr) { arr.forEach(function (p, i) { if (i > 0 || !pts.length) pts.push(p); }); }
    for (var i = 0; i < full; i++) add(pieces[i]);
    if (full < n && frac > 0) {
      var pc = pieces[full], cum = [0];
      for (var j = 1; j < pc.length; j++) cum.push(cum[j - 1] + Math.hypot(pc[j][0] - pc[j - 1][0], pc[j][1] - pc[j - 1][1]));
      var goal = cum[cum.length - 1] * frac, m = 1;
      while (m < pc.length - 1 && cum[m] < goal) m++;
      add(pc.slice(0, m + 1));
    }
    if (rev < n) {
      var tip, dx, dy;
      if (pts.length > 1) { tip = last(pts); var pr = pts[pts.length - 2]; dx = tip[0] - pr[0]; dy = tip[1] - pr[1]; }
      else { tip = pieces[0][0]; dx = pieces[0][1][0] - tip[0]; dy = pieces[0][1][1] - tip[1]; if (!pts.length) pts.push(tip); }
      var l = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= l; dy /= l;
      if (full === wrapIx) { // kierrettäessä vapaa pää osoittaa pääosin ulospäin ja heiluu kierteen mukana
        var p0 = pieces[full][0], p1 = pieces[full][1], bx = p1[0] - p0[0], by = p1[1] - p0[1], bl = Math.sqrt(bx * bx + by * by) || 1;
        dx = dx * 0.6 + bx / bl; dy = dy * 0.6 + by / bl;
      }
      l = Math.sqrt(dx * dx + dy * dy) || 1;
      var len = stubMax * (1 - rev / n);
      pts.push([tip[0] + dx / l * len, tip[1] + dy / l * len, tip[2]]);
    }
    return pts;
  }

  // --- Solmut ------------------------------------------------------------------------------

  var KNOTS = {
    verisolmu: {
      nimi: 'Verisolmu', en: 'blood knot', kaytto: 'Perukkeen ja tippetin liitos',
      tiedot: [
        'Sopii kahden lähes yhtä paksun siiman liittämiseen: paksuusero enintään noin 0,05 mm.',
        'Kierroksia kummallekin puolelle: noin 0,43 mm ja paksummalla siimalla 3, 0,25–0,38 mm siimalla 5, 0,23 mm ja ohuemmalla 7.',
        'Älä vedä päistä. Jos kierteet eivät asetu siisteiksi, leikkaa solmu pois ja aloita alusta.'
      ],
      alku: { a: 0, b: 0, k: 0, trim: 0, pull: 0 },
      zoom: { x: 180, y: 100, w: 150 },
      steps: [
        { teksti: 'Aseta siimat ristiin niin, että kummastakin jää 12–15 cm vapaata päätä.', to: {} },
        { teksti: 'Kierrä tippetin pää perukkeen ympärille 5 kertaa ristikohdasta poispäin.', to: { b: 1 }, ms: 3400 },
        { teksti: 'Tuo pää takaisin ja pujota se keskelle siimojen väliin jäävästä raosta.', to: { b: 2 }, ms: 1900 },
        { teksti: 'Kierrä perukkeen pää tippetin ympärille yhtä monta kertaa toiseen suuntaan.', to: { a: 1 }, ms: 3400 },
        { teksti: 'Pujota pää samaan rakoon vastakkaisesta suunnasta.', to: { a: 2 }, ms: 1900 },
        { teksti: 'Kostuta ja vedä nopeasti kummastakin siimasta, ei päistä. Kierteet asettuvat tiiviiksi tynnyriksi.', to: { k: 1, pull: 1 }, ms: 2400 },
        { teksti: 'Leikkaa päät lyhyiksi. Valmis solmu lähikuvassa.', to: { trim: 1, pull: 0 }, ms: 1300 }
      ],
      build: function (p) {
        var cx = 180, N = 5, k = p.k;
        function core(x) { return CY - 8 * (x - cx) / (350 - cx); } // tippetin seisova osa oikealla
        var r = lerp(9, 4.6, k), g = lerp(14, 1.5, k), len = lerp(95, 4.4 * N, k), hh = lerp(24, 7.5, k);
        var tail = lerp(lerp(46, 15, k), 2.5, p.trim);
        var x0 = cx + g, h0 = [x0, core(x0) + r, 0];
        var trans = bez([cx, CY, 0], [cx + g * 0.35, CY + r * 0.2, 0], [x0 - g * 0.35, core(x0) + r, 0], h0, 10);
        var hx = helix(x0, len, core, r, N, N * 28), e = last(hx);
        var gp = [cx + lerp(5, 1.2, k), CY + lerp(6, 2, k), 0];
        var ret = bez(e, [e[0] + lerp(14, 3, k), e[1] + hh, 0.6], [cx + lerp(30, 6, k), CY + hh + 2, 0.6], gp, 26);
        var ge = [cx - lerp(2, 0.6, k), CY - lerp(8, 4, k), 0];
        var gap = line(gp, ge, 6);
        var tl = line(ge, [ge[0] - tail * 0.3, ge[1] - tail, 0.3], 8);
        var tagA = [join(trans, hx), join(ret, gap, tl)];
        var standA = [line([10, CY + 8, 0], [cx, CY, 0], 24)];
        return {
          strands: [
            { color: COL.peruke, w: 3.2, pieces: standA, rev: 1 },
            { color: COL.tippet, w: 3.2, pieces: reflect(standA, cx), rev: 1 },
            { color: COL.tippet, w: 3.2, pieces: reflect(tagA, cx), rev: p.b, stub: 85, wrap: 0 },
            { color: COL.peruke, w: 3.2, pieces: tagA, rev: p.a, stub: 85, wrap: 0 }
          ],
          arrows: p.pull > 0.01 ? [{ x1: 60, y1: CY - 10, x2: 16, y2: CY - 5, o: p.pull }, { x1: 300, y1: CY + 10, x2: 344, y2: CY + 5, o: p.pull }] : [],
          labels: [{ x: 14, y: CY + 34, text: 'peruke', color: COL.peruke }, { x: 346, y: CY - 24, text: 'tippet', color: COL.tippet, end: true }]
        };
      }
    },

    clinch: {
      nimi: 'Parannettu clinch-solmu', en: 'improved clinch knot', kaytto: 'Tippetin ja perhon liitos',
      tiedot: [
        'Noin 5 kierrosta. Paksulla siimalla 4 riittää.',
        'Kierrä siisti spiraali, jossa kierrokset eivät mene päällekkäin.',
        'Kostuta ennen kiristämistä ja varmista, että kierteet painuvat silmää vasten.'
      ],
      alku: { t: 1, k: 0, trim: 0, pull: 0 },
      zoom: { x: 86, y: 104, w: 140 },
      steps: [
        { teksti: 'Pujota tippet koukun silmän läpi ja vedä 10–15 cm läpi.', to: {} },
        { teksti: 'Taita pää takaisin tippetin viereen.', to: { t: 2 }, ms: 1300 },
        { teksti: 'Kierrä pää tippetin ympärille 5 kertaa silmästä poispäin.', to: { t: 3 }, ms: 3400 },
        { teksti: 'Tuo pää takaisin ja pujota se silmän viereen jäävän pienen lenkin läpi.', to: { t: 4 }, ms: 2000 },
        { teksti: 'Pujota pää vielä juuri syntyneen ison lenkin läpi. Tämä tekee solmusta "parannetun".', to: { t: 5 }, ms: 2000 },
        { teksti: 'Kostuta, pidä koukusta ja vedä tippetistä. Kierteet liukuvat silmää vasten.', to: { k: 1, pull: 1 }, ms: 2400 },
        { teksti: 'Leikkaa pää lyhyeksi. Valmis solmu lähikuvassa.', to: { trim: 1, pull: 0 }, ms: 1300 }
      ],
      hook: true,
      build: function (p) {
        var k = p.k, N = 5, ex = 70;
        function core() { return CY; }
        var r = lerp(10, 4.8, k), x0 = lerp(96, 78, k), len = lerp(100, 4.5 * N, k), hh = lerp(28, 8, k);
        var tail = lerp(lerp(40, 13, k), 2.5, p.trim);
        var through = line([ex + 6, CY, 0], [ex - 9, CY, 0], 8);
        var fb = CY + lerp(12, 9.5, k);
        var fold = bez([ex - 9, CY, 0.3], [ex - lerp(17, 13, k), CY + 2, 0.4], [ex - lerp(10, 7, k), fb, 0.4], [ex + 3, fb, 0.3], 14)
          .concat(line([ex + 3, fb, 0.3], [x0, CY + r, 0], 6).slice(1));
        var hx = helix(x0, len, core, r, N, N * 28), e = last(hx);
        var sm = [lerp(81, 74, k), CY + lerp(5, 2.5, k)];
        var ret1 = bez(e, [e[0] + lerp(14, 4, k), CY + r + hh, 0.6], [ex + lerp(6, 3, k), CY + r + hh * 0.9, 0.6], [sm[0], sm[1], 0.6], 28);
        var upE = [lerp(84, 75, k), CY - lerp(22, 7, k), -0.6];
        var up = bez([sm[0], sm[1], -0.6], [sm[0] + 1, CY - 4, -0.6], [upE[0], upE[1] + 6, -0.6], upE, 10);
        var b1 = [x0 + len * 0.55, CY + r + hh * 0.5, -0.6];
        var ret2 = bez(upE, [lerp(104, 80, k), CY - lerp(34, 11, k), -0.6], [x0 + len * 0.62, CY - lerp(30, 10, k), -0.6], b1, 26);
        var out = line([b1[0], b1[1], 0.6], [b1[0] + tail * 0.4, b1[1] + tail, 0.6], 8);
        return {
          strands: [
            { color: COL.tippet, w: 3.2, pieces: [line([350, CY, 0], [ex + 6, CY, 0], 24)], rev: 1 },
            { color: COL.tippet, w: 3.2, pieces: [through, fold, hx, join(ret1, up), join(ret2, out)], rev: p.t, stub: 50, wrap: 2 }
          ],
          arrows: p.pull > 0.01 ? [{ x1: 300, y1: CY - 12, x2: 346, y2: CY - 12, o: p.pull }] : [],
          labels: [{ x: 346, y: CY - 22, text: 'tippet', color: COL.tippet, end: true }]
        };
      }
    }
  };

  // --- Piirto ------------------------------------------------------------------------------

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach(function (a) { e.setAttribute(a, attrs[a]); });
    if (parent) parent.appendChild(e);
    return e;
  }
  function dPath(pts) { return 'M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L'); }
  function layerOf(z) { return z > 0.2 ? 2 : z < -0.2 ? 0 : 1; }
  function runs(pts) {
    var out = [], cur = null;
    pts.forEach(function (p, i) {
      var L = layerOf(p[2]);
      if (!cur) { cur = { layer: L, pts: [p] }; return; }
      if (L !== cur.layer) {
        cur.pts.push(p);
        out.push(cur);
        cur = { layer: L, pts: [pts[i - 1], p] };
      } else cur.pts.push(p);
    });
    if (cur) out.push(cur);
    return out.filter(function (r) { return r.pts.length > 1; });
  }
  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    var t = [11, 21, 25];
    return 'rgb(' + [r, g, b].map(function (v, i) { return Math.round(lerp(t[i], v, f)); }).join(',') + ')';
  }

  function drawHook(g, front) {
    var ex = 70, o = { fill: 'none', stroke: COL.koukku, 'stroke-width': 3, 'stroke-linecap': 'round' };
    if (front) { el('path', Object.assign({ d: 'M' + ex + ' ' + (CY - 8) + ' A4 8 0 0 0 ' + ex + ' ' + (CY + 8) }, o), g); return; }
    el('path', Object.assign({ d: 'M' + (ex - 1) + ' ' + (CY - 8.5) + ' L26 ' + (CY - 10) + ' C8 ' + (CY - 10) + ' 6 ' + (CY + 34) + ' 28 ' + (CY + 34) +
      ' L44 ' + (CY + 20) + ' M44 ' + (CY + 20) + ' L39 ' + (CY + 25) }, o), g);
    el('ellipse', Object.assign({ cx: ex, cy: CY, rx: 4, ry: 8 }, o), g);
  }

  function render(svg, knot, p) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var z = ease(p.trim || 0), zw = lerp(360, knot.zoom.w, z), zh = zw * 200 / 360;
    svg.setAttribute('viewBox', [lerp(0, knot.zoom.x - knot.zoom.w / 2, z), lerp(0, knot.zoom.y - knot.zoom.w * 100 / 360, z), zw, zh].map(function (v) { return v.toFixed(1); }).join(' '));
    var m = knot.build(p), layers = [[], [], []];
    m.strands.forEach(function (s) {
      var pts = s.rev >= s.pieces.length ? [].concat.apply([], s.pieces.map(function (pc, i) { return i ? pc.slice(1) : pc; })) : visible(s.pieces, s.rev, s.stub || 0, s.wrap);
      runs(pts).forEach(function (r) { layers[r.layer].push({ s: s, pts: r.pts }); });
    });
    var g = el('g', {}, svg);
    if (knot.hook) drawHook(g, false);
    function stroke(item, color, w) {
      el('path', { d: dPath(item.pts), fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
    }
    layers[0].forEach(function (it) { stroke(it, shade(it.s.color, 0.55), it.s.w * 0.9); });
    // Tumma reunus erottaa risteävät siimat; reunus ei peitä saman siiman liitoskohtia.
    function halo(it) { if (it.pts.length > 4) stroke({ pts: it.pts.slice(2, -2) }, COL.tausta, it.s.w + 3.5); }
    layers[1].forEach(function (it) { halo(it); stroke(it, it.s.color, it.s.w); });
    if (knot.hook) drawHook(g, true);
    layers[2].forEach(function (it) { halo(it); stroke(it, it.s.color, it.s.w); });
    m.arrows.forEach(function (a) {
      var dx = a.x2 - a.x1, dy = a.y2 - a.y1, l = Math.sqrt(dx * dx + dy * dy), ux = dx / l, uy = dy / l;
      var hx = a.x2 - ux * 8, hy = a.y2 - uy * 8;
      el('path', { d: 'M' + a.x1 + ' ' + a.y1 + ' L' + a.x2 + ' ' + a.y2 + ' M' + (hx - uy * 5).toFixed(1) + ' ' + (hy + ux * 5).toFixed(1) +
        ' L' + a.x2 + ' ' + a.y2 + ' L' + (hx + uy * 5).toFixed(1) + ' ' + (hy - ux * 5).toFixed(1),
        fill: 'none', stroke: COL.nuoli, 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: a.o.toFixed(2) }, g);
    });
    m.labels.forEach(function (lb) {
      var t = el('text', { x: lb.x, y: lb.y, fill: lb.color, 'font-size': 12, 'text-anchor': lb.end ? 'end' : 'start' }, g);
      t.textContent = lb.text;
    });
  }

  // --- Soitin ------------------------------------------------------------------------------

  function paramsAt(knot, i) {
    var p = Object.assign({}, knot.alku);
    for (var j = 0; j <= i; j++) Object.assign(p, knot.steps[j].to);
    return p;
  }
  var reduced = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /** Palauttaa DOM-elementin, jossa animaatio, vaiheteksti ja ohjaimet. */
  function player(id) {
    var knot = KNOTS[id], step = 0, p = paramsAt(knot, 0), anim = null, playing = false, wait = null;
    var wrap = document.createElement('div');
    wrap.className = 'knot';
    var svg = el('svg', { viewBox: '0 0 360 200', class: 'knot-svg', role: 'img', 'aria-label': knot.nimi + ', animaatio' });
    wrap.appendChild(svg);
    var cap = document.createElement('p');
    cap.className = 'knot-cap';
    cap.setAttribute('aria-live', 'polite');
    wrap.appendChild(cap);
    var ctrl = document.createElement('div');
    ctrl.className = 'row knot-ctrl';
    function btn(text, fn, cls) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn' + (cls ? ' ' + cls : ''); b.textContent = text; b.addEventListener('click', fn); ctrl.appendChild(b); return b; }
    var bPrev = btn('Edellinen', function () { stop(); go(Math.max(0, step - 1), false); });
    var bPlay = btn('Toista', function () { if (playing) stop(); else play(); }, 'primary');
    var bNext = btn('Seuraava', function () { stop(); go(Math.min(knot.steps.length - 1, step + 1), true); });
    wrap.appendChild(ctrl);
    var list = document.createElement('ol');
    list.className = 'knot-steps';
    knot.steps.forEach(function (s, i) {
      var li = document.createElement('li');
      li.textContent = s.teksti;
      li.addEventListener('click', function () { stop(); go(i, i === step + 1); if (svg.scrollIntoView) svg.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }); });
      list.appendChild(li);
    });
    wrap.appendChild(list);

    function ui() {
      cap.textContent = 'Vaihe ' + (step + 1) + '/' + knot.steps.length + ': ' + knot.steps[step].teksti;
      bPrev.disabled = step === 0;
      bNext.disabled = step === knot.steps.length - 1;
      bPlay.textContent = playing ? 'Tauko' : (step === knot.steps.length - 1 ? 'Toista alusta' : 'Toista');
      Array.prototype.forEach.call(list.children, function (li, i) { li.className = i === step ? 'on' : ''; });
    }
    function frame(now) {
      if (!svg.isConnected) { anim = null; playing = false; return; }
      if (!anim) return;
      var t = Math.max(0, Math.min(1, (now - anim.t0) / anim.ms)), q = {}; // rAF:n aikaleima voi edeltää t0:aa
      Object.keys(anim.to).forEach(function (key) {
        var tt = REV[key] ? t : ease(t);
        q[key] = lerp(anim.from[key], anim.to[key], tt);
      });
      p = q;
      render(svg, knot, p);
      if (t < 1) { root.requestAnimationFrame(frame); return; }
      anim = null;
      done();
    }
    /** Vaihe valmis: toistossa siirrytään tauon jälkeen seuraavaan. */
    function done() {
      if (!playing) return;
      wait = setTimeout(function () {
        if (!svg.isConnected) { playing = false; return; }
        if (step < knot.steps.length - 1) go(step + 1, true); else { playing = false; ui(); }
      }, reduced ? 2500 : 900);
    }
    function go(i, animate) {
      var target = paramsAt(knot, i);
      step = i;
      ui();
      if (!animate || reduced) { anim = null; p = target; render(svg, knot, p); done(); return; }
      p = paramsAt(knot, i - 1);
      anim = { from: p, to: target, t0: root.performance.now(), ms: knot.steps[i].ms || 1500 };
      root.requestAnimationFrame(frame);
    }
    function play() {
      playing = true;
      if (step === knot.steps.length - 1) { step = 0; p = paramsAt(knot, 0); render(svg, knot, p); }
      ui();
      wait = setTimeout(function () { go(step + 1, true); }, 500);
    }
    function stop() { playing = false; clearTimeout(wait); if (anim) { p = anim.to; anim = null; render(svg, knot, p); } ui(); }

    render(svg, knot, p);
    ui();
    return wrap;
  }

  root.JGKnots = {
    list: Object.keys(KNOTS).map(function (k) { return { id: k, nimi: KNOTS[k].nimi, en: KNOTS[k].en, kaytto: KNOTS[k].kaytto, tiedot: KNOTS[k].tiedot }; }),
    player: player,
    /** Piirtää solmun annetun vaiheen tilaan (testejä varten). */
    draw: function (svg, id, i, extra) { render(svg, KNOTS[id], Object.assign(paramsAt(KNOTS[id], i), extra || {})); }
  };
})(typeof window !== 'undefined' ? window : this);
