# BlueMap Live – Release-Plan

Stand: 2026-10-15 · Versionsschema: eigene Nummern (`0.x.y-alpha`), damit keine Verwechslung mit BlueMap-Versionen entsteht. `0.x.0` steht für ein größeres Feature, `0.x.y` für Fehlerbehebungen.

Für jedes Release gilt:
- Die originale Karte (Renderer, Navigation, Marker, „Spieler folgen“) bleibt unverändert.
- Neue Funktionen sind abschaltbar und kommen mit fehlenden oder älteren Daten zurecht.
- Automatisierte Tests sind getrennt von den manuellen Minecraft-Tests aufgeführt.
- Ein Release wird erst getaggt, wenn die Kernpunkte in Minecraft bestätigt sind.

Die Aufwands- und Leistungsangaben unten sind **Schätzungen**, nicht gemessen.

---

## 0.1.0-alpha – erste Version (bereit zum Taggen)

**Inhalt:**
- Live-Spieler als 3D-Modell mit Skin
- Animationen
- gehaltene Items mit Vanilla-Posen
- Dimensionswechsel ohne Neuladen
- ausgeblendetes Kopfbild in der Nähe
- Einzelspieler-Unterstützung
- Name „BlueMap Live“, Mod-ID `bluemap_live`

Release-Notes: `releases/v0.1.0-alpha.md`.

**Offen bis zum Tag:**
- Release auf GitHub anlegen (macht der Nutzer, die Sitzung darf keine Tags und Releases anlegen).
- Prüfen, ob der CI die JAR anhängt.
- Kurz bestätigen, dass in der Mod-Liste „BlueMap Live“ steht (I18).

---

## 0.1.x – Fehlerbehebungen (nach Bedarf)

- Rückmeldungen aus dem Spielen mit 0.1.0.
- Restliche manuelle Prüfungen aus `singleplayer-test.md`: Server-Tests M1–M16, S1–S5, Mehrspieler über LAN, Elytra/Schwimmen, Dreizack, Fernrohr, Angel.
- Kleinere Verbesserungen an Items, falls sie stören:
  - **Färbung** (Lederrüstung, Tränke, Gras-/Laub-Blockitems)
  - **Verzauberungsglanz**

---

## 0.2.0-alpha – Entities, Teil 1: Grundlage, Gegenstände, Geschosse

**Ziel:** Entities im Umkreis um die Spieler werden live angezeigt, zuerst alles, was ohne neue Modelle auskommt.

**Inhalt:**
1. **Server:**
   - Alle 250 ms werden Entities im Umkreis (Standard 30 Blöcke) um jeden Spieler gesammelt: Typ, Position, Drehung, Geschwindigkeit, wenige Zustände.
   - Neue Datei `maps/<id>/live/entities.json`, analog zu `players.json`, mit Generationszähler für Sprünge (Teleport, Dimension).
2. **Webclient:**
   - Eine Entity-Verwaltung, die Objekte anlegt, wiederverwendet und freigibt.
   - Interpolation wie bei den Spielern.
   - Geschosse werden zwischen zwei Abtastungen mit Geschwindigkeit und Schwerkraft weiterberechnet, damit schnelle Pfeile nicht springen.
3. **Gegenstände am Boden:** Item-Modelle aus der Phase 4 (bereits vorhanden), schwebend und drehend.
4. **Geschosse:**
   - Pfeil und Spektralpfeil (kleines eigenes Modell)
   - Dreizack (vorerst flach, wie in der Hand)
   - Schneeball, Ei, Enderperle, Wurf- und Verweiltrank, Erfahrungsfläschchen, Windkugel (flache Item-Bilder)
5. **Treffer:**
   - Roter Blitz bei Schaden (`hurtTime`) für Spieler und später Mobs.
   - Den Rückstoß zeigt schon die Position.
6. **Grenzen und Einstellungen:**
   - Höchstzahl angezeigter Entities (Standard 200, die nächsten zuerst)
   - Radius und Intervall einstellbar
   - Entity-Arten einzeln abschaltbar, das Feature ganz abschaltbar
   - bestehende Ausblende-Regeln (unsichtbar, versteckt, Zuschauermodus) gelten weiter
