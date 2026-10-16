# BlueMap Live – Browser-E2E-Test (Phase 2)

Diese Dateien gehören **nicht** zum BlueMap-Build. Sie prüfen den Live-Spieler-Datenfluss im **originalen, gebauten Webclient** (`common/webapp/dist`) in einem echten Browser (Chromium über Playwright).

| Datei | Zweck |
|---|---|
| `LiveE2EServer.java` | Kleiner Test-Webserver. Liefert den gebauten Webclient aus, dazu eine Testkarte, deren Hires-Tile mit BlueMaps eigenem `ArrayTileModel` + `PRBMWriter` erzeugt wird, und `live/players.json` aus BlueMaps eigenem `PlayerMotionTracker` + `LivePlayersJson`. Diese Klassen nutzt auch der Fabric-Server. Jeder `/control`-Aufruf entspricht einem Server-Sample (`FabricPlayer.update()`). |
| `player-e2e.mjs` | Testablauf: Beitritt, Bewegung, Drehen, Kopf ≠ Körper, Teleport, Verdeckung, Dimensionswechsel, Respawn, veraltete Antwort, Disconnect, keine Tile-Reloads, Live-Endpunkt nicht erreichbar, keine Seitenfehler, Nahaufnahme |
| `regression-e2e.mjs` | Rendert dieselbe Testkarte mit derselben Kamera in zwei Webclient-Builds (z. B. Original `mc1.21.1` und `bluemap-live`) ohne Spieler. Die Screenshots werden anschließend pixelweise verglichen. |
| `screenshots/` | Screenshots aus dem Lauf vom 2026-10-15 |

**Was dieser Test nicht abdeckt:** den Fabric-Teil (`FabricMod`, `FabricPlayer`, Fabric-Events) und den echten BlueMap-Webserver (`MapRequestHandler`, `CachedRateLimitDataSupplier`). Diese sind ohne Minecraft-Server nicht ausführbar; siehe den manuellen Test in `../phase-2.md`.

## Ausführen

Voraussetzungen: JDK 21, Node 22, Playwright (global oder lokal) mit Chromium. Seit den Item-Assets (Phase 4) nutzt der Testserver den echten `ItemModelBaker` und damit BlueMaps `core`. Deshalb werden die BlueMap-API und `core` (ohne SQL-Speicher) mitkompiliert. Benötigte Jars:
- flow-math 1.0.3
- gson 2.8.9
- annotations 23.0.0
- caffeine 3.1.8
- configurate-core/-gson 4.1.2
- lz4-java 1.8.0
- aircompressor 0.27
- commons-dbcp2 2.9.0
- checker-qual 3.33.0
- lombok 1.18.32 als Annotation-Prozessor
- BlueNBT 3.5.0, aus dem Quelltext von `BlueMap-Minecraft/BlueNBT` (Tag `v3.5.0`) kompiliert

```bash
# 1. Webclient bauen
(cd common/webapp && npm ci && npm run build)

# 2. API + core kompilieren, dann den Testserver (nutzt die Quellen aus common/ direkt)
CP=$(ls libs/*.jar | tr '\n' ':')
javac --release 21 -d out-core -cp $CP -processorpath libs/lombok-1.18.32.jar \
      $(find api/src/main/java core/src/main/java -name "*.java" | grep -v "/storage/sql/")
javac --release 21 -d out-e2e -cp out-core:$CP -processorpath libs/lombok-1.18.32.jar \
      -sourcepath common/src/main/java -implicit:class \
      docs/bluemap-live/e2e/LiveE2EServer.java docs/bluemap-live/e2e/E2EItemResources.java \
      common/src/main/java/de/bluecolored/bluemap/common/plugin/items/ItemModelBaker.java \
      common/src/main/java/de/bluecolored/bluemap/common/live/LiveEntitiesJson.java
CP=out-core:$CP

# 3. Server starten (neu starten vor jedem Testlauf, der Spielerzustand liegt im Speicher)
java -cp out-e2e:$CP LiveE2EServer common/webapp/dist 8100 &

# 4. Test
PLAYWRIGHT_MODULE=/pfad/zu/node_modules/playwright E2E_OUT=e2e-out node docs/bluemap-live/e2e/player-e2e.mjs

# 5. Kartenwechsel (Overworld/Nether) und Animationen – Server vorher neu starten
PLAYWRIGHT_MODULE=/pfad/zu/node_modules/playwright node docs/bluemap-live/e2e/animation-e2e.mjs

# 6. Gehaltene Items und Item-Animationen – Server vorher neu starten
PLAYWRIGHT_MODULE=/pfad/zu/node_modules/playwright E2E_OUT=e2e-out node docs/bluemap-live/e2e/items-e2e.mjs

# 7. Entities (Gegenstände am Boden, Wurfgegenstände, Pfeile) – Server vorher neu starten
PLAYWRIGHT_MODULE=/pfad/zu/node_modules/playwright E2E_OUT=e2e-out node docs/bluemap-live/e2e/entities-e2e.mjs

# 8. Mobs (Vanilla-Modelle, Animationen, Platzhalter) – Server vorher neu starten
PLAYWRIGHT_MODULE=/pfad/zu/node_modules/playwright E2E_OUT=e2e-out node docs/bluemap-live/e2e/mobs-e2e.mjs

# 9. Tag-Nacht-Zyklus der Welt (Phase 8) – Server vorher neu starten
PLAYWRIGHT_MODULE=/pfad/zu/node_modules/playwright E2E_OUT=e2e-out node docs/bluemap-live/e2e/worldtime-e2e.mjs
```

