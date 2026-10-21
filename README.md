# Joki guide

Offline-toimiva karttasovellus eränkäyntiin ja jokikalastukseen. Asennetaan puhelimeen selaimen kautta.

Versio 0.2 on testiversio. Testialueina ovat Poroeno Käsivarren erämaa-alueella ja Hossanjoki Hossassa.

## Toiminnot

- Maastokartta, taustakartta ja ilmakuva (Maanmittauslaitos), ilman avainta OpenStreetMap
- Offline-tallennus valitun alueen kartoille
- Omat tasot: geojson.io:ssa piirretyt alueet, kosket, suvannot, tuvat ja reitit
- Oma sijainti ja etäisyysrenkaat 1, 5 ja 20 km
- Kompassi ja suunta mittaustyökalulla merkittyyn kohteeseen
- Etäisyyden ja suunnan mittaus kartalta
- Sää ja tuuli seuraavat 3 tuntia sijainnissa ja 8 pisteessä 20 km:n kehällä
- Sadetutkaennuste 0–2 h
- Auringon nousu, lasku ja hämärä
- Perhosuositus hyönteisen kehitysvaiheen mukaan: pohjalla, nousussa, pinturi tai aikuinen. Lohelle suositus veden tilan mukaan.
- Sijainti koordinaatteina hätäpuhelua varten (WGS84 ja ETRS-TM35FIN)
- Jokien vesitilanne väreinä (punainen = alhainen, vihreä = normaali, tummansininen = korkea), päälle ja pois *Tasot*-paneelista

## Käyttöönotto

1. **Julkaisu Cloudflare Pagesissa:** *Workers & Pages → Create application → Pages → Connect to Git* → GitHub. Anna Cloudflarelle pääsy vain tähän repoon (*Only select repositories*). Asetukset: Production branch **main**, Framework preset **None**, Build command tyhjä, Build output directory **docs**. Sovellus julkaistaan osoitteeseen `https://<projektin-nimi>.pages.dev/`, ja jokainen push päivittää sen.

   Sovellukselle tarvitaan oma osoite. Android-Chrome asentaa samasta osoitteesta vain yhden sovelluksen, joten esimerkiksi `käyttäjänimi.github.io/sovellus/` ei asennu, jos samassa osoitteessa on jo toinen asennettu sovellus.
