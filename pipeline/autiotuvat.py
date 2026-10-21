"""Lapin ja Kainuun autiotuvat OpenStreetMapista: docs/data/autiotuvat.geojson.

Ajetaan GitHub Actionsissa kerran kuukaudessa (.github/workflows/autiotuvat.yml). Vain Pythonin
standardikirjasto ja julkinen Overpass-rajapinta, ei avaimia. Aineisto © OpenStreetMapin tekijät, ODbL.

Mukaan otetaan tourism=wilderness_hut -kohteet sekä kohteet, joiden nimessä on "autiotupa" tai
"autiokammi". Varaus- ja vuokratuvat jätetään pois, koska ne eivät ole vapaasti käytettävissä.
Kohteista tallennetaan vain tuvan tiedot (nimi, sijainti, varustus, ylläpitäjä), ei henkilötietoja.
"""
import datetime as dt
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request

UA = "joki-opas/0.2 (+https://github.com/gitdaada/joki-opas)"
OVERPASS = "https://overpass-api.de/api/interpreter"
OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "data", "autiotuvat.geojson")
ALUEET = [("FI-10", "Lappi"), ("FI-05", "Kainuu")]
POIS = re.compile(r"varaustupa|vuokratupa|vuokrakämppä|vuokrakota|varauskammi|vuokrakammi", re.I)
NIMI = re.compile(r"autiotupa|autiokammi|autiotuvat", re.I)
LINKIT = ("luontoon.fi", "metsa.fi", "retkikartta.fi")


