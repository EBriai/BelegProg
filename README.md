# Koersvergelijker

Web-app (HTML + JavaScript, geen installatie of server nodig) om aandelen te volgen
en genormaliseerde koersgrafieken over elkaar te leggen. Werkt in elke moderne
browser: Android, Windows, iPhone, Mac. Op Android kun je hem via Chrome
"Toevoegen aan startscherm" als app installeren.

## Online zetten (gratis, via GitHub Pages)

1. Maak op github.com een nieuwe repository, bijv. `koersvergelijker`.
2. Upload de inhoud van deze map (Add file → Upload files).
3. Settings → Pages → Branch: `main`, map `/ (root)` → Save.
4. Na een minuut staat hij op `https://<jouw-naam>.github.io/koersvergelijker/`.

Lokaal proberen kan ook: `python -m http.server` in deze map en open http://localhost:8000.

## Koersbronnen (Instellingen)

- **Yahoo Finance via proxy** (standaard): gratis, alle beurzen (Amsterdam, VS, Duitsland, indexen).
  Yahoo staat ophalen vanuit een webpagina niet direct toe, dus het verzoek loopt via een
  publieke "CORS-proxy". Dat is onofficieel: een proxy kan traag zijn of stoppen. De app
  probeert er drie na elkaar. Koersen zijn gecorrigeerd voor splitsingen en dividend.
- **Twelve Data**: officiële API, gratis sleutel op twelvedata.com (800 verzoeken/dag),
  maar het gratis plan dekt alleen Amerikaanse aandelen en ETF's.
- **Demo**: verzonnen koersen, voor testen.

Koersen worden in de browser bewaard: de volledige historie één keer, daarna hooguit één
keer per dag de laatste dagen erbij.

## Gegevens: één centrale lijst

Je aandelenlijst kan op één plek staan: een geheime (niet openbare) gist in je eigen
GitHub-account. Pc en telefoon lezen en schrijven dezelfde lijst.

1. Maak een token: https://github.com/settings/tokens/new?scopes=gist&description=Koersvergelijker
   (vink alleen **gist** aan en kies een vervaldatum).
2. In de app: Instellingen → plak het token → **Koppelen**. Doe dit op elk apparaat
   (hetzelfde token mag).

Het token blijft alleen in de browser van dat apparaat staan en komt nooit in de repository.
Het geeft alleen toegang tot je gists, niet tot je repositories. Zonder koppeling bewaart de
app de lijst alleen op het apparaat zelf. Koersen worden per apparaat gecachet.

## Opbouw (voor uitbreidingen)

```
index.html          pagina
style.css           opmaak (kleuren als variabelen, licht en donker)
js/storage.js       opslag in de browser
js/sync.js          centrale lijst via een GitHub-gist
js/providers.js     koersbronnen; nieuwe bron = object met lookup() en history()
js/prices.js        koerscache en dagelijkse update
js/analysis.js      rekenwerk (uitlijnen, normaliseren), puur en testbaar
js/app.js           gebruikersinterface
sw.js, manifest     installeerbaar als app (PWA)
tests/              node tests/analysis.test.js
tools/              build_artifact.py: losse testversie voor claude.ai
```
