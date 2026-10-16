# BlueMap Live – Phase 11: Live-Blockänderungen und Truhen (0.5.0)

Stand: 2026-10-16 · Branch `bluemap-live` · nächster Punkt der Roadmap, vom Nutzer gewünscht

> **Kurzfassung:**
> - **Blockänderungen** (abbauen, setzen, Explosionen, Kolben, Wasser …) erscheinen nach etwa 10–20 s auf der Karte, ohne dass die Seite neu geladen werden muss. Gerendert wird weiter mit dem originalen BlueMap-Renderer.
> - **Truhen:** Öffnet ein Spieler eine Truhe, Fallentruhe, Endertruhe oder Doppeltruhe, klappt der Deckel auf der Karte auf und beim Schließen wieder zu, wie im Spiel.
> - **Fässer** zeigen ihren Zustand „offen“ über die Blockänderungen.
> - **Nicht in Minecraft geprüft:** offen, siehe `singleplayer-test.md` (Q32–Q35).

## 1. Blockänderungen

**Bisher:** BlueMap merkt Änderungen nur an den Region-Dateien. Dann wartet BlueMap mindestens 5 s und pro Region bis zu 60 s seit dem letzten Rendern (`update-cooldown`). Der Browser lädt eine Kachel, die er schon hat, nie neu: nur mit „Karte aktualisieren“ oder durch Neuladen der Seite. Die Kacheln werden außerdem einen Tag lang im Browser zwischengespeichert.

**Speichern übernimmt Minecraft:** Minecraft 1.21 speichert geänderte Chunks während des Spiels von selbst. Pro Tick sind es bis zu 20 Chunks, solange der Tick Zeit übrig hat, und jeden Chunk höchstens alle 10 s (`ServerChunkLoadingManager.unloadChunks` → `save(ChunkHolder)` mit `chunkToNextSaveTimeMs`, CI-Dump). Der Mod speichert deshalb nichts selbst und ändert am Spiel nichts.

**Server:**
- `live-block-updates` (Standard `true`) und `live-block-update-cooldown` (Standard 10 s) in `plugin.conf`.
- Solange die Funktion an ist, rendert BlueMap eine Region frühestens nach dieser Zeit erneut, statt nach `update-cooldown`. Die 5 s Wartezeit nach der letzten Dateiänderung bleiben.
- `WorldRegionRenderTask` meldet jede neu gerenderte oder entfernte Kachel an `LiveTileLog` (pro Karte, 60 s, höchstens 2048 Einträge).
- Bei kleinen Aktualisierungen (höchstens 16 Kacheln, typisch für ein paar geänderte Blöcke) speichert die Aufgabe die Lowres-Kacheln sofort und meldet sie ebenfalls. Bisher wurde das erst beim Speichern der Karte erledigt, höchstens einmal pro Minute.
- Große Aktualisierungen, etwa ein vollständiges Rendern, bleiben wie im Original.
- **Neue Datei** `maps/<id>/live/tiles.json`: `{"protocol":1,"serverTime":..,"next":..,"tiles":[{"id":..,"x":..,"z":..,"lowres":true?}]}`. `x`/`z` sind Hires-Kachelkoordinaten.

**Webapp** (`map/LiveTileUpdater.js`):
- Fragt `live/tiles.json` alle 2 s ab. Ohne die Datei, etwa bei einem externen Webserver, wird alle 15 s erneut versucht.
- **Erste Antwort:** Die geladenen Kacheln sind aktuell, bisherige Einträge werden übersprungen. Startet der Server neu, fangen die IDs wieder von vorn an.
- Neue Einträge laden die betroffenen geladenen Hires-Kacheln neu. Bei `lowres` werden die Lowres-Kacheln aller LOD-Stufen neu geladen, die die Hires-Kachel überdecken.
- **Ohne Flackern** (`Tile.reload`): Die alte Kachel bleibt sichtbar, bis die neue geladen ist. Eine Änderung während des Ladens wird danach nachgeholt.
- **Cache-Hash pro Kachel** (`?live<id>`), damit der Browser nicht die alte Kachel aus dem Zwischenspeicher nimmt. Er gilt auch später, wenn die Kachel nach dem Wegscrollen oder einem Kartenwechsel wieder geladen wird.

**Zeit bis zur Karte (geschätzt, nicht gemessen):**
- bis zu 10 s Speichern durch Minecraft
- plus 5 s Wartezeit
- plus Rendern (meist unter 1 s)
- plus bis zu 2 s Abfrage

Rendert eine Region gerade erst, kommen bis zu 10 s Abklingzeit dazu. Läuft gerade ein großes Rendern, wartet die Aufgabe in der Warteschlange.

