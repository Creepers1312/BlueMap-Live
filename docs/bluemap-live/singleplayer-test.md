# BlueMap Live – Test in einer Einzelspielerwelt (Minecraft 1.21.1, Fabric)

Stand: 2026-10-15 · Branch `bluemap-live` · Commit `cc4a7e2`

> **Status:** Die Unterstützung des integrierten Servers ergibt sich aus der Code-Analyse (siehe §1). Sie ist **nicht** in einem echten Minecraft-Client getestet; in dieser Umgebung gibt es weder Minecraft noch Zugriff auf die Mojang- und Fabric-Server. Alle Prüfpunkte in §6 sind **offen**.

---

## 1. Funktioniert BlueMap Live in Einzelspieler?

**Ja, laut Code ohne Architekturänderung.** Belege **[geprüft im Code]**:

| Punkt | Befund |
|---|---|
| Mod wird im Client geladen | `fabric.mod.json`: `"environment": "*"`, Entrypoint `main` → `FabricMod` wird auch im Spiel-Client initialisiert |
| Start mit der Welt | `FabricMod` registriert `ServerLifecycleEvents.SERVER_STARTED` / `SERVER_STOPPING`. Diese Fabric-Events gelten für jeden `MinecraftServer`, also auch für den **integrierten Server**, den der Client beim Öffnen einer Einzelspielerwelt startet. Beim Verlassen der Welt wird BlueMap entladen, beim Öffnen der nächsten Welt neu geladen. |
| Spieler | `ServerPlayConnectionEvents.JOIN/DISCONNECT`, `ServerTickEvents.END_SERVER_TICK` → Live-Spielerdaten wie auf einem Server |
| Welt-Ordner | `FabricWorld`: `server.getRunDirectory().resolve(server.getSavePath(ROOT))` → beim integrierten Server `.minecraft/saves/<Weltname>` |
| Webserver und Renderer | derselbe integrierte BlueMap-Webserver (`HttpServer`) und Renderer; kein zweiter Webserver, keine Änderung nötig |
| Befehle | `/bluemap …` über Brigadier; Berechtigung `hasPermissionLevel(1)` (bzw. fabric-permissions) → in Einzelspieler nur mit **Cheats erlaubt** |

**Integrierter vs. dedizierter Server**

| | Integrierter Server (Einzelspieler) | Dedizierter Server |
|---|---|---|
| Wo läuft BlueMap | im Spiel-Client (`.minecraft/mods`) | im Server (`mods/` des Servers) |
| Konfiguration | `.minecraft/config/bluemap/` | `<server>/config/bluemap/` |
| Daten / Web-Dateien | `.minecraft/bluemap/` | `<server>/bluemap/` |
| Webserver-Bindung ohne `ip` in `webserver.conf` | **neu: nur `127.0.0.1`** (siehe §2) | alle Netzwerkschnittstellen (unverändert) |
| URL | `http://127.0.0.1:8100/` | `http://<server-ip>:8100/` |
| Läuft nur, solange … | die Welt geöffnet ist; im **Pausenmenü (ESC) tickt der integrierte Server nicht**, die Live-Daten bleiben stehen | der Server läuft |

**Bekannte Einschränkungen in Einzelspieler [geprüft im Code]**

- **Kartenkonfiguration nur für die zuerst geöffnete Welt:** `BlueMapConfigManager.loadMapConfigs` legt `config/bluemap/maps/*.conf` nur an, wenn der Ordner `maps/` noch **nicht** existiert, und nur für die Welt, die dabei geöffnet ist (Map-IDs aus dem Weltordner, z. B. `new_world`, `new_world_the_nether`, `new_world_the_end`). Wer danach eine **andere** Welt öffnet, sieht weiter die Karten der ersten Welt, und Spieler gelten dort als „foreign“ (ausgeblendet). Abhilfe: vor dem Öffnen der anderen Welt `config/bluemap/maps/` löschen (oder die `world:`-Pfade anpassen) und `/bluemap reload`.
- **Kein Live-Rendering von Blöcken:** Blockänderungen erscheinen wie in BlueMap üblich erst, nachdem Minecraft die Chunks gespeichert hat und BlueMap die Region neu rendert. In Einzelspieler speichert das Spiel unter anderem beim **Öffnen des Pausenmenüs**. Live-Blockupdates sind nicht Teil dieses Stands.
- **Rechenzeit:** Die Render-Threads laufen im selben Prozess wie das Spiel. Falls das Spiel ruckelt, `render-thread-count` in `core.conf` verringern.

