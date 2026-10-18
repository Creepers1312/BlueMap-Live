# BlueMap Live – Phase 14: Aufräumen, Leistung, Forge und NeoForge (1.0)

Stand: 2026-10-18 · Branch `bluemap-live`

## 1. Leistung im Browser

Gemessen mit `docs/bluemap-live/e2e/perf-stress.mjs` (20 Spieler, 180 Entities, 30 Block-Vorschauen, Regen; JavaScript-Zeit pro Bild im Headless-Chromium der CI-Umgebung, also Vergleichswerte, keine Werte eines echten Rechners):

| Stand | Median | p90 |
|---|---|---|
| vorher | 22 ms | 37 ms |
| CSS2D-Renderer ohne zweite Matrix-Aktualisierung und ohne Durchlauf der Modelle | 17 ms | – |
| dazu Entity-Positionen ohne Vue-Reaktivität, Vorschauen nicht neu gebaut | 13,8 ms | 18 ms |

- `CSS2DRenderer`: überspringt Teilbäume mit `userData.noCss2d` (Modelle, Partikel, Vorschauen, Wetter, Truhendeckel), sammelt die gezeichneten Objekte in einer Liste, und `MapViewer` ruft ihn ohne zweite `updateMatrixWorld` auf.
- `EntityMarker`: `position` und `visible` laufen nicht mehr über den reaktiven Proxy von Vue (der Wert in `data` bleibt für die Oberfläche erhalten).
- `BlockPreviewData`: Eine Änderung, die schon angewendet ist (gleiche oder ältere `id`), baut die Vorschau nicht mehr neu. Vorher 19 Neubauten in 5 s bei wiederholten Änderungen, jetzt 0.
- Der Rest sind die Draw-Calls von three.js pro Modellteil; Instancing ist ein Thema für 1.x.

## 2. Aufräumen

- `util/LiveMath.js`: `DEG2RAD`, `TAU`, `isFiniteNumber`, `clamp`, `clamp01`, `wrapDegrees` statt eigener Kopien in neun Dateien.
- Entfernt: `MODEL_VARIANTS` in `PlayerModelLayout.js` (nirgends benutzt). Weiterer toter Code wurde nicht gefunden.
- Verhalten unverändert: alle 187 Node-Tests grün, Build grün.

## 3. Forge und NeoForge

### Ansatz

Die Live-Funktionen hingen bisher an Fabric (Yarn-Namen). Forge 51.0.1 und NeoForge 21.0 benutzen die Mojang-Namen.

1. Ein einmaliger CI-Job (`migrate-mappings` in `build.yml`, nur bei `[migrate-mappings]` in der Commit-Nachricht) hat die Fabric-Quellen mit Loom `migrateMappings` in Mojang-Namen übersetzt. Ergebnis: Branch `bluemap-live-mojmap`. Die Übersetzung stammt also aus den Mappings, nicht von Hand.
2. Daraus entstand `implementations/shared-live` (Paket `de.bluecolored.bluemap.live.mojang`), das Forge und NeoForge als zusätzlichen Quellordner einbinden:
   - `LiveMobs`, `LiveVehicles`, `LiveParticles`, `LiveProjectiles`, `LiveContainers`, `LiveArmor`, `LiveBlockChanges`: die Fabric-Klassen in Mojang-Namen (nur Kommentare angepasst)
   - `MojangPlayer`: der `FabricPlayer` in Mojang-Namen (ersetzt die alten `ForgePlayer` beider Plattformen)
   - `LiveSampler`: der Live-Teil des `FabricMod` (Entities, Zeit und Wetter, Effekte, Blockänderungen, Truhen, Schwünge)
   - `LiveHost`: was der gemeinsame Code von der Mod braucht
   - `mixin/LevelChunkMixin` und `bluemap_live.mixins.json`: das Mixin für die Blockänderungen (ohne Refmap, beide Plattformen laufen mit Mojang-Namen)
3. `ForgeMod` (beide Plattformen) leitet die Events weiter:

| Fabric | Forge / NeoForge |
|---|---|
| `END_SERVER_TICK` | `TickEvent.ServerTickEvent` (Phase `END`) / `ServerTickEvent.Post` |
| `AFTER_RESPAWN`, `AFTER_PLAYER_CHANGE_WORLD` | `PlayerEvent.PlayerRespawnEvent`, `PlayerEvent.PlayerChangedDimensionEvent` |
| `AttackEntityCallback`, `AttackBlockCallback` | `AttackEntityEvent`, `PlayerInteractEvent.LeftClickBlock` |
| `UseBlockCallback`, `UseItemCallback` | `PlayerInteractEvent.RightClickBlock`, `PlayerInteractEvent.RightClickItem` |
| `ServerEntityEvents.ENTITY_UNLOAD` | `EntityLeaveLevelEvent` |