## 2. Truhen

**Warum nicht über die Kacheln:** Eine offene Truhe hat keinen eigenen Blockzustand. Ein Neu-Rendern der Kachel beim Öffnen käme über 10 s zu spät für eine Animation.

**Server** (`FabricContainers`):
- Benutzt ein Spieler eine Truhe oder Endertruhe (`UseBlockCallback`), merkt sich der Mod den Block.
- Die Truhe gilt als offen, solange dieser Spieler ein Fenster offen hat. Vanilla öffnet das Fenster im selben Aufruf (`ChestBlock.onUse`).
- Bei Doppeltruhen kommen beide Hälften mit, die Richtung wie in `ChestBlock.getFacing`.
- Gesendet wird in `entities.json` unter `containers`: `{x, y, z, texture, facing, part?}`, nur im Umkreis angezeigter Spieler.
- Die Texturen `entity/chest/(normal|trapped|christmas)[_left|_right]` und `ender` (vanilla `TexturedRenderLayers.getChestTextureId`) werden wie die Rüstungstexturen bereitgestellt.

**Webapp** (`ChestLids.js`, `ChestLidView.js`):
- **Deckel und Schloss** wie `ChestBlockEntityRenderer`:
  - Einzel-, linke und rechte Truhe mit Drehpunkt (0, 9, 1).
  - Drehung um die Blockmitte nach `-Direction.asRotation`.
  - Winkel `-(1 − (1 − p)³) · π/2`.
- **Bewegung** wie `ChestLidAnimator`: 0,1 pro Tick zum Ziel, zwischen den Ticks interpoliert.
- **Weihnachtstexturen** vom 24. bis 26. Dezember nach dem Datum des Betrachters, wie im Client.
- **Kachel-Deckel ausblenden:** Der Hires-Shader verwirft Fragmente in „versteckten Boxen“ (höchstens 16, also 8 Truhen gleichzeitig). Pro Truhe sind das alles oberhalb des Truhenbodens (y > 10/16) und der Streifen des Schlosses vor der Front.
- Ausgeblendet wird erst, wenn der eigene Deckel gezeichnet werden kann. Lädt die Textur noch oder fehlt sie, bleibt der geschlossene Kachel-Deckel sichtbar.
- **Zeitpunkt:** Öffnen und Schließen kommen zur Wiedergabezeit (Phase 9), wie die Entities.

## 3. Abweichungen und Grenzen

- **Geschwindigkeit:** Blockänderungen kommen etwa 10–20 s später, nicht sofort. Liegt der Server unter Last (keine Zeit übrig im Tick), speichert Minecraft seltener.
- **Nicht animiert:** Shulkerkisten, Türen, Falltüren, Hebel und Knöpfe. Ihr neuer Zustand erscheint mit den Blockänderungen.
- **Mehr als 8 offene Truhen** gleichzeitig im Bild: Bei den übrigen bleibt der geschlossene Kachel-Deckel unter dem offenen Deckel sichtbar.
- **Versteckte Spieler:** Eine Truhe, die ein ausgeblendeter Spieler öffnet, wird angezeigt, wenn ein angezeigter Spieler in der Nähe ist. Das entspricht dem, was andere Spieler im Spiel sehen.

## 4. Tests

**Automatisiert:**

| Test | Ergebnis |
|---|---|
| Node `npm test` | 151/151, neu `LiveTiles.test.mjs` (4) und `ChestLids.test.mjs` (7) |
| JUnit lokal | 84/84, neu `LiveTileLogTest`, offene Truhen im Data-Supplier, Truhentexturen |
| Browser `blocks-e2e.mjs` | 10/10: Kachel ohne Lücke neu geladen (unter 4 s), keine doppelten oder ungeladenen Anfragen, Lowres neu geladen, neuer Cache-Hash nach Kartenwechsel, keine alten Änderungen beim Öffnen, Truhe öffnen (Pixel) und schließen, Doppel- und Endertruhe |
| Browser übrige Suiten | `entities` 12/12, `mobs` 15/15, `playback` 6/6, `player` 21/22 (der bekannte Skin-Schritt), `animation` 19/19, `items` 16/16, `worldtime` 9/9, `particles` 13/13 (die Pixelprüfung der Explosion zählt jetzt auch dunkelgraue Wolken) |

Der Fabric-Teil (`FabricContainers`) und die Anbindung an den Renderer (`WorldRegionRenderTask`, `Plugin`) werden nur im CI kompiliert und nicht gegen ein laufendes Minecraft getestet.

**Manuell in Minecraft:** Q32–Q35 in `singleplayer-test.md`, offen.
