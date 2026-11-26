# cuzReader

Hacker News als **PWA mit nativer iOS-Oberfläche** – ohne Backend, rein statisch.

## Funktionen

- **Tabs** wie in einer iOS-App: Top · Neu · Show · Ask · Mehr (schwebende Glas-Tab-Leiste, große Titel, Segment-Controls).
- **Show HN** mit Segmenten *Aktuell*, *Neu* und *GitHub* (nur Beiträge mit Repo-Link – auch wenn der Link nur im Text steht).
- **Filter, die HN selbst nicht hat** (Filter-Button oben rechts in jedem Feed):
  - Zeitraum: Aktuell / 24 Std. / Woche / Monat / Jahr (Zeitraum durchsucht das HN-Archiv der Kategorie via Algolia)
  - Sortierung: HN-Ranking / Punkte / Kommentare / Neueste
  - Mindest-Punkte und Mindest-Kommentare
  - Quelle: Alle / GitHub / Text-Posts / Links, plus „nur diese Domains“
  - Gelesenes ausblenden
  - Jede Kombination lässt sich als **eigener Feed** speichern (Mehr → Eigene Feeds).
- **Beitragsansicht** mit Kommentaren in einem **ziehbaren Sheet** (3 Raststufen), Threads per Tipp einklappen, „nächster Thread“-Button, Sortierung Top/Neueste/Älteste, OP-Markierung.
- **Links öffnen im Overlay** (die App wird nie verlassen):
  - **GitHub-Repos nativ**: Stars, Forks, Sprache, Lizenz, Topics, gerendertes README, Dateibrowser, Dateiansicht.
  - Andere Seiten im eingebetteten Web-View; Seiten, die Einbettung verbieten, automatisch im **Reader** (via r.jina.ai). Die Wahl Web/Reader merkt sich cuzReader pro Domain.
- Merken per Wisch nach rechts, Wisch-zurück vom linken Rand, Pull-to-Refresh, Dark Mode, Suche im gesamten Archiv.

## Installation auf dem iPhone

1. Seite in Safari öffnen.
2. Teilen → **Zum Home-Bildschirm**.
3. Optional: unter *Mehr → GitHub* einen Fine-grained Token **ohne Berechtigungen** hinterlegen (5.000 statt 60 GitHub-API-Abrufe/Stunde). Ohne Token fällt das README bei erreichtem Limit automatisch auf `raw.githubusercontent.com` zurück.

## Deployment

GitHub Pages über `.github/workflows/pages.yml` (Push auf `main`). Einmalig in den Repo-Einstellungen: *Settings → Pages → Source: GitHub Actions*.

Lokal: `python3 -m http.server` im Repo-Ordner und `http://localhost:8000` öffnen.

## Datenquellen

| Zweck | Quelle |
|---|---|
| Live-Ranglisten (Top, Neu, Beste, Show, Ask, Jobs) | Hacker News Firebase API |
| Archiv, Zeitraum-Filter, Suche, Kommentarbaum | HN Algolia API |
| Repos | GitHub REST API + raw.githubusercontent.com |
| Reader-Ansicht | r.jina.ai |
| Favicons (abschaltbar) | icons.duckduckgo.com |

Alle Einstellungen, Lesezeichen und eigenen Feeds liegen nur lokal im Browser (localStorage).

## Aufbau

```
index.html, manifest.webmanifest, sw.js
css/app.css          iOS-Designsystem (Systemfarben, Glas, Sheets, Listen)
js/app.js            Tabs, Feed-Screens, Mehr, Suche, Einstellungen
js/api.js            HN Firebase + Algolia
js/feeds.js          Filtermodell, eigene Feeds, FeedSource
js/feedview.js       Liste, Infinite Scroll, Pull-to-Refresh, Wisch-Aktionen
js/detail.js         Beitragsansicht + Kommentar-Sheet
js/browser.js        Link-Overlay (GitHub nativ / Web / Reader)
js/github.js         GitHub-API, README, Dateien
js/nav.js, sheet.js  Navigationsstapel (History-basiert), ziehbare Sheets
vendor/              marked, DOMPurify
```
