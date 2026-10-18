# BlueMap Live – Phase 9: Flüssigere Anzeige über das Internet, weniger Last (0.3.1)

Stand: 2026-10-16 · Branch `bluemap-live` · Wunsch des Nutzers nach dem Test auf seinem Server

> **Kurzfassung:**
> - **Wiedergabepuffer:** Live-Bewegungen von Spielern und Entities laufen über das Internet ohne Stocken. Die Karte zeigt sie dafür leicht verzögert (Standard 400 ms plus Abtastintervall), einstellbar im Kartenmenü.
> - **Weniger Arbeit im Browser:** Figuren außerhalb des Bildausschnitts oder weit weg werden nicht animiert und lösen kein schnelles Neuzeichnen aus.
> - **Bildratenbegrenzung:** wählbar 30 oder 60 FPS.
> - **Server:** Der Item-Index nimmt keine GUI-, Partikel- und Mob-Texturen von Mods mehr auf und wird nach 10 Minuten ohne Nutzung freigegeben. Die Live-Daten werden komprimiert übertragen, Entity-Zahlen auf 1/1000 gerundet.
> - **Nicht in Minecraft geprüft:** offen, siehe `singleplayer-test.md` (Q26).

## 1. Wiedergabepuffer (`LivePlayback.js`)

**Problem:** Der Browser fragt die Live-Daten ständig ab. Über das Internet kommen die Antworten unregelmäßig an. Bisher bewegte sich jede Figur bis zur zuletzt empfangenen Position. Kam die nächste Antwort spät, blieb sie stehen und sprang dann. Fragte der Browser seltener ab, als der Server abtastet, gingen Abtastungen verloren, und die Bewegung pausierte zusätzlich.

**Lösung** (wie die Interpolationsverzögerung in Online-Spielen):
- **Uhr:** `LiveClock` schätzt den Versatz zwischen Server- und Browser-Uhr samt schnellster Übertragungszeit. Das ist die kleinste Differenz „Empfangszeit − Abtastzeit“ der letzten 10 s. Die Uhren müssen nicht übereinstimmen.
- **Wiedergabezeit** = Abtastzeit + Versatz + Verzögerung + Abtastintervall des Servers.
- **Interpolation:** Liegt die Wiedergabezeit zwischen zwei Abtastungen, bewegt sich die Figur vom einen zum anderen Stand. Die Interpolation folgt der Uhrzeit, nicht den Bildern. Sie beginnt also nicht verspätet im nächsten Frame.
- **Wann eine Abtastung kommen muss:** spätestens, wenn die Wiedergabezeit die vorige erreicht. Durch das zusätzliche Abtastintervall bleibt die ganze eingestellte Verzögerung als Spielraum für verspätete Antworten.
- **Wiederholte und ältere Abtastungen:** Dieselbe Abtastung kommt mehrfach, weil der Browser öfter fragt, als der Server abtastet. Solche Kopien und ältere Abtastungen werden verworfen und wenden keine wartenden Abtastungen vorzeitig an.
- **Alles gemeinsam verzögert:** Positionen, Animationen, Gegenstände, Reiter, Leinen und Fahrzeuge kommen mit derselben Uhr, deshalb passen Reiter und Reittier weiterhin zusammen.
- **Ohne Puffer** (Einstellung „Aus“) gilt das bisherige Verhalten unverändert.

**Einstellung:** Kartenmenü → „Live-Anzeige“ → „Glättung (Verzögerung)“: Aus, 250, 400 (Standard), 750, 1000 ms. Gespeichert mit den anderen Benutzereinstellungen (`livePlaybackDelay`).

## 2. Weniger Arbeit im Browser

**Entities** (`EntityMarker.step`):
- Einmal pro Frame wird der Sichtbereich der Kamera bestimmt (`viewFrustum`).
- Liegt eine Entity außerhalb oder weiter als 300 Blöcke weg, laufen nur Position und Zeitgeber weiter. Das Modell wird nicht gestellt und fordert keine hohe Bildrate an.

**Spieler:** Nur Spieler im Sichtbereich fordern eine hohe Bildrate an.

**Bildratenbegrenzung:** Kartenmenü → „Bildrate begrenzen“: Unbegrenzt (Standard), 60, 30 FPS (`fpsLimit`). Gilt, solange sich etwas bewegt. Die Grundrate von BlueMap (mindestens alle 50 ms ein Bild) bleibt unverändert.

## 3. Server

- **Item-Index** (`ItemResourceIndex`): Auch für Mods werden Texturordner übersprungen, die Item-Modelle nie nutzen: `gui`, `particle`, `painting`, `font`, `environment`, `map`, `mob_effect`, `colormap`, `effect`, `models`, `misc`, `trims`. Rüstungsebenen, Verzierungen und Glanz bleiben erhalten. Mob-Texturen nur von Minecraft, denn für Mod-Mobs gibt es keine Modelle.
- **Freigabe:** Der Index wird nach 10 Minuten ohne Nutzung freigegeben (`ItemAssetUpdater.releaseIdleResources`, im 10-Minuten-Takt von `Plugin`). Gebackene Assets bleiben im Speicher der Karte. Bei Bedarf wird der Index neu geladen.
- **Komprimierung:** `JsonDataRequestHandler` (`players.json`, `entities.json` des eingebauten Webservers) überträgt ab 1 KB gzip-komprimiert, wenn der Browser das annimmt.
- **Rundung:** Zahlen in `entities.json` werden auf 1/1000 gerundet (1 mm, 0,001°).

## 4. Tests

**Automatisiert:**

| Test | Ergebnis |
|---|---|
| Node `npm test` | 125/125, neu `LivePlayback.test.mjs`: Uhrversatz, Fenster, Wiedergabe in Reihenfolge, Kopien und ältere Abtastungen, Startzeit unabhängig vom Frame, Abtastintervall, Simulation mit 50 bis 350 ms Verspätung. Die bisherigen Marker-Tests laufen ohne Puffer. |
| JUnit lokal | 73/73, neu: Komprimierung der Live-Daten (nur ab 1 KB, nur mit `Accept-Encoding: gzip`), Texturfilter für Mods, Freigabe des Item-Index nach Leerlauf |
| Browser `playback-e2e.mjs` | 6/6. Antworten werden zufällig 0 bis 350 ms zurückgehalten. Mit Puffer längster Stillstand 0 bis 61 ms (≤ 1 Frame), ohne 350 bis 430 ms. Dazu: Einstellungen gespeichert und geladen, Begrenzung auf 30 FPS. |
| Browser `player`, `animation`, `items`, `entities`, `mobs`, `worldtime` | 21/22, 19/19, 16/16, 12/12, 15/15, 9/9. Diese Suiten schalten den Puffer zu Beginn aus, weil sie die Bewegung selbst prüfen. `player`: der bekannte, gelegentlich fehlschlagende Schritt „skin (slim)“, s. `phase-8.md`. |
| Regression gegen das Original (Karte ohne Spieler) | 106 Pixel Rauschen, höchstens 42 von 255 Stufen (wie in früheren Läufen) |

Hinweis: Jede Suite braucht einen frisch gestarteten Testserver, sonst stören übrige Spieler und Entities der vorigen Suite.
