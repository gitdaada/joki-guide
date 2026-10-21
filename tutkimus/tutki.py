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
    flt = ("(KoordErTmPohj ge 7200000 and KoordErTmPohj le 7300000 and KoordErTmIta ge 560000 and KoordErTmIta le 660000) or "
           "(KoordErTmPohj ge 7580000 and KoordErTmPohj le 7720000 and KoordErTmIta ge 240000 and KoordErTmIta le 360000)")
    sel = "Paikka_Id,Suure_Id,Nimi,KuntaNimi,KoordErTmPohj,KoordErTmIta,KoordLat,KoordLong,VesalNimi,PaaVesalNimi,JarviNimi,Tila_Id"
    url = SYKE + "/Paikka?" + urllib.parse.urlencode({"$format": "json", "$filter": flt, "$select": sel})
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
    "klinkhamer": "Klinkhammer", "klinkhamer2": "Klinkhamer special", "parachute": "parachute dry fly",
    "cdc": "CDC fly", "emerger": "emerger fly", "softhackle": "soft hackle", "spider": "Partridge and Orange",
    "caddislarva": "cased caddis fly pattern", "sparklepupa": "sparkle pupa", "stonenymph": "stonefly nymph pattern",
    "rubberlegs": "rubber legs nymph", "griffith": "Griffiths gnat", "midge": "midge fly pattern",
    "williegunn": "Willie Gunn", "sunray": "Sunray Shadow", "shrimp": "shrimp fly salmon", "bomber": "Bomber deer hair fly",
    "tubefly": "Tubenfliege", "tubefly2": "tube fly"
}
CATS = ["Category:Fishing flies", "Category:Dry flies", "Category:Wet flies", "Category:Nymph flies", "Category:Salmon flies",
        "Category:Tube flies", "Category:Streamers (fishing)", "Category:Artificial flies", "Category:Fly tying"]
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
    json.dump(found, open(OUT + "/commons2.json", "w"), ensure_ascii=False, indent=1)

def commons_cats():
    found = {}
    for cat in CATS:
        params = {"action": "query", "format": "json", "generator": "categorymembers", "gcmtitle": cat, "gcmtype": "file",
                  "gcmlimit": "60", "prop": "imageinfo", "iiprop": "url|extmetadata|mime", "iiurlwidth": "480"}
        try:
            j = json.loads(get(COMMONS + "?" + urllib.parse.urlencode(params)))
        except Exception as e:  # noqa
            found[cat] = [{"error": repr(e)[:200]}]; continue
        items = []
        key = re.sub("[^a-z]", "", cat.split(":")[1].lower())[:12]
        for p in sorted((j.get("query") or {}).get("pages", {}).values(), key=lambda x: x.get("title")):
            ii = (p.get("imageinfo") or [{}])[0]
            if not ii.get("mime", "").startswith("image/") or ii.get("mime") == "image/svg+xml":
                continue
            md = ii.get("extmetadata", {})
            def m(k):
                return re.sub("<[^>]+>", "", (md.get(k) or {}).get("value", ""))[:300]
            it = {"title": p["title"], "page": ii.get("descriptionurl"), "thumb": ii.get("thumburl"), "w": ii.get("width"),
                  "license": m("LicenseShortName"), "license_url": m("LicenseUrl"), "artist": m("Artist"), "desc": m("ImageDescription")}
            fn = "%s/kuvat/c-%s-%d.jpg" % (OUT, key, len(items))
            try:
                open(fn, "wb").write(get(it["thumb"])); it["file"] = fn
            except Exception as e:  # noqa
                it["error"] = repr(e)[:200]
            items.append(it)
            time.sleep(0.2)
        found[cat] = items
    json.dump(found, open(OUT + "/commons_cats.json", "w"), ensure_ascii=False, indent=1)

def syke_suure():
    open(OUT + "/syke_suure.json", "wb").write(get(SYKE + "/Suure?$format=json"))

def syke_testi():
    # Testihaku: yhden aseman viimeisimmät virtaama-arvot, kun asemat on haettu
    rows = json.load(open(OUT + "/syke_paikat.json"))
    ids = [r["Paikka_Id"] for r in rows][:400]
    res = {}
    for ent in ["Virtaama", "Vedenkorkeus"]:
        q = {"$format": "json", "$top": "5", "$orderby": "Aika desc", "$filter": "Paikka_Id eq %d" % ids[0]}
        res[ent] = json.loads(get(SYKE + "/" + ent + "?" + urllib.parse.urlencode(q)))
    json.dump(res, open(OUT + "/syke_testi.json", "w"), ensure_ascii=False, indent=1)

step("syke_suure", syke_suure)
step("syke_paikat", syke_paikat)
step("syke_testi", syke_testi)
step("commons", commons)
step("commons_cats", commons_cats)
json.dump(log, open(OUT + "/loki.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(log, ensure_ascii=False))
