# BlueMap Live – Phase 8: Tag-Nacht-Zyklus der Welt und weitere Mob-Details

Stand: 2026-10-16 · Branch `bluemap-live` · Wunsch des Nutzers nach Phase 7

> **Kurzfassung:**
> - **Implementiert:** Die Kartenbeleuchtung kann dem Tag-Nacht-Zyklus der Minecraft-Welt folgen. Das ist eine zusätzliche Auswahl neben BlueMaps eigenem Tag/Nacht-Schalter.
> - **Nicht geprüft:** Minecraft (manuelle Prüfungen Q1–Q6 offen).

## 1. Tag-Nacht-Zyklus der Welt

**Server** (`FabricMod`, Server-Thread, im Takt der Live-Daten):
- Für jede Welt ohne feste Zeit (Oberwelt, nicht Nether und Ende) werden gelesen:
  - die Tageszeit (`getTimeOfDay() mod 24000`)
  - Regen- und Gewitterstärke
  - die Spielregel `doDaylightCycle`
- **Daten** in `players.json` der Karte, nur mit `live-player-extended-data`:
  ```json
  "world": {"dayTime": 13000, "rain": 0.0, "thunder": 0.0, "cycle": true}
  ```
- Ohne Feld (alter Server, Nether, Ende) bleibt alles wie bisher.

**Webapp** (`WorldTime.js`, `WorldTimeLighting.js`):
- **Helligkeit:** Das Sonnenlicht der Karte folgt dem Himmelslicht des Servers wie `World.calculateAmbientDarkness` (Sonnenwinkel wie `DimensionType.getSkyAngle`).
  - Werte: Tag 1, Nacht 4/15. Regen und Gewitter dunkeln ab.
  - Anders als in Minecraft wird nicht auf ganze Lichtstufen gerundet. Der Übergang ist dadurch fließend.
- **Zwischen den Abfragen** läuft die Zeit mit 20 Ticks pro Sekunde weiter (nicht bei `doDaylightCycle false`). Die Beleuchtung wird einmal pro Sekunde nachgeführt und nur bei einer Änderung neu gezeichnet.
- **Bedienung:**
  - Ein Uhr-Knopf direkt neben dem Tag/Nacht-Schalter und ein Schalter „Tag-Nacht-Zyklus der Welt“ im Einstellungsmenü unter „Beleuchtung“.
  - Beide erscheinen nur, wenn der Server die Zeit liefert. Standard: aus, das ursprüngliche Verhalten.
  - Der eigene Tag/Nacht-Schalter und der Sonnenlicht-Regler beenden den Modus.
  - Die Wahl wird mit den anderen Benutzereinstellungen gespeichert (nur mit `useCookies`, wie im Original).
- **Lebewesen und Gegenstände:**
  - Spieler, Mobs und Items werden jetzt wie die Karte im Freien beleuchtet, d. h. nachts dunkler: Farbe · mix(Umgebungslicht, 1, Sonnenlicht).
  - Das gilt auch für BlueMaps eigenen Schalter und die Regler.
  - Leuchtende Teile (Augen von Spinne und Enderman, Energiehülle) bleiben hell wie in Minecraft.
  - Das Blocklicht am Ort des Lebewesens wird nicht berücksichtigt (Näherung: draußen).

**Einschränkungen:**
- Der Himmel der Karte ist BlueMaps eigener (keine Sonne, kein Mond, keine Sterne).
- Das Licht der Karte ist BlueMaps Shader: `mix(Blocklicht, Himmelslicht, Sonnenlicht)`. In Minecraft wird stattdessen die Verdunkelung vom Himmelslicht abgezogen. Höhlen und Innenräume können dadurch leicht anders wirken.

## 2. Tests

**Automatisiert:**

| Test | Ergebnis |
|---|---|
| Java (lokal) | 63/63, u. a. `world` in `players.json` nur mit erweiterten Daten |
| Node | 96/96, u. a. Sonnenwinkel, Himmelslicht (Tag, Nacht, Regen, Gewitter), Weiterlaufen der Zeit, Beleuchtung der Lebewesen, Ein- und Ausschalten |
| Browser `worldtime-e2e.mjs` | 9/9: Knopf nur mit Weltzeit, Mitternacht dunkelt die Karte ab (Pixel), Mittag, Regen, Speichern/Laden, eigener Schalter beendet den Modus, Einstellungsmenü |
| Browser `entities`, `mobs`, `items`, `player`, `animation` | 12/12, 10/10, 16/16, 22/22, 19/19 |

- Ein Lauf von `animation-e2e.mjs` schlug einmal bei der Gehamplitude nach Skinwechsel fehl, zwei Wiederholungen liefen fehlerfrei durch (Zeitabhängigkeit des Tests).
- Der Fabric-Teil kompiliert nur in der CI.

**Manuell in Minecraft:** Q1–Q6 in `singleplayer-test.md`, alle offen.