Weltzeit der Testkarte: `/control?dayTime=TICKS&rain=0..1&thunder=0..1&cycle=0|1`, `dayTime=none` entfernt sie.

Für Schritt 2 werden außerdem `MobTextures.java`, `LiveEntityState.java`, `LiveMobState.java`, `LivePlayerState.java`, `LivePlayersJson.java` und `LiveWorldTime.java` aus `common/src/main/java/.../live` bzw. `.../plugin/items` mitkompiliert. Sie werden explizit angegeben, weil Lombok für implizit kompilierte Quellen nicht läuft.

Für `entities-e2e.mjs` liefert der Server `maps/world/live/entities.json`; die Nether-Karte ist leer. Steuerung:
- `/control?entity=ID&type=minecraft:item&x=..&y=..&z=..&item=minecraft:diamond&vx=..&vy=..&vz=..&yaw=..&pitch=..&ground=1`
- `/control?removeEntity=ID`
- Mobs (`mobs-e2e.mjs`): zusätzlich `mob=1&bodyYaw=..&headYaw=..&hurt=TICKS&death=TICKS&baby=1&variant=..&size=..&flags=a,b&main=ITEM&left=1&w=..&h=..&swing=TICKS&attack=TICKS&head=ITEM`. Die Mob-Texturen des Test-Packs sind einfarbig (Zombie, Kuh, Schaf, weiße Wolle, Dorfbewohner, Beruf nur auf der oberen Hälfte).

Für `items-e2e.mjs` liefert der Server `maps/<id>/assets/items/<ns>/<pfad>.json`. Die Dateien erzeugt der echte `ItemModelBaker` aus einem kleinen, farbcodierten Resource-Pack (`E2EItemResources.java`, Modell-JSONs in der Struktur der Vanilla-Modelle). Weitere Steuerparameter:
- `main=`/`off=` mit einer Item-ID oder `none` (bleibt gesetzt)
- `leftHanded=1`, `charged=1`
- `use=main|off&useAction=bow&useTicks=12` (nur für diese Abtastung)
- `swingKind=attack|mine|use|swing`
- `/control?itemsDown=1|0`: Item-Assets mit 404 beantworten

Steuerparameter von `/control` für die Animationen: `sneaking=1`, `sprinting=1`, `ground=0`, `swimming=1`, `flying=1`, `fallFlying=1`, `vx`/`vy`/`vz` (Geschwindigkeit statt der aus den Abtastungen abgeleiteten) und `swing=right|left` (erhöht den Armschwung-Zähler).

Regressionsvergleich: Den Original-Webclient (`git archive mc1.21.1 common/webapp`) separat bauen, einen zweiten Server auf Port 8101 mit dessen `dist` starten und dann Folgendes ausführen:

```bash
E2E_BASES="http://127.0.0.1:8101,http://127.0.0.1:8100" node docs/bluemap-live/e2e/regression-e2e.mjs
```

Anschließend `e2e-out/regression-0.png` und `regression-1.png` vergleichen (z. B. mit Pillow `ImageChops.difference`).

Hinweis: Die Kamera wird über die normale Seitenadresse gesetzt (`#world:x:y:z:distance:rotation:angle:tilt:ortho:view`). Ein direktes Setzen von `controlsManager.distance` wird von den Map-Controls überschrieben. Dann werden keine Hires-Tiles geladen; das gilt für das Original genauso.
