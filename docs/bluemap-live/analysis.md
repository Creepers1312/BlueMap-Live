# BlueMap Live – Phase 1: Bestandsaufnahme und Architektur

Stand: 2026-10-15 · Branch `bluemap-live` (abgezweigt von `origin/mc1.21.1` @ `78bd894`)

Legende für Aussagen in diesem Dokument:

- **[geprüft]** – im Code bzw. per Befehl tatsächlich nachgesehen (Datei/Zeile angegeben)
- **[Annahme]** – plausibel, aber noch nicht überprüft; muss vor oder während der Implementierung verifiziert werden

---

## 0. Kurzfassung

1. **Basis-Branch:** `master` zielt inzwischen auf Minecraft **26.x** (`implementations/fabric/build.gradle.kts`: `minecraftVersion = "26.1"`, Mojang-Mappings). Für Minecraft **1.21.1 + Fabric** pflegt das Projekt einen eigenen Branch **`mc1.21.1`** (Stand `v5.13-31-g78bd894`, letzter Commit 2025-12-09). Dieser Branch ist die einzige sinnvolle Basis. Alle Aussagen unten beziehen sich auf ihn. **[geprüft]**
2. **Issue #95** („Add player models (player live positions)“) ist weiterhin **offen**, ohne BlueMap-PR und ohne Branch. Pitch und Yaw werden bereits übertragen, dargestellt wird aber weiterhin nur ein 2D-Kopf (HTML/CSS). Ein 3D-Modell, Skins am Körper und Animationen fehlen vollständig. **[geprüft]**
3. **Spieler:** Daten werden nur **1×/s pro Spieler** auf dem Server-Thread gesammelt und per **HTTP-Polling** (`live/players.json`, 1 s) ausgeliefert. Für flüssige Bewegungen sind höhere Raten und zusätzliche Felder nötig (Körper-Yaw, Bewegungszustände, Teleport-Erkennung). Diese Ergänzungen sind klein.
4. **Blockänderungen:** BlueMap liest Welten **ausschließlich aus den Region-Dateien auf der Festplatte** (`MCAWorld`). Änderungen werden erst nach dem Speichern durch Minecraft und einem Region-Datei-Watcher (mindestens 5 s Verzögerung) neu gerendert. Der Webclient lädt geänderte Tiles erst nach einem Neuladen der Seite (globaler Cache-Hash). Es gibt **keinen** Fabric-Hook für Blockänderungen.
5. **Empfohlene Architektur:** Die originale BlueMap-Pipeline wird verwendet und nur an drei Stellen minimal erweitert:
   - (a) Serverseitiger Mixin-Hook auf jede Blockänderung → betroffene Chunks werden als „dirty“ markiert.
   - (b) **In-Memory-Chunk-Overlay** im `MCAWorld`: Der Live-Chunk wird mit Minecrafts eigenem `ChunkSerializer` als NBT serialisiert und von BlueMaps **eigenem** `MCAChunkLoader` geparst. Anschließend werden nur die betroffenen **Hires-Tiles (32×32)** über den normalen `RenderManager` neu gerendert.
   - (c) Versionierte Polling-Endpunkte; der Webclient lädt nur diese Tiles gezielt nach.

   Spielermodelle werden als echte `THREE.Object3D` in die vorhandene Marker-Szene (`MapViewer.markers`) eingehängt. Diese Szene wird bereits mit derselben Kamera und demselben Tiefenpuffer wie die Karte gerendert.
6. **Kleinster sinnvoller nächster Schritt** (Abschnitt 11): erweiterte, versionierte Spielerdaten (Server) plus ein `PlayerMarker` mit echtem 3D-Objekt, zunächst als Platzhalter-Box, inklusive Teleport- und Dimensionswechsel-Logik. Der bestehende Kopf-Marker bleibt als Fallback und Option erhalten.

---

## 1. Repository und Build

| Thema | Befund | Quelle |
|---|---|---|
| Module | `api` (includeBuild), `core`, `common`, `implementations/{cli,fabric,forge,neoforge,paper,spigot,sponge}` | `settings.gradle.kts` **[geprüft]** |
| Branches | `master` (26.x), `mc1.21.1`, `mc1.20`, `legacy`, `feat/events`, `feat/vt-webserver` u. a. | `git ls-remote` **[geprüft]** |
| Fabric auf `mc1.21.1` | `supportedMinecraftVersions = 1.21 … 1.21.4`, kompiliert gegen **1.21** (`supportedMinecraftVersions.first()`), Yarn `1.21+build.1`, Loader `0.17.2`, Fabric API `0.100.1+1.21` | `implementations/fabric/build.gradle.kts` **[geprüft]** |
| Java | Toolchain 21 | `buildSrc/.../bluemap.java.gradle.kts:18` **[geprüft]** |
| Webapp | Vue 3 + three.js **0.147**, Vite 6; wird über Gradle-`NpmTask` (`buildWebapp`, `npm ci`) gebaut und in `common` eingebettet | `common/webapp/package.json`, `common/build.gradle.kts:33-47` **[geprüft]** |
| Tests | Nur 2 JUnit-5-Tests in `core`, keine in `common`, `fabric` oder Webapp | `find */src/test` **[geprüft]** |
| Code-Stil | Spotless mit Lizenz-Header (`LICENSE_HEADER`), 4 Spaces, Lombok | `bluemap.java.gradle.kts` **[geprüft]** |
| Build in dieser Umgebung | siehe Abschnitt 10 | |

