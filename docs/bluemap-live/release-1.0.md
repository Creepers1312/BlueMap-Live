# BlueMap Live – Release-Plan 1.0

Stand: 2026-10-18 · Branch `bluemap-live` · Entscheidung des Nutzers: **1.0 = der aktuelle Stand mit kleinen Fixes, Mod-Support kommt in einer 1.x.**

## 1. Inhalt von 1.0

Alles aus 0.1–0.6. Auf GitHub veröffentlicht sind bisher nur `v0.1.0-alpha` und `v0.3.0-alpha`; 0.4, 0.5 und 0.6 gibt es nur als Release-Notes. Für viele Nutzer ist 1.0 also der erste Release mit diesen Funktionen:

| Bereich | Funktionen |
|---|---|
| Plattformen | Fabric, Forge, NeoForge (Minecraft 1.21.1) |
| Spieler | 3D-Modelle mit Skin, Animationen, gehaltene Items, Rüstung, Reiten, dynamische Lichter |
| Entities | Gegenstände, Geschosse, Vanilla-Mobs mit Animationen, Fahrzeuge, Leinen, Platzhalter für andere Lebewesen |
| Effekte | Explosionen, Tränke, Feuer, Rauch |
| Blöcke | Live-Vorschau mit Bestätigung durch den Renderer, Truhen-Deckel, Licht wie die Kacheln, leuchtende Blöcke |
| Welt | Tag-Nacht-Zyklus der Welt, Live-Wetter (Sonne, Mond, Sterne, Wolken, Regen, Schnee, Blitze), Weltuhr |
| Bedienung | Einstellungs-Popup mit Reitern, Voreinstellungen, Entity-Filter, Namensschilder, Lebensbalken, Folgekamera, LIVE-Anzeige, 28 Sprachen |
| Server | `/bluemap live-stats`, Telemetrie standardmäßig aus |

## 2. Kleine Fixes und Aufräumen vor 1.0

| # | Punkt | Warum | Wer |
|---|---|---|---|
| F1 | `README.md` neu schreiben | völlig veraltet (Phasen 7/8 „geplant“, Version 0.1.0, „nicht für den produktiven Einsatz“) | ✅ `README.md` (Englisch) und `README.de.md` mit Bildern des Nutzers (`docs/images`); ein Wetterbild ist optional (Platzhalter als Kommentar) |
| F2 | `fabric.mod.json`: Beschreibung | nennt nur „live 3d player-models“ | ✅ auch in `mods.toml`/`neoforge.mods.toml` (Name „BlueMap Live“) |
| F3 | `fabric.mod.json`: Minecraft-Version | `>=1.21` ohne Obergrenze, getestet ist nur 1.21.1; neuere Versionen können abstürzen oder still Funktionen verlieren | ✅ `>=1.21 <1.21.2` (Forge/NeoForge `[1.21,1.21.2)`) |
| F4 | Name der JAR | `bluemap-<version>-fabric.jar`, leicht mit dem Original-BlueMap zu verwechseln (beide gleichzeitig im `mods`-Ordner wären ein Problem) | ✅ `bluemap-live-<version>-<plattform>.jar`; Fabric: `breaks: bluemap` |
| F5 | `fabric.mod.json`: Autoren | nur der Autor des Originals; der Fork-Maintainer fehlt | offen: Name des Nutzers |
| F6 | Release-Workflow | legt fehlende Releases als *Pre-Release* an; für 1.0 ein normaler Release (entweder Release vor dem Tag selbst anlegen oder den Workflow für Tags ohne `-` anpassen) | ✅ Pre-Release nur bei Tags mit `-`; hängt Fabric, Forge und NeoForge an |
| F7 | Release-Notes 1.0 und `CHANGELOG.md` | 0.4–0.6 zusammenführen, „Alpha“-Hinweise entfernen, bekannte Einschränkungen gesammelt | ✅ `releases/v1.0.0.md`, `CHANGELOG.md` |
| F8 | Konfigurations-Referenz | alle `live-*`-Einstellungen aus `plugin.conf` und die Browser-Einstellungen an einer Stelle, mit Standardwerten und Server-Kosten | ✅ `configuration.md` |
| F9 | Doku-Index | `docs/bluemap-live/README.md`: was für Nutzer ist (Installation, Konfiguration, FAQ) und was Entwickler-Doku (Phasen) | ✅ |
| F11 | Forge und NeoForge | Entscheidung des Nutzers: Live-Funktionen vor 1.0 | ✅ kompiliert (CI), Test in Minecraft durch den Nutzer: FN1–FN12 in `phase-14.md` |
| F10 | Temporärer Branch `bluemap-live-model-dump` | nur für den einmaligen Vanilla-Dump angelegt | Nutzer (löschen, falls gewünscht) |

