# BlueMap Live

[English](README.md) · **Deutsch**

BlueMap Live ist ein inoffizieller Fork von [BlueMap](https://github.com/BlueMap-Minecraft/BlueMap), der deine Minecraft-Welt **live** auf der 3D-Karte zeigt: Spieler mit Skin und Animationen, Mobs, Gegenstände, Effekte, Blockänderungen, die Tageszeit und das Wetter.

Die originale Karte wird ergänzt, nicht ersetzt. Karte, Texturen, Webclient, Navigation und Webserver sind die von BlueMap; die Live-Inhalte werden darüber gezeichnet.

> Nicht vom BlueMap-Team. Fehler bitte [hier](https://github.com/Creepers1312/BlueMap-Live/issues) melden, nicht beim Original.

![Ein Spieler reitet nachts auf einem Pferd, Mobs mit Lebensbalken, Mond und Sterne](docs/images/overview.webp)

## Funktionen

| | |
|---|---|
| **Spieler** | 3D-Modelle mit Skin, Gehen, Schleichen, Schwimmen, Elytra-Flug, Reiten, Schlafen, gehaltene Items mit ihren Animationen (Bogen, Armbrust, Schild, Dreizack, Essen, …), Rüstung mit Verzierungen, dynamisches Licht von Fackeln in der Hand |
| **Entities** | Gegenstände am Boden, Wurfgegenstände, Pfeile und Dreizacke im Flug, Vanilla-Mobs mit Texturen und Animationen, Boote und Loren, Leinen, Platzhalter für andere Lebewesen |
| **Effekte** | Explosionen, Tränke, Feuer, Rauch |
| **Blöcke** | geänderte Blöcke erscheinen sofort als Vorschau mit dem Licht der Umgebung, bis BlueMap die Kachel neu gerendert hat; Truhen gehen auf und zu |
| **Welt** | Tag-Nacht-Zyklus der Welt, Live-Wetter mit Sonne, Mondphasen, Sternen, Wolken, Regen, Schnee und Blitzen, Weltuhr |
| **Bedienung** | Einstellungen als Popup mit Reitern, Voreinstellungen, Entity-Filter, Namensschilder, Lebensbalken, einem Spieler folgen (Ego-Perspektive oder über der Schulter), LIVE-Anzeige, 28 Sprachen |
| **Server** | `/bluemap live-stats` zeigt, was die Live-Daten kosten; die Metrik-Berichte des Original-BlueMap sind standardmäßig aus (`metrics` in `core.conf`) |

<p>
  <img src="docs/images/player.webp" alt="Ein Spielermodell mit Skin und Rüstung in einem Raum mit Lesepulten" width="49%">
  <img src="docs/images/chest-shield.webp" alt="Eine geöffnete Truhe, ein Spieler blockt mit dem Schild, ein Creeper mit Lebensbalken" width="49%">
</p>

<p>
  <img src="docs/images/settings-entities.png" alt="Einstellungen: Entities und Filter" width="49%">
  <img src="docs/images/settings-live.png" alt="Einstellungen: Glättung, Bildrate und Folgekamera" width="49%">
</p>

<p>
  <img src="docs/images/weather.webp" alt="Regen in der Nacht über einem Leuchtturm, mit Wolken und Weltuhr" width="49%">
  <img src="docs/images/weather-morning.webp" alt="Dieselbe Stelle an einem verregneten Morgen, mit Spieler-Markierung" width="49%">
</p>

## Download

Die Downloads liegen auf der [Release-Seite](https://github.com/Creepers1312/BlueMap-Live/releases/latest). Jeder Release hat eine JAR pro Plattform:

| Plattform | Datei | Stand |
|---|---|---|
| Fabric (Loader ≥ 0.17.2 und Fabric API) | `bluemap-live-<version>-fabric.jar` | in Minecraft getestet |
| NeoForge | `bluemap-live-<version>-neoforge.jar` | neu in 1.0, Test in Minecraft noch offen |
| Forge | `bluemap-live-<version>-forge.jar` | neu in 1.0, in Minecraft getestet (Forge 52.1.0) |

Minecraft Java Edition **1.21.1** (und 1.21). Läuft im Einzelspieler und auf dedizierten Servern. Nur der Server braucht die Mod; die Spieler nutzen ihren Browser.

## Installation

1. Die JAR des Original-BlueMap aus dem `mods`-Ordner entfernen (beide zusammen gehen nicht).
2. Die BlueMap-Live-JAR deiner Plattform in den `mods`-Ordner legen.
3. Server oder Welt starten. Wie bei BlueMap einmal den Download der Minecraft-Ressourcen in `config/bluemap/core.conf` erlauben (`accept-download: true`).
4. Die Karte im Browser öffnen, standardmäßig `http://localhost:8100`.

Vorhandene BlueMap-Einstellungen und Karten bleiben erhalten. Für alles, was nicht live ist, gilt die Dokumentation von BlueMap: [bluemap.bluecolored.de/wiki](https://bluemap.bluecolored.de/wiki/).

## Einstellungen

Die Live-Einstellungen stehen in `config/bluemap/plugin.conf`, alle sind standardmäßig an:

| Einstellung | Standard | Wirkung |
|---|---|---|
| `live-player-markers` | `true` | sendet die Spieler an die Karte |
| `live-player-update-interval` | `250` | Millisekunden zwischen zwei Abtastungen (50–10000); kleiner ist flüssiger, kostet aber mehr |
| `live-player-extended-data` | `true` | Körperdrehung, Bewegung, Items, Rüstung, …; `false` sendet nur Name, Position und Blickrichtung |
| `live-entities` | `true` | Gegenstände, Geschosse, Mobs und Fahrzeuge um die Spieler |
| `live-entities-radius` | `30` | Blöcke um jeden Spieler (0–128) |
| `live-entities-limit` | `200` | Entities pro Karte, die nächsten zuerst (0–1000) |
| `live-entities-hidden-types` | `[]` | Entity-Arten, die nie gesendet werden, z. B. `["minecraft:item"]` |
| `live-block-updates` | `true` | geänderte Kacheln werden nach kurzer Wartezeit neu gerendert |
| `live-block-preview` | `true` | geänderte Blöcke erscheinen sofort als Vorschau |
| `live-block-preview-radius` | `96` | Blöcke um die Spieler (0–256) |
| `live-block-update-cooldown` | `10` | Sekunden, bis eine geänderte Region neu gerendert wird |

Gesendet wird nur, was um Spieler liegt, die auf der Karte sichtbar sind; versteckte Spieler und ihre Umgebung bleiben verborgen. Alle Einstellungen, auch die im Browser, stehen in [docs/bluemap-live/configuration.md](docs/bluemap-live/configuration.md).

## Leistung

Der Server liest nur Positionen und Zustände (wenige Feldzugriffe pro Entity, standardmäßig viermal pro Sekunde). Modelle, Animationen und Wetter zeichnet der Browser jedes Betrachters. Die Voreinstellungen in den Einstellungen (Leistung, Ausgewogen, Schön) legen fest, wie viel der Browser zeichnet.

## Selbst bauen

```sh
./gradlew release
```

Die JARs liegen danach in `build/release/`. Benötigt wird Java 21. Die Tests des Webclients laufen mit `npm test` in `common/webapp`.

## Dokumentation

- [docs/bluemap-live/README.md](docs/bluemap-live/README.md): Übersicht über alle Dokumente
- [CHANGELOG.md](CHANGELOG.md): Änderungen pro Version
- [docs/bluemap-live/roadmap.md](docs/bluemap-live/roadmap.md): was als Nächstes kommt (1.x: Unterstützung für Mod-Entities)

## Urheber und Lizenz

BlueMap stammt von [Blue (TBlueF, Lukas Rieger)](https://github.com/TBlueF) und den [BlueMap-Mitwirkenden](https://github.com/BlueMap-Minecraft/BlueMap/graphs/contributors). BlueMap Live baut darauf auf und behält die Lizenz: MIT, siehe [LICENSE](LICENSE). Die originale README steht bei [BlueMap-Minecraft/BlueMap](https://github.com/BlueMap-Minecraft/BlueMap#readme).

Minecraft-Texturen und -Modelle sind nicht Teil dieses Repositorys. Wie bei BlueMap lädt die Mod sie nach deiner Zustimmung von Mojang herunter.
