/* Joki guiden service worker: sovellus, tasot ja tallennetut kartat toimivat ilman verkkoa. */
'use strict';

var SHELL_CACHE = 'jg-shell-0.3.0';
var TILE_CACHE = 'jg-tiles-v1';
var SHELL = [
  './', 'app.js', 'core.js', 'rotate.js', 'solmut.js', 'style.css', 'manifest.webmanifest',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'layers/index.json', 'data/perhot.json', // tasotiedostot tallentuvat välimuistiin, kun sovellus lataa ne
  'img/perhot/nymfi.svg', 'img/perhot/toukka.svg', 'img/perhot/kotelo.svg', 'img/perhot/pinturi.svg',
  'img/perhot/aikuinen-korento.svg', 'img/perhot/aikuinen-vesiperhonen.svg', 'img/perhot/aikuinen-koskikorento.svg',
  'img/perhot/surviainen.svg', 'img/perhot/putkiperho.svg'
];

/** Uudelleenohjattua vastausta ei saa käyttää sivulatauksessa (esim. Cloudflare ohjaa index.html -> /), joten kopioidaan se puhtaaksi. */
function clean(r) {
  if (!r.redirected) return Promise.resolve(r);
  return r.blob().then(function (b) { return new Response(b, { status: r.status, statusText: r.statusText, headers: r.headers }); });
}

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL_CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) {
      return fetch(new Request(u, { cache: 'reload' })).then(function (r) {
        if (!r.ok) throw new Error(u + ' ' + r.status);
        return clean(r);
      }).then(function (r) { return c.put(u, r); });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('jg-shell-') === 0 && k !== SHELL_CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

/** MML:n karttatiili: välimuistin avain ilman API-avainta, ensin tallennettu, sitten verkko. */
function tileResponse(request, url) {
  var key = url.origin + url.pathname;
  return caches.open(TILE_CACHE).then(function (cache) {
    return cache.match(key).then(function (hit) {
      if (hit) return hit;
      return fetch(url.href, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' }).then(function (r) {
        if (r.ok) cache.put(key, r.clone());
        return r;
      }).catch(function () { return new Response('', { status: 504, statusText: 'Offline' }); });
    });
  });
}

/** Sovelluksen omat tiedostot: heti välimuistista, päivitys taustalla. */
function staleWhileRevalidate(event, request) {
  return caches.open(SHELL_CACHE).then(function (cache) {
    return cache.match(request, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(request, { cache: 'no-cache' }).then(clean).then(function (r) {
        if (r.ok && r.type === 'basic') cache.put(request, r.clone());
        return r;
      });
      if (hit) { event.waitUntil(net.catch(function () {})); return clean(hit); }
      return net.catch(function () { return new Response('', { status: 504, statusText: 'Offline' }); });
    });
  });
}

/** Päivittyvä data: ensin verkosta, ilman verkkoa viimeisin tallennettu. */
function networkFirst(request) {
  return caches.open(SHELL_CACHE).then(function (cache) {
    return fetch(request, { cache: 'no-cache' }).then(function (r) {
      if (r.ok) cache.put(request, r.clone());
      return r;
    }).catch(function () {
      return cache.match(request, { ignoreSearch: true }).then(function (hit) {
        return hit || new Response('{}', { status: 504, headers: { 'Content-Type': 'application/json' } });
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.hostname === 'avoin-karttakuva.maanmittauslaitos.fi' && url.pathname.indexOf('/WGS84_Pseudo-Mercator/') >= 0) {
    e.respondWith(tileResponse(req, url));
    return;
  }
  if (url.origin !== self.location.origin) return; // sää ja OSM suoraan verkosta, ei välimuistiin
  if (req.mode === 'navigate') {
    // Vain sovelluksen oma etusivu tulee välimuistista; muut sivut saman polun alla haetaan verkosta.
    var rel = url.pathname.slice(new URL(self.registration.scope).pathname.length);
    if (rel === '' || rel === 'index.html') e.respondWith(staleWhileRevalidate(e, new Request('./')));
    return;
  }
  if (/\/data\/vesitilanne\.json$/.test(url.pathname)) { e.respondWith(networkFirst(req)); return; }
  e.respondWith(staleWhileRevalidate(e, req));
});
