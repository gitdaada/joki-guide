"""Vesitilanneputken laskennan testit: python3 tests/test_pipeline.py"""
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
import vesitilanne as v  # noqa: E402

assert v.classify(1, 2, 5) == "alhainen"
assert v.classify(3, 2, 5) == "normaali"
assert v.classify(6, 2, 5) == "korkea"
assert v.classify(None, 2, 5) is None
assert v.pct([1, 2, 3, 4, 5], 0.25) == 2 and v.pct([1, 2, 3, 4, 5], 0.75) == 4
assert v.doy_diff(dt.date(2026, 12, 30), dt.date(2025, 1, 2)) <= 4
n, e = v.to_tm35(69 + 8.9371 / 60, 21 + 33.7112 / 60)  # Porojärven autiotupa: N 7680549, E 284220
assert abs(n - 7680549) < 3 and abs(e - 284220) < 3
q = v.odata_query({"$filter": "Paikka_Id eq 5 and Aika ge datetime'2020-01-01'", "$format": "json"})
assert q.startswith("$filter=Paikka_Id%20eq%205") and "%24" not in q
pts = [(0, 0), (1, 0.00001), (2, 0)]
assert v.simplify(pts, 0.001) == [(0, 0), (2, 0)]
print("putken laskenta läpi")

# FMI:n timevaluepair-jäsennys (synteettinen aineisto)
x = open(os.path.join(os.path.dirname(__file__), "fixtures", "fmi_daily_tvp.xml"), "rb").read()
r = v.parse_fmi_tvp(x)
assert r == {"999001": {"nimi": "Testiasema", "pos": [65.4, 29.5], "arvot": [2.5, 0.0, 4.0]}}, r
print("FMI-jäsennys läpi")

# Autiotupien suodatus ja kuvaus
import autiotuvat as a  # noqa: E402
assert a.is_hut({"tourism": "wilderness_hut", "name": "Pihtsusjärven autiotupa"})[0]
assert not a.is_hut({"tourism": "wilderness_hut", "name": "Pihtsusjärven varaustupa"})[0]
assert not a.is_hut({"tourism": "wilderness_hut", "name": "Testitupa", "reservation": "required"})[0]
assert not a.is_hut({"name": "Autiotupa", "place": "locality"})[0]
assert a.is_hut({"name": "Vanha autiotupa", "building": "hut"})[0]
assert not a.is_hut({"tourism": "wilderness_hut", "name": "X", "ruins": "yes"})[0]
d = a.describe({"capacity": "8", "fireplace": "yes", "operator": "Metsähallitus", "ele": "512"}, "autiotupa", "Lappi")
assert d == "Autiotupa Lappi. Makuupaikkoja noin 8. Tulisija. Ylläpitäjä: Metsähallitus. Korkeus 512 m.", d
assert a.safe_link({"website": "https://www.luontoon.fi/fi/kohteet/x"}) and not a.safe_link({"website": "http://luontoon.fi/x"})
assert not a.safe_link({"website": "https://example.com/luontoon.fi"})
print("autiotupien suodatus läpi")
