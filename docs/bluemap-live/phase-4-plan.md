# BlueMap Live – Phase 4 (Plan): gehaltene Items, Item-Animationen, interaktive Blöcke

Stand: 2026-10-15 · Branch `bluemap-live` · Minecraft 1.21.1, Fabric API 0.100.1 (Kompilierung), Yarn 1.21.1

## 1. Ausgangslage (geprüft)

**Datenfluss Spieler:**
- `FabricPlayer.update()` bildet alle `live-player-update-interval` Ticks einen unveränderlichen Schnappschuss (`LivePlayerState`). Der Armschwung wird in jedem Tick geprüft (`SwingTracker`).
- `LivePlayersDataSupplier` → `LivePlayersJson` → `maps/<id>/live/players.json` (pro Karte, gecacht und ratenbegrenzt).
- Webclient: `PlayerMarkerManager` → `PlayerMarkerSet` → `PlayerMarker` → `PlayerModel`/`PlayerAnimator`, gesteuert über das vorhandene `bluemapRenderFrame`.

**Ressourcen:**
- BlueMap lädt **alle** Modelle (`assets/*/models/**`) in seinen `ResourcePack`.
- Anzeige-Transformationen (`display`) und `overrides` übernimmt BlueMap nicht in seine Modellklassen.
- Texturen lädt BlueMap nur, soweit Block-/Entity-Modelle der Karte sie verwenden; **Item-Texturen fehlen**.
- Der Webclient kennt keine Minecraft-Modelle, er zeigt fertige Kachel-Meshes.

**Fabric (Quelltext 0.100.1 geprüft):** Die folgenden Ereignisse werden serverseitig ausgelöst.
- `AttackEntityCallback` in `ServerPlayerEntity.attack`
- `AttackBlockCallback` bei `START_DESTROY_BLOCK`
- `UseBlockCallback` in `interactBlock`
- `UseItemCallback` in `interactItem`

**Minecraft (Namen gegen Yarn 1.21.1 geprüft):**
- `getMainHandStack`, `getOffHandStack`, `isUsingItem`, `getActiveHand`, `getActiveItem`, `getItemUseTime`, `isBlocking`, `getMainArm`
- `ItemStack.areItemsAndComponentsEqual`, `hasGlint`, `getUseAction`
- `CrossbowItem.isCharged`, `ChargedProjectilesComponent.contains`
- `PlayerEntity.fishHook`

## 2. Phase 1 – Umsetzung

1. **Server: Itemdaten**
   - Neue Records `HeldItem` (Item-ID, Glanz, `custom_model_data`, Armbrust geladen/Feuerwerk), `Equipment` (Haupt-/Nebenhand, Linkshänder, Angel ausgeworfen) und `ItemUse` (Hand, `UseAction`, Ticks).
   - Ein neuer `HeldItem` wird nur erzeugt, wenn sich Item oder Komponenten ändern. Die Anzahl wird ignoriert.
2. **Server: Aktionsart des Armschwungs**
   - Die Fabric-Ereignisse aus §1 markieren den Schwung im selben Tick als `attack`, `mine` oder `use`; ohne Ereignis bleibt es `swing`.
   - Fortgesetztes Abbauen bleibt `mine`, solange die Schwünge ohne Pause weiterlaufen.
3. **`players.json`**
   - Neue Felder `equipment`, `use` und `swing.kind`, nur mit `live-player-extended-data`.
   - Pro Hand werden nur die Item-ID und wenige Flags übertragen. Ein getrennter Abruf wäre teurer als diese Daten.
4. **Server: Item-Assets**
   - Ein `ItemAssetUpdater` schreibt beim ersten Bedarf, also wenn ein Item in einer ausgelieferten `players.json` vorkommt, `assets/items/<ns>/<pfad>.json` in den Speicher jeder Karte. Das ist derselbe Weg wie bei den Skins.
   - Inhalt: fertig aufgelöste Flächen (Elternkette, Element-Rotation, UV-Standardwerte und UV-Rotation über BlueMaps eigene `Element`/`Face`-Klassen), Texturen als PNG-Daten-URL (bei animierten Texturen das erste Bild), `display.thirdperson_*` und die `overrides`.
   - `builtin/generated` wird wie Vanillas `ItemModelGenerator` zu Flächen extrudiert.
   - Der Schild (`builtin/entity`) bekommt eine eigene Geometrie.
   - Für andere `builtin/entity`-Items (Truhe, Dreizack, Banner, Köpfe …) wird die flache Item-Textur verwendet, falls vorhanden. Gibt es keine, wird kein Item angezeigt.
5. **Webclient**
   - `ItemAssetCache` mit Referenzzählung lädt Geometrie, Texturen und Materialien je Item-Typ und gibt sie wieder frei.
   - `PlayerModel` erhält zwei Item-Anker, die den Armknochen folgen. Die Transformationskette entspricht Vanillas `HeldItemFeatureRenderer`/`ItemRenderer`.
   - `overrides` werden ausgewertet: `pulling`/`pull` (Bogen, Armbrust), `charged`/`firework`, `blocking`, `throwing`, `cast`, `custom_model_data`.
6. **Animationen**
   - Die Arm-Posen nach Vanilla-`ArmPose` werden aus dem Item und aus `use` abgeleitet: ITEM, BLOCK, BOW_AND_ARROW, THROW_SPEAR, CROSSBOW_CHARGE, CROSSBOW_HOLD, SPYGLASS, TOOT_HORN, BRUSH.
   - Essen und Trinken haben in Vanilla 1.21.1 aus der Third-Person-Sicht keine Pose; dafür gibt es eine gekennzeichnete Näherung.
   - Posen werden weich überblendet.
7. **Tests:** JUnit, Node, Browser-E2E (der E2E-Server liefert synthetische Item-Assets), Dokumentation.

## 3. Phase 2 – Truhen und interaktive Blöcke (Analyse)

- BlueMap backt Truhen über eigene Ressourcen-Erweiterungen (`resourceExtensions/.../blockstates/chest.json`, `models/entity/chest/*`) **geschlossen** in die Hires-Kacheln.
- Ein geöffneter Deckel lässt sich im Webclient deshalb nicht korrekt darstellen. Der gebackene geschlossene Deckel bliebe sichtbar, solange die Kachel nicht neu gerendert oder die Kachelgeometrie zur Laufzeit verändert wird.
- Beides berührt den BlueMap-Renderer bzw. die geplanten Live-Block-Updates.
- Verlässliche Öffnungszustände gibt es serverseitig:
  - Fass: Blockzustand `open`
  - Truhe: `ChestBlockEntity.getPlayersLookingInChestCount`
  - Endertruhe: `EnderChestInventory.isActiveBlockEntity`
  - Shulkerkiste: `ShulkerBoxBlockEntity.getAnimationStage`
- Phase 2 wird erst nach stabiler Phase 1 und nach einer Entscheidung zur Darstellung (Kachel-Update oder Laufzeit-Ausblendung) umgesetzt. Siehe Abschlussbericht.
