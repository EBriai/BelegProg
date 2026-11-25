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

## Gegevens: één centrale, versleutelde lijst

Je aandelenlijst staat op één plek: `data/kluis.json` in deze repository, **versleuteld**
(AES-256) met een wachtwoord dat alleen jij kent. Het bestand zelf is zichtbaar, de inhoud
(welke aandelen, en het GitHub-token waarmee de app opslaat) niet. Gebruik dus een goed
wachtwoord: wie het raadt, kan de lijst lezen.

Eenmalig op de pc: in de app op "Stel de centrale lijst in" klikken, een GitHub-token maken
(alleen voor deze repository, Contents: Read and write), dat plakken en een wachtwoord kiezen.
Op elk ander apparaat vraagt de app alleen het wachtwoord. Het apparaat onthoudt het
wachtwoord tot je op "Wachtwoord vergeten op dit apparaat" drukt.

Is het token verlopen, dan plak je bij Instellingen een nieuw token. Koersen worden per
apparaat gecachet en zijn openbare informatie.

## Opbouw (voor uitbreidingen)

```
index.html          pagina
style.css           opmaak (kleuren als variabelen, licht en donker)
js/storage.js       opslag in de browser
js/sync.js          centrale, versleutelde lijst (data/kluis.json)
js/providers.js     koersbronnen; nieuwe bron = object met lookup() en history()
js/prices.js        koerscache en dagelijkse update
js/analysis.js      rekenwerk (uitlijnen, normaliseren), puur en testbaar
js/app.js           gebruikersinterface
sw.js, manifest     installeerbaar als app (PWA)
tests/              node tests/analysis.test.js
tools/              build_artifact.py: losse testversie voor claude.ai
```
