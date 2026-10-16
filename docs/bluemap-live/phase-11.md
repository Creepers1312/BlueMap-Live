# BlueMap Live – Phase 11: Live-Blockänderungen und Truhen (0.5.0)

Stand: 2026-10-16 · Branch `bluemap-live` · nächster Punkt der Roadmap, vom Nutzer gewünscht

> **Kurzfassung:**
> - **Blockänderungen** (abbauen, setzen, Explosionen, Kolben, Wasser …) erscheinen nach etwa 10–20 s auf der Karte, ohne dass die Seite neu geladen werden muss. Gerendert wird weiter mit dem originalen BlueMap-Renderer.
> - **Truhen:** Öffnet ein Spieler eine Truhe, Fallentruhe, Endertruhe oder Doppeltruhe, klappt der Deckel auf der Karte auf und beim Schließen wieder zu, wie im Spiel.
> - **Fässer** zeigen ihren Zustand „offen“ über die Blockänderungen.
> - **Sofort-Vorschau** (Wunsch des Nutzers): Jede Blockänderung erscheint nach unter einer Sekunde als Vorschau. BlueMaps Renderer bestätigt sie, sobald er die Kachel mit der Änderung gerendert hat; dann zeigt die Karte wieder die echte Kachel. Wird eine Vorschau nicht innerhalb von 90 s bestätigt, wird sie verworfen.
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

## 2. Sofort-Vorschau der Blockänderungen

**Erfassen** (Fabric):
- Ein Mixin auf `WorldChunk.setBlockState` meldet jede tatsächliche Änderung in einem geladenen Chunk. Vanilla gibt dort den vorigen Zustand zurück, wenn sich der Block geändert hat, sonst `null`. Das deckt Abbauen, Setzen, Explosionen, Kolben, Flüssigkeiten, Feuer, Wachstum usw. ab.
- Es ist der erste Mixin des Mods. Er ist optional (`required: false`, `require = 0`): Fehlt die Methode in einer Minecraft-Version, startet der Mod trotzdem, nur ohne Vorschau.
- Der Mixin merkt sich nur die Position, und das nur, wenn die Funktion an ist und Spieler online sind. Einmal pro Tick (`FabricBlockChanges.flush`) werden die Positionen im Umkreis der Spieler (`live-block-preview-radius`, Standard 96) zu Blockzuständen. Gespeichert werden auch die 6 Nachbarn.
- Grenzen: höchstens 2048 Positionen pro Welt und Tick, das Log hält 10 s und höchstens 4096 Einträge. Was darüber hinausgeht, kommt mit dem normalen Rendern.

**Daten:**
- `entities.json` → `blocks`: `{"palette": [Zustände], "changes": [[id, x, y, z, Zustand, unten, oben, Norden, Süden, Westen, Osten, Zeit], ...]}`. Zustände sind Indizes in die Palette, `-1` steht für Luft.
- Die Blockmodelle backt der Server wie die Item-Modelle (`ItemModelBaker.bakeBlock`): Blockstate-Varianten und Multipart nach den Bedingungen, Drehung der Variante (auch der Cullface), Texturen aus dem Ressourcenpaket.
- Sie liegen unter `assets/blocks/<ns>/<block>/<eigenschaften>.json` und tragen dazu, ob der Block ein voller undurchsichtiger Würfel ist.
- Der Item-Index liest dafür auch die `blockstates/`.

**Bestätigen:**
- `live/tiles.json` gibt jetzt für jede neu gerenderte Kachel die Speicherzeit ihrer Chunks mit (`chunks: [x, z, Sekunden, …]`). Das sind die Zeitstempel der Region-Datei, aus der BlueMap gerendert hat.
- Eine Vorschau gilt als bestätigt, wenn ihre Kachel neu gerendert wurde und ihr Chunk **nach** der Änderung gespeichert war. Weil die Zeit auf die Sekunde genau ist, wartet eine Änderung aus derselben Sekunde auf das nächste Rendern.
- Die Vorschau wird erst entfernt, wenn die neue Kachel geladen ist. Es gibt also keine Lücke.
- Ein Rendern aus älteren Chunk-Daten bestätigt nichts.
- **Unbestätigt** nach 90 s: Die Vorschau wird verworfen, die Karte zeigt wieder die Kachel.

