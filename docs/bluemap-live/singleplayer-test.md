# BlueMap Live – Test in einer Einzelspielerwelt (Minecraft 1.21.1, Fabric)

Stand: 2026-10-15 · Branch `bluemap-live` · Commit `8d33402`

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

**CI-Lauf:** Workflow „CI“, **Push**-Lauf auf `8d33402` (enthält die lokale Bindung aus `cc4a7e2` und den deaktivierten Metrics-Standard): <https://github.com/Creepers1312/BlueMap-Live/actions/runs/38774450401>, Build- und Test-Job erfolgreich.

**Artefakt:** `artifacts` (ID 11993121918, 41 155 651 Bytes, gültig bis 2027-01-13). Es enthält den Inhalt von `build/release/`, also die JARs **aller** Plattformen. Ältere Artefakte, z. B. von `cc4a7e2`, enthalten den Metrics-Standard `false` noch nicht.

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
   - `metrics: false` ist in BlueMap Live **Standard** (§9). Prüfen, dass der Eintrag so in der neu erzeugten Datei steht. Eine `core.conf` aus einer früheren BlueMap-Installation wird **nicht** geändert und kann noch `metrics: true` enthalten; dann manuell auf `false` setzen.
6. Im Spiel `/bluemap reload` ausführen.
7. Mit `/bluemap status` prüfen, bis die Render-Aufgaben fertig sind; zwischendurch einmal **ESC** drücken, damit das Spiel die Chunks speichert.
8. Im Browser auf **demselben Rechner** öffnen: **<http://127.0.0.1:8100/>**

**Welche Version läuft? (nach jedem JAR-Wechsel prüfen)**
- **Server-Teil:** Bei offener Welt <http://127.0.0.1:8100/maps/new_world/live/players.json> öffnen (statt `new_world` die Karten-ID). Ab Schritt 4 enthält jeder Spieler `"swing":{…}` und `"state":{…}`. Fehlt `swing`, läuft ein älteres JAR. Fehlt auch `state`, ist zusätzlich `live-player-extended-data: false` gesetzt.
- **Webclient:** In der Browser-Konsole (F12) mit einem Spieler auf der Karte ausführen:
  `!!window.bluemap.playerMarkerManager.getPlayerMarkerSet(false).markers.values().next().value.animator`.
  `true` heißt: Der Webclient mit Animationen ist geladen.
- **Alte Webclient-Dateien:** Bis einschließlich `a529aba5` hat BlueMap den Webclient nur entpackt, wenn `index.html` im Web-Ordner fehlte (Verhalten des Originals). Ein späteres JAR hat dann zwar den neuen Server-Teil verwendet, aber weiter den **alten** Webclient ausgeliefert.
  - Ab dem Folge-Commit wird der Webclient automatisch neu entpackt, wenn er nicht aus dem mitgelieferten Webclient des JARs stammt. Erkannt wird das über einen Hash in `.bluemap-webapp-hash`. Kartendaten (`maps/`) und `settings.json` bleiben erhalten.
  - Für ältere JARs: Die Welt schließen, `index.html` im Web-Ordner löschen (Standard: `bluemap/web/` im Minecraft-Ordner, siehe `webapp.conf`) und die Welt neu öffnen.
  - Danach die Seite einmal mit **Strg+F5** neu laden (Browser-Cache).

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
| E5 | Laufen, Drehen, Kopf heben/senken | Modell folgt flüssig (≈ 250 ms), Gliedmaßen siehe E17–E25 |
| E6 | `/tp @s ~200 ~ ~` | Modell springt, kein Flug über die Karte |
| E7 | Netherportal oder `/execute in minecraft:the_nether run tp @s 0 100 0` | Spieler verschwindet auf der Overworld-Karte, erscheint auf der Nether-Karte (Modell **ohne** Neuladen, siehe E15) |
| E8 | Sterben und Respawn | Sprung zum Spawnpunkt |
| E9 | ESC (Pause) | Live-Position bleibt stehen (integrierter Server tickt nicht), Karte bleibt nutzbar |
| E10 | Welt verlassen | Spieler verschwindet; Karte ist nicht mehr erreichbar (Webserver gestoppt) |
| E11 | zweite, andere Welt öffnen | Karten der ersten Welt werden weiter angezeigt (Einschränkung §1); nach Löschen von `config/bluemap/maps/` und `/bluemap reload` Karten der neuen Welt |
| E12 | Slim-Skin-Account (falls vorhanden) | Arme 3 px breit |
| E13 | `skin-download: false`, Welt neu öffnen | keine Skin-Downloads; bereits gespeicherte Skins weiter sichtbar |
| E14 | Navigation, Texturen, Marker, „Spieler folgen“ | unverändert wie im originalen BlueMap |

