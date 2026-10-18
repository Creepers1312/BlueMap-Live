# BlueMap Live – Release-Plan 1.0

Stand: 2026-10-18 · Branch `bluemap-live` · Entscheidung des Nutzers: **1.0 = der aktuelle Stand mit kleinen Fixes, Mod-Support kommt in einer 1.x.**

## 1. Inhalt von 1.0

Alles aus 0.1–0.6. Auf GitHub veröffentlicht sind bisher nur `v0.1.0-alpha` und `v0.3.0-alpha`; 0.4, 0.5 und 0.6 gibt es nur als Release-Notes. Für viele Nutzer ist 1.0 also der erste Release mit diesen Funktionen:

| Bereich | Funktionen |
|---|---|
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
| F1 | `README.md` neu schreiben | völlig veraltet (Phasen 7/8 „geplant“, Version 0.1.0, „nicht für den produktiven Einsatz“) | Claude |
| F2 | `fabric.mod.json`: Beschreibung | nennt nur „live 3d player-models“ | Claude |
| F3 | `fabric.mod.json`: Minecraft-Version | `>=1.21` ohne Obergrenze, getestet ist nur 1.21.1; neuere Versionen können abstürzen oder still Funktionen verlieren | **Entscheidung**, dann Claude |
| F4 | Name der JAR | `bluemap-<version>-fabric.jar`, leicht mit dem Original-BlueMap zu verwechseln (beide gleichzeitig im `mods`-Ordner wären ein Problem) | **Entscheidung**, dann Claude |
| F5 | `fabric.mod.json`: Autoren | nur der Autor des Originals; der Fork-Maintainer fehlt | **Entscheidung** (Name), dann Claude |
| F6 | Release-Workflow | legt fehlende Releases als *Pre-Release* an; für 1.0 ein normaler Release (entweder Release vor dem Tag selbst anlegen oder den Workflow für Tags ohne `-` anpassen) | Claude (Workflow), Nutzer (Release) |
| F7 | Release-Notes 1.0 und `CHANGELOG.md` | 0.4–0.6 zusammenführen, „Alpha“-Hinweise entfernen, bekannte Einschränkungen gesammelt | Claude |
| F8 | Konfigurations-Referenz | alle `live-*`-Einstellungen aus `plugin.conf` und die Browser-Einstellungen an einer Stelle, mit Standardwerten und Server-Kosten | Claude |
| F9 | Doku-Index | `docs/bluemap-live/README.md`: was für Nutzer ist (Installation, Konfiguration, FAQ) und was Entwickler-Doku (Phasen) | Claude |
| F10 | Temporärer Branch `bluemap-live-model-dump` | nur für den einmaligen Vanilla-Dump angelegt | Nutzer (löschen, falls gewünscht) |

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
- Weitere Minecraft-Versionen und Plattformen (bisher nur Fabric 1.21.1).
- Entscheidung über die Veröffentlichung außerhalb von GitHub (Modrinth/CurseForge unter eigenem Projekt).