7. **Tests:** JUnit (Sammeln, Filter, JSON), Node (Interpolation, Flugbahn, Freigabe), Browser-E2E mit simulierten Entities, Regression gegen das Original; manuelle Prüfliste.

**Leistung (Schätzung):**

| Bereich | Erwartete Last |
|---|---|
| Server | unter 1 % der Tick-Zeit |
| Netzwerk | etwa 5–8 KB/s komprimiert bei 100 Entities |
| Browser | dauerhaft hohe Bildrate, solange sich etwas bewegt; begrenzt durch Höchstzahl und Detailstufen |

**Aufwand:** etwa so groß wie die erste Spieler-Phase.

---

## 0.3.0-alpha – Entities, Teil 2: Mobs

**Ziel:** Die häufigsten Mobs mit Vanilla-Modell, Textur aus dem Resource-Pack und Laufanimation.

**Hintergrund:** Die Mob-Modelle stehen in Minecraft im Java-Code, nicht im Resource-Pack. Jede Modell-Familie wird deshalb nachgebaut, wie Spieler und Schild.

**Reihenfolge nach Modell-Familien:**
1. **Menschenähnliche:** Zombie, Husk, Ertrunkener, Skelett, Eiswanderer, Wither-Skelett, Piglin, Zombifizierter Piglin. Sie nutzen das vorhandene Spielermodell und den Animator.
2. **Vierbeiner:** Kuh, Mooshroom, Schwein, Schaf (mit Wolle).
3. **Einzelmodelle:** Creeper, Spinne/Höhlenspinne, Huhn, Dorfbewohner, Enderman, Schleim.

Weitere Mobs folgen in späteren `0.3.x`-Versionen. Unbekannte Mobs erscheinen als einfacher Platzhalter mit Namen. Rüstung und gehaltene Items der Mobs werden über die vorhandene Item-Darstellung angebunden, soweit möglich.

**Leistung:**
- 6–10 Teile pro Mob; Geometrie und Texturen sind pro Art geteilt.
- Detailstufen: Animationen nur in Kameranähe, aus der Ferne vereinfacht.
- Bei sehr vielen gleichen Mobs (Farmen) später Instancing.

---

## 0.4.0-alpha – Live-Blockänderungen und Truhen

**Ziel:** Gesetzte und abgebaute Blöcke erscheinen ohne vollständiges Neurendern auf der Karte.

**Inhalt:**
1. **Zuverlässige Stufe:** Geänderte Kacheln werden gezielt neu gerendert und im Webclient nachgeladen, mit dem vorhandenen BlueMap-Renderer.
2. **Inkrementelle Stufe:** häufige kleine Änderungen zusammengefasst.
3. **Truhen** (Entscheidung Option 1, `phase-4.md` §8):
   - Geöffnete Truhen, Doppeltruhen, Endertruhen und Shulkerkisten werden ohne Deckel in die Kachel gerendert; der Deckel wird im Webclient animiert.
   - Das Fass zeigt seinen Zustand über den Blockzustand `open`.
4. **Vorbereitung** für Türen, Falltüren, Hebel und Knöpfe. Deren Zustand steht im Blockzustand und kommt mit den Blockänderungen; eigene Animationen erst danach.

---

## 0.5.0-alpha – Effekte und Partikel (Näherung)

- Partikel für Trankeffekte (Farbe aus den aktiven Effekten).
- Wolke des Verweiltranks (eigenes Entity).
- Treffer-, Explosions- und Zerbrechen-Effekte, soweit der Server sie kennt.
- Klar als Näherung gekennzeichnet; exakte Vanilla-Partikel sind kein Ziel.

---

## Danach: Stabilisierung und Veröffentlichung (1.0)

- Lasttests mit vielen Spielern und Entities, Optimierung (Instancing, Datenmenge).
- Vollständige Dokumentation, Konfigurationsbeschreibung.
- Entscheidung, ob und wo BlueMap Live öffentlich angeboten wird (GitHub-Releases, Modrinth/CurseForge unter eigenem Projekt).
- Prüfung weiterer Minecraft-Versionen bzw. Plattformen (bisher nur Fabric 1.21.1).