**Konsequenz:** Die Fabric-Implementierung wird gegen 1.21 kompiliert und für 1.21–1.21.4 freigegeben. Mixins sind empfindlicher gegenüber Versionsunterschieden als die heutige Fabric-API-Nutzung. Für BlueMap Live wird deshalb **1.21.1 als einzige verifizierte Zielversion** dokumentiert. Die Laufzeitprüfung muss gegen einen echten 1.21.1-Server erfolgen. Die übrigen Versionen der Liste gelten als „nicht geprüft“.

---

## 2. Issue #95 – Ist-Zustand im Code

GitHub-Status (abgerufen 2026-10-15): **offen**, keine Labels mehr, Projekt-Board „Planned (unordered)“, „No branches or pull requests“. Einzige Referenz ist ein Commit in einem Fremd-Repository (`thoughts-on-things/vantage-mc`), der keinen BlueMap-Code betrifft. **[geprüft]**

Abgleich mit dem Code (`mc1.21.1`):

| Stufe | Status | Beleg |
|---|---|---|
| 1. Spieler-Kopf / Marker | **vorhanden** | `webapp/src/js/markers/PlayerMarker.js`: `CSS2DObject` mit `<img>` aus `assets/playerheads/<uuid>.png` |
| 2. Statisches 3D-Spielermodell | **fehlt** | keine Geometrie für Spieler im Webclient |
| 3. 3D-Modell mit Skin | **fehlt** | Server lädt zwar den **vollen Skin**, speichert aber nur den 8×8-Kopf (`PlayerSkinUpdater` → `DefaultPlayerIconFactory`); Modelltyp (classic/slim) wird nicht ausgewertet (`MojangSkinProvider.readTextureUrl`) |
| 4. Animiertes Modell | **fehlt** | – |
| 5. Live-Position + Blickrichtung | **teilweise** | `LivePlayersDataSupplier` liefert `position`, `rotation{pitch,yaw,roll}`, `foreign`; `FabricPlayer.update` setzt `rotation = (pitch, headYaw, 0)`; Aktualisierung 1×/s/Spieler (`FabricMod.updateSomePlayers`), HTTP-Cache 1 s (`MapRequestHandler`), Client-Polling 1 s (`BlueMapApp.initPlayerMarkerManager`). Pitch und Yaw werden im Client zwar interpoliert (`PlayerMarker.updateFromData`), aber **nirgends dargestellt**. |

Wiederverwendbar: die Datenkette `Player` → `LivePlayersDataSupplier` → `PlayerMarkerManager`/`PlayerMarkerSet`/`PlayerMarker`, die Filterlogik (hide-invisible, vanished, sneaking, gamemodes, light), die Skin-Pipeline `PlayerSkinUpdater` + API-`SkinProvider` und die Konfiguration `live-player-markers`.

---

## 3. Serverseite (Fabric, `mc1.21.1`)

### 3.1 Vorhandene Komponenten **[geprüft]**

- `implementations/fabric/.../FabricMod.java` – `ModInitializer` + `Server`-Interface. Registriert `ServerLifecycleEvents.SERVER_STARTED/STOPPING`, `ServerPlayConnectionEvents.JOIN/DISCONNECT` und `ServerTickEvents.END_SERVER_TICK` → `updateSomePlayers()`: **onlineCount/20 Spieler pro Tick**, also jeder Spieler etwa 1×/s.
- `FabricPlayer.java` – Snapshot von Gamemode, Unsichtbarkeit, Name, Position, `(pitch, headYaw)`, Sneaking, Sky-/Blocklight und Welt. Wird nur auf dem Server-Thread befüllt und von anderen Threads gelesen; die Felder sind nicht `volatile`.
- `FabricEventForwarder.java` – leitet nur **Join und Leave** an `ServerEventListener` weiter.
- `FabricWorld.java` – `persistWorldChanges()` ruft `world.save(null, true, false)` für die **ganze Welt** auf dem Server-Thread auf. Das wird für `/bluemap update` genutzt.
- `common/.../serverinterface/{Server,Player,ServerWorld,ServerEventListener}.java` – plattformneutrale Abstraktion. `ServerEventListener` kennt nur `onPlayerJoin/onPlayerLeave`.

### 3.2 Was für BlueMap Live fehlt

| Bedarf | Vorhandene API (1.21.1) | Bewertung |
|---|---|---|
| Join/Leave | `ServerPlayConnectionEvents` | vorhanden |
| Respawn | Fabric `ServerPlayerEvents.AFTER_RESPAWN` **[Annahme: im Fabric-API-Modul `fabric-entity-events-v1` der Version 0.100.1 vorhanden – verifizieren]** | ergänzen |
| Dimensionswechsel | `ServerEntityWorldChangeEvents.AFTER_PLAYER_CHANGE_WORLD` **[Annahme, wie oben]** | ergänzen; zusätzlich robust über den Weltvergleich pro Sample |
| Teleport | kein Fabric-Event **[Annahme]** | Erkennung über Positionssprung pro Sample (> konfigurierbarer Schwellwert, z. B. 8 Blöcke/Tick) sowie Welt-, Respawn- und Join-Ereignisse → **`epoch`-Zähler pro Spieler** |
| Körper-Yaw, Sprint, Onground, Schwimmen, Elytra, Schleichen | Felder/Methoden an `ServerPlayerEntity` bzw. `Entity`/`LivingEntity` (`bodyYaw`, `isSprinting()`, `isOnGround()`, `isSwimming()`, `isFallFlying()`, `getPose()`, `getVelocity()`) **[Annahme – Yarn-Namen gegen 1.21-Mappings verifizieren]** | serverseitig autoritativ |
| Blockänderungen allgemein | Fabric API bietet nur `PlayerBlockBreakEvents` (nur Spieler-Abbau) und `UseBlockCallback` (vor dem Platzieren, nicht autoritativ) | **nicht ausreichend** → Mixin nötig (3.3) |

### 3.3 Blockänderungen: Integrationspunkt

