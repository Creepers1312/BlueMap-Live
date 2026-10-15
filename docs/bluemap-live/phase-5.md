# BlueMap Live – Phase 5 (Release 0.2.0): Entities, Schritt 1

Stand: 2026-10-15 · Branch `bluemap-live` · Plan: `roadmap.md` (0.2.0-alpha)

> **Kurzfassung:**
> - **Implementiert:** Grundlage für Live-Entities (Server-Abtastung, `live/entities.json`, Verwaltung im Webclient). Damit werden **Gegenstände am Boden**, **Wurfgegenstände** (Schneeball, Ei, Enderperle, Tränke, Feuerbälle …) und **Pfeile/Dreizack** auf der Karte angezeigt.
> - **Getestet** (automatisiert): 56 Java-Tests lokal, 66 Node-Tests, neue Browser-E2E-Suite 9/9; alle bisherigen Suites grün, ohne Spieler pixelgleich zum Original.
> - **Nicht** geprüft: Fabric-Kompilierung bis zum CI-Lauf, Minecraft.
> - **Noch offen in 0.2.0:** roter Treffer-Blitz, echtes Pfeil-Modell. Mobs folgen in 0.3.0.

## 1. Datenfluss

1. **Fabric** (`FabricMod.sampleLiveEntities`, Spiel-Thread, im Takt von `live-player-update-interval`):
   - Für jede Welt mit Spielern werden die Entities in der Box „Spieler ± Radius“ gesucht (`world.getOtherEntities`), ohne Doppelte.
   - Unterstützte Arten bisher: `ItemEntity`, `FlyingItemEntity` (alle Wurfgegenstände und Feuerbälle) und `PersistentProjectileEntity` (Pfeile, Spektralpfeile, Dreizack).
   - Pro Entity werden erfasst: Netzwerk-ID, Typ, Position, Drehung, Geschwindigkeit (Blöcke/s), am Boden, und das Item. Das Item ist das gedroppte Item bzw. `getStack()`/`getItemStack()`.
   - Schutz gegen Farmen: höchstens 2000 Entities pro Welt.
   - Das Ergebnis liegt als unveränderliche Liste im Speicher und wird vom Webserver nur gelesen.
2. **`LiveEntitiesDataSupplier`** (pro Karte, ratenbegrenzt wie `players.json`):
   - Ausgeliefert werden nur Entities im Radius um **angezeigte** Spieler. Entities um versteckte Spieler (Zuschauermodus, unsichtbar, versteckt, per Befehl ausgeblendet) würden sonst deren Position verraten.
   - Die nächsten Entities stehen zuerst, höchstens `live-entities-limit`.
   - Ausgeblendete Typen werden entfernt.
   - Die Item-Modelle werden wie bei den gehaltenen Items angefordert.
3. **`maps/<id>/live/entities.json`:**
   ```json
   {"protocol": 1, "serverTime": 1760000000000, "updateInterval": 250, "entities": [
     {"id": 812, "type": "minecraft:item", "position": {"x": 1.5, "y": 64, "z": 2.5},
      "rotation": {"yaw": 0, "pitch": 0}, "velocity": {"x": 0, "y": 0, "z": 0}, "time": 1760000000000,
      "onGround": true, "item": {"id": "minecraft:diamond"}}]}
   ```
4. **Webclient:**
   - `EntityMarkerManager` fragt die Datei im angekündigten Intervall ab.
   - Ohne die Datei (Original-BlueMap, ältere BlueMap-Live-Versionen) fragt er nur alle 30 s nach und legt nichts an.
   - Die Entities liegen im eigenen Marker-Set **„Entities“**, das im Marker-Menü ein- und ausgeschaltet werden kann. Die einzelnen Entities erscheinen dort nicht in der Liste.

## 2. Darstellung