### Bereits erledigt

| Fix | Ursache und Lösung | Test |
|---|---|---|
| **Körper läuft schräg** (Meldung des Nutzers: Spieler läuft geradeaus, der Körper ist seitlich gedreht, der Kopf schaut geradeaus) | Der Server berechnet die Körperdrehung von Spielern in `LivingEntity.tick`, das für Spieler erst im Netzwerk-Tick läuft. Bis dahin hat der Welt-Tick die Vorposition schon zurückgesetzt, der Spieler gilt als stehend. Der Körper folgt dem Kopf dann nur, wenn der Unterschied 50° übersteigt (`turnHead`, im CI-Dump aus dem Spiel gelesen). Der Vanilla-Client berechnet die Körperdrehung anderer Spieler deshalb selbst. **Lösung:** Die Webapp rechnet genauso (`player/BodyYaw.js`): pro Tick Zielrichtung aus der Bewegung (rückwärts: entgegengesetzt), beim Schlagen die Blickrichtung, 30 % Annäherung, höchstens 50° vom Kopf (15° beim Blocken), zwischen den Ticks interpoliert. Beim Reiten und im Bett bleibt der gesendete Wert. | `BodyYaw.test.mjs` (4), `player-e2e.mjs` (Geradeauslaufen mit 40° schräg gesendetem Körper; stehend folgt der Körper bis auf 50°) |

## 3. Qualitäts-Tore

1. **Release-Kandidat `v1.0.0-rc.1`** (Tag durch den Nutzer, die CI hängt die JAR an).
2. **Manuelle Prüfung in Minecraft** mit einer gekürzten 1.0-Liste: aus Q1–Q49 die wichtigsten etwa 20 Punkte, die noch offen sind oder das Zusammenspiel prüfen (Einzelspieler).
3. **Dedizierter Server** (bisher fast nur Einzelspieler geprüft): Start, mehrere Spieler, Live-Daten über das Netzwerk, `live-stats` unter Last (M1–M16, S1–S5 aus `phase-2.md`/`phase-3.md`, gekürzt).
4. **Mit dem Modpack des Nutzers** (~150 Mods): kein Absturz, kein Konflikt des Mixins (`WorldChunk.setBlockState`, z. B. mit Lithium), Mod-Blöcke auf der Karte und in der Vorschau, Mod-Entities als Platzhalter.
5. **Last- und Leistungstest (automatisiert)** mit dem E2E-Server: viele Spieler, Entities und Blockänderungen gleichzeitig; Messung von Bildrate im Browser, Antwortgrößen und Dauer der JSON-Erzeugung. Ziel: Grenzwerte dokumentieren, offensichtliche Engpässe beheben.
6. **Alle automatischen Tests grün** (Node, JUnit, 11 Browser-Suiten, CI).
7. Funde aus 2–5 werden behoben, bei Bedarf `rc.2`, dann **`v1.0.0`**.

## 4. Ablauf

| Schritt | Inhalt | Wer |
|---|---|---|
| 1 | Entscheidungen F3–F5 | Nutzer |
| 2 | F1–F9 umsetzen, Lasttest (Tor 5), gekürzte Testliste | Claude |
| 3 | Tag `v1.0.0-rc.1` | Nutzer |
| 4 | Tore 2–4 testen, Funde melden | Nutzer |
| 5 | Fixes, ggf. `rc.2` | Claude / Nutzer |
| 6 | Tag `v1.0.0`, Release veröffentlichen | Nutzer |

## 5. Nach 1.0

- **1.1 Mod-Support** (Analyse siehe Gespräch vom 2026-10-18): `/bluemap live-mods` (Bestandsaufnahme der Entity-Arten), texturierter Platzhalter, Mitschnitt der Mod-Modelle aus dem echten Renderer (Einzelspieler automatisch, dedizierte Server per Export), GeckoLib-Dateien optional. In der Mod-Liste des Nutzers betrifft das vor allem Alex's Mobs (Citadel), Twilight Forest, Mowzie's Mobs, Naturalist, Critters and Companions, Enderscape, Better Nether, Guard Villagers, Illager Invasion und Adorable Hamster Pets.
- Weitere Minecraft-Versionen.
- Fabric auf Mojang-Namen umstellen, damit es die Live-Logik nur noch einmal gibt (siehe `phase-14.md` §3).
- Entscheidung über die Veröffentlichung außerhalb von GitHub (Modrinth/CurseForge unter eigenem Projekt).
