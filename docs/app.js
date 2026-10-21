/* Joki guide: käyttöliittymä. Kaikki käyttäjän tiedot (API-avain, tuodut tasot, välimuisti) pysyvät tässä laitteessa. */
(function () {
  'use strict';

  var JG = window.JG;
  var VERSION = '0.2.2';
  var MML_BASE = 'https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0';
  var MML_LAYERS = {
    maastokartta: { path: 'maastokartta', ext: 'png', estKB: 20, name: 'Maastokartta' },
    taustakartta: { path: 'taustakartta', ext: 'png', estKB: 15, name: 'Taustakartta' },
    ortokuva: { path: 'ortokuva', ext: 'jpg', estKB: 40, name: 'Ilmakuva' }
  };
  var FMI_WFS = 'https://opendata.fmi.fi/wfs';
  var MET_NOWCAST = 'https://api.met.no/weatherapi/nowcast/2.0/complete';
  var TILE_CACHE = 'jg-tiles-v1';
  var RING_M = 20000;
  var WX_MAX_AGE = 30 * 60 * 1000;
  var OFFLINE_ZMIN = 8;
  var MAX_TILES = 20000;
  var DEFAULT_VIEW = { c: [69.11, 21.67], z: 11 };

  // --- Paikallinen tallennus (vain tämä laite) -----------------------------------------

  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem('jg.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem('jg.' + k, JSON.stringify(v)); return true; } catch (e) { return false; }
    },
    del: function (k) { try { localStorage.removeItem('jg.' + k); } catch (e) { /* estetty */ } }
  };

  var settings = Object.assign({ apiKey: '', basemap: 'maastokartta', rings: false, water: false, offlineMaxZ: 15, hidden: {} },
    store.get('settings', {}));
  settings.apiKey = JG.sanitizeKey(settings.apiKey);
  if (!MML_LAYERS[settings.basemap]) settings.basemap = 'maastokartta';
  function saveSettings() { store.set('settings', settings); }

  var S = { pos: null, watchId: null, follow: false, heading: null, compassOn: false, measuring: false,
            pts: [], layers: {}, wx: store.get('wx', null), wxLoading: false, dl: null, flies: null,
            fly: { species: 'harjus', group: 'kaikki', surface: null, flying: null, signs: null, water: null } };

  // --- DOM-apurit: teksti asetetaan aina textContentina, ei HTML:nä -----------------------

  function $(id) { return document.getElementById(id); }
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svgArrow(deg) {
    var s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'arrow');
    var g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('transform', 'rotate(' + Math.round(deg) + ' 12 12)');
    var p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', 'M12 2 L18 20 L12 16 L6 20 Z');
    p.setAttribute('fill', 'currentColor');
    g.appendChild(p); s.appendChild(g);
    return s;
  }

  var toastTimer = 0;
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 3500);
  }

  function fmt1(n) { return n === null || n === undefined ? '–' : (Math.round(n * 10) / 10).toString().replace('.', ','); }
  function hm(ms) { return new Date(ms).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' }); }

  // --- Kartta ----------------------------------------------------------------------------

  var view = store.get('view', DEFAULT_VIEW);
  var map = L.map('map', { zoomControl: false, attributionControl: true, maxZoom: 18, tap: true })
    .setView(view.c, view.z);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  map.attributionControl.setPrefix(false);
  map.on('moveend', function () {
    var c = map.getCenter();
    store.set('view', { c: [JG.roundCoord(c.lat, 4), JG.roundCoord(c.lng, 4)], z: map.getZoom() });
  });

  function mmlTemplate(layer) {
    var L_ = MML_LAYERS[layer];
    return MML_BASE + '/' + L_.path + '/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.' + L_.ext;
  }
  function mmlTileUrl(layer, z, x, y, key) {
    return mmlTemplate(layer).replace('{z}', z).replace('{y}', y).replace('{x}', x) + '?api-key=' + encodeURIComponent(key);
  }

  var base = null;
  function setBasemap() {
    if (base) map.removeLayer(base);
    var key = settings.apiKey;
    if (key) {
      base = L.tileLayer(mmlTemplate(settings.basemap) + '?api-key=' + encodeURIComponent(key), {
        maxNativeZoom: 16, maxZoom: 18, keepBuffer: 3, crossOrigin: 'anonymous',
        attribution: '© Maanmittauslaitos (CC BY 4.0)'
      });
    } else {
      // Ilman avainta OpenStreetMap, vain verkossa (OSM ei salli karttojen joukkolatausta).
      base = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18, attribution: '© OpenStreetMapin tekijät'
      });
    }
    base.addTo(map);
  }
  setBasemap();

  // --- Omat tasot (GeoJSON) --------------------------------------------------------------

  var STYLE = {
    alue: { color: '#ffd166', weight: 2.5, dashArray: '6 6', fillColor: '#ffd166', fillOpacity: 0.06 },
    joki: { color: '#2b8cbe', weight: 4 },
    reitti: { color: '#e5484d', weight: 3, dashArray: '4 6' },
    oletus: { color: '#4cc3d9', weight: 3, fillOpacity: 0.12 }
  };
  var POINT = {
    koski: '#2b8cbe', suvanto: '#7fc8e8', tupa: '#ffd166', laavu: '#ff9f43', parkki: '#cfd8dc', kohde: '#5bd18b'
  };

  function featureTitle(p) { return p.nimi || p.name || 'Kohde'; }
  function popupFor(p) {
    var box = h('div', null, [h('div', { class: 'pop-t', text: featureTitle(p) })]);
    if (p.tyyppi) box.appendChild(h('div', { class: 'muted small', text: p.tyyppi }));
    if (p.kuvaus || p.description) box.appendChild(h('p', { class: 'small', text: p.kuvaus || p.description }));
    return box;
  }

  function makeLayer(gj) {
    return L.geoJSON(gj, {
      style: function (f) { var t = (f.properties || {}).tyyppi; return STYLE[t] || STYLE.oletus; },
      pointToLayer: function (f, ll) {
        var c = POINT[(f.properties || {}).tyyppi] || '#4cc3d9';
        return L.circleMarker(ll, { radius: 7, color: '#0b1418', weight: 2, fillColor: c, fillOpacity: 1 });
      },
      onEachFeature: function (f, l) {
        l.bindPopup(function () { return popupFor(f.properties || {}); });
        // Tietoikkuna pysäyttää napautuksen, joten mittauksen aikana piste lisätään tässä ja ikkuna suljetaan.
        l.on('click', function (e) { if (S.measuring) { l.closePopup(); addMeasurePoint(e.latlng); } });
      }
    });
  }

  function addLayerEntry(id, name, gj, imported) {
    var layer = makeLayer(gj);
    S.layers[id] = { id: id, name: name, gj: gj, layer: layer, imported: !!imported };
    if (!settings.hidden[id]) layer.addTo(map);
  }

  function loadLayers() {
    store.get('imported', []).forEach(function (x) {
      try { addLayerEntry(x.id, x.nimi, JG.cleanGeoJSON(x.gj), true); } catch (e) { /* ohitetaan viallinen */ }
    });
    return fetch('layers/index.json', { credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (idx) {
      return Promise.all((idx.tasot || []).map(function (t) {
        if (!/^[a-z0-9_-]+\.geojson$/i.test(t.tiedosto)) return null;
        return fetch('layers/' + t.tiedosto, { credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (gj) {
          addLayerEntry(t.id, t.nimi, JG.cleanGeoJSON(gj), false);
        }).catch(function () { toast('Tasoa ' + t.nimi + ' ei voitu ladata.'); });
      }));
    }).catch(function () { /* ilman verkkoa ja välimuistia */ }).then(updateChip);
  }

  function updateChip() {
    var vis = Object.keys(S.layers).filter(function (k) { return !settings.hidden[k]; }).map(function (k) { return S.layers[k].name; });
    $('layerChip').textContent = vis.length ? vis.join(', ') : 'Tasot';
  }

  function fitLayer(id) {
    var e = S.layers[id];
    if (!e) return;
    var b = JG.areaBbox(e.gj);
    if (b) map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [30, 30] });
  }

  // --- Sijainti ja etäisyysrenkaat ------------------------------------------------------

  var posMarker = null, accCircle = null, rings = L.layerGroup().addTo(map);

  function startLocate() {
    if (!navigator.geolocation) { toast('Laite ei tue sijaintia.'); return; }
    S.follow = true;
    $('btnLocate').classList.add('on');
    S.watchId = navigator.geolocation.watchPosition(onPos, function (err) {
      toast(err.code === 1 ? 'Sijaintilupa evätty. Salli sijainti selaimen asetuksista.' : 'Sijaintia ei saatu.');
      stopLocate();
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  }
  function stopLocate() {
    if (S.watchId !== null) navigator.geolocation.clearWatch(S.watchId);
    S.watchId = null; S.follow = false;
    $('btnLocate').classList.remove('on');
  }
  function onPos(p) {
    var first = !S.pos;
    S.pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: p.timestamp };
    var ll = [S.pos.lat, S.pos.lon];
    if (!posMarker) {
      posMarker = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#2f80ed', fillOpacity: 1 }).addTo(map);
      accCircle = L.circle(ll, { radius: S.pos.acc, color: '#2f80ed', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(map);
    } else { posMarker.setLatLng(ll); accCircle.setLatLng(ll).setRadius(S.pos.acc); }
    if (first || S.follow) map.setView(ll, first ? Math.max(map.getZoom(), 13) : map.getZoom());
    drawRings(); updateMeasureText(); updateCompassTarget();
    if (S.sheet === 'sos') renderSos();
  }
  map.on('dragstart', function () { S.follow = false; });

  function ringCenter() { return S.pos ? [S.pos.lat, S.pos.lon] : null; }
  function drawRings() {
    rings.clearLayers();
    var c = ringCenter();
    if (!settings.rings || !c) return;
    [1000, 5000, 20000].forEach(function (r) {
      L.circle(c, { radius: r, color: '#ffffff', weight: 1.5, dashArray: '5 6', fill: false, interactive: false }).addTo(rings);
      var lbl = JG.destPoint(c[0], c[1], 0, r);
      L.marker(lbl, { interactive: false, icon: L.divIcon({ className: 'dist-label', html: h('span', { text: JG.fmtDistance(r) }), iconSize: null }) }).addTo(rings);
    });
  }

  // --- Kompassi -------------------------------------------------------------------------

  var ORIENT_EVENT = ('ondeviceorientationabsolute' in window) ? 'deviceorientationabsolute' : 'deviceorientation';
  var lastHeadingDraw = 0;
  function screenAngle() {
    var o = window.screen && window.screen.orientation;
    return o && typeof o.angle === 'number' ? o.angle : (typeof window.orientation === 'number' ? window.orientation : 0);
  }
  function onOrient(e) {
    if (e.type === 'deviceorientation' && !e.absolute && typeof e.webkitCompassHeading !== 'number') return;
    var hd = JG.compassHeading(e, screenAngle());
    if (hd === null) return;
    S.heading = hd;
    var now = Date.now();
    if (now - lastHeadingDraw < 80) return;
    lastHeadingDraw = now;
    $('roseDial').setAttribute('transform', 'rotate(' + (-hd).toFixed(1) + ' 50 50)');
    $('headingText').textContent = Math.round(hd) + '° ' + JG.dirName(hd);
    updateCompassTarget();
  }
  function compassTarget() { return S.pts.length ? S.pts[S.pts.length - 1] : null; }
  function updateCompassTarget() {
    var t = compassTarget(), arrow = $('targetArrow'), txt = $('targetText');
    if (!S.compassOn) return;
    if (!t || !S.pos) {
      arrow.classList.add('hidden');
      txt.textContent = t ? 'Kohteen suunta näkyy, kun sijainti on päällä.' : 'Lisää kohde mittaustyökalulla.';
      return;
    }
    var brg = JG.bearing(S.pos.lat, S.pos.lon, t.lat, t.lng), d = JG.distance(S.pos.lat, S.pos.lon, t.lat, t.lng);
    txt.textContent = 'Kohde ' + JG.fmtDistance(d) + ', suunta ' + Math.round(brg) + '° ' + JG.dirName(brg);
    if (S.heading === null) { arrow.classList.add('hidden'); return; }
    arrow.classList.remove('hidden');
    arrow.setAttribute('transform', 'rotate(' + (brg - S.heading).toFixed(1) + ' 50 50)');
  }
  function toggleCompass() {
    if (S.compassOn) {
      window.removeEventListener(ORIENT_EVENT, onOrient);
      S.compassOn = false; S.heading = null;
      $('compass').classList.add('hidden'); $('btnCompass').classList.remove('on');
      return;
    }
    var ask = (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') ?
      DeviceOrientationEvent.requestPermission().catch(function () { return 'denied'; }) : Promise.resolve('granted');
    ask.then(function (st) {
      if (st !== 'granted') { toast('Kompassin käyttölupa evätty.'); return; }
      window.addEventListener(ORIENT_EVENT, onOrient);
      S.compassOn = true;
      $('compass').classList.remove('hidden'); $('btnCompass').classList.add('on');
      $('headingText').textContent = '–';
      updateCompassTarget();
      setTimeout(function () { if (S.compassOn && S.heading === null) toast('Kompassi ei anna lukemaa. Laitteessa ei ehkä ole magneettianturia.'); }, 4000);
    });
  }

  // --- Etäisyyden mittaus ----------------------------------------------------------------

  var measureLayer = L.layerGroup().addTo(map);
  function addMeasurePoint(ll) { S.pts.push(ll); drawMeasure(); }
  function drawMeasure() {
    measureLayer.clearLayers();
    if (S.pts.length > 1) L.polyline(S.pts, { color: '#ffd166', weight: 3 }).addTo(measureLayer);
    var total = 0;
    S.pts.forEach(function (p, i) {
      if (i > 0) total += JG.distance(S.pts[i - 1].lat, S.pts[i - 1].lng, p.lat, p.lng);
      L.circleMarker(p, { radius: 5, color: '#0b1418', weight: 2, fillColor: '#ffd166', fillOpacity: 1, interactive: false }).addTo(measureLayer);
      if (i > 0) L.marker(p, { interactive: false, icon: L.divIcon({ className: 'dist-label', html: h('span', { text: JG.fmtDistance(total) }), iconSize: null, iconAnchor: [-8, 8] }) }).addTo(measureLayer);
    });
    updateMeasureText(); updateCompassTarget();
  }
  function updateMeasureText() {
    var el = $('measureText');
    if (!S.pts.length) { el.textContent = 'Napauta karttaa lisätäksesi pisteitä.'; return; }
    var total = 0, n = S.pts.length, parts = [];
    for (var i = 1; i < n; i++) total += JG.distance(S.pts[i - 1].lat, S.pts[i - 1].lng, S.pts[i].lat, S.pts[i].lng);
    if (n > 1) {
      var a = S.pts[n - 2], b = S.pts[n - 1], brg = JG.bearing(a.lat, a.lng, b.lat, b.lng);
      parts.push('Matka ' + JG.fmtDistance(total) + ', viimeinen osuus ' + Math.round(brg) + '° ' + JG.dirName(brg));
    }
    if (S.pos) {
      var t = S.pts[n - 1], d = JG.distance(S.pos.lat, S.pos.lon, t.lat, t.lng), b2 = JG.bearing(S.pos.lat, S.pos.lon, t.lat, t.lng);
      parts.push('Minusta ' + JG.fmtDistance(d) + ', suunta ' + Math.round(b2) + '° ' + JG.dirName(b2));
    } else if (n === 1) parts.push('Lisää toinen piste tai laita sijainti päälle.');
    el.textContent = parts.join(' · ');
  }
  function setMeasuring(on) {
    S.measuring = on;
    $('measureBar').classList.toggle('hidden', !on);
    $('btnMeasure').classList.toggle('on', on);
    if (on) closeSheet();
  }
  map.on('click', function (e) { if (S.measuring) addMeasurePoint(e.latlng); });

  // --- Sää ja tuuli -------------------------------------------------------------------------

  function fetchWithTimeout(url, ms) {
    var c = new AbortController(), t = setTimeout(function () { c.abort(); }, ms);
    return fetch(url, { signal: c.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' })
      .then(function (r) { clearTimeout(t); return r; }, function (e) { clearTimeout(t); throw e; });
  }
  function isoHour(ms) { var d = new Date(ms); d.setUTCMinutes(0, 0, 0); return d.toISOString().replace('.000Z', 'Z'); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function fetchFmi(lat, lon) {
    var now = Date.now();
    function q(params) {
      return FMI_WFS + '?service=WFS&version=2.0.0&request=getFeature' +
        '&storedquery_id=fmi::forecast::edited::weather::scandinavia::point::simple' +
        '&latlon=' + lat + ',' + lon + '&parameters=' + params + '&timestep=60' +
        '&starttime=' + isoHour(now) + '&endtime=' + isoHour(now + 4 * 3600000);
    }
    function get(params) {
      return fetchWithTimeout(q(params), 15000).then(function (r) { return r.text(); }).then(function (x) {
        var s = JG.parseFmi(x);
        if (!s.length) throw new Error('FMI: ei tietoa');
        return s;
      });
    }
    return get('Temperature,WindSpeedMS,WindGust,WindDirection,Precipitation1h')
      .catch(function (e) { if (/^FMI:/.test(e.message)) return get('Temperature,WindSpeedMS,WindDirection,Precipitation1h'); throw e; });
  }
  function fetchNowcast(lat, lon) {
    return fetchWithTimeout(MET_NOWCAST + '?lat=' + lat + '&lon=' + lon, 15000).then(function (r) {
      if (!r.ok) throw new Error('MET HTTP ' + r.status);
      return r.json();
    }).then(JG.parseNowcast);
  }

  function wxCenter() {
    if (S.pos) return { lat: S.pos.lat, lon: S.pos.lon, gps: true };
    var c = map.getCenter();
    return { lat: c.lat, lon: c.lng, gps: false };
  }

  function refreshWeather(force) {
    if (S.wxLoading) return;
    if (!navigator.onLine) { toast('Ei verkkoyhteyttä. Näytetään viimeisin haettu ennuste.'); renderWeather(); return; }
    var c = wxCenter();
    if (!force && S.wx && Date.now() - S.wx.at < WX_MAX_AGE && JG.distance(c.lat, c.lon, S.wx.lat, S.wx.lon) < 3000) { renderWeather(); return; }
    S.wxLoading = true;
    renderWeather();
    // Pyöristys ennen lähetystä: tarkka sijainti ei lähde laitteesta.
    var pts = JG.ringPoints(c.lat, c.lon, RING_M).map(function (p) {
      return { lat: JG.roundCoord(p.lat, 2), lon: JG.roundCoord(p.lon, 2), dir: p.dir, label: p.label };
    });
    var i = 0, failed = 0;
    function next() {
      if (i >= pts.length) return Promise.resolve();
      var p = pts[i++];
      return Promise.all([
        fetchFmi(p.lat, p.lon).then(function (s) { p.fmi = s; }).catch(function () { p.fmi = null; failed++; }),
        fetchNowcast(p.lat, p.lon).then(function (n) { p.now = n; }).catch(function () { p.now = null; })
      ]).then(function () { return wait(120); }).then(next);
    }
    next().then(function () {
      S.wxLoading = false;
      if (failed === pts.length) { toast('Sääennustetta ei saatu.'); renderWeather(); return; }
      S.wx = { at: Date.now(), lat: c.lat, lon: c.lon, gps: c.gps, pts: pts };
      store.set('wx', { at: S.wx.at, lat: JG.roundCoord(c.lat, 2), lon: JG.roundCoord(c.lon, 2), gps: c.gps, pts: pts });
      drawWind(); renderWeather();
    });
  }

  var windLayer = L.layerGroup().addTo(map);
  function drawWind() {
    windLayer.clearLayers();
    if (!S.wx) return;
    var now = Date.now();
    S.wx.pts.forEach(function (p) {
      if (!p.fmi) return;
      var rows = JG.nextHours(p.fmi, now, 0), r = rows[0];
      if (!r || r.dir === null) return;
      var box = h('div', { class: 'wbox' });
      box.appendChild(svgArrow(r.dir + 180));
      box.appendChild(h('span', { class: 'lbl', text: fmt1(r.spd) + ' m/s' }));
      L.marker([p.lat, p.lon], { interactive: false, icon: L.divIcon({ className: 'wind-icon', html: box, iconSize: [34, 34] }) }).addTo(windLayer);
    });
  }

  function sunLine(lat, lon) {
    var st = JG.sunTimes(JG.localNoon(Date.now()), lat, lon);
    if (st.polar === 'day') return 'Aurinko ei laske tänään.';
    if (st.polar === 'night') return 'Aurinko ei nouse tänään (kaamos).';
    return 'Aurinko nousee ' + hm(st.rise) + ' ja laskee ' + hm(st.set) + (st.dusk ? ', hämärä päättyy ' + hm(st.dusk) : '') + '.';
  }

  function renderWeather() {
    if (S.sheet !== 'weather') return;
    var body = $('sheetBody');
    body.textContent = '';
    var row = h('div', { class: 'row' }, [
      h('button', { class: 'btn primary', type: 'button', text: S.wxLoading ? 'Haetaan…' : 'Päivitä', disabled: S.wxLoading, onclick: function () { refreshWeather(true); } })
    ]);
    body.appendChild(row);
    var c = wxCenter();
    body.appendChild(h('p', { class: 'small', text: sunLine(c.lat, c.lon) }));
    if (!S.wx) { body.appendChild(h('p', { class: 'muted', text: S.wxLoading ? 'Haetaan ennustetta 9 pisteeseen…' : 'Ei haettua ennustetta.' })); return; }
    var now = Date.now(), ctr = S.wx.pts[0];
    body.appendChild(h('p', { class: 'muted small', text: 'Ennuste haettu ' + hm(S.wx.at) + (S.wx.gps ? ' sijainnistasi' : ' kartan keskeltä') +
      '. Lähteet: Ilmatieteen laitos, MET Norway (CC BY 4.0).' }));
    if (now - S.wx.at > 3 * 3600000) body.appendChild(h('p', { class: 'warn small', text: 'Ennuste on yli 3 tuntia vanha.' }));

    body.appendChild(h('h3', { text: 'Seuraavat 3 tuntia' }));
    if (ctr.fmi) {
      var tb = h('tbody');
      JG.nextHours(ctr.fmi, now, 3).forEach(function (r) {
        var dirCell = h('td');
        if (r.dir !== null) { dirCell.appendChild(svgArrow(r.dir + 180)); dirCell.appendChild(document.createTextNode(' ' + JG.dirName(r.dir))); }
        tb.appendChild(h('tr', null, [
          h('td', { text: hm(r.t) }), h('td', { text: fmt1(r.temp) + ' °C' }),
          h('td', { text: fmt1(r.spd) + (r.gust !== null ? ' (' + fmt1(r.gust) + ')' : '') }), dirCell,
          h('td', { text: fmt1(r.prec) })
        ]));
      });
      body.appendChild(h('table', { class: 'wx' }, [h('thead', null, [h('tr', null, [
        h('th', { text: 'Klo' }), h('th', { text: 'Lämpö' }), h('th', { text: 'Tuuli m/s (puuska)' }), h('th', { text: 'Tulee' }), h('th', { text: 'Sade mm' })
      ])]), tb]));
    } else body.appendChild(h('p', { class: 'muted', text: 'Sijainnin ennustetta ei saatu.' }));
    if (ctr.now) {
      var rs = JG.rainStart(ctr.now.series, now);
      body.appendChild(h('p', { class: 'small', text: 'Sadetutka 0–2 h: ' + (rs === null ? 'ei sadetta tiedossa.' : (rs <= now + 5 * 60000 ? 'sataa nyt.' : 'sade alkaa noin klo ' + hm(rs) + '.')) +
        (ctr.now.coverage !== 'ok' ? ' Tutkan kattavuus alueella on heikko.' : '') }));
    }

    body.appendChild(h('h3', { text: '20 km ympärillä, seuraavat 3 h' }));
    var grid = h('div', { class: 'ring-grid' });
    var order = [7, 0, 1, 6, -1, 2, 5, 4, 3];
    order.forEach(function (k) {
      var p = k < 0 ? ctr : S.wx.pts[k + 1];
      var cell = h('div', { class: 'cell' + (k < 0 ? ' center' : '') }, [h('b', { text: k < 0 ? 'Sijainti' : p.label })]);
      if (p.fmi) {
        var s = JG.summarize(JG.nextHours(p.fmi, now, 3));
        cell.appendChild(h('div', { text: 'Tuuli ' + fmt1(s.spd) + (s.gust !== null ? ' (' + fmt1(s.gust) + ')' : '') }));
        cell.appendChild(h('div', { text: 'Sade ' + fmt1(s.prec) + ' mm' }));
      } else cell.appendChild(h('div', { class: 'muted', text: 'ei tietoa' }));
      if (p.now) {
        var r0 = JG.rainStart(p.now.series, now);
        if (r0 !== null) cell.appendChild(h('div', { class: 'warn', text: r0 <= now + 5 * 60000 ? 'Sataa nyt' : 'Sade ' + hm(r0) }));
      }
      grid.appendChild(cell);
    });
    body.appendChild(grid);
    body.appendChild(h('p', { class: 'muted small', text: 'Tuulinuolet kartalla näyttävät, mihin tuuli puhaltaa. Taulukon suunta kertoo, mistä tuuli tulee.' }));
  }

  // --- Perhosuositus ----------------------------------------------------------------------

  function loadFlies() {
    if (S.flies) return Promise.resolve(S.flies);
    return fetch('data/perhot.json', { credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (d) { S.flies = d; return d; });
  }

  function seg(options, value, onPick) {
    var box = h('div', { class: 'seg' });
    options.forEach(function (o) {
      box.appendChild(h('button', { type: 'button', class: o[0] === value ? 'on' : '', text: o[1], onclick: function () { onPick(o[0]); } }));
    });
    return box;
  }
  function yesNo(label, key) {
    return h('div', { class: 'field' }, [h('span', { text: label }), seg([[true, 'Kyllä'], [false, 'Ei']], S.fly[key], function (v) { S.fly[key] = v; renderFlies(); })]);
  }
  function flyCard(p, title, lines, badges) {
    var right = h('div', null, [h('div', { class: 't', text: title })]);
    (badges || []).forEach(function (b) { right.appendChild(h('span', { class: 'badge', text: b })); });
    lines.forEach(function (l) { if (l) right.appendChild(h('div', { class: 'small', text: l })); });
    if (p.kuvassa) right.appendChild(h('div', { class: 'credit', text: 'Kuvassa: ' + p.kuvassa }));
    if (/\.svg$/.test(p.kuva || '')) right.appendChild(h('div', { class: 'credit', text: 'Piirros: vapaata kuvaa ei löytynyt.' }));
    if (p.kuvaaja || p.lisenssi) {
      var credit = h('div', { class: 'credit' }, ['Kuva: ' + (p.kuvaaja || 'tuntematon') + ', ' + (p.lisenssi || '') + ', pienennetty, ']);
      if (p.lahde && /^https:\/\/commons\.wikimedia\.org\//.test(p.lahde)) {
        credit.appendChild(h('a', { href: p.lahde, target: '_blank', rel: 'noopener noreferrer', text: 'lähde' }));
      }
      right.appendChild(credit);
    }
    return h('div', { class: 'card' }, [h('img', { src: 'img/perhot/' + p.kuva, alt: title, loading: 'lazy' }), right]);
  }

  function renderFlies() {
    if (S.sheet !== 'flies') return;
    var body = $('sheetBody'), d = S.flies, f = S.fly;
    body.textContent = '';
    if (!d) { body.appendChild(h('p', { class: 'muted', text: 'Ladataan…' })); return; }
    body.appendChild(h('p', { class: 'warn small', text: d.lampoteksti }));
    body.appendChild(h('h3', { text: 'Kalalaji' }));
    body.appendChild(seg(Object.keys(d.lajit).map(function (k) { return [k, d.lajit[k].nimi]; }), f.species, function (v) { f.species = v; renderFlies(); }));
    var sp = d.lajit[f.species];

    if (sp.lohi) {
      body.appendChild(h('p', { class: 'small', text: d.lohi.huom }));
      body.appendChild(h('h3', { text: 'Veden tila' }));
      body.appendChild(seg(Object.keys(d.lohi.tilat).map(function (k) { return [k, d.lohi.tilat[k].nimi]; }), f.water, function (v) { f.water = v; renderFlies(); }));
      var t = d.lohi.tilat[f.water];
      if (t) t.perhot.forEach(function (p) { body.appendChild(flyCard({ kuva: p.kuva || t.kuva, kuvaaja: p.kuvaaja, lisenssi: p.lisenssi, lahde: p.lahde, kuvassa: p.kuvassa }, p.nimi, [t.tapa], [p.koko])); });
      body.appendChild(h('p', { class: 'muted small', text: d.huom }));
      return;
    }

    body.appendChild(h('p', { class: 'muted small', text: sp.nimi + ': koot ' + sp.koot + '. ' + (sp.lisa || '') }));
    body.appendChild(h('h3', { text: 'Hyönteinen' }));
    var groups = [['kaikki', 'En tiedä']].concat(sp.ryhmat.map(function (k) { return [k, d.ryhmat[k].nimi]; }));
    if (f.group !== 'kaikki' && sp.ryhmat.indexOf(f.group) < 0) f.group = 'kaikki';
    body.appendChild(seg(groups, f.group, function (v) { f.group = v; renderFlies(); }));

    body.appendChild(h('h3', { text: 'Mitä näet?' }));
    body.appendChild(yesNo('Nouseeko kaloja pintaan tai kuoriutuuko pinnalla hyönteisiä?', 'surface'));
    if (f.surface === true) body.appendChild(yesNo('Lentääkö veden yllä hyönteisiä tai munivia naaraita?', 'flying'));
    if (f.surface === false) body.appendChild(yesNo('Näkyykö kuoriutumisen merkkejä: lentäviä hyönteisiä rannalla tai nahkoja kivillä?', 'signs'));
    if (f.surface === null || (f.surface === false && f.signs === null)) {
      body.appendChild(h('p', { class: 'muted small', text: 'Vastaa kysymyksiin, niin sovellus valitsee kehitysvaiheen.' }));
      return;
    }
    var recs = JG.recommend(d, f.species, f.group, { surface: f.surface, flying: f.flying === true, signs: f.signs === true });
    body.appendChild(h('h3', { text: 'Suositus' }));
    if (!recs.length) body.appendChild(h('p', { class: 'muted', text: 'Ei suositusta tälle yhdistelmälle.' }));
    recs.forEach(function (r) {
      r.perhot.forEach(function (p) {
        body.appendChild(flyCard(p, p.nimi, [r.kuvaus, r.huom], [r.ryhma, r.vaihe, r.syvyys, 'koko ' + p.koko]));
      });
    });
    body.appendChild(h('p', { class: 'muted small', text: d.huom }));
  }

  // --- Koordinaatit hätätilanteeseen ----------------------------------------------------

  function renderSos() {
    if (S.sheet !== 'sos') return;
    var body = $('sheetBody');
    body.textContent = '';
    body.appendChild(h('p', { text: 'Hätätilanteessa soita 112 ja kerro nämä koordinaatit.' }));
    if (!S.pos) {
      body.appendChild(h('button', { class: 'btn primary', type: 'button', text: 'Hae sijainti', onclick: startLocate }));
      body.appendChild(h('p', { class: 'muted small', text: 'GPS toimii ilman verkkoa. Ensimmäinen paikannus voi kestää hetken.' }));
      return;
    }
    var p = S.pos, tm = JG.toTM35FIN(p.lat, p.lon);
    var wgs = p.lat.toFixed(5) + ', ' + p.lon.toFixed(5);
    var dl = h('dl', { class: 'kv' }, [
      h('dt', { text: 'WGS84' }), h('dd', { text: wgs }),
      h('dt', { text: 'Asteet, minuutit' }), h('dd', { text: 'N ' + JG.fmtDM(p.lat) + ', E ' + JG.fmtDM(p.lon) }),
      h('dt', { text: 'ETRS-TM35FIN' }), h('dd', { text: 'N ' + Math.round(tm.N) + ', E ' + Math.round(tm.E) }),
      h('dt', { text: 'Tarkkuus' }), h('dd', { text: '± ' + Math.round(p.acc) + ' m' }),
      h('dt', { text: 'Aika' }), h('dd', { text: hm(p.t) })
    ]);
    body.appendChild(dl);
    body.appendChild(h('div', { class: 'row' }, [
      h('button', { class: 'btn', type: 'button', text: 'Kopioi', onclick: function () {
        var txt = 'WGS84 ' + wgs + ' / ETRS-TM35FIN N ' + Math.round(tm.N) + ' E ' + Math.round(tm.E);
        if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { toast('Kopioitu.'); }, function () { toast('Kopiointi ei onnistunut.'); });
      } })
    ]));
  }

  // --- Tasot ja offline-tallennus ----------------------------------------------------------

  function renderLayers() {
    if (S.sheet !== 'layers') return;
    var body = $('sheetBody');
    body.textContent = '';
    body.appendChild(h('h3', { text: 'Pohjakartta' }));
    if (!settings.apiKey) body.appendChild(h('p', { class: 'warn small', text: 'Ilman MML:n API-avainta näytetään OpenStreetMap, joka toimii vain verkossa. Lisää avain asetuksiin.' }));
    body.appendChild(seg(Object.keys(MML_LAYERS).map(function (k) { return [k, MML_LAYERS[k].name]; }), settings.basemap, function (v) {
      settings.basemap = v; saveSettings(); setBasemap(); renderLayers();
    }));

    body.appendChild(h('h3', { text: 'Omat tasot' }));
    Object.keys(S.layers).forEach(function (id) {
      var e = S.layers[id];
      var cb = h('input', { type: 'checkbox', checked: !settings.hidden[id] });
      cb.addEventListener('change', function () {
        if (cb.checked) { delete settings.hidden[id]; e.layer.addTo(map); } else { settings.hidden[id] = true; map.removeLayer(e.layer); }
        saveSettings(); updateChip();
      });
      body.appendChild(h('label', { class: 'check' }, [cb, h('span', { text: e.name + (e.imported ? ' (tuotu)' : '') })]));
      var b = JG.areaBbox(e.gj);
      var btns = [h('button', { class: 'btn', type: 'button', text: 'Näytä', onclick: function () { fitLayer(id); closeSheet(); } })];
      if (b) btns.push(h('button', { class: 'btn', type: 'button', text: 'Tallenna offline', onclick: function () { offlineDialog(id); } }));
      if (e.imported) btns.push(h('button', { class: 'btn danger', type: 'button', text: 'Poista', onclick: function () { removeImported(id); } }));
      body.appendChild(h('div', { class: 'row' }, btns));
    });

    var file = h('input', { type: 'file', accept: '.geojson,.json,application/geo+json,application/json', class: 'hidden' });
    file.addEventListener('change', function () { if (file.files[0]) importFile(file.files[0]); });
    body.appendChild(file);
    body.appendChild(h('div', { class: 'row' }, [h('button', { class: 'btn', type: 'button', text: 'Tuo GeoJSON-tiedosto', onclick: function () { file.click(); } })]));
    body.appendChild(h('p', { class: 'muted small', text: 'Piirrä taso geojson.io:ssa ja tallenna se GeoJSON-muodossa. Tuotu taso tallentuu vain tähän laitteeseen.' }));

    body.appendChild(h('h3', { text: 'Vesitilanne' }));
    var wc = h('input', { type: 'checkbox', checked: settings.water });
    wc.addEventListener('change', function () { settings.water = wc.checked; saveSettings(); drawWater(); renderLayers(); });
    body.appendChild(h('label', { class: 'check' }, [wc, h('span', { text: 'Näytä jokien vesitilanne väreinä' })]));
    if (settings.water) body.appendChild(waterLegend());

    body.appendChild(h('h3', { text: 'Apuvälineet' }));
    var rc = h('input', { type: 'checkbox', checked: settings.rings });
    rc.addEventListener('change', function () { settings.rings = rc.checked; saveSettings(); drawRings(); if (rc.checked && !S.pos) toast('Renkaat näkyvät, kun sijainti on päällä.'); });
    body.appendChild(h('label', { class: 'check' }, [rc, h('span', { text: 'Etäisyysrenkaat 1, 5 ja 20 km sijainnista' })]));
  }

  function importFile(f) {
    if (f.size > 2 * 1024 * 1024) { toast('Tiedosto on liian suuri (yli 2 Mt).'); return; }
    f.text().then(function (txt) {
      var gj = JG.cleanGeoJSON(JSON.parse(txt));
      var id = 'tuotu-' + Date.now().toString(36);
      var name = f.name.replace(/\.(geo)?json$/i, '').slice(0, 60) || 'Tuotu taso';
      var list = store.get('imported', []);
      list.push({ id: id, nimi: name, gj: gj });
      if (!store.set('imported', list)) { toast('Tallennustila on täynnä.'); return; }
      addLayerEntry(id, name, gj, true);
      updateChip(); renderLayers(); fitLayer(id);
      toast('Taso tuotu: ' + name);
    }).catch(function (e) { toast('Tuonti epäonnistui: ' + (e && e.message ? e.message : 'virheellinen tiedosto')); });
  }
  function removeImported(id) {
    var e = S.layers[id];
    if (e) map.removeLayer(e.layer);
    delete S.layers[id]; delete settings.hidden[id]; saveSettings();
    store.set('imported', store.get('imported', []).filter(function (x) { return x.id !== id; }));
    updateChip(); renderLayers();
  }

  function offlineDialog(id) {
    var e = S.layers[id], body = $('sheetBody');
    var bbox = JG.areaBbox(e.gj);
    openSheet('offline', 'Tallenna offline');
    body = $('sheetBody'); body.textContent = '';
    body.appendChild(h('p', { text: e.name }));
    if (!settings.apiKey) {
      body.appendChild(h('p', { class: 'warn', text: 'Offline-tallennus vaatii MML:n API-avaimen. Lisää se asetuksiin.' }));
      body.appendChild(h('button', { class: 'btn primary', type: 'button', text: 'Asetuksiin', onclick: function () { openMenu(); } }));
      return;
    }
    var chosen = { maastokartta: true, ortokuva: false }, zmax = settings.offlineMaxZ;
    var info = h('p', { class: 'small' });
    function upd() {
      var n = JG.countTiles(bbox, OFFLINE_ZMIN, zmax), kb = 0, cnt = 0;
      Object.keys(chosen).forEach(function (k) { if (chosen[k]) { cnt += n; kb += n * MML_LAYERS[k].estKB; } });
      info.textContent = cnt + ' karttatiiltä, arviolta ' + Math.round(kb / 1024) + ' Mt.' + (cnt > MAX_TILES ? ' Liian suuri: pienennä tarkkuutta.' : '');
      go.disabled = !cnt || cnt > MAX_TILES || !!S.dl;
    }
    Object.keys(chosen).forEach(function (k) {
      var cb = h('input', { type: 'checkbox', checked: chosen[k] });
      cb.addEventListener('change', function () { chosen[k] = cb.checked; upd(); });
      body.appendChild(h('label', { class: 'check' }, [cb, h('span', { text: MML_LAYERS[k].name })]));
    });
    body.appendChild(h('div', { class: 'field' }, [h('span', { text: 'Tarkin taso' }),
      seg([[14, '14'], [15, '15'], [16, '16 (tarkin)']], zmax, function (v) { zmax = v; settings.offlineMaxZ = v; saveSettings(); offlineDialog(id); })]));
    body.appendChild(info);
    var bar = h('div', { class: 'progress hidden' }, [h('div')]);
    var status = h('p', { class: 'small muted' });
    var go = h('button', { class: 'btn primary', type: 'button', text: 'Aloita', onclick: function () {
      var layers = Object.keys(chosen).filter(function (k) { return chosen[k]; });
      downloadTiles(bbox, layers, zmax, bar, status, go, stop);
    } });
    var stop = h('button', { class: 'btn', type: 'button', text: 'Keskeytä', disabled: true, onclick: function () { if (S.dl) S.dl.cancel = true; } });
    body.appendChild(h('div', { class: 'row' }, [go, stop]));
    body.appendChild(bar); body.appendChild(status);
    body.appendChild(h('p', { class: 'muted small', text: 'Tee tallennus Wi-Fissä. MML:n avoin rajapinta on tarkoitettu pienimuotoiseen käyttöön, joten tallenna vain tarvitsemasi alue.' }));
    upd();
  }

  function downloadTiles(bbox, layers, zmax, bar, status, go, stop) {
    var tiles = JG.tilesForBbox(bbox, OFFLINE_ZMIN, zmax), jobs = [];
    layers.forEach(function (l) { tiles.forEach(function (t) { jobs.push({ l: l, z: t.z, x: t.x, y: t.y }); }); });
    var key = settings.apiKey, done = 0, failed = 0, bytes = 0, k = 0;
    S.dl = { cancel: false };
    go.disabled = true; stop.disabled = false; bar.classList.remove('hidden');
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    caches.open(TILE_CACHE).then(function (cache) {
      function one() {
        if (S.dl.cancel || k >= jobs.length) return Promise.resolve();
        var j = jobs[k++];
        var url = mmlTileUrl(j.l, j.z, j.x, j.y, key);
        var u = new URL(url), ck = u.origin + u.pathname; // välimuistin avaimessa ei ole API-avainta
        return cache.match(ck).then(function (hit) {
          if (hit) return null;
          return fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' }).then(function (r) {
            if (r.status === 401 || r.status === 403) { S.dl.cancel = true; S.dl.auth = true; throw new Error('auth'); }
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.blob().then(function (b) { bytes += b.size; return cache.put(ck, new Response(b, { headers: { 'Content-Type': r.headers.get('Content-Type') || 'image/png' } })); });
          });
        }).catch(function () { failed++; }).then(function () {
          done++;
          if (done % 10 === 0 || done === jobs.length) {
            bar.firstChild.style.width = Math.round(done / jobs.length * 100) + '%';
            status.textContent = done + ' / ' + jobs.length + ' tiiltä, ' + (bytes / 1048576).toFixed(1).replace('.', ',') + ' Mt' + (failed ? ', ' + failed + ' epäonnistui' : '');
          }
        }).then(one);
      }
      return Promise.all([one(), one(), one(), one()]);
    }).then(function () {
      var r = S.dl; S.dl = null;
      go.disabled = false; stop.disabled = true;
      if (r.auth) status.textContent = 'MML hylkäsi API-avaimen. Tarkista avain asetuksista.';
      else if (r.cancel) status.textContent = 'Keskeytetty: ' + done + ' / ' + jobs.length + ' tiiltä.';
      else status.textContent = 'Valmis: ' + (jobs.length - failed) + ' / ' + jobs.length + ' tiiltä tallennettu.' + (failed ? ' Yritä uudelleen puuttuville.' : '');
    });
  }

  // --- Asetukset ja tiedot ----------------------------------------------------------------

  function openMenu() {
    openSheet('menu', 'Asetukset ja tiedot');
    var body = $('sheetBody');
    body.textContent = '';
    body.appendChild(h('h3', { text: 'Maanmittauslaitoksen API-avain' }));
    var key = h('input', { class: 'input', type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'API-avain', value: settings.apiKey });
    body.appendChild(key);
    body.appendChild(h('div', { class: 'row' }, [
      h('button', { class: 'btn primary', type: 'button', text: 'Tallenna avain', onclick: function () {
        settings.apiKey = JG.sanitizeKey(key.value); key.value = settings.apiKey; saveSettings(); setBasemap();
        toast(settings.apiKey ? 'Avain tallennettu tähän laitteeseen.' : 'Avain poistettu.');
      } })
    ]));
    body.appendChild(h('p', { class: 'muted small', text: 'Avain tallentuu vain tähän laitteeseen, eikä sitä lähetetä muualle kuin Maanmittauslaitokselle karttakuvien haussa. Ilmaisen avaimen saat MML:n Oma tili -palvelusta.' }));

    body.appendChild(h('h3', { text: 'Tallennetut tiedot' }));
    var est = h('p', { class: 'small muted', text: 'Lasketaan…' });
    body.appendChild(est);
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(function (e) {
      est.textContent = 'Käytössä noin ' + Math.round((e.usage || 0) / 1048576) + ' Mt.';
    }); else est.textContent = '';
    body.appendChild(h('div', { class: 'row' }, [
      h('button', { class: 'btn danger', type: 'button', text: 'Poista offline-kartat', onclick: function () {
        caches.delete(TILE_CACHE).then(function () { toast('Offline-kartat poistettu.'); openMenu(); });
      } }),
      h('button', { class: 'btn danger', type: 'button', text: 'Poista kaikki tiedot', onclick: function () {
        if (!window.confirm('Poistetaanko API-avain, tuodut tasot, sääennusteet ja offline-kartat tästä laitteesta?')) return;
        try { Object.keys(localStorage).filter(function (k) { return k.indexOf('jg.') === 0; }).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) { /* estetty */ }
        caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf('jg-') === 0; }).map(function (k) { return caches.delete(k); })); })
          .then(function () { location.reload(); });
      } })
    ]));

    body.appendChild(h('h3', { text: 'Tietosuoja' }));
    [
      'Sovellus ei kerää, tallenna eikä lähetä henkilötietoja. Siinä ei ole kirjautumista, evästeitä eikä analytiikkaa.',
      'Sijaintisi käsitellään vain tässä laitteessa. Sääennustetta haettaessa Ilmatieteen laitokselle ja MET Norwaylle lähetetään noin kilometrin tarkkuuteen pyöristetyt koordinaatit.',
      'API-avain, tuodut tasot ja tallennetut kartat ovat vain tämän laitteen selaimessa.'
    ].forEach(function (t) { body.appendChild(h('p', { class: 'small', text: t })); });

    body.appendChild(h('h3', { text: 'Tietolähteet' }));
    [
      'Pohjakartta ja ilmakuva: Maanmittauslaitos, CC BY 4.0. Ilman avainta: © OpenStreetMapin tekijät (ODbL).',
      'Sääennuste ja tuuli: Ilmatieteen laitos, CC BY 4.0.',
      'Sadetutkaennuste: MET Norway, Nowcast 2.0, CC BY 4.0.',
      'Vesitilanne: Suomen ympäristökeskus (Syke), Hydrologiarajapinta, CC BY 4.0, ja Ilmatieteen laitos, CC BY 4.0.',
      'Jokien uomat: © OpenStreetMapin tekijät, ODbL.',
      'Perhokuvat: Wikimedia Commons, tekijät ja lisenssit kuvien yhteydessä.',
      'Testialueet: tupien sijainnit Metsähallitukselta (luontoon.fi). Alueiden rajaus on likimääräinen.'
    ].forEach(function (t) { body.appendChild(h('p', { class: 'small', text: t })); });

    body.appendChild(h('h3', { text: 'Lisenssi' }));
    body.appendChild(h('p', { class: 'small', text: 'Joki guide © 2026 gitdaada. PolyForm Noncommercial 1.0.0: käyttö ja muokkaus sallittu ei-kaupallisiin tarkoituksiin. Kaupallinen käyttö vaatii tekijän kirjallisen luvan. Leaflet: BSD 2-Clause.' }));
    body.appendChild(h('p', { class: 'muted small', text: 'Versio ' + VERSION }));
    body.appendChild(h('div', { class: 'row' }, [h('button', { class: 'btn', type: 'button', text: 'Päivitä sovellus', onclick: checkForUpdate })]));
  }

  // --- Päivitys ---------------------------------------------------------------------------

  function showUpdateBanner() {
    var t = $('toast');
    clearTimeout(toastTimer);
    t.textContent = '';
    t.appendChild(h('span', { text: 'Uusi versio on ladattu. ' }));
    t.appendChild(h('button', { class: 'btn primary', type: 'button', text: 'Ota käyttöön', onclick: function () { location.reload(); } }));
    t.classList.remove('hidden');
  }

  function checkForUpdate() {
    if (!S.swReg) { location.reload(); return; }
    toast('Tarkistetaan päivityksiä…');
    S.swReg.update().then(function () {
      setTimeout(function () { location.reload(); }, 800);
    }, function () { toast('Päivitystä ei voitu tarkistaa. Tarkista verkkoyhteys.'); });
  }

  // --- Paneeli ----------------------------------------------------------------------------

  function openSheet(name, title) {
    S.sheet = name;
    $('sheetTitle').textContent = title;
    $('sheet').classList.remove('hidden');
  }
  function closeSheet() { S.sheet = null; $('sheet').classList.add('hidden'); }
  $('sheetClose').addEventListener('click', closeSheet);

  $('btnLocate').addEventListener('click', function () { if (S.watchId !== null) stopLocate(); else startLocate(); });
  $('btnCompass').addEventListener('click', toggleCompass);
  $('btnMeasure').addEventListener('click', function () { setMeasuring(!S.measuring); });
  $('measureUndo').addEventListener('click', function () { S.pts.pop(); drawMeasure(); });
  $('measureClear').addEventListener('click', function () { S.pts = []; drawMeasure(); });
  $('measureDone').addEventListener('click', function () { setMeasuring(false); });
  $('btnWeather').addEventListener('click', function () { openSheet('weather', 'Sää ja tuuli'); renderWeather(); refreshWeather(false); });
  $('btnFlies').addEventListener('click', function () { openSheet('flies', 'Perhosuositus'); renderFlies(); loadFlies().then(renderFlies, function () { toast('Perhotietoja ei voitu ladata.'); }); });
  $('btnSos').addEventListener('click', function () { openSheet('sos', 'Sijaintini koordinaatteina'); renderSos(); if (!S.pos) startLocate(); });
  $('btnMenu').addEventListener('click', openMenu);
  $('layerChip').addEventListener('click', function () { openSheet('layers', 'Kartta ja tasot'); renderLayers(); });

  // --- Vesitilanne jokien päällä -----------------------------------------------------------
  // Data tulee tiedostosta data/vesitilanne.json, jonka GitHub Actions päivittää päivittäin (pipeline/vesitilanne.py).

  var WATER = {
    alhainen: { color: '#e5484d', nimi: 'Alhainen' },
    normaali: { color: '#2fb35a', nimi: 'Normaali' },
    korkea: { color: '#0b3d91', nimi: 'Korkea' },
    tuntematon: { color: '#8a9aa0', nimi: 'Ei tietoa' }
  };
  var waterLayer = L.layerGroup();
  S.water = null;

  function fmtNum(v, unit) {
    if (v === null || v === undefined || !isFinite(v)) return '–';
    var d = Math.abs(v) >= 100 ? 0 : (Math.abs(v) >= 10 ? 1 : 2);
    return v.toFixed(d).replace('.', ',') + (unit ? ' ' + unit : '');
  }
  function fmtDate(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    var d = new Date(t);
    return d.getDate() + '.' + (d.getMonth() + 1) + '.' + d.getFullYear();
  }

  function waterLegend() {
    var box = h('div', { class: 'legend' });
    ['alhainen', 'normaali', 'korkea', 'tuntematon'].forEach(function (k) {
      var sw = h('span', { class: 'sw sw-' + k });
      box.appendChild(h('span', { class: 'li' }, [sw, WATER[k].nimi]));
    });
    var p = h('p', { class: 'muted small' });
    if (S.water) {
      p.textContent = 'Luokka verrataan saman vuodenajan tavalliseen vaihteluun (25–75 % aiempina vuosina). ' +
        'Päivitetty ' + fmtDate(S.water.paivitetty) + '. Napauta jokea nähdäksesi arvot.';
    } else p.textContent = 'Vesitilannetta ei ole vielä ladattu.';
    return h('div', null, [box, p]);
  }

  function waterPopup(j) {
    var c = WATER[j.luokka] || WATER.tuntematon;
    var box = h('div', null, [h('div', { class: 'pop-t', text: j.nimi }), h('div', { text: 'Vesitilanne: ' + c.nimi })]);
    var m = j.mittaus;
    if (m) {
      box.appendChild(h('p', { class: 'small', text: (m.suure === 'virtaama' ? 'Virtaama ' : 'Vedenkorkeus ') + fmtNum(m.arvo, m.yksikko) +
        ' (' + fmtDate(m.aika) + '), asema ' + m.asema + '.' }));
      if (m.p25 !== null && m.p25 !== undefined) box.appendChild(h('p', { class: 'small muted', text: 'Tavallisesti tähän aikaan ' +
        fmtNum(m.p25, m.yksikko) + '–' + fmtNum(m.p75, m.yksikko) + ' (' + m.vuodet + ' vuotta).' }));
    }
    var r = j.sade14;
    if (r) {
      box.appendChild(h('p', { class: 'small', text: 'Sade 14 vrk: ' + fmtNum(r.mm, 'mm') + ', sääasema ' + r.asema + (r.etaisyys_km ? ' (' + Math.round(r.etaisyys_km) + ' km)' : '') + '.' }));
      if (r.p25 !== null && r.p25 !== undefined) box.appendChild(h('p', { class: 'small muted', text: 'Tavallisesti samaan aikaan ' +
        fmtNum(r.p25, 'mm') + '–' + fmtNum(r.p75, 'mm') + ' (' + r.vuodet + ' vuotta).' }));
    }
    box.appendChild(h('p', { class: 'small muted', text: j.menetelma === 'mittaus' ? 'Luokka mitatusta arvosta (Syke).' :
      (j.menetelma === 'sade' ? 'Luokka on arvio sademäärästä (Ilmatieteen laitos), ei mitattu vedenkorkeus.' : 'Luokkaa ei voitu laskea.') }));
    return box;
  }

  function drawWater() {
    waterLayer.clearLayers();
    if (!settings.water) { map.removeLayer(waterLayer); return; }
    waterLayer.addTo(map);
    if (!S.water) { loadWater(); return; }
    var byId = {};
    (S.water.joet || []).forEach(function (j) { byId[j.id] = j; });
    (S.water.geo || []).forEach(function (gj) {
      gj.features.forEach(function (f) {
        var j = byId[(f.properties || {}).joki_id];
        if (!j || !f.geometry || !/LineString/.test(f.geometry.type)) return;
        var c = (WATER[j.luokka] || WATER.tuntematon).color;
        L.geoJSON(f, { style: { color: '#ffffff', weight: 9, opacity: 0.85, lineCap: 'round' }, interactive: false }).addTo(waterLayer);
        L.geoJSON(f, { style: { color: c, weight: 5, opacity: 1, lineCap: 'round', dashArray: j.luokka ? null : '6 6' } })
          .bindPopup(function () { return waterPopup(j); }).addTo(waterLayer);
      });
    });
  }

  function loadWater() {
    return fetch('data/vesitilanne.json', { credentials: 'omit', cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (j) {
      var files = (j.geometriat || []).filter(function (f) { return /^layers\/[a-z0-9_-]+\.geojson$/i.test(f); });
      return Promise.all(files.map(function (f) {
        return fetch(f, { credentials: 'omit' }).then(function (r) { return r.json(); }).then(JG.cleanGeoJSON).catch(function () { return null; });
      })).then(function (geo) {
        j.geo = geo.filter(Boolean);
        S.water = j;
        drawWater();
        if (S.sheet === 'layers') renderLayers();
      });
    }).catch(function () { toast('Vesitilannetta ei voitu ladata.'); });
  }

  // Kun verkko on käytössä, sovelluksen data ja kuvat haetaan valmiiksi välimuistiin offline-käyttöä varten.
  function prefetchForOffline() {
    if (!navigator.onLine || !('serviceWorker' in navigator)) return;
    loadFlies().then(function (d) {
      var urls = {};
      Object.keys(d.ryhmat).forEach(function (g) {
        Object.keys(d.ryhmat[g].vaiheet).forEach(function (v) {
          (d.ryhmat[g].vaiheet[v].perhot || []).forEach(function (p) { if (p.kuva) urls['img/perhot/' + p.kuva] = 1; });
        });
      });
      Object.keys(d.lohi.tilat).forEach(function (k) { d.lohi.tilat[k].perhot.forEach(function (p) { if (p.kuva) urls['img/perhot/' + p.kuva] = 1; }); });
      Object.keys(urls).forEach(function (u) { fetch(u, { credentials: 'omit' }).catch(function () {}); });
    }).catch(function () {});
    fetch('data/vesitilanne.json', { credentials: 'omit' }).catch(function () {});
  }

  // --- Käynnistys --------------------------------------------------------------------------

  if (S.wx) drawWind();
  loadLayers().then(function () {
    if (!store.get('view', null)) fitLayer('poroeno');
  });
  if (settings.water) drawWater();
  setTimeout(prefetchForOffline, 4000);
  // Päivitykset: uusi versio otetaan käyttöön, ja käyttäjälle tarjotaan uudelleenlatausta.
  // Asennetussa sovelluksessa ei ole selaimen päivityspainiketta, ja kartta vie vetoeleen.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { scope: './' }).then(function (reg) {
      S.swReg = reg;
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && navigator.onLine) reg.update().catch(function () {});
      });
    }).catch(function () { /* offline-tila ei käytössä */ });
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; }
      showUpdateBanner();
    });
  }
  if (!settings.apiKey) setTimeout(function () { toast('Lisää MML:n API-avain asetuksista, niin saat maastokartan ja offline-tallennuksen.', 6000); }, 1200);
})();