Alle relevanten Änderungen (Spieler, Pistons, Explosionen, Fluids, Redstone, `/setblock`, `/fill`, andere Mods) laufen in Vanilla über `World#setBlockState(BlockPos, BlockState, int flags, int maxUpdateDepth)` → `WorldChunk#setBlockState`. Dort ruft Vanilla bei einer tatsächlichen Änderung `World#onBlockChanged(pos, oldState, newState)` auf; `ServerWorld` überschreibt diese Methode für POI-Updates.

**Vorschlag:** ein `@Inject(at = TAIL)`-Mixin auf `ServerWorld#onBlockChanged`, das nur `(dimension, chunkX, chunkZ, sectionY)` in eine **begrenzte, deduplizierende Dirty-Menge** einträgt. Das kostet O(1) auf dem Server-Thread, ohne Allokation pro Block bei wiederholten Änderungen im selben Chunk.

- **[Annahme]** Name und Signatur von `onBlockChanged` in Yarn 1.21. Außerdem ist zu prüfen, ob die Methode auch bei Piston-Moving-Blocks, Explosionen (`Explosion#affectWorld` → `setBlockState`) und Worldgen-Nachbearbeitung aufgerufen wird. Worldgen läuft über `ProtoChunk`; Änderungen dort sollten nicht ausgelöst werden, was erwünscht ist.
- Nicht erfasst werden Änderungen, die direkt in `ChunkSection`-Paletten schreiben (manche Mods und World-Edit-Tools umgehen `setBlockState`). Diese werden weiterhin über den bestehenden Region-Datei-Watcher erfasst, sobald Minecraft speichert. Das ist der Fallback und wird dokumentiert.
- Fabric-Mixins sind in der `fabric`-Implementierung bisher **nicht** konfiguriert (kein `mixins`-Eintrag in `fabric.mod.json`). Es muss eine `bluemap.mixins.json` ergänzt werden. Das ist die einzige neue Build-Infrastruktur.

---

## 4. Live-Datenübertragung

### 4.1 Vorhanden **[geprüft]**

- Eigener NIO-HTTP-Server (`common/.../web/http/Server.java`, `HttpConnection.java`). Anfragen werden **synchron im Selector-Thread** bearbeitet (`HttpConnection(requestHandler)` → `Runnable::run`). **Kein WebSocket, kein SSE, kein Long-Polling** möglich, ohne den Server umzubauen: Ein blockierender Handler würde alle anderen Verbindungen blockieren.
- Routing: `RoutingRequestHandler` → `maps/<id>/(.*)` → `MapRequestHandler` mit `live/players.json` (über `CachedRateLimitDataSupplier`, 1000 ms) und `live/markers.json` (10000 ms). `JsonDataRequestHandler` setzt `Cache-Control: no-cache`.
- Viele Installationen betreiben BlueMap hinter einem Reverse-Proxy oder liefern Kartendaten über einen externen Webserver bzw. `sql.php` aus. Live-Daten kommen dann über `webapp.conf: live-data-root` vom integrierten Webserver (`WebappConfig.liveDataRoot`).

### 4.2 Entscheidung: versioniertes HTTP-Polling (Stufe 1), WebSocket nur optional später

Begründung anhand der Infrastruktur:

- Polling funktioniert mit **allen** bestehenden Deployments: Reverse-Proxy-Konfigurationen, `live-data-root` und CDN-freie Setups. WebSocket bräuchte Upgrade-Handling im eigenen NIO-Server plus neue Proxy-Konfiguration bei jedem Betreiber.
- Die Zielwerte (Spieler etwa 4–5 Hz, Blockänderungen etwa 1 s) sind mit kleinen JSON-Antworten und `CachedRateLimitDataSupplier` erreichbar. Pro Abfrage wird ein Snapshot für alle Clients berechnet, nicht einer pro Client.
- Gegen Lücken und Paketverluste schützt der Ansatz „voller Zustand für Spieler, Delta mit Sequenznummer für Tiles“ (siehe unten).
- Eine WebSocket- bzw. SSE-Variante wird in Phase 5 nur dann gebaut, wenn Messungen zeigen, dass Polling nicht reicht. Der Branch `feat/vt-webserver` (virtual-thread-basierter Webserver) wäre ein möglicher Unterbau. **[Annahme – Branch nicht im Detail analysiert]**

### 4.3 Nachrichtenformate (Entwurf)

`GET maps/<id>/live/players.json` – **abwärtskompatibel erweitert**. Bestehende Felder bleiben erhalten, alte Clients ignorieren neue Felder:

```json
{
  "protocol": 1,
  "serverTime": 1739999999123,
  "players": [{
    "uuid": "…", "name": "…", "foreign": false,
    "position": {"x":0,"y":64,"z":0},
    "rotation": {"pitch":0,"yaw":0,"roll":0},
    "bodyYaw": 0,
    "epoch": 3,
    "state": {"sneaking":false,"sprinting":false,"onGround":true,"swimming":false,"flying":false,"fallFlying":false},
    "velocity": {"x":0,"y":0,"z":0},
    "light": {"sky":15,"block":0},
    "skin": {"model":"classic","hash":"…"}
  }]
}
```

- `epoch` wird bei Join, Respawn, Weltwechsel und erkanntem Teleport erhöht. Der Client **springt** dann, statt zu interpolieren.
- `serverTime` dient der Interpolation mit Puffer (Entity-Interpolation mit etwa 1–2 Samples Verzögerung) und dem Verwerfen veralteter Antworten: Antworten mit kleinerem `serverTime` als der zuletzt verarbeiteten werden ignoriert. Das ist relevant bei überlappenden Requests und Proxys.
- Die Rate wird über `CachedRateLimitDataSupplier` konfigurierbar (z. B. 200–250 ms) statt fest 1000 ms.

