# BlueMap Live – Release-Plan

Stand: 2026-10-16 · Versionsschema: eigene Nummern (`0.x.y-alpha`), damit keine Verwechslung mit BlueMap-Versionen entsteht. `0.x.0` steht für ein größeres Feature, `0.x.y` für Fehlerbehebungen.

Für jedes Release gilt:
- Die originale Karte (Renderer, Navigation, Marker, „Spieler folgen“) bleibt unverändert.
- Neue Funktionen sind abschaltbar und kommen mit fehlenden oder älteren Daten zurecht.
- Automatisierte Tests sind getrennt von den manuellen Minecraft-Tests aufgeführt.
- Ein Release wird erst getaggt, wenn die Kernpunkte in Minecraft bestätigt sind.

Die Aufwands- und Leistungsangaben unten sind **Schätzungen**, nicht gemessen.

---

## 0.1.0-alpha – erste Version (veröffentlicht)

**Pre-release:** <https://github.com/Creepers1312/BlueMap-Live/releases/tag/v0.1.0-alpha>
- Tag `v0.1.0-alpha` auf Commit `0adb5db6`, also ohne die Entities aus 0.2.0.
- Die JAR `bluemap-0.1.0-alpha-fabric.jar` hat der CI angehängt; der Tag-Build war erfolgreich.

**Inhalt:**
- Live-Spieler als 3D-Modell mit Skin
- Animationen
- gehaltene Items mit Vanilla-Posen
- Dimensionswechsel ohne Neuladen
- ausgeblendetes Kopfbild in der Nähe
- Einzelspieler-Unterstützung
- Name „BlueMap Live“, Mod-ID `bluemap_live`

Release-Notes: `releases/v0.1.0-alpha.md`.

---

## 0.1.x – Fehlerbehebungen (nach Bedarf)

- Rückmeldungen aus dem Spielen mit 0.1.0.
- Restliche manuelle Prüfungen aus `singleplayer-test.md`: Server-Tests M1–M16, S1–S5, Mehrspieler über LAN, Elytra/Schwimmen, Dreizack, Fernrohr, Angel.
- Kleinere Verbesserungen an Items, falls sie stören:
  - **Färbung** (Lederrüstung, Tränke, Gras-/Laub-Blockitems)
  - **Verzauberungsglanz**

---

## 0.2.0-alpha – Entities, Teil 1: Grundlage, Gegenstände, Geschosse

**Stand:**
- Alle Punkte sind umgesetzt und automatisiert getestet (`phase-5.md`), inklusive Treffer-Blitz und Vanilla-Pfeilmodell mit flüssiger Flugbahn.
- Nach dem ersten Test in Minecraft verbessert: Pfeilmodell und Flugbahn; der Treffer-Blitz fehlte zuvor.
- Fehler behoben (bei der Arbeit an 0.3.0 gefunden): Das Neuladen von `markers.json` alle 10 s hat das Entity-Set entfernt.
- In Minecraft vom Nutzer bestätigt (N1, N4, N9, N10; nach den Fixes für Item-Assets und Pfeil-Kollision).
- **Veröffentlichung:** Auf Wunsch des Nutzers wird 0.2.0 zusammen mit 0.3.0 veröffentlicht (nach der Prüfung in Minecraft).

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

**Stand:**
- Umgesetzt und automatisiert getestet (`phase-6.md`): alle drei Familien unten, dazu Zombiedorfbewohner und Piglin-Barbar.
- Unbekannte Lebewesen erscheinen als Platzhalter.
- Die Modelldaten prüft das CI gegen Minecraft 1.21.
- In Minecraft vom Nutzer geprüft („alles passt“, Zombies/Skelette und Treffer einzeln bestätigt).
- **Veröffentlicht als Pre-release:** <https://github.com/Creepers1312/BlueMap-Live/releases/tag/v0.3.0-alpha>
  - Tag `v0.3.0-alpha` auf `e86559df`, enthält 0.2.0, Phase 7 und Phase 8 (`phase-8.md`).
  - Die JAR `bluemap-0.3.0-alpha-fabric.jar` hat das CI angehängt. Der Tag-Build musste von Hand gestartet werden, weil der Commit `[skip ci]` enthielt.
  - **Für künftige Releases:** den Tag nicht auf einen `[skip ci]`-Commit setzen, sonst startet kein Build.

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

## 0.3.x – Rüstung, Mob-Details, alle Mobs (auf Wunsch des Nutzers vor den Blockänderungen)