**Dimensionswechsel und Animationen (Schritt 4, `phase-3.md` §7, alle offen)**

Vorbereitung: Die Welt mit dem neuen JAR öffnen, die Seite einmal öffnen und danach **nicht mehr neu laden**.

| # | Prüfung | Erwartung |
|---|---|---|
| E15 | Über „Spieler folgen“ in den Nether gehen, dann zurück; dasselbe mit manuellem Kartenwechsel im Menü | Das 3D-Modell erscheint jeweils auf der neuen Karte **ohne** Neuladen (mit eigenem Skin oder Standard-Skin); nur ein Modell, kein doppelter Name |
| E16 | Mehrmals schnell hintereinander durch ein Portal gehen | Ein Modell, keine Fehler in der Browser-Konsole (F12); die Karte bleibt bedienbar |
| E17 | Stillstehen | Arme bewegen sich leicht (Idle), Beine still |
| E18 | Gehen, dann stehen bleiben | Beine und Arme schwingen gegenläufig; nach dem Stehenbleiben laufen sie innerhalb von ≈ 0,5 s aus |
| E19 | Sprinten (Strg/Doppel-W), dann wieder gehen | Etwas schnellere, weitere Schritte als beim Gehen (wie in Minecraft nur geringer Unterschied) |
| E20 | Schleichen (Shift), stehend und gehend | Oberkörper nach vorn geneigt, Kopf tiefer, Beine nach hinten; langsame Schritte; zurück beim Loslassen |
| E21 | Linksklick in die Luft bzw. auf einen Block/Mob; mit Linkshänder-Einstellung (Optionen → Skin-Anpassung → Haupthand links) | Ein Armschwung pro Klick (rechter Arm, bei Linkshänder links); Dauerklick zeigt wiederholte Schwünge |
| E22 | Springen, Herunterfallen von einem Block | In der Luft Arme leicht abgespreizt, beim Fallen stärker; nach der Landung normal |
| E23 | Schwimmen (Sprint unter Wasser), Elytra-Gleiten, Kreativflug | Modell liegt beim Schwimmen/Gleiten waagerecht (Näherung); beim Fliegen keine Sprungpose |
| E24 | Respawn oder `/tp` während des Gehens | Kein Nachschwingen über die Karte, Animation startet neu |
| E25 | Kopf drehen/heben während einer Animation; Kartennavigation, „Spieler folgen“ | Kopf folgt weiter dem Blick; Navigation und Folgen unverändert |

**Gehaltene Items und Item-Animationen (Phase 4, `phase-4.md`)**

Rückmeldung aus Minecraft 1.21.1, Einzelspieler, CI-Artefakt von `b4e64b4c`, belegt mit Screenshots aus dem Webclient:
- Items werden angezeigt und animiert.
- Schwert in der rechten Hand (I1, teilweise).
- Schild in der linken Hand, gehalten und blockend (I3).
- Armbrust mit beidhändiger Pose (I7, teilweise).
- Bogen in der Hand (I6, Spannen nicht gezeigt).

Bestätigt mit dem CI-Artefakt von `1bcc51ee`: I17. Nah ist das Kopfbild ausgeblendet; ab einer bestimmten Entfernung erscheint es wieder.

Ebenfalls bestätigt:
- Die Darstellung ist im direkten Vergleich mit der F5-Ansicht identisch (I1–I3).
- Items in der linken Hand funktionieren (I4).

Noch offen: die Mod-Liste (I18) und die übrigen Prüfungen.

Vorbereitung: Welt mit dem neuen JAR öffnen, die Seite mit Strg+F5 laden. In `players.json` (§4) muss beim Spieler `"equipment"` stehen.