`GET maps/<id>/live/tiles.json?since=<seq>` – neu:

```json
{ "protocol":1, "session":"<random-id-pro-Pluginstart>", "seq":1234,
  "reset": false,
  "tiles": [{"x":12,"z":-4,"v":1233}, …] }
```

- Ein serverseitiger Ringpuffer mit begrenzter Größe (z. B. 4096 Einträge) speichert, welche Hires-Tiles in welchem `seq` neu geschrieben wurden.
- Liegt `since` außerhalb des Puffers oder passt `session` nicht (Server-Neustart), antwortet der Server mit `reset: true`. Der Client lädt dann **alle sichtbaren Tiles neu**, was dem bestehenden Verhalten nach einem Seiten-Reload entspricht. Verlorene Ereignisse führen so nie zu dauerhaft falschen Zuständen.
- `v` wird als Query-Parameter an die Tile-URL gehängt (`…/x12/z-4.prbm?<cacheHash>-<v>`). Das umgeht den 1-Tag-Browsercache (`MapStorageRequestHandler:82-83`), ohne die statische Auslieferung zu ändern.

### 4.4 Validierung

- Es gibt **keinen Kanal vom Client zum Server**, der Zustand verändert. Der Webclient sendet nur `GET` mit `since=<int>`. Dieser Parameter wird geparst und begrenzt (nicht numerisch oder negativ → `reset`).
- Antwortgrößen sind begrenzt: maximale Spieleranzahl (Konfiguration) und maximale Tiles pro Antwort (danach `reset`).

---

## 5. Webclient

### 5.1 Vorhandene Rendering-Architektur **[geprüft]**

- `MapViewer.js` rendert pro Frame in fester Reihenfolge: Skybox → (Tiefe leeren) → Lowres-LODs → Hires (`map.hiresTileManager.sceneParent`) → **`this.markers` mit derselben Kamera und ohne vorheriges Leeren des Tiefenpuffers** (`MapViewer.js:392`) → `css2dRenderer` für HTML-Marker.
  ⇒ 3D-Objekte in `this.markers` (einer `MarkerSet`, abgeleitet von `THREE.Scene`) werden **korrekt von der Hires-Geometrie verdeckt**. Das ist der Einhängepunkt für Spielermodelle. Bestehende 3D-Marker (`ShapeMarker`, `ExtrudeMarker`, `LineMarker`) nutzen genau diesen Weg.
- Präzisions-Trick: Karte und Kamera werden für das Map-Rendering um Vielfache von 10000 verschoben und danach zurückgesetzt. Marker liegen in Weltkoordinaten, was für die bestehenden Marker bereits funktioniert.
- Render-Loop (`MapViewer.renderLoop`): Ohne Interaktion wird nur alle ≥50 ms (etwa 20 fps) gerendert, mit `redraw()` 1 s lang mit voller Framerate. ⇒ Animierte Spieler müssen `redraw()` aufrufen, **solange ein sichtbarer Spieler animiert ist**, und sonst nicht.
- Hires-Shader (`HiresFragmentShader.js:71-72`): `light = mix(blocklight, max(sunlight, blocklight), sunlightStrength); color *= mix(ambientLight, 1, light/15)`. Die Uniforms `sunlightStrength` und `ambientLight` liegen in `mapViewer.data.uniforms` und werden mit der Karte geteilt. ⇒ Spielermodelle können mit **derselben Lichtformel** und den Sky-/Blocklight-Werten des Spielers schattiert werden und wirken so konsistent zur Karte.
- `PlayerMarkerManager` (extends `MarkerManager`) pollt `live/players.json`. `PlayerMarkerSet.updateFromPlayerData` legt Marker an, aktualisiert sie und entfernt fehlende (keine Geisterspieler). `PlayerMarker.updateFromData` interpoliert mit `animate(..., 1000)` per easeInOutCubic. Teleports werden ebenfalls „durchgeflogen“; das ist ein Fehler gegenüber Anforderung 5.2.
- Tiles: `TileManager` → `Tile.load(tileLoader)` ruft **zuerst `unload()`** und dann das Laden auf. Ein einfaches Neuladen würde also kurz eine Lücke erzeugen. `TileLoader.load` hängt `?<tileCacheHash>` an (global, pro Seitenaufruf).

### 5.2 Spielermodell – Integrationsplan

