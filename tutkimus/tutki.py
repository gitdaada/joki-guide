"""Selvitysajo: perhokuvaehdokkaat (Wikimedia Commons), Syken mittausasemat ja jokien uomat (OSM).
Ajetaan GitHub Actionsissa, tulokset tallennetaan kansioon tutkimus/out/. Vain julkisia rajapintoja, ei avaimia."""
import json, os, re, time, urllib.parse, urllib.request

UA = "joki-guide/0.1 (+https://github.com/gitdaada/joki-guide)"
OUT = "tutkimus/out"
os.makedirs(OUT + "/kuvat", exist_ok=True)
log = []

def get(url, data=None, timeout=60):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "application/json, */*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def step(name, fn):
    t = time.time()
    try:
        fn()
        log.append({"vaihe": name, "ok": True, "s": round(time.time() - t, 1)})
    except Exception as e:  # noqa
        log.append({"vaihe": name, "ok": False, "virhe": repr(e)[:500]})

# --- Syke ---------------------------------------------------------------
SYKE = "https://rajapinnat.ymparisto.fi/api/Hydrologiarajapinta/1.2/odata"

def syke_meta():
    open(OUT + "/syke_service.json", "wb").write(get(SYKE + "/?$format=json")[:20000])
    open(OUT + "/syke_metadata.xml", "wb").write(get(SYKE + "/$metadata")[:200000])

def syke_paikat():
    url = SYKE + "/Paikka?$format=json"
    rows, n = [], 0
    while url and n < 60:
        j = json.loads(get(url))
        rows += j.get("value", [])
        url = j.get("odata.nextLink") or j.get("@odata.nextLink")
        if url and url.startswith("/"):
            url = "https://rajapinnat.ymparisto.fi" + url
        elif url and not url.startswith("http"):
            url = SYKE + "/" + url
        n += 1
    json.dump(rows[:3], open(OUT + "/syke_paikka_esim.json", "w"), ensure_ascii=False, indent=1)
    json.dump(rows, open(OUT + "/syke_paikat.json", "w"), ensure_ascii=False)

# --- OSM-uomat ------------------------------------------------------------
def overpass():
    q = """[out:json][timeout:90];
(
  way["waterway"~"river|stream"]["name"~"Hossanjoki|Peranganjoki|Somerjoki|Kirpistönjoki"](65.25,29.2,65.75,30.0);
  way["waterway"~"river|stream"]["name"~"Poroeno|Lätäseno"](68.4,20.8,69.35,22.9);
);
out geom tags;"""
    raw = get("https://overpass-api.de/api/interpreter", data=urllib.parse.urlencode({"data": q}).encode(), timeout=120)
    open(OUT + "/osm_joet.json", "wb").write(raw)

# --- Wikimedia Commons ------------------------------------------------------
PERHOT = {
    "klinkhamer": "Klinkhamer fly", "pheasant-tail": "Pheasant tail nymph", "hares-ear": "Hare's ear nymph",
    "soft-hackle": "soft hackle fly", "elk-hair-caddis": "Elk hair caddis", "stimulator": "Stimulator fly",
    "griffiths-gnat": "Griffith's gnat", "willie-gunn": "Willie Gunn fly", "sunray-shadow": "Sunray Shadow fly",
    "allys-shrimp": "Ally's shrimp fly", "bomber": "Bomber fly salmon", "buzzer": "buzzer fly fishing",
    "cdc-emerger": "CDC emerger fly", "caddis-pupa": "caddis pupa fly", "caddis-larva": "caddis larva fly fishing",
    "stonefly-nymph": "stonefly nymph fly", "bloodworm": "bloodworm fly fishing", "spent-spinner": "spinner dry fly",
    "tube-fly": "tube fly salmon", "cdc-caddis": "CDC caddis fly", "midge-emerger": "midge emerger fly",
    "dry-fly": "dry fly fishing", "nymph-fly": "nymph fly fishing", "wet-fly": "wet fly fishing"
}
COMMONS = "https://commons.wikimedia.org/w/api.php"

def commons():
    found = {}
    for key, q in PERHOT.items():
        params = {"action": "query", "format": "json", "generator": "search", "gsrsearch": q, "gsrnamespace": "6",
                  "gsrlimit": "8", "prop": "imageinfo", "iiprop": "url|extmetadata|mime", "iiurlwidth": "480"}
        j = json.loads(get(COMMONS + "?" + urllib.parse.urlencode(params)))
        items = []
        for p in sorted((j.get("query") or {}).get("pages", {}).values(), key=lambda x: x.get("index", 99)):
            ii = (p.get("imageinfo") or [{}])[0]
            if not ii.get("mime", "").startswith("image/") or ii.get("mime") == "image/svg+xml":
                continue
            md = ii.get("extmetadata", {})
            def m(k):
                return re.sub("<[^>]+>", "", (md.get(k) or {}).get("value", ""))[:300]
            it = {"title": p["title"], "page": ii.get("descriptionurl"), "thumb": ii.get("thumburl"),
                  "license": m("LicenseShortName"), "license_url": m("LicenseUrl"), "artist": m("Artist"),
                  "credit": m("Credit"), "desc": m("ImageDescription")}
            n = len(items)
            try:
                fn = "%s/kuvat/%s-%d.jpg" % (OUT, key, n)
                open(fn, "wb").write(get(it["thumb"]))
                it["file"] = fn
            except Exception as e:  # noqa
                it["error"] = repr(e)[:200]
            items.append(it)
            time.sleep(0.3)
        found[key] = items
    json.dump(found, open(OUT + "/commons.json", "w"), ensure_ascii=False, indent=1)

step("syke_meta", syke_meta)
step("syke_paikat", syke_paikat)
step("overpass", overpass)
step("commons", commons)
json.dump(log, open(OUT + "/loki.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(log, ensure_ascii=False))
