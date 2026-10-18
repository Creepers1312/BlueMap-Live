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

**Fahrzeuge (Phase 8):** Spieler: `&riding=1&vehicle=ID&vox=..&voy=..&voz=..&vbody=..&vhead=..` (Versatz und Drehungen relativ zur Fahrzeugdrehung). Boote und Loren als Mob: `&entity=ID&mob=1&type=minecraft:boat&variant=oak&flags=paddle_left,paddle_right`; Platzhaltertexturen `entity/boat/oak` und `entity/minecart`. Leine an Mob/Boot: `&leash=ENTITY_ID` oder `&leashPlayer=UUID`, Enden `&lsx/lsy/lsz` (Entity) und `&lex/ley/lez` (Halter); Knoten als Mob `minecraft:leash_knot`. Dynamisches Licht eines Spielers: `&light=0..15`.

**Wiedergabepuffer (Phase 9):** `playback-e2e.mjs` hält die Antworten von `players.json` zufällig 0 bis 350 ms zurück und misst die Stillstände eines gleichmäßig laufenden Spielers mit und ohne Puffer. Die übrigen Suiten schalten den Puffer zu Beginn aus (`setLivePlaybackDelay(0)`). Jede Suite braucht einen frisch gestarteten Server.

**Partikel und Effekte (Phase 10):** `particles-e2e.mjs`. Effekte: `/control?effect=explosion|splash|instant_splash&x=..&y=..&z=..&power=..&destroy=1&color=RRGGBB`. Partikel einer Entity oder eines Spielers: `&fire=1&swirls=AARRGGBB,..&ambient=1&cloud=RADIUS,AARRGGBB[,waiting]` (Wolke als `type=minecraft:area_effect_cloud` ohne `mob`). Die Partikeltexturen sind weiß (die Partikelfarbe wird multipliziert), das Feuer ist orange (32 Animationsbilder).

**Blockänderungen und Truhen (Phase 11):** `blocks-e2e.mjs`. Neu gerenderte Kachel: `/control?tileUpdate=X,Z[&lowres=1][&pillar=HÖHE]` (die Testkachel bekommt eine Säule dieser Höhe). Lowres-Testkacheln (leere Bilder) nur nach `/control?lowresTiles=1`. Offene Truhe: `/control?container=X,Y,Z&texture=minecraft:entity/chest/normal&facing=south&part=single|left|right`, schließen mit `/control?closeContainer=X,Y,Z`.
Blockänderung (Sofort-Vorschau): `/control?block=X,Y,Z&state=minecraft:stone[&n=unten,oben,norden,süden,westen,osten]` („-“ für Luft). Die Blockmodelle werden für die Zustände der Änderungen gebacken (Testressourcen: `minecraft:stone`, `minecraft:grass_block`, ohne Cullfaces). Bestätigung: `/control?tileUpdate=0,0&chunks=0,0,now` (Chunk-Zeit nach der Änderung) oder eine feste ältere Zeit in Sekunden.

**Anzeige-Einstellungen (Phase 12):** `display-e2e.mjs` prüft die Gruppe „Entities und Effekte“ (Abstand zu den Spielern und zur Kamera, Partikel, Vorschau, Speichern). Der Testserver sendet `radius: 30`.

## Phase 13: Komfort und Live-Wetter (`qol-e2e.mjs`)

```bash
PLAYWRIGHT_MODULE=/pfad/zu/node_modules/playwright E2E_OUT=e2e-out node docs/bluemap-live/e2e/qol-e2e.mjs
```

Zusätzliche Steuerparameter des Testservers:
- Mobs: `&group=monster&health=..&maxHealth=..&mobName=..` (Spawn-Gruppe, Lebenspunkte, Name)
- Spieler: `&health=..&maxHealth=..&precipitation=rain|snow|none`
- Weltzeit: `&moonPhase=0..7`

`E2EItemResources` liefert dazu Testtexturen für Himmel und Wetter: gelbe Sonne, eine Farbe pro Mondphase (Phase 2 blau), karierte Wolken, blaue Regenstreifen, weiße Schneeflocken.


## Leistungsmessung (`perf-stress.mjs`)

Kein Test mit Bestanden/Fehlgeschlagen, sondern eine Messung: eine Stress-Szene (20 Spieler, 120 Mobs, 60 Gegenstände, 30 Block-Vorschauen, Regen, Lebensbalken) gegen den Testserver. Ausgegeben wird die JS-Zeit der Render-Funktion pro Bild (Median, 90 %), dazu `<out>.cpuprofile` für die Chrome-DevTools. Für lesbare Funktionsnamen die Webapp mit `npx vite build --minify false` bauen.

```bash
node docs/bluemap-live/e2e/perf-stress.mjs e2e-out/perf
```