| Art | Wie | Grundlage |
|---|---|---|
| Gegenstand am Boden | Item-Modell mit der `ground`-Anzeigetransformation des Resource-Packs, gehoben um 0,1 ± 0,1 + 0,25 · Skalierung, langsam drehend | Vanillas `ItemEntityRenderer` (nachgebildet) |
| Wurfgegenstand | Item-Modell, immer zur Kamera gedreht; Feuerball ×3, kleiner Feuerball ×0,75 | Vanillas `FlyingItemEntityRenderer` (nachgebildet) |
| Pfeil, Spektralpfeil | **Vanilla-Pfeilmodell**: Federende (5×5 px) und vier Schaftflächen (16×5 px) als Kreuz, Textur `entity/projectiles/(spectral_)arrow` aus dem Resource-Pack (als Entity-Asset `assets/entities/minecraft/arrow.json`), gedreht um y (Gierwinkel − 90°) und z (Neigung), Kreuz 45° um die Achse | Vanillas `ArrowEntityRenderer`/`ProjectileEntityRenderer` (nachgebildet) |
| Dreizack | **Näherung:** das flache Item entlang der Flugrichtung | Vanilla verwendet ein eigenes Modell |

**Flugbahn (Nachtrag nach dem ersten Test in Minecraft):**
- Ein Pfeil fliegt etwa 60 Blöcke/s, der Server tastet alle 250 ms ab. Mit reiner Interpolation sah man nur 2–3 Standbilder und dann den Pfeil im Boden.
- Jetzt rechnet der Browser fliegende Geschosse und Wurfgegenstände ab jeder Abtastung mit der Vanilla-Physik weiter: pro Tick Position + Geschwindigkeit, dann Luftwiderstand ×0,99 und Schwerkraft (Pfeil, Dreizack, Trank 0,05; Schneeball, Ei, Enderperle 0,03; Erfahrungsfläschchen 0,07; Feuerbälle und Windkugeln ohne).
- Zwischen zwei Ticks wird interpoliert. Die Drehung folgt der Bewegung des aktuellen Ticks, der Pfeil neigt sich also im Fallen.
- Die Abweichung zu einer neuen Abtastung wird mit τ = 0,1 s ausgeglichen, ohne Sprung. Nach 0,75 s ohne neue Abtastung endet die Vorhersage.
- **Steckende Pfeile:** Der Server erkennt sie daran, dass sie sich seit dem letzten Tick nicht bewegt haben (`prevX/Y/Z`), und sendet sie als ruhend ohne Geschwindigkeit. Dort bleiben sie mit ihrer Drehung liegen.

**Allgemein:**
- Der Ablauf ist derselbe wie bei den Spielern: `ItemView` (aus den Spieler-Items herausgelöst), gemeinsamer `ItemAssetCache` des Managers mit Referenzzählung, Interpolation zwischen den Abtastungen (Sprünge über 16 Blöcke ohne Interpolation).
- Gesteuert wird über das vorhandene `bluemapRenderFrame`. Hohe Bildrate wird nur angefordert, solange sich ein Entity bewegt. Das Drehen liegender Items läuft in der normalen Bildrate.
- Ab 300 Blöcken Kameraabstand werden Entities ausgeblendet.

## 3. Einstellungen (`plugin.conf`)

| Option | Standard | Bedeutung |
|---|---|---|
| `live-entities` | `true` | Entities anzeigen |
| `live-entities-radius` | `30` | Radius um angezeigte Spieler (0–128) |
| `live-entities-limit` | `200` | höchstens so viele Entities pro Karte, die nächsten zuerst (0–1000) |
| `live-entities-hidden-types` | `[]` | nie angezeigte Typen, z. B. `[ "minecraft:item" ]` |

Bestehende `plugin.conf`-Dateien werden nicht geändert. Fehlende Optionen haben die Standardwerte.

## 4. Tests

**Automatisiert ausgeführt**