**Zeichnen** (`markers/blocks/`):
- **Neuer Block:** sein Modell, ohne die Flächen zu vollen Nachbarblöcken (Vanilla-Cullface). Abgedunkelt wie die Modelle im Spiel (oben 1, Seiten 0,8/0,6, unten 0,5) und nachts wie die Entities.
- **Färbung** ohne Biomdaten: Gras, Laub, Wasser usw. in den Farben des Biomes Ebene. Die bestätigte Kachel hat dann die richtige Biomfarbe.
- **Alter Block in der Kachel:** Er wird im Hires-Shader ausgeblendet. Eine Hash-Tabelle in einer Float-Textur (bis 8192 Blöcke) sagt, welche Blöcke versteckt sind. Jedes Fragment prüft den Block, zu dem seine Fläche gehört (Position etwas gegen die Flächennormale verschoben).
- **Loch:** Ist der neue Block nicht voll (Luft, Glas, Stufe …), zeichnet die Vorschau die Flächen der Nachbarn zum Loch hin. Sie waren in der Kachel vom alten Block verdeckt. Dafür zählen die Flächen mit passender Cullface, bei Modellen ohne Cullface die Flächen genau auf der Blockgrenze.
- **Zeitpunkt:** Änderungen kommen zur Wiedergabezeit, passend zur Bewegung des Spielers, der sie auslöst.
- Die Vorschau gehört zur Karte und bleibt auch bei ausgeblendetem Set „Entities“ sichtbar.

**Abweichungen der Vorschau** (bis zur Bestätigung):
- Licht: Schatten und Blocklicht des Renderers fehlen, gezeichnet wird mit dem gemeinsamen Entity-Licht.
- Verbundene Blöcke (Zäune, Mauern, Glasscheiben, Redstone) zeigen ihren übertragenen Zustand, die Nachbarn passen sich erst nach dem Rendern an.
- Flüssigkeiten, Blockentities (Schilder, Banner, Köpfe, Truhen) und Blöcke mit eigenem Renderer haben keine Vorschau.
- Zufällige Varianten (z. B. gedrehte Grasoberseiten) können sich bei der Bestätigung ändern.
- Uv-Lock wird nicht angewendet.

## 3. Truhen

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

## 4. Abweichungen und Grenzen

- **Geschwindigkeit:** Die Vorschau erscheint sofort. Die gerenderte Kachel kommt etwa 10–20 s später, unter Last später, weil Minecraft dann seltener speichert.
- **Nicht animiert:** Shulkerkisten, Türen, Falltüren, Hebel und Knöpfe. Ihr neuer Zustand erscheint mit den Blockänderungen.
- **Mehr als 8 offene Truhen** gleichzeitig im Bild: Bei den übrigen bleibt der geschlossene Kachel-Deckel unter dem offenen Deckel sichtbar.
- **Versteckte Spieler:** Eine Truhe, die ein ausgeblendeter Spieler öffnet, wird angezeigt, wenn ein angezeigter Spieler in der Nähe ist. Das entspricht dem, was andere Spieler im Spiel sehen.

## 5. Tests

**Automatisiert:**

| Test | Ergebnis |
|---|---|
| Node `npm test` | 159/159, neu `LiveTiles.test.mjs` (5), `ChestLids.test.mjs` (7), `BlockPreview.test.mjs` (7: Asset-Namen, Daten, Bestätigung nach Chunk-Zeit, Verwerfen, sichtbare Flächen, Hash-Tabelle, Geometrie) |
| JUnit lokal | 93/93, neu `LiveTileLogTest`, `LiveBlockLogTest`, `BlockModelBakerTest` (Varianten, Drehung samt Cullface, voller Würfel, Asset-Namen), Truhen und Blockänderungen im Data-Supplier |
| Browser `blocks-e2e.mjs` | 15/15: Kachel ohne Lücke neu geladen (unter 4 s), keine doppelten oder ungeladenen Anfragen, Lowres neu geladen, neuer Cache-Hash nach Kartenwechsel, keine alten Änderungen beim Öffnen, Truhen; **Vorschau:** gesetzter Block nach unter 1,5 s sichtbar (Pixel), abgebauter Block mit Loch und Nachbarfläche (Pixel), keine Bestätigung durch ältere Chunk-Daten, Bestätigung und Entfernen nach neuer Kachel, Verwerfen nach 90 s |
| Browser übrige Suiten | `entities` 12/12, `mobs` 15/15, `playback` 6/6, `player` 21/22 (der bekannte Skin-Schritt), `animation` 19/19, `items` 16/16, `worldtime` 9/9, `particles` 13/13 (die Pixelprüfung der Explosion zählt jetzt auch dunkelgraue Wolken) |

Der Fabric-Teil (`FabricContainers`, `FabricBlockChanges`, der Mixin) und die Anbindung an den Renderer (`WorldRegionRenderTask`, `Plugin`) werden nur im CI kompiliert und nicht gegen ein laufendes Minecraft getestet.

**Manuell in Minecraft:** Q32–Q37 in `singleplayer-test.md`, offen.

**Nebenbei behoben:** Das Feuer aus Phase 10 (`block/fire_0`, `fire_1`) wurde vom echten Server nur als erstes Animationsbild geliefert, weil der Item-Index animierte Texturen auf das erste Bild kürzt. Feuertexturen behalten jetzt alle Bilder, die Flammen sind animiert wie im Testserver.