| # | Prüfung | Erwartung |
|---|---|---|
| I1 | Diamantschwert, eiserne Axt, Spitzhacke, Schaufel, Hacke in die Haupthand; Spieler von der Seite und von vorn ansehen | Werkzeug in der rechten Hand, Klinge bzw. Kopf nach vorn und leicht nach oben wie in Minecraft (F5-Ansicht zum Vergleich) |
| I2 | Steinblock, Treppe, Zaun, Fackel, Apfel, Stock | Blöcke als kleine gedrehte Würfel bzw. Modelle, flache Items als 1 px dicke Form mit Kanten |
| I3 | Schild in die Nebenhand, Rechtsklick halten | Schild in der linken Hand; beim Blocken vor dem Körper, Arm angehoben |
| I4 | Optionen → Skin-Anpassung → Haupthand links; Schwert halten | Schwert in der linken Hand, gespiegelt |
| I5 | Itemwechsel mit dem Mausrad, Hand leeren (Q bzw. leerer Slot) | Item wechselt innerhalb von ≈ 0,25 s, Arm geht weich in die Pose; leere Hand ohne Item |
| I6 | Bogen spannen und loslassen | Beide Arme nach vorn, Bogentextur wechselt durch die drei Spannstufen, nach dem Schuss normal |
| I7 | Armbrust laden, geladen halten, schießen | Lade-Pose mit Zugarm; geladen: beide Arme vorn, Armbrust mit Pfeil (mit Feuerwerk: Feuerwerk-Textur) |
| I8 | Dreizack spannen und werfen | Arm über den Kopf; Dreizack als flaches Item (Einschränkung) |
| I9 | Essen und Trinken (Brot, Trank) | Arm zum Mund mit Wippen (Näherung, Vanilla zeigt in F5 keine Pose) |
| I10 | Mob schlagen, Block abbauen (gedrückt halten), Schneeball werfen | Armschwung mit Item; beim Abbauen wiederholte Schwünge. In `players.json` hat `swing.kind` den Wert `attack`, `mine` bzw. `use`. |
| I11 | Fernrohr, Ziegenhorn, Pinsel benutzen | Arm-Posen wie in F5 (Fernrohr bleibt in der Hand, Einschränkung) |
| I12 | Angel auswerfen | Angel mit ausgeworfener Textur |
| I13 | Dimensionswechsel mit Item in der Hand (ohne Neuladen) | Modell und Item erscheinen auf der neuen Karte |
| I14 | Zweiter Spieler (LAN) mit anderem Item | Beide Items unabhängig; nach Verlassen verschwindet das Item |
| I15 | Erstes Halten eines neuen Items | Item erscheint nach höchstens wenigen Sekunden (Asset wird beim ersten Bedarf erzeugt) |
| I16 | Kartennavigation, „Spieler folgen“, Kopf drehen mit Item | unverändert; Item folgt dem Arm, nicht dem Kopf |
| I17 | Nah an den Spieler heranzoomen, dann weit herauszoomen | nah: Kopfbild ausgeblendet, nur der Name; fern: Kopfbild und Name wie bisher |
| I18 | Mod-Liste (Mod Menu) | Name „BlueMap Live“, Beschreibung mit Hinweis auf den inoffiziellen Fork |

**Entities (Release 0.2.0, `phase-5.md`)**

| # | Prüfung | Erwartung |
|---|---|---|
| N1 | Items fallen lassen (Q), in der Nähe auf die Karte schauen | Items liegen schwebend und drehend am Boden; beim Aufheben verschwinden sie **Vom Nutzer bestätigt** (nach dem Fix der Asset-Versionierung: Größe und Drehung stimmen) |
| N2 | Block mit vielen Drops abbauen, Truhe mit Items zerstören | Viele Items gleichzeitig, kein Ruckeln der Karte |
| N3 | Schneebälle, Eier, Enderperle, Wurftrank werfen | Fliegende Gegenstände sind sichtbar und zeigen zur Kamera |
| N4 | Mit dem Bogen schießen, Pfeil im Block stecken lassen | Pfeil sieht aus wie in Minecraft (dünnes Kreuz mit Federn), fliegt flüssig im Bogen und neigt sich im Fallen; steckender Pfeil bleibt mit seiner Neigung · **Vom Nutzer bestätigt** (nach dem Fix der Kollision mit dem Aufprallpunkt vom Server) |
| N9 | Schaden nehmen (Fallschaden, Mob) | Körper 0,5 s rot eingefärbt, das Item in der Hand nicht; Rückstoß sichtbar · **Vom Nutzer bestätigt** |
| N5 | Marker-Menü → „Entities“ ausschalten | Entities verschwinden, Spieler bleiben |
| N6 | Zuschauermodus mit Items in der Nähe | Keine Entities um den versteckten Spieler |
| N7 | `live-entities: false`, `/bluemap reload` | Keine Entities; mit `live-entities-hidden-types: ["minecraft:item"]` nur keine Bodenitems |
| N8 | Dimensionswechsel mit Items in der Nähe (ohne Neuladen) | Auf der neuen Karte die Entities der neuen Dimension |
| N10 | Item am Boden / steckenden Pfeil länger als 30 s beobachten | Kein Flackern oder Neuladen alle 10 s (Fehler aus 0.2.0 behoben) · **Vom Nutzer bestätigt** |

