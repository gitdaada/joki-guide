/* Joki guide: laskenta ilman käyttöliittymää. Toimii selaimessa (window.JG) ja Nodessa (testit). */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JG = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RAD = Math.PI / 180, EARTH_R = 6371008.8;

  function norm360(d) { d = d % 360; return d < 0 ? d + 360 : d; }
  function angleDiff(a, b) { return ((b - a) % 360 + 540) % 360 - 180; }

  // --- Etäisyys ja suunta --------------------------------------------------------

  /** Isoympyräetäisyys metreinä. */
  function distance(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * RAD, p2 = lat2 * RAD, dp = (lat2 - lat1) * RAD, dl = (lon2 - lon1) * RAD;
    var a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * EARTH_R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** Suuntima pisteestä 1 pisteeseen 2 asteina (0 = pohjoinen, myötäpäivään). */
  function bearing(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return norm360(Math.atan2(y, x) / RAD);
  }

  /** Piste, joka on matkan dist (m) päässä suuntaan brg (astetta). */
  function destPoint(lat, lon, brg, dist) {
    var d = dist / EARTH_R, b = brg * RAD, p1 = lat * RAD, l1 = lon * RAD;
    var p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    var l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [p2 / RAD, ((l2 / RAD + 540) % 360) - 180];
  }

  var DIRS = ['P', 'KO', 'I', 'KA', 'E', 'LO', 'L', 'LU'];
  var DIR_NAMES = ['pohjoinen', 'koillinen', 'itä', 'kaakko', 'etelä', 'lounas', 'länsi', 'luode'];
  function dirName(brg, long) { var i = Math.round(norm360(brg) / 45) % 8; return long ? DIR_NAMES[i] : DIRS[i]; }

  /** Keskipiste ja kahdeksan pistettä kehällä (sääennusteen ympäristö). */
  function ringPoints(lat, lon, radiusM) {
    var pts = [{ lat: lat, lon: lon, dir: null, label: 'Sijainti' }];
    for (var i = 0; i < 8; i++) {
      var p = destPoint(lat, lon, i * 45, radiusM);
      pts.push({ lat: p[0], lon: p[1], dir: i * 45, label: DIR_NAMES[i] });
    }
    return pts;
  }

  /** Sijainti pyöristetään ennen lähettämistä säärajapinnoille (2 desimaalia ≈ 1 km). */
  function roundCoord(v, decimals) {
    var m = Math.pow(10, decimals === undefined ? 2 : decimals);
    return Math.round(v * m) / m;
  }

  function fmtDistance(m) {
    if (!isFinite(m)) return '–';
    if (m < 1000) return Math.round(m) + ' m';
    return (m < 10000 ? (Math.round(m / 10) / 100).toFixed(2) : (Math.round(m / 100) / 10).toFixed(1)).replace('.', ',') + ' km';
  }

  // --- Koordinaatit: ETRS-TM35FIN (EPSG:3067) ------------------------------------
  // Poikittainen Mercator, GRS80, keskimeridiaani 27° E, mittakaava 0,9996, itäsiirto 500 000 m.

  var TM = (function () {
    var a = 6378137, f = 1 / 298.257222101, n = f / (2 - f);
    var A = a / (1 + n) * (1 + n * n / 4 + Math.pow(n, 4) / 64);
    var al = [n / 2 - 2 * n * n / 3 + 5 * n * n * n / 16, 13 * n * n / 48 - 3 * n * n * n / 5, 61 * n * n * n / 240];
    var e2 = 2 * Math.sqrt(n) / (1 + n);
    return { A: A, al: al, e: e2, k0: 0.9996, lon0: 27 * RAD, fe: 500000 };
  })();

  function atanh(x) { return 0.5 * Math.log((1 + x) / (1 - x)); }

  function toTM35FIN(lat, lon) {
    var phi = lat * RAD, dl = lon * RAD - TM.lon0;
    var t = Math.sinh(atanh(Math.sin(phi)) - TM.e * atanh(TM.e * Math.sin(phi)));
    var xi1 = Math.atan2(t, Math.cos(dl)), eta1 = atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
    var xi = xi1, eta = eta1;
    for (var j = 1; j <= 3; j++) {
      xi += TM.al[j - 1] * Math.sin(2 * j * xi1) * Math.cosh(2 * j * eta1);
      eta += TM.al[j - 1] * Math.cos(2 * j * xi1) * Math.sinh(2 * j * eta1);
    }
    return { N: TM.k0 * TM.A * xi, E: TM.fe + TM.k0 * TM.A * eta };
  }

  /** 69.14895 -> "69° 08,937′" */
  function fmtDM(v) {
    var a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60;
    if (Number(m.toFixed(3)) >= 60) { d += 1; m = 0; }
    return d + '° ' + (m < 10 ? '0' : '') + m.toFixed(3).replace('.', ',') + '′';
  }

  // --- Aurinko ----------------------------------------------------------------------

  var DAYMS = 86400000, J1970 = 2440588, J2000 = 2451545, OBL = RAD * 23.4397, J0 = 0.0009;
  function toDays(ms) { return ms / DAYMS - 0.5 + J1970 - J2000; }
  function fromJulian(j) { return (j + 0.5 - J1970) * DAYMS; }

  /** Auringon nousu ja lasku sekä porvarillinen hämärä sen vuorokauden osalta, jonka keskipäivä on lähinnä ms. */
  function sunTimes(ms, lat, lon) {
    var lw = RAD * -lon, phi = RAD * lat, d = toDays(ms);
    var n = Math.round(d - J0 - lw / (2 * Math.PI));
    var ds = J0 + lw / (2 * Math.PI) + n;
    var M = RAD * (357.5291 + 0.98560028 * ds);
    var C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    var L = M + C + RAD * 102.9372 + Math.PI;
    var dec = Math.asin(Math.sin(OBL) * Math.sin(L));
    var Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    function at(h0) {
      var cosH = (Math.sin(h0 * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
      if (cosH > 1) return { polar: 'night' };
      if (cosH < -1) return { polar: 'day' };
      var w = Math.acos(cosH);
      var a = J0 + (w + lw) / (2 * Math.PI) + n;
      var Jset = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
      return { set: fromJulian(Jset), rise: fromJulian(Jnoon - (Jset - Jnoon)) };
    }
    var s = at(-0.833), c = at(-6);
    return { rise: s.rise || null, set: s.set || null, polar: s.polar || null, dawn: c.rise || null, dusk: c.set || null };
  }

  function localNoon(ms) { var d = new Date(ms); d.setHours(12, 0, 0, 0); return d.getTime(); }

  // --- Ilmatieteen laitos ja MET Norway ---------------------------------------------

  function cleanNum(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  var FMI_PARAMS = { WindDirection: 'dir', WindSpeedMS: 'spd', WindGust: 'gust', Temperature: 'temp', Precipitation1h: 'prec' };

  /** FMI:n "simple"-kyselyn XML -> [{t, dir, spd, gust, temp, prec}] aikajärjestyksessä. */
  function parseFmi(xmlText, DOMParserCtor) {
    var P = DOMParserCtor || (typeof DOMParser !== 'undefined' ? DOMParser : null);
    var doc = new P().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('FMI: virheellinen XML');
    var ex = doc.getElementsByTagNameNS('*', 'ExceptionText');
    if (ex.length) throw new Error('FMI: ' + (ex[0].textContent || 'virhe').trim().slice(0, 160));
    var els = doc.getElementsByTagNameNS('*', 'BsWfsElement'), byT = {};
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var t = Date.parse((el.getElementsByTagNameNS('*', 'Time')[0] || {}).textContent);
      var name = ((el.getElementsByTagNameNS('*', 'ParameterName')[0] || {}).textContent || '').trim();
      var val = cleanNum(((el.getElementsByTagNameNS('*', 'ParameterValue')[0] || {}).textContent || '').trim());
      if (!isFinite(t) || !FMI_PARAMS[name]) continue;
      var e = byT[t] || (byT[t] = { t: t, dir: null, spd: null, gust: null, temp: null, prec: null });
      e[FMI_PARAMS[name]] = val;
    }
    return Object.keys(byT).map(function (k) { return byT[k]; }).sort(function (a, b) { return a.t - b.t; });
  }

  /** MET Norway nowcast 2.0 JSON -> {coverage, series:[{t, r}]} (r = sateen intensiteetti mm/h). */
  function parseNowcast(j) {
    var p = j && j.properties;
    if (!p || !Array.isArray(p.timeseries)) throw new Error('MET: odottamaton vastaus');
    var series = [];
    p.timeseries.forEach(function (e) {
      var t = Date.parse(e.time);
      var d = e.data && e.data.instant && e.data.instant.details;
      if (isFinite(t)) series.push({ t: t, r: d ? cleanNum(d.precipitation_rate) : null });
    });
    return { coverage: String((p.meta && p.meta.radar_coverage) || 'unknown'), series: series };
  }

  /** Seuraavien h tunnin rivit sarjasta (ensimmäinen = kuluva tunti). */
  function nextHours(series, now, h) {
    var start = now - 3600000;
    return series.filter(function (e) { return e.t > start; }).slice(0, h + 1).filter(function (e) { return e.t <= now + h * 3600000; });
  }

  /** Yhteenveto 3 h ajalta: suurin tuuli, puuska ja sademäärä. */
  function summarize(rows) {
    var s = { spd: null, gust: null, prec: 0, dir: null, temp: null };
    rows.forEach(function (r, i) {
      if (r.spd !== null && (s.spd === null || r.spd > s.spd)) { s.spd = r.spd; s.dir = r.dir; }
      if (r.gust !== null && (s.gust === null || r.gust > s.gust)) s.gust = r.gust;
      if (r.prec !== null) s.prec += r.prec;
      if (i === 0) s.temp = r.temp;
    });
    s.prec = Math.round(s.prec * 10) / 10;
    return s;
  }

  /** Ensimmäinen hetki, jolloin sade alkaa (>= 0,1 mm/h), tai null. */
  function rainStart(series, now) {
    for (var i = 0; i < series.length; i++) {
      var e = series[i];
      if (e.t >= now - 5 * 60000 && e.r !== null && e.r >= 0.1) return e.t;
    }
    return null;
  }

  // --- Kompassi --------------------------------------------------------------------

  /** Laitteen yläreunan kompassisuunta. Android: deviceorientationabsolute (alpha). iOS: webkitCompassHeading. */
  function compassHeading(e, screenAngle) {
    var sa = Number(screenAngle) || 0;
    if (e && typeof e.webkitCompassHeading === 'number' && isFinite(e.webkitCompassHeading)) return norm360(e.webkitCompassHeading + sa);
    if (!e || typeof e.alpha !== 'number' || !isFinite(e.alpha)) return null;
    if (typeof e.beta === 'number' && Math.abs(e.beta) > 80) return null;
    return norm360(360 - e.alpha + sa);
  }

  // --- Karttatiilet ------------------------------------------------------------------

  function lon2x(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
  function lat2y(lat, z) {
    var r = lat * RAD;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
  }

  /** Rajauksen [minLon, minLat, maxLon, maxLat] tiilet tasoilla zmin..zmax. */
  function tilesForBbox(bbox, zmin, zmax) {
    var out = [];
    for (var z = zmin; z <= zmax; z++) {
      var x0 = lon2x(bbox[0], z), x1 = lon2x(bbox[2], z), y0 = lat2y(bbox[3], z), y1 = lat2y(bbox[1], z);
      for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) out.push({ z: z, x: x, y: y });
    }
    return out;
  }
  function countTiles(bbox, zmin, zmax) {
    var n = 0;
    for (var z = zmin; z <= zmax; z++) {
      n += (lon2x(bbox[2], z) - lon2x(bbox[0], z) + 1) * (lat2y(bbox[1], z) - lat2y(bbox[3], z) + 1);
    }
    return n;
  }

  // --- GeoJSON-tasot -------------------------------------------------------------------

  var MAX_FEATURES = 2000;

  function validCoord(c) {
    return Array.isArray(c) && c.length >= 2 && isFinite(c[0]) && isFinite(c[1]) &&
      c[0] >= -180 && c[0] <= 180 && c[1] >= -90 && c[1] <= 90;
  }
  function eachCoord(g, fn) {
    if (!g) return;
    var t = g.type, c = g.coordinates;
    if (t === 'Point') fn(c);
    else if (t === 'MultiPoint' || t === 'LineString') c.forEach(fn);
    else if (t === 'MultiLineString' || t === 'Polygon') c.forEach(function (r) { r.forEach(fn); });
    else if (t === 'MultiPolygon') c.forEach(function (p) { p.forEach(function (r) { r.forEach(fn); }); });
    else if (t === 'GeometryCollection') (g.geometries || []).forEach(function (x) { eachCoord(x, fn); });
  }

  /**
   * Tarkistaa tuodun GeoJSONin: vain FeatureCollection, enintään MAX_FEATURES kohdetta, kelvolliset koordinaatit.
   * Ominaisuuksista säilytetään vain tunnetut tekstikentät (nimi, tyyppi, kuvaus), joten ylimääräinen tieto ei tallennu.
   */
  function cleanGeoJSON(obj) {
    if (!obj || obj.type !== 'FeatureCollection' || !Array.isArray(obj.features)) throw new Error('Tiedosto ei ole GeoJSON FeatureCollection.');
    if (obj.features.length > MAX_FEATURES) throw new Error('Liikaa kohteita (yli ' + MAX_FEATURES + ').');
    var TYPES = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];
    var out = [];
    obj.features.forEach(function (f) {
      if (!f || f.type !== 'Feature' || !f.geometry || TYPES.indexOf(f.geometry.type) < 0) return;
      var ok = true;
      eachCoord(f.geometry, function (c) { if (!validCoord(c)) ok = false; });
      if (!ok) return;
      var p = f.properties || {}, props = {};
      ['nimi', 'name', 'tyyppi', 'kuvaus', 'description', 'joki_id'].forEach(function (k) {
        if (typeof p[k] === 'string' || typeof p[k] === 'number') props[k] = String(p[k]).slice(0, 300);
      });
      out.push({ type: 'Feature', geometry: f.geometry, properties: props });
    });
    if (!out.length) throw new Error('Tiedostossa ei ole kelvollisia kohteita.');
    return { type: 'FeatureCollection', features: out };
  }

  function bboxOf(gj) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    (gj.features || []).forEach(function (f) {
      eachCoord(f.geometry, function (c) {
        if (c[0] < b[0]) b[0] = c[0]; if (c[1] < b[1]) b[1] = c[1];
        if (c[0] > b[2]) b[2] = c[0]; if (c[1] > b[3]) b[3] = c[1];
      });
    });
    return isFinite(b[0]) ? b : null;
  }

  /** Tason tallennusalue: alue-tyyppisten polygonien rajaus, muuten koko tason rajaus. */
  function areaBbox(gj) {
    var polys = (gj.features || []).filter(function (f) {
      return f.geometry && /Polygon/.test(f.geometry.type) && (f.properties || {}).tyyppi === 'alue';
    });
    return bboxOf(polys.length ? { features: polys } : gj);
  }

  // --- Perhosuositukset ------------------------------------------------------------------

  /**
   * Valitsee kehitysvaiheen havaintojen perusteella.
   * obs.surface: nouseeko kaloja / kuoriutuuko pinnalla; obs.flying: lentääkö hyönteisiä veden yllä;
   * obs.signs: näkyykö kuoriutumisen merkkejä (lentäviä hyönteisiä rannalla, nahkoja kivillä).
   */
  function pickStages(obs) {
    if (obs.surface) return obs.flying ? ['pinturi', 'aikuinen'] : ['pinturi'];
    if (obs.signs) return ['nousussa'];
    return ['pohjalla'];
  }

  /**
   * Suositukset: [{ryhma, vaihe, syvyys, kuvaus, perhot:[{nimi, koko, kuva}], huom}].
   * data = perhot.json, species = lajin avain, group = ryhmän avain tai 'kaikki'.
   */
  function recommend(data, species, group, obs) {
    var sp = data.lajit[species];
    if (!sp) return [];
    var groups = group === 'kaikki' ? sp.ryhmat : sp.ryhmat.filter(function (g) { return g === group; });
    if (!groups.length && group !== 'kaikki') groups = [group];
    var stages = pickStages(obs), out = [];
    groups.forEach(function (gk) {
      var g = data.ryhmat[gk];
      if (!g) return;
      stages.forEach(function (st) {
        var v = g.vaiheet[st], note = null;
        if (!v && st === 'pinturi' && g.vaiheet.aikuinen) {
          v = g.vaiheet.aikuinen;
          note = g.huom || (g.nimi + ': ei pinturivaihetta.');
          if (stages.indexOf('aikuinen') >= 0) return;
        }
        if (!v) return;
        out.push({
          ryhma: g.nimi, vaihe: v.nimi, syvyys: v.syvyys, kuvaus: v.kuvaus, kuva: v.kuva,
          perhot: (v.perhot || []).map(function (p) {
            return { nimi: p.nimi, koko: p.koko || sp.koot, kuva: p.kuva || v.kuva, kuvaaja: p.kuvaaja, lisenssi: p.lisenssi, lahde: p.lahde };
          }),
          huom: note
        });
      });
    });
    return out;
  }

  function sanitizeKey(k) { return typeof k === 'string' ? k.trim().replace(/[^A-Za-z0-9._~-]/g, '').slice(0, 100) : ''; }

  return {
    norm360: norm360, angleDiff: angleDiff, distance: distance, bearing: bearing, destPoint: destPoint,
    dirName: dirName, ringPoints: ringPoints, roundCoord: roundCoord, fmtDistance: fmtDistance,
    toTM35FIN: toTM35FIN, fmtDM: fmtDM, sunTimes: sunTimes, localNoon: localNoon,
    parseFmi: parseFmi, parseNowcast: parseNowcast, nextHours: nextHours, summarize: summarize, rainStart: rainStart,
    compassHeading: compassHeading, tilesForBbox: tilesForBbox, countTiles: countTiles,
    cleanGeoJSON: cleanGeoJSON, bboxOf: bboxOf, areaBbox: areaBbox,
    pickStages: pickStages, recommend: recommend, sanitizeKey: sanitizeKey
  };
});