- **Kein neuer Renderer:** `PlayerMarker` erhält zusätzlich zum bestehenden `CSS2DObject` (Name, optional Kopf) ein `THREE.Group` mit dem Spielermodell. Dessen Kind-Objekte bilden die Knochenhierarchie: `body`, darin `head`, `armL/R` und `legL/R` als eigene Pivot-Gruppen, damit Gliedmaßen echt rotieren können.
- **Geometrie:** Boxen nach dem Vanilla-Modell (Kopf 8³, Körper 8×12×4, Arme 4×12×4 bzw. 3×12×4 bei `slim`, Beine 4×12×4), Maßstab 1/16 Block. Die zweite Skin-Ebene (Hut, Jacke, Ärmel, Hose) wird als leicht vergrößerte Boxen mit `alphaTest` dargestellt. UVs werden einmal pro Modellvariante (classic/slim × 64×64 bzw. Legacy 64×32) erzeugt, und die `BufferGeometry` wird **zwischen allen Spielern geteilt**. Pro Spieler gibt es nur Material und Textur.
- **Material:** `ShaderMaterial` mit `NearestFilter`-Textur, Alpha-Test und der Lichtformel aus 5.1 (Uniforms aus `mapViewer.data.uniforms` + per-Spieler `skyLight`/`blockLight`). Es wird nichts an den Karten-Shadern geändert.
- **Skin-Quelle:** Der Server speichert zusätzlich zum Kopf den **vollen Skin** als `assets/playerskins/<uuid>.png` in derselben Map-Storage (`PlayerSkinUpdater`, gleicher Mechanismus wie für `playerheads`). Den Modelltyp (`metadata.model == "slim"`) liefert der Mojang-Profil-JSON, der heute schon geladen wird. Der Client lädt Skins über einen geteilten `TextureLoader`-Cache je UUID und Hash. Bei Fehlern oder fehlendem Skin wird `assets/steve.png` verwendet; ein Steve-Fallback-Skin wird neu als Asset ergänzt. Es wird kein zweiter Download-Workflow eingeführt.
- **Skalierung/Zoom:** Weltmaßstab 1:1 (1,8 Blöcke hoch). Ab einer konfigurierbaren Kameradistanz (z. B. > 400) wird das Modell ausgeblendet und nur der bestehende Kopf- und Namensmarker gezeigt. Die vorhandene `distance-data`-Logik in `PlayerMarker.onBeforeRender` wird dafür wiederverwendet.
- **Interpolation:** Ringpuffer der letzten 2–3 Samples mit `serverTime`. Gerendert wird mit etwa einem Pollintervall Verzögerung (Snapshot-Interpolation). Bei neuer `epoch` oder Weltwechsel wird hart gesetzt. Yaw wird über den kürzesten Winkel interpoliert (bereits vorhanden).

### 5.3 Animationen – Datenbasis

| Animation | Datenquelle | Art |
|---|---|---|
| Idle (leichtes Armpendeln, Atmen) | Zeit | rein kosmetisch, wie Vanilla |
| Gehen / Laufen | horizontale Geschwindigkeit aus Positionsdelta, Phase akkumuliert über Strecke (wie Vanilla `limbSwing`) | **Näherung** aus Positionen |
| Sprinten | `state.sprinting` (Server) + Geschwindigkeit | **Zustand vom Server** |
| Schleichen | `state.sneaking` (bereits vorhanden) | Zustand |
| Springen / Fallen | `state.onGround` + vertikale Geschwindigkeit | Zustand + Näherung |
| Schwimmen / Elytra | `state.swimming` / `state.fallFlying` (Pose) | Zustand |
| Kopf vs. Körper | `rotation.yaw` (Kopf) und `bodyYaw` | Zustand |
| Schlagen / Item-Nutzung | serverseitig nur `handSwinging` bzw. `isUsingItem` **[Annahme]** | Phase 3+, optional |

Interpolierte Bewegung allein gilt **nicht** als Animation. Die Gliedmaßen rotieren tatsächlich um ihre Pivots.

### 5.4 Tile-Nachladen ohne Flackern

Kleine Erweiterung in `TileManager`: `reloadTile(x, z, version)`. Das neue Modell wird geladen, während das alte bestehen bleibt. Erst danach wird `scene.remove(old) / scene.add(new)` ausgeführt und das alte Modell freigegeben (`Tile.disposeModel`). `TileLoader.load` erhält einen optionalen Versions-Suffix. Lowres-Tiles werden nicht live nachgeladen (siehe 6.3).

---

## 6. Blockänderungen und Rendering

### 6.1 Vorhandene Pipeline **[geprüft]**

1. Minecraft schreibt Chunks beim Autosave oder Entladen in `region/r.X.Z.mca`.
2. `MapUpdateService` (Thread pro Karte) beobachtet die Region-Dateien (`MCAWorldRegionWatchService`) und plant pro geänderter Region nach **≥ 5 s Ruhe** (`max(updateCooldown − seit letztem Update, 5000)`, Standard `update-cooldown: 60` s) einen `WorldRegionRenderTask`.
3. `WorldRegionRenderTask.init` liest die Chunk-Zeitstempel aus dem Region-Header, invalidiert den Chunk-Cache und rendert **nur Tiles, deren Chunks sich geändert haben** (`checkChunksHaveChanges` gegen `MapChunkState`). Schon heute ist der kleinste Render-Baustein also das **Hires-Tile** (`BmMap.renderTile(Vector2i)` → `HiresModelManager.render`, Standard 32×32 Blöcke, volle Höhe).
4. `HiresModelManager.render` schreibt das PRBM-Tile und aktualisiert `LowresTileManager` im Speicher. Lowres wird mit `map.save()` persistiert, höchstens etwa minütlich (`WorldRegionRenderTask.complete`).
5. `RenderManager` serialisiert alle Render-Tasks, dedupliziert sie über `RenderTask#contains` und hat N Worker-Threads.
6. Der Webclient sieht Änderungen erst nach einem Seiten-Reload (globaler `tileCacheHash`) bzw. nach Ablauf des Browser-Caches (`max-age` 1 Tag).

Die Latenz liegt heute also bei **Autosave-Intervall** (Vanilla: alle 6000 Ticks ≈ 5 min **[Annahme für 1.21.1 – verifizieren]**) + ≥5–60 s + Reload.

### 6.2 Stufe 1 – zuverlässig: Live-Chunk-Overlay + gezieltes Tile-Rendering

```
Server-Thread                       BlueMap-Threads                         Webclient
─────────────                       ───────────────                         ─────────
onBlockChanged(pos) ──► DirtyChunks (Set, bounded)
END_SERVER_TICK (alle N Ticks, Budget K Chunks/Tick):
  ChunkSerializer.serialize(world, chunk) → NbtCompound → byte[]  ──►  LiveChunkOverlay.put(chunkPos, bytes, captureTime)
                                                                         │  (MCAChunkLoader.load(bytes, NONE) → Chunk)
                                                                         ▼
                                                                    LiveTilesRenderTask(map, Set<tile>)
                                                                      → BmMap.renderTile(tile)   (bestehender Renderer!)
                                                                      → TileChangeLog.append(tile, seq)  ──► live/tiles.json?since=
                                                                                                             TileManager.reloadTile(x,z,v)
```