**Mobs (Release 0.3.0, `phase-6.md`)** – der Nutzer meldete nach dem Test „alles passt“; einzeln bestätigt sind O1 und O3

| # | Prüfung | Erwartung |
|---|---|---|
| O1 | Zombie, Skelett, Creeper, Spinne in der Nähe (Nacht oder Spawn-Ei) | Modelle wie im Spiel (Form, Textur, Blickrichtung), laufen mit Bein-Animation, Kopf folgt dem Blick · **Vom Nutzer bestätigt** (Zombies, Skelette) |
| O2 | Zombie/Skelett greift dich an | Zombie hebt die Arme höher; Skelett zielt mit dem Bogen in deine Richtung |
| O3 | Mob schlagen, Mob töten | Mob 0,5 s rot; beim Tod kippt er rot zur Seite (Spinne auf den Rücken) und verschwindet · **Vom Nutzer bestätigt** (rot bei Schaden) |
| O4 | Kuh, Schwein (mit Sattel), Schaf (gefärbt, geschoren), Huhn | Richtige Texturen, Wollfarbe wie im Spiel, geschoren ohne Wolle, Huhn schlägt beim Fallen mit den Flügeln |
| O5 | Babys (Kälber, Babyzombie) | Kleiner, mit größerem Kopf wie im Spiel |
| O6 | Dorfbewohner verschiedener Biome und Berufe | Kleidung von Biom und Beruf, Stufen-Abzeichen |
| O7 | Mob mit Item (Zombie mit Schwert, Skelett mit Bogen, Ertrunkener mit Dreizack) | Item in der richtigen Hand und Lage |
| O8 | Creeper zündet; aufgeladener Creeper (Blitz) | Creeper schwillt an; aufgeladen mit wanderndem Energie-Schimmer |
| O9 | Enderman ansehen (wird wütend), Enderman mit Block | Mund öffnet sich (Kopf nach oben); Arme nach vorn, wenn er einen Block trägt (der Block selbst fehlt noch) |
| O10 | Schleim verschiedener Größen, Eiswanderer, Ertrunkener | Größen stimmen; durchscheinende Schleimhülle; äußere Schicht bei Eiswanderer/Ertrunkenem |
| O11 | Tier ohne Modell in der Webapp (Wolf, Pferd, Allay …) | Durchsichtiger Kasten in Hitbox-Größe mit Namen; dreht sich mit dem Tier |
| O12 | Viele Mobs (Farm, 50+) | Karte bleibt flüssig; höchstens `live-entities-limit` (Standard 200), die nächsten zuerst; mit `live-entities-hidden-types: ["minecraft:zombie"]` keine Zombies |

**Rüstung, Mob-Details, weitere Mobs (`phase-7.md`, alle offen)**

| # | Prüfung | Erwartung |
|---|---|---|
| P1 | Eigene Rüstung anziehen (Eisen, Diamant, Netherit, Gold, Kettenhemd), F5-Vergleich | Gleiche Rüstung am Kartenmodell, folgt Armen und Beinen; nicht rot bei Schaden |
| P2 | Gefärbte Lederrüstung | Farbe wie im Spiel, Überzug ungefärbt |
| P3 | Zombie/Skelett mit Rüstung (natürlich gespawnt oder per Befehl) | Rüstung am Mob, auch bei Baby-Zombies |
| P4 | Mooshroom (rot und braun), Baby-Mooshroom | Pilze auf Rücken und Kopf; beim Baby keine |
| P5 | Enderman mit Block (z. B. Gras, Blume) | Block in den Händen vor dem Körper |
| P6 | Creeper zündet | Schwillt an und blinkt weiß |
| P7 | Neue Mobs: Illager, Hexe, Golems, Pferde, Wölfe, Katzen, Füchse, Lamas, Bienen, Fische, Wächter … | Richtige Modelle, Texturen und Varianten (Fell-/Farbvarianten, Pferdeabzeichen) |
| P8 | Plünderer/Diener greifen an, Magier zaubert | Arme wie im Spiel (Armbrust, Axt erhoben, Zauberpose); sonst verschränkte Arme |
| P9 | Gesattelte Pferde/Strider, Esel/Lama mit Truhe | Sattel bzw. Truhen sichtbar |
| P10 | Enderdrache | Platzhalter mit Namen |