4. Mixin-Registrierung: NeoForge über `[[mixins]]` in `neoforge.mods.toml`, Forge über das Manifest-Attribut `MixinConfigs` der fertigen JAR.
5. Die Spieler werden wie bei Fabric über das eingestellte `live-player-update-interval` verteilt (vorher fest einmal pro Sekunde).

Fabric selbst bleibt bei Yarn. Die Fabric-Tests (`VanillaMobModelsTest`, Vanilla-Dump) lesen Minecraft-Klassen über Yarn-Namen. Eine Umstellung hätte den getesteten Fabric-Code kurz vor 1.0 verändert. Die Live-Logik gibt es deshalb zweimal (Yarn für Fabric, Mojang für Forge/NeoForge). **Bei Änderungen an der Fabric-Logik muss `shared-live` mitgezogen werden.** Für 1.x: Fabric auf Mojang-Namen umstellen und nur noch eine Kopie pflegen.

### Was geprüft ist

- **Automatisch (CI):** Forge und NeoForge kompilieren; der Build-Job meldet pro JAR, ob der gemeinsame Code und die Mixin-Konfiguration enthalten sind (Schritt „Release files“).
- **Forge in Minecraft (Nutzer, 2026-10-18):** Test mit `v1.0.0-rc.1` auf Forge 52.1.0 (Minecraft 1.21.1) laut Nutzer erfolgreich („forge test hat geklappt“); welche Punkte aus FN1–FN12 im Einzelnen geprüft wurden, ist nicht festgehalten.
- **Nicht geprüft:** NeoForge in Minecraft (siehe 4).

### Bekannte Unterschiede zu Fabric

- `PlayerInteractEvent.LeftClickBlock` feuert auf Forge/NeoForge auch beim Abbrechen und Beenden des Abbauens. Das markiert den nächsten Schwung höchstens zusätzlich als „Abbauen“, ohne sichtbaren Unterschied.
- Forge und NeoForge haben die Mod-ID `bluemap` wie das Original. Beide JARs zusammen ergeben deshalb einen Fehler wegen doppelter Mod-ID statt eines stillen Konflikts.

## 3a. Fix: geöffnete Truhe, die noch Vorschau ist

Meldung des Nutzers (Bild): Eine gerade gesetzte Truhe wird geöffnet, der aufgehende Deckel ist zu sehen und zusätzlich der geschlossene Deckel. Ursache: Die Truhe war noch eine Block-Vorschau. Den Kachel-Deckel blendet nur der Kachel-Shader aus (versteckte Boxen); der Shader der Vorschau kannte die Boxen nicht. Lösung: `applyPreviewLighting` verwirft die Fragmente in denselben Boxen (`hiddenBoxesMin/Max/Count` der Karten-Uniforms).

Test: `blocks-e2e.mjs`, Schritt „a placed chest (still a preview) is opened“ (Test-Truhe mit magentafarbenem Deckel im Blockmodell). Ohne den Fix schlägt er fehl, mit dem Fix 18/18.

## 3b. Fix: gesetzte Blöcke verschwinden nach einer Weile von der Karte

Meldung des Nutzers (Bilder): Im Spiel stehen zwei Truhen, auf der Karte nur eine; „manchmal verschwinden Texturen, wenn man AFK ist“. Eine unsichtbare Truhe lässt sich öffnen, dann erscheint nur ihr Deckel.

Ursache: Eine Vorschau wurde nach 90 s verworfen, auch wenn BlueMap die Kachel bis dahin gar nicht neu gerendert hatte. Die Karte zeigte dann wieder die alte Kachel ohne den Block. Neu rendern kann BlueMap erst, wenn Minecraft den Chunk gespeichert hat. Ein Einzelspieler-Spiel speichert nichts, solange es pausiert, und es pausiert, sobald das Fenster den Fokus verliert, also etwa beim Wechsel in den Browser. Das ist die wahrscheinliche Ursache, geprüft ist sie nicht. Auch eine lange Render-Warteschlange kann die Kachel über 90 s verzögern.

Lösung (`BlockPreviewData`):
- Eine Vorschau wird verworfen, wenn ihre Kachel **mehr als 90 s nach der Änderung** gerendert wird und die Änderung trotzdem nicht enthält; dann ist die Kachel neuer.
- Ohne Rendern bleibt die Vorschau, höchstens 30 min (`PREVIEW_MAX_AGE`).