- **`LiveChunkOverlay`** (neu, in `core`, von `ChunkGrid`/`MCAWorld` genutzt): `getChunk(x,z)` liefert, wenn vorhanden, den Overlay-Chunk, sonst wie bisher den Cache bzw. die Region-Datei. Dadurch lesen **alle** Renderings, auch statische Voll-Updates, den neuesten Zustand. Ein älteres statisches Rendering kann eine Live-Änderung nicht überschreiben (Anforderung 6.1).
- **Ablauf eines Overlay-Eintrags:** Der Eintrag wird entfernt, sobald der Chunk-Zeitstempel im Region-Header ≥ `captureTime` ist, Minecraft also gespeichert hat. Das wird in `WorldRegionRenderTask.init` geprüft, das die Zeitstempel ohnehin liest. Die Größe ist hart begrenzt (z. B. 2048 Chunks ≈ einige MB). Bei Überlauf wird der älteste Eintrag verworfen. Dieser Chunk bleibt bis zum nächsten Autosave veraltet; das wird geloggt und dokumentiert.
- **Warum NBT-Serialisierung statt eigener Konvertierung:** BlueMaps Blockstate-, Biome-, Light- und Block-Entity-Parsing (`Chunk_1_18`, `BlockStateDeserializer` …) wird **unverändert** wiederverwendet. Es entsteht keine zweite Abbildung von Minecraft-Blockzuständen. Kosten: `ChunkSerializer.serialize` läuft auf dem Server-Thread. Deshalb gibt es ein Budget pro Tick und eine Entprellung (Standard: Chunk frühestens 1 s nach der letzten Änderung und höchstens alle 2 s erneut). **[Annahme: Kosten im niedrigen ms-Bereich pro Chunk – messen in Phase 4]**
- **Nachbar-Tiles:** Hires-Tiles rendern Blöcke an den Rändern teils mit Nachbarinformationen (Occlusion, Fluid, Blending). Ein Chunk an einer Tile-Grenze markiert deshalb alle Tiles, die den Chunk **plus 1 Block Rand** schneiden (`tileGrid.forEachIntersecting`).
- **Neustart:** Das Overlay ist flüchtig. Beim Server-Stopp speichert Minecraft alle Chunks, danach entspricht die Region-Datei dem neuesten Zustand. Nach dem Neustart greifen der normale Watcher bzw. das Voll-Update. Clients erkennen den Neustart an der neuen `session` → `reset`.
- **Nicht erfasste Änderungen** (Mods ohne `setBlockState`) erscheinen weiterhin über den bestehenden Pfad. Die Funktion verschlechtert sich, bricht aber nicht.

### 6.3 Stufe 2 – Optimierung (Phase 5)

- Mehrere Änderungen werden im Entprellfenster zusammengeführt (Set pro Chunk, Set pro Tile); Tiles, die schon geplant sind, werden nicht erneut eingeplant (`RenderTask#contains`).
- Nur geänderte **Sections** serialisieren: `ChunkSerializer` arbeitet chunkweise. Eine sectionweise Variante bräuchte eigenen Code und wird nur bei messbarem Bedarf angegangen.
- Live-Tile-Renderings werden vor statischen Region-Tasks priorisiert (`scheduleRenderTaskNext`), sind aber begrenzt (z. B. max. 64 Tiles pro Sekunde).
- Ein Lowres-Live-Update ist optional: Der Lowres-Zustand wird beim Hires-Rendering bereits im Speicher aktualisiert, aber erst beim `map.save()` persistiert. Ein „Lowres-Dirty“-Log ist analog möglich, aber zweitrangig, da Blockänderungen auf Lowres-Zoom kaum sichtbar sind.
- **Bewusst abgelehnt:** Blockweises Patchen der PRBM-Geometrie im Browser. Dafür müsste der Client Blockmodelle, Texturen, Culling und AO von BlueMap nachbauen, was ein paralleler Renderer wäre (Abschnitt 2 der Anforderungen). Das kleinste korrekte Update bleibt das 32×32-Hires-Tile. Kleinere Tiles sind über die vorhandene Map-Einstellung `hires-tile-size` möglich, verändern aber alle Tiles der Karte.

### 6.4 Was wann sichtbar wird

| Änderung | Sichtbar nach |
|---|---|
| Über `setBlockState` (Spieler, Piston, Explosion, Redstone, Befehle, die meisten Mods) | Entprellung (≈1 s) + Serialisierung + Tile-Rendering (typisch < 1 s pro Tile **[Annahme]**) + Client-Poll (≈1 s) |
| Direkte Paletten-Schreiber (manche Mods/Tools) | wie heute: nach Minecraft-Speicherung + Watcher |
| Lowres-Ebene | nach `map.save()` und Reload bzw. nächstem Lowres-Laden |
| Entity-basierte Darstellung (Item-Frames, Bilder usw., sofern gerendert) | wie heute (Entity-Region-Dateien werden nicht überlagert) |

---

## 7. Sicherheit und Vertrauensmodell