**Tag-Nacht-Zyklus der Welt, Schlag der Mobs, Posen, Ebenen (`phase-8.md`)**

Ergebnis vom 2026-10-16 (Rückmeldung des Nutzers, Einzelspieler):
- Bestätigt: Tag-Nacht-Zyklus, Gegenstände auf dem Kopf, Tropenfische, Schlagposen, Rüstung, Pandas, Verzauberungsglanz, Sitzpose (nach den Korrekturen unten); Gesamturteil „läuft und passt“.
- Dabei gefunden und behoben: Rüstung fehlte im fertigen Spiel, sitzende Wölfe und Katzen waren um 90° gekippt, Pandas fehlten (gleiche Ursache), der Glanz stand still.
- Ebenfalls bestätigt: springende Slimes, Warden, Halsbänder, Pferderüstung.
- Danach gemeldet und behoben: Reitpose fehlte; Reiter und Pferd liefen auseinander; Boote fehlten; beim Pferd fehlten Grasen, Steigen und Galopp.
- Bestätigt nach diesen Korrekturen: „okay klappt“ (Pferdeanimation, Reiten).
- Danach bestätigt: Boote mit Ruderanimation, Loren, Lama-Teppiche, Verzierungen (Q18), Schädel und Glanz (Q19), Dorfbewohner legen sich schlafen.
- Gemeldet: Leine fehlte (jetzt eingebaut, Q23); Bett unter dem Dorfbewohner fehlte (Kartenblock, erscheint nach dem Neu-Rendern des Bereichs).
- Danach bestätigt: Betten erscheinen, Leine funktioniert. Gemeldet: schlafender Spieler lag nicht (jetzt eingebaut, Q24).
- Dynamische Lichter (Q25): vom Nutzer bestätigt („funktioniert“).