---

## 2. Änderung in diesem Schritt: lokale Bindung in Einzelspieler

Bisher band der BlueMap-Webserver ohne `ip`-Eintrag an **alle** Netzwerkschnittstellen (`0.0.0.0`). Die Karte einer Einzelspielerwelt war damit im ganzen lokalen Netz erreichbar.

Kleinste sichere Änderung (Commit `cc4a7e2`):

- `WebserverConfig.ip` ist jetzt `null`, wenn nichts konfiguriert ist. `resolveBindAddress(integratedServer)` liefert in diesem Fall
  - auf dem **integrierten Server** `127.0.0.1`,
  - sonst wie bisher alle Schnittstellen.
- Eine **explizit gesetzte** `ip` gilt immer; `"0.0.0.0"` macht die Einzelspieler-Karte wieder im Netz erreichbar.
- `Server#isIntegratedServer()` (Standard `false`, also unverändertes Verhalten für Paper, Spigot, Sponge, Forge und NeoForge); `FabricMod` liefert `!server.isDedicated()` (Yarn `MinecraftServer#isDedicated`, in 1.21.1 vorhanden).
- `webserver.conf`-Vorlage dokumentiert `#ip: "127.0.0.1"` (auskommentiert).
- Test: `WebserverConfigTest` (lokal 2/2, im CI grün).

Für dedizierte Server ändert sich nichts.

---

## 3. Benötigtes JAR

**CI-Lauf:** Workflow „CI“, **Push**-Lauf auf `cc4a7e2` (enthält die Bind-Änderung): <https://github.com/Creepers1312/BlueMap-Live/actions/runs/38772068598>, Build- und Test-Job erfolgreich.

**Artefakt:** `artifacts` (ID 11991189023, 41 155 545 Bytes, gültig bis 2027-01-13). Es enthält den Inhalt von `build/release/`, also die JARs **aller** Plattformen.

**Davon wird genau ein JAR benötigt: das mit der Endung `-fabric.jar`.**

- Name laut Build-Skript: `bluemap-${version}-fabric.jar` (`bluemap.implementation.gradle.kts`, Task `release`).
- **Erwarteter** Name: **`bluemap-0.0-bluemap-live-fabric.jar`**.
  - Herleitung: `versioning.kt` ergibt ohne Git-Tags `0.0`, plus `-bluemap-live` für den ausgecheckten Branch; das Repository hat keine Tags.
  - Die Git-Befehle aus `versioning.kt` habe ich in einem frischen Klon von `Creepers1312/BlueMap-Live` nachvollzogen.
  - **[Annahme]** `actions/checkout` legt beim Push-Lauf einen lokalen Branch `bluemap-live` an. Im PR-Lauf (losgelöster Merge-Commit) heißt dasselbe JAR deshalb vermutlich `bluemap-0.0-fabric.jar`.
- **Nicht geprüft:** Das Artefakt selbst konnte ich **nicht** herunterladen, Inhalt und genauer Dateiname sind **unbestätigt**. GitHub leitet Artefakte und Job-Protokolle nach `*.blob.core.windows.net` um, und das blockiert der Proxy dieser Umgebung („Forbidden“).

**Nicht verwenden:** die JARs für `cli`, `forge`, `neoforge`, `paper`, `spigot`, `sponge`.

---

## 4. Installation und Start (Einzelspieler)

Voraussetzungen:
- Minecraft Java Edition **1.21.1**
- **Fabric Loader ≥ 0.17.2** (`fabric.mod.json` verlangt `fabricloader >= 0.17.2`)
- **Fabric API** für 1.21.1
- Java 21 (bringt der Minecraft-Launcher für 1.21.1 mit)