Tests: Node `BlockPreview.test.mjs` (ohne Rendern bleibt die Vorschau nach 90 s; ein Rendern ihrer Kachel ohne die Änderung verwirft sie erst lange nach der Änderung), `blocks-e2e.mjs` 18/18.

## 3c. Fix: Schattierung und Flackern bei abgebauten Blöcken

Meldung des Nutzers (Bilder): Abgebaute Blöcke sind anders schattiert als die Kachel und flackern.

- **Schattierung:** Die Vorschau dunkelte Flächen nach Richtung ab (oben 100 %, Nord/Süd 80 %, Ost/West 60 %, unten 50 %, wie die Item-Modelle). BlueMaps Renderer macht das nicht (`ResourceModelRenderer`: nur die Tönung, abgedunkelt wird über Ambient Occlusion). Die Vorschau zeichnet die Flächen jetzt ohne diese Abdunklung. Ambient Occlusion hat die Vorschau weiterhin nicht, Ecken in einem Loch sind darum etwas heller als nach dem Rendern.
- **Flackern:** Die Speicherzeit der Chunks ist nur sekundengenau. Speicherte Minecraft in derselben Sekunde, in der der Block abgebaut wurde, bestätigte die neue Kachel die Vorschau nicht. Vorschau und Kachel lagen dann übereinander, bis die Kachel erneut gerendert wurde. Mit 3b hätte das bis zu 30 min dauern können. Jetzt gilt: Folgt innerhalb von 60 s (`SAME_SECOND_WAIT`) kein neueres Rendern der Kachel, war die Änderung enthalten, und die Vorschau wird entfernt. War die Speicherung vor der Änderung, speichert Minecraft den Chunk ohnehin erneut, und das nächste Rendern bestätigt sie.

Tests: Node 189/189 (u. a. „a tile from a chunk saved in the same second …“, Farbe der Seitenflächen 1), `blocks-e2e.mjs` 18/18.

## 3d. Fix: Vorschau-Blöcke verdecken die Sicht in Höhlen

Meldung des Nutzers: Unter der Erde sieht man in BlueMap von außen durch die Blöcke in einen Hohlraum, die Live-Blöcke sind aber von beiden Seiten sichtbar und verdecken den Spieler.

Ursache: BlueMap zeichnet die Kacheln einseitig (`FrontSide`, `Map.js`): Flächen, auf die die Kamera von hinten schaut, fehlen. Die Vorschau war beidseitig (`DoubleSide`). Jetzt ist sie einseitig wie die Kacheln.

Test: `blocks-e2e.mjs`, „previews are one-sided like the tiles“ (Kamera im Freiflug mitten im Vorschau-Block). Mit `DoubleSide` schlägt er fehl (40000 von 40000 Pixeln verdeckt), mit dem Fix 19/19.

## 4. Test in Minecraft: Forge und NeoForge (Nutzer)

Für jede Plattform einmal mit Minecraft 1.21.1 (Einzelspieler genügt, dedizierter Server besser):

| # | Schritt | Erwartet |
|---|---|---|
| FN1 | Welt starten, `config/bluemap/core.conf`: `accept-download: true`, `/bluemap reload` | Log „Loaded!“, keine Exception mit `de.bluecolored.bluemap.live` |
| FN2 | Log nach `bluemap_live.mixins.json` / `LevelChunkMixin` durchsuchen | keine Mixin-Fehlermeldung |
| FN3 | Karte öffnen, herumlaufen, springen, schleichen | Spieler als 3D-Modell mit Skin, Körper zeigt in Laufrichtung |
| FN4 | Schwert, Bogen, Schild in die Hand, schlagen, Bogen spannen | Items und Animationen wie bei Fabric |
| FN5 | Mobs in der Nähe, Item fallen lassen, Pfeil schießen | Mobs mit Modell, Item am Boden, Pfeil fliegt und steckt |
| FN6 | Block setzen und abbauen | Vorschau erscheint sofort (das prüft das Mixin), nach 10–20 s die gerenderte Kachel |
| FN7 | Truhe öffnen | Deckel geht auf der Karte auf |
| FN8 | TNT zünden | Explosion auf der Karte |
| FN9 | Tag-Nacht-Zyklus der Welt im Browser einschalten, `/weather rain` | Uhr und Regen auf der Karte |
| FN10 | Sterben und respawnen, in den Nether gehen | Spieler springt sauber an die neue Stelle bzw. Karte |
| FN11 | `/bluemap live-stats` | Zahlen für Blockänderungen, Entities und `players.json`/`entities.json` |
| FN12 | Mit einem Client **ohne** die Mod einem dedizierten Server beitreten | Beitritt klappt |