2. **Puhelin:** avaa osoite Chromessa ja valitse ⋮ → *Asenna sovellus*.
3. **MML:n API-avain:** hae ilmainen avain [Maanmittauslaitokselta](https://www.maanmittauslaitos.fi/rajapinnat/api-avaimen-ohje) ja syötä se sovelluksen asetuksiin. Avain tallentuu vain puhelimeen.
4. **Offline:** avaa *Tasot* → *Tallenna offline* kotona Wi-Fissä ennen reissua.

## Omat tasot

1. Piirrä alue tai kohteet osoitteessa [geojson.io](https://geojson.io).
2. Lisää kohteille ominaisuudet `nimi`, `tyyppi` ja tarvittaessa `kuvaus`. Tyyppejä ovat `alue`, `joki`, `koski`, `suvanto`, `tupa`, `laavu`, `parkki`, `reitti` ja `kohde`. Offline-tallennus käyttää `alue`-tyyppisen polygonin rajausta.
3. Tallenna GeoJSON-tiedosto kansioon `docs/layers/` ja lisää se tiedostoon `docs/layers/index.json`.

Tiedoston voi myös tuoda suoraan puhelimessa: *Tasot* → *Tuo GeoJSON-tiedosto*. Tuotu taso tallentuu vain siihen laitteeseen. Tuonnissa säilytetään vain kentät `nimi`, `tyyppi` ja `kuvaus`.

## Vesitilanne

`pipeline/vesitilanne.py` ajetaan GitHub Actionsissa kerran päivässä (`.github/workflows/vesitilanne.yml`). Se kirjoittaa tiedoston `docs/data/vesitilanne.json`.

- **Mitattu:** jos joella on Syken mittausasema enintään 2 km:n päässä uomasta, viimeisintä virtaamaa tai vedenkorkeutta verrataan saman vuodenajan (±7 vrk) arvoihin aiempina vuosina. Alle 25 %:n arvo on alhainen, yli 75 %:n korkea ja muut normaaleja.
- **Arvio sateesta:** jos mittausasemaa ei ole, sama vertailu tehdään lähimmän sääaseman 14 vuorokauden sademäärälle. Arvio on karkeampi, ja se merkitään sovelluksessa erikseen.
- Jokien uomat haetaan OpenStreetMapista kerran, ja ne tallentuvat tiedostoihin `docs/layers/<alue>-joet.geojson`.
- Joet ja alueet määritellään tiedostossa `pipeline/joet.json`.

Ajon voi käynnistää käsin: *Actions → Vesitilanne → Run workflow*. GitHub keskeyttää ajastetut ajot, jos repossa ei tapahdu mitään 60 päivään.

## Rakenne

- `docs/`: sovellus, jonka Cloudflare Pages julkaisee (`docs/_headers` = HTTP-turvaotsakkeet)
  - `core.js`: laskenta ilman käyttöliittymää (etäisyys, koordinaatit, aurinko, sää, perhosuositus)
  - `app.js`: käyttöliittymä
  - `sw.js`: service worker, joka pitää sovelluksen ja tallennetut kartat käytettävissä ilman verkkoa
  - `layers/`: omat GeoJSON-tasot
  - `data/perhot.json`: perhosuositusten säännöt
  - `img/perhot/`: kehitysvaiheiden kuvitukset (korvataan omilla valokuvilla)
- `pipeline/`: vesitilanteen päivitys GitHub Actionsissa (vain Pythonin standardikirjasto)
- `tests/`: testit, ajetaan komennoilla `node tests/core.test.js` ja `python3 tests/test_pipeline.py`

## Tietosuoja ja tietoturva

- Sovellus ei kerää, tallenna eikä lähetä henkilötietoja. Siinä ei ole kirjautumista, evästeitä, analytiikkaa eikä ulkopuolisia skriptejä.
- Sijainti käsitellään vain laitteessa. Sääennustetta haettaessa Ilmatieteen laitokselle ja MET Norwaylle lähetetään noin kilometrin tarkkuuteen pyöristetyt koordinaatit.
- MML:n API-avain, tuodut tasot ja tallennetut kartat ovat vain laitteen selaimessa. Avain lähetetään vain Maanmittauslaitokselle, eikä se tallennu karttavälimuistin avaimiin.
- Sisältöturvakäytäntö (CSP) sallii yhteydet vain sovellukseen itseensä sekä Maanmittauslaitokselle, OpenStreetMapille, Ilmatieteen laitokselle ja MET Norwaylle.
- Repossa ei ole API-avaimia, salasanoja eikä henkilötietoja. Älä lisää niitä tiedostoihin.

## Tietolähteet ja lisenssit

- Pohjakartta ja ilmakuva: Maanmittauslaitos, CC BY 4.0. Ilman avainta: © OpenStreetMapin tekijät, ODbL.
- Sääennuste ja tuuli: Ilmatieteen laitos, avoin data, CC BY 4.0.
- Sadetutkaennuste: MET Norway, Nowcast 2.0, CC BY 4.0.
- Vesitilanne: Suomen ympäristökeskus (Syke), Hydrologiarajapinta, CC BY 4.0; sademäärä: Ilmatieteen laitos, CC BY 4.0.
- Jokien uomat: © OpenStreetMapin tekijät, ODbL.
- Testialueiden tuvat: Metsähallitus (luontoon.fi). Alueiden rajaus on likimääräinen.
- Perhosuositukset ovat lähtötaulukko yleisesti käytetyistä perhoista, eivät tutkimusdataa.
- Perhojen valokuvat: Wikimedia Commons, ks. *Perhokuvat* alla.

## Perhokuvat

Valokuvat ovat Wikimedia Commonsista. Ne on pienennetty 480 pikselin levyisiksi, ja metatiedot on poistettu. Kuvien lisenssit ovat alkuperäisten tekijöiden, eikä tämän sovelluksen lisenssi koske niitä. Jos suositellusta perhosta ei löytynyt vapaasti lisensoitua kuvaa, sovelluksessa näytetään samantyyppisen perhon kuva ja kerrotaan, mikä perho kuvassa on, tai piirros.

| Tiedosto | Alkuperäinen | Tekijä | Lisenssi |
| --- | --- | --- | --- |
| `bloodworm.jpg` | [Bloodworm-trout-flies.jpg](https://commons.wikimedia.org/wiki/File:Bloodworm-trout-flies.jpg) | Theessentialfly | CC BY-SA 3.0 |
| `buzzer.jpg` | [Trout Buzzers Flies.jpg](https://commons.wikimedia.org/wiki/File:Trout_Buzzers_Flies.jpg) | Theessentialfly | CC BY 3.0 |
| `cdc-olive.jpg` | [BWO CDC Winged Olive Biot.jpg](https://commons.wikimedia.org/wiki/File:BWO_CDC_Winged_Olive_Biot.jpg) | Mike Cline | CC BY-SA 4.0 |
| `elk-hair-caddis.jpg` | [Elk Hair Caddis2.jpg](https://commons.wikimedia.org/wiki/File:Elk_Hair_Caddis2.jpg) | Mike Cline | CC BY-SA 4.0 |
| `hares-ear.jpg` | [Gold ribbed hairs ear trout fly.JPG](https://commons.wikimedia.org/wiki/File:Gold_ribbed_hairs_ear_trout_fly.JPG) | Waldemarpaetz | CC BY-SA 4.0 |
| `lohiperhoja.jpg` | [Lachsfliegen mit Federn-20071204-RM-113502.jpg](https://commons.wikimedia.org/wiki/File:Lachsfliegen_mit_Federn-20071204-RM-113502.jpg) | Ermell | CC BY-SA 4.0 |
| `montana-stone.jpg` | [BrooksMontanaStone.jpg](https://commons.wikimedia.org/wiki/File:BrooksMontanaStone.jpg) | Mike Cline | Public domain |
| `para-midge.jpg` | [Biot Para-Midge.jpg](https://commons.wikimedia.org/wiki/File:Biot_Para-Midge.jpg) | Curtis Fry | CC BY 2.0 |
| `parachute-adams.jpg` | [Parachute Adams Dry Fly.jpg](https://commons.wikimedia.org/wiki/File:Parachute_Adams_Dry_Fly.jpg) | Freyfisher | CC BY-SA 2.0 |
| `partridge-and-orange.jpg` | [PartridgeandOrange.jpg](https://commons.wikimedia.org/wiki/File:PartridgeandOrange.jpg) | Mike Cline | Public domain |
| `pheasant-tail.jpg` | [American Pheasant Tail Nymph 02.jpg](https://commons.wikimedia.org/wiki/File:American_Pheasant_Tail_Nymph_02.jpg) | Mike Cline | CC BY-SA 4.0 |
| `putkiperho.jpg` | [Large blue tube fly.jpg](https://commons.wikimedia.org/wiki/File:Large_blue_tube_fly.jpg) | kasperbs | CC BY 2.0 |
| `red-spinner.jpg` | [Červená jepice modifikace Red Spinner IMG 1076.JPG](https://commons.wikimedia.org/wiki/File:%C4%8Cerven%C3%A1_jepice_modifikace_Red_Spinner_IMG_1076.JPG) | Jan Doné | CC BY 3.0 |
| `stimulator.jpg` | [OrangeStimulator.jpg](https://commons.wikimedia.org/wiki/File:OrangeStimulator.jpg) | Mike Cline | Public domain |

## Lisenssi

Sovellus ja sen lähdekoodi ovat julkisesti nähtävillä, mutta niitä ei saa käyttää kaupallisesti ilman tekijän lupaa.

- Sovelluksen koodi on lisensoitu [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) -lisenssillä ([LICENSE](LICENSE)). Sovellusta saa käyttää, muokata ja jakaa ei-kaupallisiin tarkoituksiin, esimerkiksi omaan käyttöön, harrastuksiin, opiskeluun ja tutkimukseen.
- Kaupallinen käyttö edellyttää tekijän (GitHub-käyttäjä [gitdaada](https://github.com/gitdaada)) etukäteen antamaa kirjallista lupaa. Kaupallista käyttöä on esimerkiksi:
  - sovelluksen tai siitä muokatun version julkaiseminen sovelluskaupassa (esim. App Store tai Google Play) tai muuten maksullisena, mainosrahoitteisena tai tilauspohjaisena
  - sovelluksen tai sen osien käyttäminen osana kaupallista tuotetta tai palvelua, kuten maksullista opastus-, erä- tai kalastusmatkailupalvelua
  - sovelluksen myyminen tai lisensoiminen eteenpäin.
- Luvasta, sen ehdoista ja mahdollisesta rojaltijaosta sovitaan tapauskohtaisesti erikseen kirjallisesti. Lupaa voi pyytää avaamalla [issuen](https://github.com/gitdaada/joki-opas/issues).
- Kopioissa ja muokatuissa versioissa on säilytettävä LICENSE-tiedosto ja sen alussa oleva `Required Notice` -rivi.
- Poikkeus: `docs/vendor/leaflet/` on Leaflet-kirjasto, jota koskee sen oma BSD 2-Clause -lisenssi ([docs/vendor/leaflet/LICENSE](docs/vendor/leaflet/LICENSE)).

Sovelluksen data (`docs/layers/`, `docs/data/`) on johdettu avoimista aineistoista, joiden lisenssit on lueteltu kohdassa *Tietolähteet ja lisenssit*. Piirroskuvitukset (`docs/img/perhot/*.svg`) ja kuvakkeet ovat tekijän omia, eikä niitä saa käyttää kaupallisesti ilman lupaa. Valokuvia (`docs/img/perhot/kuvat/`) koskevat niiden omat lisenssit, jotka on lueteltu kohdassa *Perhokuvat*.
