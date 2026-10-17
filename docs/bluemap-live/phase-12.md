# BlueMap Live – Phase 12: Komfort-Einstellungen im Browser

Stand: 2026-10-17 · Branch `bluemap-live` · Wunsch des Nutzers („im Browser einstellen, wie weit die Entities um den Spieler geladen werden, und die Detailreichweite der Blöcke“)

## 1. Neue Gruppe „Entities und Effekte“ im Kartenmenü

| Einstellung | Wirkung | Standard |
|---|---|---|
| **Entities um Spieler** | Entities, die weiter als dieser Abstand vom nächsten angezeigten Spieler entfernt sind, werden ausgeblendet. Ganz rechts zeigt alle, die der Server sendet. | alle |
| **Entities sichtbar bis** | Entities, die weiter als dieser Abstand von der Kamera entfernt sind, werden nicht gezeichnet (50–1000 Blöcke, vorher fest 300). | 300 Blöcke |
| **Partikel und Effekte** | Explosionen, Trankwirbel, Wolken, Feuer, Rauch an oder aus | an |
| **Sofort-Vorschau der Blöcke** | Vorschau der Blockänderungen an oder aus. Aus: Die Karte zeigt nur die gerenderten Kacheln, versteckte Blöcke werden wieder angezeigt. | an |

- Gespeichert wird mit den anderen Benutzereinstellungen (`live.entityRadius`, `live.entityDistance`, `live.particles`, `live.blockPreview`).
- Die Glättung und die Bildratenbegrenzung bleiben in der Gruppe „Live-Anzeige“. Die Gruppe wurde geteilt, weil BlueMap jede Gruppe auf eine feste Höhe begrenzt und den Rest scrollen lässt.

**Wie weit der Server sendet:**
- `entities.json` enthält jetzt `radius`: den Umkreis, in dem der Server Entities sammelt (`live-entities-radius` in `plugin.conf`, Standard 30, höchstens 128).
- Der Regler reicht bis zu diesem Wert. Mehr als der Server sendet, kann der Browser nicht anzeigen.
- Wer weiter sehen will, erhöht `live-entities-radius`. Das kostet etwas mehr Server-Zeit, sichtbar in `/bluemap live-stats`.

## 2. Detailreichweite der Blöcke

Die gibt es schon im Original: Kartenmenü → „Sichtweite“ → „Hires-Ebene“. Das ist die Entfernung, bis zu der die detaillierten Kacheln geladen werden.
- Der Regler reicht bis `hires-slider-max` in `webapp.conf`, Standard 500.
- Für mehr Reichweite den Wert in `webapp.conf` erhöhen und `/bluemap reload` ausführen. Mehr Hires-Kacheln brauchen mehr Speicher und Leistung im Browser.

## 3. Tests

| Test | Ergebnis |
|---|---|
| Node `npm test` | 161/161, neu: Abstand zu den Spielern, `radius` aus der Antwort |
| JUnit lokal | 96/96, `radius` in `entities.json` |
| Browser `display-e2e.mjs` | 6/6: Gruppe im Menü, Regler bis zum Server-Radius, Ausblenden nach Abstand zu den Spielern und zur Kamera, Begrenzung auf 1000, Partikel aus, Vorschau aus (keine versteckten Blöcke), Speichern und Laden |

**Manuell:** Q41 in `singleplayer-test.md`.
