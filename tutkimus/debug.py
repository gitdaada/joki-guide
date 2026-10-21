"""Vianetsintä: Syken kyselymuodot ja FMI:n päivähavainnot. Tulokset tutkimus/out/debug.json."""
import json, os, urllib.request, urllib.error
UA = "joki-guide/0.2 (+https://github.com/gitdaada/joki-guide)"
os.makedirs("tutkimus/out", exist_ok=True)
res = {}
def try_url(name, url, accept="application/json"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
            res[name] = {"url": url, "status": r.status, "ctype": r.headers.get("Content-Type"), "body": body[:1500].decode("utf-8", "replace")}
    except urllib.error.HTTPError as e:
        res[name] = {"url": url, "status": e.code, "body": e.read()[:1500].decode("utf-8", "replace")}
    except Exception as e:  # noqa
        res[name] = {"url": url, "error": repr(e)}
B12 = "https://rajapinnat.ymparisto.fi/api/Hydrologiarajapinta/1.2/odata"
B11 = "https://rajapinnat.ymparisto.fi/api/Hydrologiarajapinta/1.1/odata"
try_url("suure_12_plain", B12 + "/Suure")
try_url("suure_12_format", B12 + "/Suure?$format=json")
try_url("suure_12_top", B12 + "/Suure?$top=3")
try_url("suure_12_accept_any", B12 + "/Suure?$top=3", accept="*/*")
try_url("suure_11_top", B11 + "/Suure?$top=3")
try_url("paikka_12_top", B12 + "/Paikka?$top=2")
try_url("paikka_12_filter", B12 + "/Paikka?$top=5&$filter=KoordErTmPohj%20ge%207240000%20and%20KoordErTmPohj%20le%207270000%20and%20KoordErTmIta%20ge%20600000%20and%20KoordErTmIta%20le%20625000")
try_url("paikka_11_filter", B11 + "/Paikka?$top=5&$filter=KoordErTmPohj%20ge%207240000%20and%20KoordErTmPohj%20le%207270000%20and%20KoordErTmIta%20ge%20600000%20and%20KoordErTmIta%20le%20625000")
try_url("virtaama_12_top", B12 + "/Virtaama?$top=2&$orderby=Aika%20desc")
F = "https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature&storedquery_id=fmi::observations::weather::daily::timevaluepair&parameters=rrday&bbox=28.3,64.9,30.7,65.9&starttime=2026-10-07T00:00:00Z&endtime=2026-10-20T00:00:00Z"
try_url("fmi_daily", F, accept="*/*")
res["fmi_daily"]["body"] = res.get("fmi_daily", {}).get("body", "")[:1500]
try_url("fmi_daily_simple", F.replace("timevaluepair", "simple"), accept="*/*")
json.dump(res, open("tutkimus/out/debug.json", "w"), ensure_ascii=False, indent=1)