1. Fabric Loader für 1.21.1 mit dem Fabric-Installer installieren und das Profil „fabric-loader-…-1.21.1“ einmal starten.
2. Im CI-Lauf (§3) das Artefakt „artifacts“ herunterladen (Download nur angemeldet möglich), entpacken und **nur** das `…-fabric.jar` nach `.minecraft/mods/` kopieren.
3. Fabric API (1.21.1) ebenfalls nach `.minecraft/mods/`.
4. Minecraft mit dem Fabric-Profil starten, eine Einzelspielerwelt **mit „Cheats erlauben: An“** erstellen oder öffnen. Bei einer bestehenden Welt geht auch „Für LAN öffnen“ mit Cheats, dann aber nicht im Netz freigeben.
5. Beim ersten Start meldet BlueMap fehlende Ressourcen (§5). Spiel offen lassen und `.minecraft/config/bluemap/core.conf` bearbeiten:
   - `accept-download: true`. Damit bestätigst du die Minecraft-EULA, und BlueMap lädt die Client-Ressourcen von Mojang herunter.
   - **Empfohlen:** `metrics: false`. Standardmäßig schickt BlueMap eine kurze Meldung (Plattform, Version, MC-Version) an `https://metrics.bluecolored.de/bluemap/`, den Server des BlueMap-Autors. Für einen privaten Test sinnvoll abzuschalten.
6. Im Spiel `/bluemap reload` ausführen.
7. Mit `/bluemap status` prüfen, bis die Render-Aufgaben fertig sind; zwischendurch einmal **ESC** drücken, damit das Spiel die Chunks speichert.
8. Im Browser auf **demselben Rechner** öffnen: **<http://127.0.0.1:8100/>**

Optional für den Live-Spieler:
- `.minecraft/config/bluemap/plugin.conf`: `live-player-markers: true`, `live-player-update-interval: 250`, `live-player-extended-data: true`, `skin-download: true`. Das sind die Standardwerte.
- **Wichtig:** `hidden-game-modes` enthält standardmäßig `"spectator"`; im Zuschauermodus ist der Spieler auf der Karte unsichtbar.

---

## 5. Erwartete Logmeldungen (`.minecraft/logs/latest.log`)

Die Texte stammen aus dem Code (`FabricMod`, `Plugin`, `http/Server`); das Präfix des Loggers kann abweichen.

Erster Start (ohne `accept-download`):
```
Loading BlueMap...
BlueMap is missing important resources!
You must accept the required file download in order for BlueMap to work!
Please check: <…>/.minecraft/config/bluemap/core.conf
If you have changed the config you can simply reload the plugin using: /bluemap reload
```

Nach `accept-download: true` und `/bluemap reload`:
```
Loading map 'new_world'...            (je Karte; ID abhängig vom Weltordner)
WebServer bound to: /127.0.0.1:8100   (neu: nur lokal)
WebServer started.
BlueMap loaded!
```
Mit explizit gesetztem `ip: "0.0.0.0"` erscheint stattdessen `WebServer bound to all network interfaces on port 8100`.

Beim Verlassen der Welt: `BlueMap unloaded!`

---

## 6. Manuelle Prüfungen (alle **offen**)

| # | Prüfung | Erwartung |
|---|---|---|
| E1 | Welt öffnen, Log prüfen | Meldungen wie in §5, `bound to: /127.0.0.1:8100` |
| E2 | `http://127.0.0.1:8100/` im Browser | Originale BlueMap-Oberfläche, Karte der Welt (nach dem Rendern) |
| E3 | von einem anderen Gerät im Netz `http://<PC-IP>:8100/` | **nicht** erreichbar |
| E4 | Spieler auf der Karte | 3D-Spielermodell mit eigenem Skin (bei Mojang-Account und `skin-download: true`), Kopf- und Namensmarker |
| E5 | Laufen, Drehen, Kopf heben/senken | Modell folgt flüssig (≈ 250 ms), keine Animation der Gliedmaßen (noch nicht umgesetzt) |
| E6 | `/tp @s ~200 ~ ~` | Modell springt, kein Flug über die Karte |
| E7 | Netherportal oder `/execute in minecraft:the_nether run tp @s 0 100 0` | Spieler verschwindet auf der Overworld-Karte, erscheint auf der Nether-Karte |
| E8 | Sterben und Respawn | Sprung zum Spawnpunkt |
| E9 | ESC (Pause) | Live-Position bleibt stehen (integrierter Server tickt nicht), Karte bleibt nutzbar |
| E10 | Welt verlassen | Spieler verschwindet; Karte ist nicht mehr erreichbar (Webserver gestoppt) |
| E11 | zweite, andere Welt öffnen | Karten der ersten Welt werden weiter angezeigt (Einschränkung §1); nach Löschen von `config/bluemap/maps/` und `/bluemap reload` Karten der neuen Welt |
| E12 | Slim-Skin-Account (falls vorhanden) | Arme 3 px breit |
| E13 | `skin-download: false`, Welt neu öffnen | keine Skin-Downloads; bereits gespeicherte Skins weiter sichtbar |
| E14 | Navigation, Texturen, Marker, „Spieler folgen“ | unverändert wie im originalen BlueMap |