| Test | Ergebnis |
|---|---|
| JUnit lokal | **56/56**. Neu im `LivePlayersDataSupplierTest`: Entities um angezeigte Spieler, sortiert, mit Item-Anforderung; Grenze, ausgeblendete Typen, abgeschaltet; versteckte Spieler, andere Welt und Spielerfilter verraten nichts. `ItemModelBakerTest` prüft zusätzlich die `ground`-Transformation. |
| `npm test` | **66/66**. Neu in `LiveEntities.test.mjs`: Parser, Darstellungsart, Flugrichtung, Vanilla-Bewegung liegender Items, Marker (Bewegung, Interpolation, Sprung, Freigabe, Billboard, Feuerball-Größe, Pfeilrichtung). Die bisherigen Item-Tests laufen unverändert gegen die herausgelöste `ItemView`. |
| ESLint, `npm run build` | ok |
| Browser-E2E `entities-e2e.mjs` (neu) | **9/9**: leer; Gegenstand am Boden (Pixel, Schweben, Drehen, nicht im Menü); Interpolation und Sprung; Schneeball zur Kamera (Pixel), Feuerball-Größe; Pfeilrichtung; Entfernen und Freigeben; Set ausblenden (Pixel); Kartenwechsel ohne Neuladen, alte Ressourcen freigegeben, kein doppeltes Set; keine Fehler |
| `items-e2e.mjs`, `player-e2e.mjs`, `animation-e2e.mjs` | 16/16, 22/22, 18/18 |
| Regression gegen das Original (ohne Spieler) | 0 abweichende Pixel |

**Nicht ausgeführt**

| Test | Grund |
|---|---|
| Fabric-Kompilierung (`FabricMod.sampleLiveEntities`) | lokal nicht möglich, im CI nach dem Push. Die Namen sind gegen Yarn 1.21.1 geprüft. |
| Minecraft | manuelle Tests N1–N8 in `singleplayer-test.md` |

## 5. Einschränkungen

- **Dreizack:** nur das flache Item entlang der Flugrichtung, nicht das Vanilla-Modell.
- **Pfeile:** Getränkte Pfeile zeigen die normale Pfeiltextur. Das Wackeln beim Einschlag (`shake`) fehlt.
- **Vorhersage:** Wasser (anderer Widerstand) und Kollisionen sind nicht nachgebildet. Trifft ein Pfeil zwischen zwei Abtastungen, fliegt er bis zur nächsten Abtastung kurz weiter und wird dann an die Einschlagstelle gezogen.
- **Mehrere gleiche Items** in einem Stapel werden als ein Modell gezeigt; Vanilla zeichnet bis zu fünf.
- **Leistung:** Die Werte in `roadmap.md` sind Schätzungen; gemessen ist noch nichts.

## 6. Treffer-Blitz (Nachtrag)

- **Server (Fabric):** Pro Tick wird `LivingEntity.hurtTime` des Spielers geprüft. Steigt der Wert, ist das ein neuer Treffer und der Zähler `hurt.count` erhöht sich. `players.json` enthält dann `"hurt": {"count": N}`, nur mit erweiterten Daten.
- **Webclient:** Ändert sich der Zähler, ist der Körper 0,5 s lang rot eingefärbt (Vanilla: `hurtTime` 10 Ticks, `OverlayTexture` mischt 30 % Rot ein).
  - Umgesetzt mit geteilten, rot gemischten Kopien der Skin-Materialien.
  - Gehaltene Items bleiben wie in Vanilla ungefärbt.
  - Der erste bekannte Zähler (Beitritt, Neuanlage) löst keinen Blitz aus.
- Den Rückstoß zeigt weiterhin die Position.

## 7. Tests zum Nachtrag (Pfeil, Flugbahn, Treffer)

| Test | Ergebnis |
|---|---|
| JUnit lokal | **59/59**: Entity-Asset Pfeil, Schreiben der Entity-Assets, `hurt` im JSON, Anforderung der Entity-Typen |
| `npm test` | **71/71**: Pfeilmodell (Flächen, Länge), Vanilla-Drehung, Vorhersage gegen nachgerechnete Vanilla-Physik, sanfte Korrektur, steckender Pfeil, Physik-Konstanten; Treffer im Animator und geteilte Treffer-Materialien |
| Browser-E2E `entities-e2e.mjs` | **10/10**: Pfeil mit Vanilla-Modell und Pack-Textur; fliegender Pfeil bewegt sich in jedem Frame zwischen den Abtastungen; ruhender Pfeil bleibt |
| Browser-E2E `animation-e2e.mjs` | **19/19**: Treffer-Blitz 0,5 s, anderer Spieler ungefärbt |
| `items-e2e.mjs`, `player-e2e.mjs`, Regression | 16/16, 22/22, 0 abweichende Pixel |
