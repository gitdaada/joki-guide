# Joki guide

Offline-toimiva karttasovellus eränkäyntiin ja jokikalastukseen. Asennetaan puhelimeen selaimen kautta.

Versio 0.1 on testiversio. Testialueena on Poroeno Käsivarren erämaa-alueella.

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

## Käyttöönotto

1. **GitHub Pages:** repon *Settings → Pages → Build and deployment*: Source **Deploy from a branch**, Branch **main**, kansio **/docs** → *Save*. Sovellus on hetken päästä osoitteessa `https://<käyttäjänimi>.github.io/joki-guide/`.
2. **Puhelin:** avaa osoite Chromessa ja valitse ⋮ → *Asenna sovellus*.
3. **MML:n API-avain:** hae ilmainen avain [Maanmittauslaitokselta](https://www.maanmittauslaitos.fi/rajapinnat/api-avaimen-ohje) ja syötä se sovelluksen asetuksiin. Avain tallentuu vain puhelimeen.
4. **Offline:** avaa *Tasot* → *Tallenna offline* kotona Wi-Fissä ennen reissua.

## Omat tasot

1. Piirrä alue tai kohteet osoitteessa [geojson.io](https://geojson.io).
2. Lisää kohteille ominaisuudet `nimi`, `tyyppi` ja tarvittaessa `kuvaus`. Tyyppejä ovat `alue`, `joki`, `koski`, `suvanto`, `tupa`, `laavu`, `parkki`, `reitti` ja `kohde`. Offline-tallennus käyttää `alue`-tyyppisen polygonin rajausta.
3. Tallenna GeoJSON-tiedosto kansioon `docs/layers/` ja lisää se tiedostoon `docs/layers/index.json`.

Tiedoston voi myös tuoda suoraan puhelimessa: *Tasot* → *Tuo GeoJSON-tiedosto*. Tuotu taso tallentuu vain siihen laitteeseen. Tuonnissa säilytetään vain kentät `nimi`, `tyyppi` ja `kuvaus`.

## Rakenne

- `docs/`: sovellus, jonka GitHub Pages julkaisee
  - `core.js`: laskenta ilman käyttöliittymää (etäisyys, koordinaatit, aurinko, sää, perhosuositus)
  - `app.js`: käyttöliittymä
  - `sw.js`: service worker, joka pitää sovelluksen ja tallennetut kartat käytettävissä ilman verkkoa
  - `layers/`: omat GeoJSON-tasot
  - `data/perhot.json`: perhosuositusten säännöt
  - `img/perhot/`: kehitysvaiheiden kuvitukset (korvataan omilla valokuvilla)
- `tests/`: laskennan testit, ajetaan komennolla `node tests/core.test.js`

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
- Testialueen tuvat: Metsähallitus (luontoon.fi). Alueen rajaus on likimääräinen; uoma näkyy maastokartalla.
- Perhosuositukset ovat lähtötaulukko yleisesti käytetyistä perhoista, eivät tutkimusdataa.

## Lisenssi

Sovellus ja sen lähdekoodi ovat julkisesti nähtävillä, mutta niitä ei saa käyttää kaupallisesti ilman tekijän lupaa.

- Sovelluksen koodi on lisensoitu [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) -lisenssillä ([LICENSE](LICENSE)). Sovellusta saa käyttää, muokata ja jakaa ei-kaupallisiin tarkoituksiin, esimerkiksi omaan käyttöön, harrastuksiin, opiskeluun ja tutkimukseen.
- Kaupallinen käyttö edellyttää tekijän (GitHub-käyttäjä [gitdaada](https://github.com/gitdaada)) etukäteen antamaa kirjallista lupaa. Kaupallista käyttöä on esimerkiksi:
  - sovelluksen tai siitä muokatun version julkaiseminen sovelluskaupassa (esim. App Store tai Google Play) tai muuten maksullisena, mainosrahoitteisena tai tilauspohjaisena
  - sovelluksen tai sen osien käyttäminen osana kaupallista tuotetta tai palvelua, kuten maksullista opastus-, erä- tai kalastusmatkailupalvelua
  - sovelluksen myyminen tai lisensoiminen eteenpäin.
- Luvasta, sen ehdoista ja mahdollisesta rojaltijaosta sovitaan tapauskohtaisesti erikseen kirjallisesti. Lupaa voi pyytää avaamalla [issuen](https://github.com/gitdaada/joki-guide/issues).
- Kopioissa ja muokatuissa versioissa on säilytettävä LICENSE-tiedosto ja sen alussa oleva `Required Notice` -rivi.
- Poikkeus: `docs/vendor/leaflet/` on Leaflet-kirjasto, jota koskee sen oma BSD 2-Clause -lisenssi ([docs/vendor/leaflet/LICENSE](docs/vendor/leaflet/LICENSE)).

Sovelluksen data (`docs/layers/`, `docs/data/`) on johdettu avoimista aineistoista, joiden lisenssit on lueteltu kohdassa *Tietolähteet ja lisenssit*. Kuvitukset (`docs/img/`) ovat tekijän omia, eikä niitä saa käyttää kaupallisesti ilman lupaa.