| # | Prüfung | Erwartung |
|---|---|---|
| Q1 | Oberwelt-Karte öffnen | Uhr-Knopf neben dem Tag/Nacht-Schalter; aus, Karte wie bisher |
| Q2 | Uhr-Knopf an, `/time set midnight`, dann `/time set noon` | Karte nach spätestens etwa 1 s dunkel bzw. hell |
| Q3 | `/time set 12000`, Sonnenuntergang abwarten | Karte wird fließend dunkler |
| Q4 | `/weather rain`, `/weather thunder` | Karte etwas bzw. deutlich dunkler |
| Q5 | Eigener Tag/Nacht-Schalter, danach Sonnenlicht-Regler | Modus aus, beide wirken wie im Original |
| Q6 | Nether-Karte; danach Oberwelt mit BlueMaps Nacht-Schalter | Nether: kein Uhr-Knopf. Nacht: Spieler, Mobs und Items so dunkel wie die Karte, Augen von Spinne/Enderman hell |
| Q7 | Zombie oder Skelett mit Schwert greift an | Arm schlägt, der Körper dreht sich mit |
| Q8 | Eisengolem greift einen Zombie an | Beide Arme schlagen von oben nach unten |
| Q9 | Hoglin bzw. Verwüster greift an | Hoglin reißt den Kopf hoch; der Verwüster stößt den Kopf vor und öffnet das Maul |
| Q10 | Wolf und Katze zähmen, per Rechtsklick sitzen lassen, Halsband färben | Sitzpose wie im Spiel; Halsband in der Farbe |
| Q11 | Katze legt sich zu einem schlafenden Spieler, Fuchs schläft tagsüber | Katze auf der Seite liegend, Fuchs eingerollt |
| Q12 | Dorfbewohner schlafen nachts im Bett | Liegen im Bett, Kopf am Kopfende |
| Q13 | Panda sitzt / liegt auf dem Rücken, Eisbär-Junges angreifen | Panda-Posen; der erwachsene Eisbär richtet sich auf |
| Q14 | Verschiedene Tropenfische (Eimer), Kugelfisch anstupsen | Farben wie im Spiel; Kugelfisch bläht sich in zwei Stufen auf |
| Q15 | Lama mit Teppich, Händlerlama, Pferd mit Eisen- und gefärbter Lederrüstung | Teppich-, Dekor- und Rüstungsebenen |
| Q16 | Geschnitzter Kürbis auf dem eigenen Kopf und auf einem Zombie (`/item replace entity`) | Kürbis sitzt um den Kopf und dreht sich mit; Leuchttintenfisch nachts hell |
| Q17 | Warden nachts | Leuchtende Flecken pulsieren, Leuchtschicht hell |
| Q18 | Rüstung mit Verzierungen (z. B. Küste/Eisen auf Eisenrüstung, Ranke/Gold) | Muster in der Materialfarbe wie im Spiel, `_darker` bei gleichem Material |
| Q19 | Verzauberte Rüstung; Skelett- und Creeperkopf auf dem Kopf | Glanz läuft über die Rüstung; Kopf sitzt etwas größer als der eigene Kopf |
| Q20 | Auf Pferd, Schwein, Boot und Lore sitzen; Zombie-Jockey bzw. Pillager auf Verwüster | Beine sitzend nach vorn gespreizt, Arme leicht nach vorn, keine Laufbewegung; Körper dreht mit dem Reittier |
| Q21 | Mit dem Pferd galoppieren und Kurven reiten; Boot (auch Bambusfloß, Kistenboot) fahren und rudern; Lore auf Schienen mit Steigung | Reiter bleibt auf dem Pferd bzw. im Boot, auch bei Tempo; Boot mit Holzart und Rudern; Lore folgt der Steigung |
| Q22 | Pferde auf Gras beobachten; ungezähmtes Pferd reiten, bis es steigt; galoppieren | Kopf senkt sich zum Grasen und nickt; Pferd steigt auf die Hinterbeine; beim Galopp nickt der Kopf und der Schweif hebt sich |
| Q23 | Tier an der Leine führen; Leine an einen Zaun knoten; Boot an der Leine | Seil hängt durch zwischen Kopf des Tiers und Hand bzw. Knoten, folgt beim Laufen; Knoten am Zaun sichtbar |
| Q24 | Nachts ins Bett legen (am besten zu zweit oder mit `/gamerule playersSleepingPercentage 200`, damit die Nacht nicht sofort vorbei ist) | Spieler liegt im Bett, Kopf am Kopfende, wie ein schlafender Dorfbewohner |
| Q25 | Nachts mit Uhr-Knopf an: Fackel, Laterne, Lavaeimer in die Hand nehmen und herumlaufen | Karte um den Spieler wird heller (Fackel etwa 14 Blöcke Reichweite), wandert mit; ohne Licht wieder dunkel |
| Q26 | Karte über das Internet öffnen (nicht im eigenen Netz), Spieler und Mobs beim Laufen beobachten; im Kartenmenü „Live-Anzeige“ die Glättung auf „Aus“ und zurück stellen; Bildrate auf 30 FPS | Mit Glättung laufen Figuren ohne Stocken (etwa eine halbe Sekunde verzögert); ohne Glättung wie bisher; Einstellungen bleiben nach dem Neuladen erhalten |
| Q27 | Creeper explodieren lassen (mit und ohne `/gamerule mobGriefing false`), TNT zünden, Endkristall zerschlagen, Ghast-Feuerball | Mit Blockschaden die große Explosion (viele graue Wolken über etwa 1 s), ohne Blockschaden bzw. beim Feuerball eine einzelne kleinere Wolke; der Creeper verschwindet zusammen mit der Explosion |
| Q28 | Selbst einen Trank trinken (z. B. Schnelligkeit), einem Mob einen Effekt geben (`/effect give @e[type=zombie,limit=1] minecraft:poison 60`), Leuchtfeuer-Effekt | Farbige Wirbel steigen am Körper auf, in der Farbe des Effekts; beim Leuchtfeuer (ambient) deutlich weniger und blasser |
| Q29 | Wurftrank (z. B. Heilung, Gift) und Verweiltrank werfen | Beim Zerbrechen ein Ring aus farbigen Partikeln; Verweiltrank: Wolke am Boden mit Partikeln in Trankfarbe, die kleiner wird |
| Q30 | Zombie im Sonnenlicht brennen lassen, selbst in Lava/Feuer laufen, brennender Pfeil | Animierte Flammen um die Figur, auch nachts hell |
| Q31 | Einen Mob töten | Nach der Todesanimation eine kleine graue Rauchwolke |
| Q32 | Karte offen lassen, im Spiel Blöcke abbauen und setzen, etwas sprengen | Nach etwa 10–20 s ändert sich die Karte an der Stelle, ohne Neuladen und ohne dass die Kachel kurz verschwindet; auch weiter herausgezoomt (Lowres) |
| Q33 | Truhe, Fallentruhe, Doppeltruhe und Endertruhe öffnen und wieder schließen | Deckel klappt auf der Karte auf und zu wie im Spiel, mit der richtigen Textur; geschlossen wieder normal |
| Q34 | Fass öffnen | Nach etwa 10–20 s zeigt das Fass auf der Karte den offenen Deckel (Blockzustand) |
| Q35 | `live-block-updates: false` in `plugin.conf`, `/bluemap reload` | Karte verhält sich wie im Original (Änderungen erst nach Minuten bzw. mit „Karte aktualisieren“) |
| Q36 | Karte offen, im Spiel schnell hintereinander Blöcke setzen und abbauen (auch Treppen, Glas, Stufen), TNT zünden, Wasser fließen lassen | Gesetzte und abgebaute Blöcke erscheinen nach unter 1–2 s als Vorschau; nach 10–20 s wird die Kachel geladen, ohne Sprung zurück; Treppen/Stufen in richtiger Richtung |
| Q37 | `live-block-preview: false` in `plugin.conf`, `/bluemap reload` | Keine Sofort-Vorschau mehr, Änderungen kommen wie in Q32 nach 10–20 s |
| Q38 | Fackel in der Hand halten und Feuer anschauen (brennender Zombie) | Flammen sind animiert (vorher nur ein Standbild) |
| Q40 | Feuer mit dem Feuerzeug legen, Magmablock und Seelaterne setzen | Die Vorschau zeigt die Blöcke animiert (nicht gestreift), danach übernimmt die Kachel |
| Q41 | Kartenmenü → „Entities und Effekte“: Regler „Entities um Spieler“ verkleinern, „Entities sichtbar bis“ ändern, Partikel und Sofort-Vorschau aus- und einschalten, Seite neu laden | Entities weiter weg verschwinden bzw. erscheinen wieder; ohne Partikel keine Explosionswolken; ohne Vorschau erscheinen Blockänderungen erst mit der Kachel; Einstellungen bleiben nach dem Neuladen |
| Q39 | `/bluemap live-stats` in Ruhe, dann beim Bauen und nach einer TNT-Explosion | Werte erscheinen; Server-Thread-Anteil bleibt klein (Erwartung: unter 1 %), Blockänderungen pro Sekunde steigen beim Bauen |

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
| Skin wird angezeigt, aber keine Animationen bzw. Modell erscheint nach Dimensionswechsel erst nach Neuladen | Alter Webclient im Web-Ordner (§4 „Welche Version läuft?“) → neues JAR verwenden bzw. `index.html` löschen, Welt neu öffnen, Strg+F5 |
| Spiel ruckelt beim Rendern | `render-thread-count` in `core.conf` verringern |