Diese Liste ergänzt die Server-Tests M1–M16 (`phase-2.md`) und S1–S5 (`phase-3.md`).

---

## 7. Fehlersuche

| Symptom | Ursache / Lösung |
|---|---|
| Keine BlueMap-Meldungen im Log | JAR nicht in `.minecraft/mods/` oder falsches JAR (nicht `-fabric.jar`); Fabric API fehlt; falsches Profil (nicht Fabric 1.21.1) |
| `BlueMap failed to bind to the configured address.` / `This usually happens when the configured port (8100) is already in use by some other program.` | Anderes Programm (oder ein zweiter Minecraft-Client) nutzt Port 8100 → in `webserver.conf` `port` ändern und `/bluemap reload` |
| Browser: Seite nicht erreichbar | Welt nicht geöffnet bzw. im Hauptmenü (Webserver läuft nur mit offener Welt); URL `127.0.0.1` statt `localhost` probieren; vom **selben** Rechner öffnen |
| Von Handy/anderem PC nicht erreichbar | so gewollt (§2); bei Bedarf `ip: "0.0.0.0"` in `webserver.conf` setzen (die Karte ist dann im Netz sichtbar) |
| `/bluemap` „Unknown command“ / keine Rechte | Cheats sind aus → Welt mit Cheats erstellen oder „Für LAN öffnen“ mit „Cheats erlauben“ |
| Karte leer / schwarz | Noch nicht gerendert → `/bluemap status`; ESC drücken (Chunks speichern); `accept-download` nicht gesetzt (Log §5) |
| Falsche Welt auf der Karte | Kartenkonfiguration der zuerst geöffneten Welt (§1) → `config/bluemap/maps/` löschen, `/bluemap reload` |
| Kein Spieler auf der Karte | Zuschauermodus (`hidden-game-modes`), unsichtbar (Trank), andere Dimension als die angezeigte Karte, `live-player-markers: false` |
| Spieler als graues bzw. Standard-Modell | Skin konnte nicht geladen werden (Offline-Launcher ohne Mojang-Profil, `skin-download: false`, kein Internet) → Standard-Skin aus dem Resource-Pack, kein Fehler |
| Kein 3D-Modell, nur Kopf | Weder Spieler-Skin noch Standard-Skin verfügbar; prüfen, ob `maps/<id>/textures.json` `minecraft:entity/player/slim/steve` enthält (offener Prüfpunkt S5) |
| Spiel ruckelt beim Rendern | `render-thread-count` in `core.conf` verringern |

---

## 8. Automatisierte Tests zu diesem Stand

| Test | Ergebnis |
|---|---|
| GitHub Actions auf `cc4a7e2`: `spotlessCheck test`, `release` | erfolgreich (Push- und PR-Lauf) |
| Lokal JUnit ohne Gradle (`live`, `skins`, `WebserverConfigTest`) | 37/37 |
| `npm test` | 30/30 |
| ESLint auf allen geänderten/neuen JS-Dateien | ok. Auf ganz `src/js` gibt es 3 Befunde in unveränderten Original-Dateien (`PopupMarker.js`, `PRBMLoader.js`, `Utils.js`), identisch auf `mc1.21.1`, nicht angefasst. |
| `npm run build` | ok |
| Browser-E2E `player-e2e.mjs` | 22/22 |
| **Echter Minecraft-Client/-Server, echte Mojang-Skins** | **nicht ausgeführt** (keine Minecraft-Umgebung; `piston-meta.mojang.com`, `libraries.minecraft.net`, `maven.fabricmc.net`, `sessionserver.mojang.com` nicht erreichbar) |
