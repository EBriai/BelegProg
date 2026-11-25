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

## Koersen

Yahoo Finance blokkeert verzoeken die rechtstreeks uit een webpagina komen. Daarom haalt
**GitHub Actions** de koersen op (`.github/workflows/koersen.yml`, `scripts/koersen.py`):

- automatisch zodra je een aandeel toevoegt of verwijdert (klaar na ongeveer een minuut);
- elke werkdag na sluiting van de Europese en Amerikaanse beurzen.

Typ een ticker zoals je hem kent (`RHM`, `ASML`, `AAPL`) of een naam (`Rheinmetall`). Yahoo
kiest de hoofdnotering; andere beurzen kun je per aandeel kiezen, of vooraf met de beurskeuze
naast het invoerveld. Koersen zijn gecorrigeerd voor splitsingen en dividend.

De lijst met tickers (`data/tickers.enc`) en de koersen (branch `koersen`) zijn versleuteld
met een sleutel die alleen in je wachtwoordkluis en in het repository-secret `KOERS_KEY` staat.

## Gegevens: één centrale, versleutelde lijst

Je aandelenlijst staat op één plek: `data/kluis.json` in deze repository, **versleuteld**
(AES-256) met een wachtwoord dat alleen jij kent. Het bestand zelf is zichtbaar, de inhoud
(welke aandelen, en het GitHub-token waarmee de app opslaat) niet. Gebruik dus een goed
wachtwoord: wie het raadt, kan de lijst lezen.

Eenmalig op de pc: in de app op "Eenmalig instellen" klikken, een GitHub-token maken
(alleen voor deze repository; Contents én Secrets: Read and write), dat plakken en een
wachtwoord kiezen. De app zet dan zelf het secret voor GitHub Actions.
Op elk ander apparaat vraagt de app alleen het wachtwoord. Het apparaat onthoudt het
wachtwoord tot je op "Wachtwoord vergeten op dit apparaat" drukt.

Is het token verlopen, dan plak je bij Instellingen een nieuw token. 
## Opbouw (voor uitbreidingen)

```
index.html          pagina
style.css           opmaak (kleuren als variabelen, licht en donker)
js/storage.js       opslag in de browser
js/sync.js          centrale, versleutelde lijst (data/kluis.json)
js/providers.js     koersbronnen (GitHub/Yahoo en demo)
js/prices.js        koersen in geheugen en cache
scripts/koersen.py  ophalen bij Yahoo in GitHub Actions
js/analysis.js      rekenwerk (uitlijnen, normaliseren), puur en testbaar
js/app.js           gebruikersinterface
sw.js, manifest     installeerbaar als app (PWA)
tests/              node tests/analysis.test.js
tools/              build_artifact.py: losse testversie voor claude.ai
```