- **Kein neuer Schreibkanal:** Der Webclient liest nur. Alle Live-Zustände stammen aus `ServerPlayerEntity` und `ServerWorld` auf dem Server-Thread. Ein optionaler Client-Mod ist für diese Architektur **nicht nötig** und wird nicht eingeplant.
- **Bestehendes Zugriffsmodell:** BlueMap hat **keine eigene Authentifizierung** für den Webserver. Zugriffskontrolle erfolgt über Bind-Adresse oder Reverse-Proxy. BlueMap Live übernimmt dieses Modell und dokumentiert es. Die neuen Endpunkte geben **nicht mehr Information preis** als `players.json` heute, mit zwei Ausnahmen:
  - Bewegungszustände und eine höhere Aktualisierungsrate machen Spielerbewegungen genauer verfolgbar.
  - Tile-Änderungen verraten, **wo** gerade gebaut wird.

  Beides wird abschaltbar. Die bestehenden Filter (hidden, vanished, invisible, sneaking, gamemodes, light, `hide-different-world`) gelten unverändert auch für Modelle. Gefilterte Spieler erzeugen keine Daten.
- Eingaben (`since`) werden geparst und begrenzt. Antworten sind in der Größe begrenzt. Es gibt keine Logs mit Zugangsdaten (es gibt keine).
- Veraltete Daten: `serverTime`- bzw. `seq`-Monotonie auf dem Client; `session`-ID gegen Neustarts.

---

## 8. Konfiguration

Bestehender Mechanismus: Configurate-HOCON (`common/.../config/PluginConfig.java` + Template `common/src/main/resources/de/bluecolored/bluemap/config/plugin.conf`). Neue Schlüssel kommen in `plugin.conf`; alle sind standardmäßig so gesetzt, dass sich bestehende Installationen **wie bisher** verhalten oder nur vorsichtig aktiviert werden:

```hocon
live-player-models: true          # 3D-Modell statt nur Kopf (Client fällt bei false auf Kopf zurück)
live-player-update-interval: 250  # ms, Serversampling + Cache von players.json (bisher fest ~1000)
live-player-extended-data: true   # Bewegungszustände/Velocity/BodyYaw senden
live-block-updates: false         # Live-Chunk-Overlay + Tile-Live-Updates (Phase 4)
live-block-debounce: 1000         # ms
live-block-max-chunks-per-tick: 4
live-block-overlay-max-chunks: 2048
live-tile-log-size: 4096
```

`live-player-markers: false` deaktiviert wie bisher alles, was Spieler betrifft.

---

## 9. Risiken und offene Fragen

| # | Risiko / Frage | Umgang |
|---|---|---|
| R1 | Yarn-Namen und Signaturen (`onBlockChanged`, `ChunkSerializer.serialize`, Entity-Zustände, Fabric-Events) sind in diesem Dokument noch **nicht gegen die 1.21-Mappings geprüft** | Erster Schritt in Phase 2/4: Build mit Loom, Quellen dekompilieren (`genSources`), Namen verifizieren |
| R2 | Kompiliert wird gegen 1.21, Zielversion ist 1.21.1; Mixins können zwischen Patchversionen brechen | Mixin mit `require = 0` und Log-Warnung → Live-Blockupdates deaktivieren sich selbst, BlueMap läuft weiter; Laufzeittest auf echtem 1.21.1 |
| R3 | Kosten von `ChunkSerializer.serialize` auf dem Server-Thread bei Massenänderungen (TNT, `/fill`) | Budget pro Tick, Entprellung, harte Obergrenzen, Messung |
| R4 | Thread-Sicherheit: Overlay-Lesen in Render-Threads während Server-Thread schreibt | Overlay speichert **unveränderliche** Byte-Snapshots; Parsing in BlueMap-Threads; `ConcurrentHashMap` |
| R5 | Verhältnis zur Hires-Tile-Grenze (Nachbarblöcke, Wasser-Blending) | Rand von 1 Block beim Markieren; Test an Tile-Grenzen |
| R6 | Interaktion mit `MapChunkState`: Ein Live-Rendering darf den Chunk-Hash nicht so setzen, dass ein späterer echter Speicherstand übersprungen wird | Live-Renderings verändern `MapChunkState` **nicht**. Der nächste Region-Task rendert nach dem Speichern erneut. Das ist doppelte Arbeit, aber korrekt. Optimierung in Phase 5 |
| R7 | Deployments ohne integrierten Webserver (externer Webserver, SQL-Storage + `sql.php`) | Live-Funktionen setzen erreichbaren `live-data-root` voraus, wie `players.json` heute; Client degradiert still (bestehender `catch` in `initPlayerMarkerManager`) |
| R8 | Fehlende Testinfrastruktur in `common` und `fabric`, kein Headless-Minecraft-Test | JUnit-Tests für reine Logik (Overlay, Change-Log, Teleport-Erkennung, JSON); Fabric-GameTest bzw. manueller Testserver für Laufzeitverifikation |
| R9 | Skins: Mojang-Rate-Limits, Offline-Mode-Server ohne Mojang-Profile | Bestehende 1-h-Drossel bleibt; Fallback-Skin; `skin-download: false` wird respektiert |
| R10 | Upstream-Pflege: `mc1.21.1` ist ein Wartungsbranch | Änderungen klein und lokal halten, damit ein späterer Port auf `master` (26.x, Mojang-Mappings) möglich bleibt |

Offene Fragen an den Auftraggeber (blockieren Phase 1/2 nicht):

1. Soll die erhöhte Bewegungs-Genauigkeit (Datenschutz/Verfolgbarkeit) standardmäßig aktiv sein?
2. Ist ein Umstieg auf den Basis-Branch `mc1.21.1` (statt `master`) für Auslieferung und PR-Ziel akzeptiert?

---

## 10. Build-Verifikation in dieser Umgebung

**Java-/Fabric-Build: in dieser Session nicht möglich.** Die Netzwerk-Policy der Cloud-Umgebung blockiert die Hosts `maven.fabricmc.net` (Loom, Yarn, Fabric API), `libraries.minecraft.net` und `piston-meta.mojang.com` (Minecraft-Jar, Libraries) sowie `repo.bluecolored.de` (BlueNBT, BlueCommands; wird schon von `core` benötigt). Maven Central antwortete zusätzlich wiederholt mit HTTP 429. Damit ließ sich **kein** Java-Modul bauen. Auch die Yarn-Namen aus R1 konnten deshalb nicht gegen die Mappings geprüft werden.