def get(url, data=None, timeout=200, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa
            last = e
            time.sleep(10 * (i + 1))
    raise last


def overpass(iso):
    q = ('[out:json][timeout:180];area["ISO3166-2"="%s"]->.a;'
         '(nwr["tourism"="wilderness_hut"](area.a);nwr["name"~"autiotupa|autiokammi",i](area.a););out center tags;') % iso
    return json.loads(get(OVERPASS, data=urllib.parse.urlencode({"data": q}).encode()))["elements"]


def clean_text(s, n):
    s = re.sub(r"[\x00-\x1f\x7f]+", " ", str(s or "")).strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def num(s):
    m = re.match(r"^\s*(\d+(?:[.,]\d+)?)", str(s or ""))
    return float(m.group(1).replace(",", ".")) if m else None


def safe_link(t):
    for k in ("website", "contact:website", "url"):
        u = t.get(k, "")
        try:
            p = urllib.parse.urlparse(u)
        except ValueError:
            continue
        host = (p.hostname or "").lower()
        if p.scheme == "https" and any(host == d or host.endswith("." + d) for d in LINKIT):
            return u[:300]
    return None


def is_hut(t):
    """Palauttaa (hyväksytty, syy)."""
    name = t.get("name", "") or t.get("name:fi", "")
    if t.get("tourism") != "wilderness_hut":
        if not NIMI.search(name):
            return False, "ei tupa"
        if not ("building" in t or t.get("amenity") == "shelter" or t.get("tourism") == "alpine_hut"):
            return False, "nimi viittaa tupaan, mutta kohde on muu (" + str(t.get("tourism") or t.get("amenity") or t.get("place") or t.get("highway") or "?") + ")"
    if POIS.search(name):
        return False, "varaus- tai vuokratupa"
    if t.get("reservation") in ("required", "yes", "members_only"):
        return False, "varattava"
    if t.get("access") in ("private", "no"):
        return False, "ei vapaata pääsyä"
    if t.get("ruins") == "yes" or any(k.startswith(("disused:", "abandoned:", "was:", "removed:", "destroyed:")) for k in t):
        return False, "purettu tai käytöstä poistettu"
    return True, ""


def describe(t, tyyppi, maakunta):
    parts = ["Autiokammi" if tyyppi == "kammi" else "Autiotupa", maakunta + "."]
    s = [" ".join(parts)]
    cap = num(t.get("capacity") or t.get("beds"))
    if cap:
        s.append("Makuupaikkoja noin %d." % cap)
    if t.get("fireplace") == "yes" or t.get("heating") in ("stove", "fireplace", "wood"):
        s.append("Tulisija.")
    if t.get("toilets") == "yes":
        s.append("Käymälä.")
    if t.get("drinking_water") == "yes":
        s.append("Juomavettä saatavilla.")
    if t.get("operator"):
        s.append("Ylläpitäjä: %s." % clean_text(t["operator"], 60))
    ele = num(t.get("ele"))
    if ele:
        s.append("Korkeus %d m." % round(ele))
    d = t.get("description:fi") or t.get("description")
    if d:
        s.append(clean_text(d, 280))
    return " ".join(s)


def dist_m(a, b):
    R = 6371000.0
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dla, dlo = la2 - la1, math.radians(b[0] - a[0])
    h = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def main():
    feats, excluded = [], {}
    for iso, maakunta in ALUEET:
        els = overpass(iso)
        print("%s: %d OSM-kohdetta" % (maakunta, len(els)))
        for el in els:
            t = el.get("tags", {})
            ok, why = is_hut(t)
            name = t.get("name") or t.get("name:fi") or ""
            if not ok:
                excluded[why] = excluded.get(why, 0) + 1
                if why != "ei tupa":
                    print("  pois (%s): %s" % (why, name or el["type"] + "/" + str(el["id"])))
                continue
            c = el.get("center") or {"lat": el.get("lat"), "lon": el.get("lon")}
            if c.get("lat") is None:
                continue
            tyyppi = "kammi" if re.search(r"kammi", name, re.I) else "autiotupa"
            props = {
                "nimi": clean_text(name, 80) or ("Nimetön autiokammi" if tyyppi == "kammi" else "Nimetön autiotupa"),
                "tyyppi": tyyppi,
                "maakunta": maakunta,
                "kuvaus": describe(t, tyyppi, maakunta),
                "osm": "%s/%d" % (el["type"], el["id"]),
                "_tageja": len(t),
            }
            link = safe_link(t)
            if link:
                props["linkki"] = link
            feats.append({"type": "Feature", "properties": props,
                          "geometry": {"type": "Point", "coordinates": [round(c["lon"], 5), round(c["lat"], 5)]}})
        time.sleep(5)

    # Sama tupa voi olla sekä pisteenä että rakennuksena: yhdistetään saman nimiset alle 300 m päässä.
    feats.sort(key=lambda f: -f["properties"]["_tageja"])
    kept = []
    for f in feats:
        dup = next((k for k in kept if k["properties"]["nimi"].lower() == f["properties"]["nimi"].lower()
                    and dist_m(k["geometry"]["coordinates"], f["geometry"]["coordinates"]) < 300), None)
        if dup:
            continue
        kept.append(f)
    for f in kept:
        del f["properties"]["_tageja"]
    kept.sort(key=lambda f: (f["properties"]["maakunta"], f["properties"]["nimi"]))

    if len(kept) < 50:
        raise RuntimeError("Liian vähän tupia (%d), aineistoa ei päivitetä" % len(kept))
    out = {"type": "FeatureCollection",
           "properties": {"lahde": "© OpenStreetMapin tekijät, ODbL", "paivitetty": dt.date.today().isoformat(),
                          "maara": len(kept)},
           "features": kept}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    per = {}
    for f in kept:
        k = f["properties"]["maakunta"] + "/" + f["properties"]["tyyppi"]
        per[k] = per.get(k, 0) + 1
    print("Tallennettu %d tupaa: %s" % (len(kept), ", ".join("%s %d" % kv for kv in sorted(per.items()))))
    print("Pois jätetyt: %s" % ", ".join("%s %d" % kv for kv in sorted(excluded.items())))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa
        print("VIRHE:", e, file=sys.stderr)
        sys.exit(1)