**Stand:**
- Umgesetzt und automatisiert getestet (`phase-7.md`): Rüstung an Spielern und Mobs, Mooshroom-Pilze, Enderman-Block, Creeper-Aufblitzen und 60 weitere Mob-Arten von 1.21 (alle außer dem Enderdrachen).
- Die Modelldaten aller 97 Ebenen prüft das CI gegen Minecraft.
- In Minecraft vom Nutzer geprüft und mit 0.3.0 veröffentlicht. Phase 8 (Tag-Nacht-Zyklus, Posen, Reiten, Boote, Loren, Pferde, Leinen, schlafende Spieler, dynamische Lichter) ebenfalls bestätigt, nur die Liegepose schlafender Spieler (Q24) ist nicht einzeln zurückgemeldet.

---

## 0.4.0-alpha – Effekte und Partikel (auf Wunsch des Nutzers vor die Blockänderungen gezogen)

**Stand:** umgesetzt und automatisiert getestet (`phase-10.md`), in Minecraft noch nicht geprüft (Q27–Q31). Release-Notes: `releases/v0.4.0-alpha.md`.

- Explosionen (Creeper, TNT, Ghast-Feuerball, Witherschädel, Endkristall) mit den Vanilla-Partikeln, erkannt beim Entfernen der auslösenden Entity.
- Trankwirbel in der Farbe der aktiven Effekte, Partikelring beim Zerbrechen von Wurf- und Verweiltränken, Wolke des Verweiltranks.
- Feuer an brennenden Entities und Spielern, Rauchwolke beim Tod.
- Partikel-Regeln aus dem Vanilla-Code (CI-Dump), Texturen aus dem Ressourcenpaket; Abweichungen (keine Blockkollision, gemeinsames Licht) sind in `phase-10.md` §3 beschrieben.

---

## 0.5.0-alpha – Live-Blockänderungen und Truhen

**Stand:** umgesetzt und automatisiert getestet (`phase-11.md`), in Minecraft noch nicht geprüft (Q32–Q35). Release-Notes: `releases/v0.5.0-alpha.md`. Die inkrementelle Stufe ist nicht nötig, weil Minecraft geänderte Chunks schon laufend speichert. Die Truhen werden im Browser animiert statt deckellos in die Kachel gerendert (schneller).

**Ziel:** Gesetzte und abgebaute Blöcke erscheinen ohne vollständiges Neurendern auf der Karte.

**Inhalt:**
1. **Zuverlässige Stufe:** Geänderte Kacheln werden gezielt neu gerendert und im Webclient nachgeladen, mit dem vorhandenen BlueMap-Renderer.
2. **Inkrementelle Stufe:** häufige kleine Änderungen zusammengefasst.
3. **Truhen** (Entscheidung Option 1, `phase-4.md` §8):
   - Geöffnete Truhen, Doppeltruhen, Endertruhen und Shulkerkisten werden ohne Deckel in die Kachel gerendert; der Deckel wird im Webclient animiert.
   - Das Fass zeigt seinen Zustand über den Blockzustand `open`.
4. **Vorbereitung** für Türen, Falltüren, Hebel und Knöpfe. Deren Zustand steht im Blockzustand und kommt mit den Blockänderungen; eigene Animationen erst danach.

---

## 0.6.0-alpha – Komfort und Live-Wetter

**Stand:** umgesetzt und automatisiert getestet (`phase-13.md`), in Minecraft noch nicht geprüft (Q42–Q48). Release-Notes: `releases/v0.6.0-alpha.md`.

**Inhalt:** Folgekamera (Ego, Schulter), Namensschilder und Lebensbalken, Entity-Filter, Weltuhr mit Wetter, LIVE-Anzeige, Voreinstellungen, Live-Wetter im Weltzeit-Modus (Sonne, Mond mit Phasen, Sterne, Wolken, Regen, Schnee, Blitze), alle 28 Sprachen.

---

## 1.0 – Hauptrelease

**Plan:** `release-1.0.md`. 1.0 ist der aktuelle Stand (0.1–0.6) mit kleinen Fixes, einem Release-Kandidaten und Tests in Minecraft, auf einem dedizierten Server und mit dem Modpack des Nutzers. Mod-Support kommt in 1.1.

## Danach: Stabilisierung und Veröffentlichung (ursprüngliche Liste)

- Lasttests mit vielen Spielern und Entities, Optimierung (Instancing, Datenmenge).
- Vollständige Dokumentation, Konfigurationsbeschreibung.
- Entscheidung, ob und wo BlueMap Live öffentlich angeboten wird (GitHub-Releases, Modrinth/CurseForge unter eigenem Projekt).
- Prüfung weiterer Minecraft-Versionen bzw. Plattformen (bisher nur Fabric 1.21.1).