**Webapp-Build: erfolgreich** (`npm ci && npm run build` in `common/webapp`, unveränderter Stand) → Baseline für spätere Regressionen.

Voraussetzung für Phase 2: Die genannten Hosts müssen in den Netzwerk-Einstellungen der Umgebung freigegeben werden, alternativ wird lokal gebaut.

---

## 11. Implementierungsplan und empfohlener nächster Schritt

### Phase 2 – minimaler End-to-End-Prototyp (empfohlener nächster Schritt)

Kleinster sinnvoller Schritt, der die echte Integration beweist und keine Rendering-Komponente der Karte anfasst:

1. **Server (`fabric`, `common`):**
   - `Player` um `getBodyYaw()`, `getEpoch()`, `getMovementState()` und `getVelocity()` erweitern (Default-Implementierungen, damit andere Plattformen weiter kompilieren).
   - `FabricPlayer.update` befüllt die neuen Felder; Teleport-Erkennung (Positionssprung oder Weltwechsel) → `epoch++`.
   - `FabricMod.updateSomePlayers` sampelt konfigurierbar (z. B. alle 5 Ticks alle Spieler statt alle 20 Ticks).
   - `LivePlayersDataSupplier` schreibt `protocol`, `serverTime` und die neuen Felder; `MapRequestHandler` nutzt das konfigurierbare Intervall.
   - Optional sofort: `AFTER_RESPAWN` und `AFTER_PLAYER_CHANGE_WORLD` → sofortiges Update + `epoch++`.
2. **Webclient:**
   - `PlayerMarker` erhält ein 3D-`Group` in der vorhandenen Marker-Szene (Platzhalter: zwei Boxen für Körper und Kopf, Kopf mit Pitch/Yaw, Körper mit BodyYaw). Der bestehende CSS2D-Kopf und der Name bleiben.
   - Snapshot-Interpolation mit `serverTime`; harter Sprung bei `epoch`-Wechsel oder `foreign`-Wechsel.
   - `redraw()` nur, solange sichtbare Spieler sich bewegen.
   - Polling-Intervall aus den Daten bzw. Einstellungen statt fest 1000 ms.
3. **Tests:**
   - JUnit (`common`): JSON-Format (alte Felder unverändert vorhanden), Teleport/Epoch-Logik als reine Funktion, Filter greifen weiterhin.
   - Build: `./gradlew :fabric:build` (inkl. `buildWebapp`).
   - Laufzeit (manuell, 1.21.1-Fabric-Server + Vanilla-Client ohne Mod): Join, Leave, Bewegung, Drehen auf der Stelle, `/tp`, Respawn, Netherportal, Reconnect, zwei Spieler gleichzeitig; Regression: Karte, Texturen, Navigation, Marker, `live-player-markers: false`, Webserver aus und Live-Endpunkt nicht erreichbar.

Abnahmekriterium Phase 2: Ein Platzhalter-3D-Objekt bewegt sich in der **originalen** BlueMap-Szene, wird von Terrain verdeckt, springt bei `/tp`, verschwindet bei Disconnect und Weltwechsel. Ausdrücklich **noch kein** fertiges Spielermodell.

### Phase 3 – echtes Modell
Geteilte Geometrie (classic/slim, Overlay-Layer), Skin-Speicherung `assets/playerskins/`, Material mit Kartenlichtformel, Gliedmaßen-Hierarchie, Animationen nach 5.3, LOD und Ausblenden, Test mit realen Skins (64×64, Legacy 64×32, slim, transparent).

### Phase 4 – Live-Blockänderungen Stufe 1
Mixin + `bluemap.mixins.json`, `DirtyChunkTracker` (Server-Thread), `LiveChunkOverlay` (core), `LiveTilesRenderTask` (common/rendermanager), `TileChangeLog` + `live/tiles.json`, `TileManager.reloadTile` (webapp); Tests für Overlay-Ablauf, Change-Log/Reset und Tile-Grenzen; Laufzeittests Piston, TNT, `/fill`, Reconnect, Server-Neustart.

### Phase 5 / 6
Messen, Zusammenfassen, Priorisieren, optional Lowres-Live-Update und Push-Kanal; Doku (Installation 1.21.1 Fabric, Konfiguration, Grenzen), Abschlussbericht mit Statusmatrix (Geplant/Implementiert/Gebaut/Getestet/Verifiziert).

---

## Ausgeführte Befehle (Phase 1)

| Befehl | Ergebnis |
|---|---|
| `git clone --depth 200 https://github.com/BlueMap-Minecraft/bluemap` | ok |
| `git fetch --depth 100 origin mc1.21.1 feat/events` | ok |
| `git checkout -b bluemap-live mc1.21.1` | ok |
| GitHub-Issue #95 (Web) | gelesen, Status offen |
| `./gradlew :fabric:build --no-daemon` (mehrfach, auch `--max-workers=1`) | **fehlgeschlagen**: HTTP 429 von Maven Central in `:buildSrc`; danach Abbruch, weil `maven.fabricmc.net`, `libraries.minecraft.net`, `piston-meta.mojang.com`, `repo.bluecolored.de` vom Proxy abgewiesen werden (`curl` → 403/000) |
| `npm ci && npm run build` (`common/webapp`) | **erfolgreich** (`✓ built in 4.01s`, nur die bekannte Chunk-Size-Warnung) |
| Tests | **nicht ausgeführt** (Java-Build nicht möglich; Webapp hat keine Tests) |