---

## 8. Automatisierte Tests zu diesem Stand

| Test | Ergebnis |
|---|---|
| GitHub Actions auf `cc4a7e2` und `8d33402`: `spotlessCheck test`, `release` | erfolgreich (jeweils Push- und PR-Lauf); auf `8d33402` inklusive `MetricsDefaultTest` |
| Lokal JUnit ohne Gradle (`live`, `skins`, `WebserverConfigTest`) | 37/37 (`MetricsDefaultTest` braucht Lombok und den vollständigen Klassenpfad und läuft nur im CI) |
| `npm test` | 30/30 |
| ESLint auf allen geänderten/neuen JS-Dateien | ok. Auf ganz `src/js` gibt es 3 Befunde in unveränderten Original-Dateien (`PopupMarker.js`, `PRBMLoader.js`, `Utils.js`), identisch auf `mc1.21.1`, nicht angefasst. |
| `npm run build` | ok |
| Browser-E2E `player-e2e.mjs` | 22/22 |
| **Schritt 4 (Dimensionswechsel, Animationen):** JUnit `live` lokal | 25/25 |
| Schritt 4: `npm test` | 43/43 |
| Schritt 4: Browser-E2E `animation-e2e.mjs` (Kartenwechsel Overworld↔Nether ohne Neuladen, alle Animationsübergänge) | 18/18 |
| Schritt 4: Browser-E2E `player-e2e.mjs`, Regression gegen das Original | 22/22, 0 abweichende Pixel |
| Schritt 4: Gradle/CI (Fabric-Kompilierung des Armschwungs, `Plugin.java`) | erfolgreich auf `a529aba5` und `c81b46b9` (Push- und PR-Lauf) |
| **Phase 4 (Items):** JUnit lokal (`live`, `plugin.items`, `WebFilesManagerTest`, mit `core`) | 53/53 |
| Phase 4: `npm test` | 60/60 |
| Phase 4: Browser-E2E `items-e2e.mjs`, `player-e2e.mjs`, `animation-e2e.mjs`, Regression | 15/15, 22/22, 18/18, 0 abweichende Pixel |
| Phase 4: Gradle/CI (Fabric-Kompilierung) | erfolgreich auf `fbd62486` (Push- und PR-Lauf) |
| **Echter Minecraft-Client/-Server, echte Mojang-Skins** | **nicht ausgeführt** (keine Minecraft-Umgebung; `piston-meta.mojang.com`, `libraries.minecraft.net`, `maven.fabricmc.net`, `sessionserver.mojang.com` nicht erreichbar) |

