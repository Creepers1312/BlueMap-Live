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

Voraussetzungen: JDK 21, Node 22, Playwright (global oder lokal) mit Chromium, die Jars `flow-math-1.0.3`, `gson-2.8.9`, `annotations-23.0.0`.

```bash
# 1. Webclient bauen
(cd common/webapp && npm ci && npm run build)

# 2. Testserver kompilieren (nutzt die Quellen aus core/ und common/ direkt)
CP=flow-math-1.0.3.jar:gson-2.8.9.jar:annotations-23.0.0.jar
javac --release 21 -d out-e2e -cp $CP -sourcepath core/src/main/java:common/src/main/java \
      -implicit:class docs/bluemap-live/e2e/LiveE2EServer.java

# 3. Server starten (neu starten vor jedem Testlauf, der Spielerzustand liegt im Speicher)
java -cp out-e2e:$CP LiveE2EServer common/webapp/dist 8100 &

# 4. Test
PLAYWRIGHT_MODULE=/pfad/zu/node_modules/playwright E2E_OUT=e2e-out node docs/bluemap-live/e2e/player-e2e.mjs

# 5. Kartenwechsel (Overworld/Nether) und Animationen – Server vorher neu starten
PLAYWRIGHT_MODULE=/pfad/zu/node_modules/playwright node docs/bluemap-live/e2e/animation-e2e.mjs
```

Steuerparameter von `/control` für die Animationen: `sneaking=1`, `sprinting=1`, `ground=0`, `swimming=1`, `flying=1`, `fallFlying=1`, `vx`/`vy`/`vz` (Geschwindigkeit statt der aus den Abtastungen abgeleiteten) und `swing=right|left` (erhöht den Armschwung-Zähler).

Regressionsvergleich: Den Original-Webclient (`git archive mc1.21.1 common/webapp`) separat bauen, einen zweiten Server auf Port 8101 mit dessen `dist` starten und dann Folgendes ausführen:

```bash
E2E_BASES="http://127.0.0.1:8101,http://127.0.0.1:8100" node docs/bluemap-live/e2e/regression-e2e.mjs
```

Anschließend `e2e-out/regression-0.png` und `regression-1.png` vergleichen (z. B. mit Pillow `ImageChops.difference`).

Hinweis: Die Kamera wird über die normale Seitenadresse gesetzt (`#world:x:y:z:distance:rotation:angle:tilt:ortho:view`). Ein direktes Setzen von `controlsManager.distance` wird von den Map-Controls überschrieben. Dann werden keine Hires-Tiles geladen; das gilt für das Original genauso.