---

## 9. Telemetrie (Metrics) und verbleibende Verbindungen zum Originalprojekt

**Änderung (BlueMap Live):** Die Nutzungsmeldungen an `https://metrics.bluecolored.de/bluemap/` (Plattform, Version, Minecraft-Version; alle 30 Minuten, siehe `Plugin`) sind jetzt **standardmäßig deaktiviert**:
- `CoreConfig.metrics` hat den Standardwert `false`.
- Die Vorlage `core.conf` schreibt `metrics: false` mit einem Hinweis, dass man die Meldungen mit `true` weiterhin aktivieren kann.

**Bestehende Konfigurationen [geprüft im Code]:** `BlueMapConfigManager.loadCoreConfig` erzeugt `core.conf` aus der Vorlage **nur, wenn die Datei noch nicht existiert**. Eine vorhandene Datei wird unverändert geladen und nie zurückgeschrieben. Folgen:
- Eine `core.conf` mit `metrics: true` (z. B. aus einer früheren Original-BlueMap-Installation im selben Ordner) **bleibt aktiv**, bis man sie selbst auf `false` setzt.
- Ein explizites `metrics: false` bleibt ebenfalls erhalten.
- Fehlt der Eintrag, gilt der neue Standard `false`.
- Auf Sponge entscheidet weiterhin die Sponge-eigene Einstellung (`Server#isMetricsEnabled`).

**Tests:** `MetricsDefaultTest` prüft Neuinstallation (echter `BlueMapConfigManager`-Builder, erzeugte Datei enthält `metrics: false`), Neuinstallation ohne Metrics-Abschnitt, explizites `true`/`false` und fehlenden Eintrag. Außerdem prüft er, dass eine bestehende Datei nicht verändert wird.

**Weitere Verbindungen zum Originalprojekt, die bewusst unverändert bleiben:**

| Wo | Was | Betrifft den Fabric-Test? |
|---|---|---|
| Paper/Spigot (`BukkitPlugin`) | bStats-Metrics mit der Plugin-ID 5912 des Original-BlueMap (`new Metrics(this, 5912)`), abschaltbar über die bStats-Konfiguration des Servers | nein |
| Ressourcen-Download | lädt das Minecraft-Client-Jar von Mojang (`piston-meta.mojang.com`), nicht vom BlueMap-Projekt | – |
| Skins | `sessionserver.mojang.com` / `textures.minecraft.net` (Mojang), abschaltbar mit `skin-download: false` | ja (Mojang, nicht BlueMap) |
| `README.md` (originaler Teil) | Badge-Bilder von `img.shields.io` und `metrics.bluecolored.de`; werden nur beim Anzeigen der README auf GitHub geladen, nicht von der Mod | nein |
