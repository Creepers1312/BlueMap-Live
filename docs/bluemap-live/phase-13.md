# BlueMap Live – Phase 13: Komfort und Live-Wetter (0.6.0)

Stand: 2026-10-17 · Branch `bluemap-live` · Wunsch des Nutzers („1, 2, 3, 4, 5, 6, wenn möglich statt nur live Tag-Nacht-Zyklus auch Live-Wetter mit Regen, Sturm, Sternen, Sonne und Mond sowie Wolken, alles aber nur im Live-Weltzeit-Modus“)

> **Kurzfassung:**
> - **Spieler folgen:** neben BlueMaps eigener Verfolgung jetzt Ego-Perspektive und Kamera über der Schulter.
> - **Namensschilder** benannter Mobs und **Lebensbalken** von Mobs und Spielern, beide abschaltbar.
> - **Entity-Filter:** feindliche Mobs, Tiere, andere Mobs, Gegenstände/Geschosse, Boote/Loren einzeln ein- und ausblendbar.
> - **Weltuhr** mit Wetter- und Mondphasen-Symbol in der Kontrollleiste.
> - **Voreinstellungen** „Leistung“, „Ausgewogen“, „Schön“.
> - **Live-Anzeige** (grün/gelb/rot) für den Zustand der Live-Daten.
> - **Live-Wetter** (nur im Weltzeit-Modus): Sonne, Mond mit Phasen, Sterne, Wolken, Regen, Schnee, Blitze.
> - **Nicht in Minecraft geprüft:** offen, siehe `singleplayer-test.md` (Q42–Q48).

## 1. Was der Server zusätzlich sendet

Ohne Mixins, aus dem Zustand der Entities und der Welt:

| Feld | Datei | Bedeutung | Vanilla-Quelle |
|---|---|---|---|
| `mob.group` | `entities.json` | Spawn-Gruppe, z. B. `monster`, `creature`, `water_ambient`, `misc` | `EntityType.getSpawnGroup().getName()` |
| `mob.health`, `mob.maxHealth` | `entities.json` | Lebenspunkte | `LivingEntity.getHealth`, `getMaxHealth` |
| `mob.name` | `entities.json` | eigener Name (Namensschild), höchstens 64 Zeichen | `Entity.getCustomName` |
| `status.health`, `status.maxHealth` | `players.json` (erweiterte Daten) | Lebenspunkte des Spielers | `PlayerEntity.getHealth`, `getMaxHealth` |
| `status.precipitation` | `players.json` (erweiterte Daten) | Niederschlag im Biom des Spielers: `rain`, `snow`, `none` | `Biome.getPrecipitation(BlockPos)` |
| `world.moonPhase` | `players.json` | Mondphase 0–7 (0 = Vollmond) | `World.getMoonPhase` |

- `Biome.getPrecipitation(BlockPos)` hat sich in 1.21.2 geändert. Das JAR ist für 1.21 kompiliert; fehlt die Methode, wird der Status nicht mehr abgetastet (`LinkageError` abgefangen), alles andere läuft weiter.
- `RegistryEntry.value()` ist in den Yarn-Mappings von 1.21 nicht gemappt und heißt `comp_349` (wie schon bei den Partikeln).

**Texturen:** `environment/sun`, `environment/moon_phases`, `environment/clouds`, `environment/rain`, `environment/snow` (`LiveWorldTime.TEXTURES`) werden wie die Partikeltexturen unter `assets/textures/` bereitgestellt, nur von Minecraft, nur diese. Angefordert werden sie, sobald `players.json` eine Weltzeit enthält. Regen und Schnee sind 4 Spalten Tropfen, keine Animationsbilder; sie werden deshalb nicht auf das erste Bild zugeschnitten.

## 2. Die Funktionen im Browser

### 2.1 Spieler folgen (Kartenmenü → „Kamera beim Folgen“)

| Modus | Verhalten |
|---|---|
| Karte (wie BlueMap) | unverändert: Die aktuelle Steuerung folgt dem Spieler |
| Ego-Perspektive | wechselt in die Freiflug-Ansicht; Kamera in den Augen des Spielers, Blickrichtung = Kopf. Das eigene Modell, Kopfsymbol und Name werden ausgeblendet. |
| Über der Schulter | wechselt in die Freiflug-Ansicht; Kamera 3,5 Blöcke hinter, 0,75 rechts und 0,35 über den Augen, gleiche Blickrichtung |

- Augenhöhe wie Vanilla: stehend 1,62, schleichend 1,27, schwimmend/gleitend 0,4.
- Wie bei BlueMap endet das Folgen, sobald man selbst die Kamera bewegt. Das ausgeblendete Modell erscheint dann wieder.
- Die Kamera kollidiert nicht mit Blöcken (anders als die Third-Person-Kamera im Spiel).
- Umsetzung: `controls/FollowCamera.js`, Hook `FreeFlightControls.followPose`, `BlueMapApp.followPlayer`.

### 2.2 Namensschilder und Lebensbalken (Gruppe „Entities filtern“)

- **Namensschilder:** Mobs mit eigenem Namen zeigen ihn über dem Kopf (Höhe + 0,5 wie Vanilla), bis 64 Blöcke von der Kamera. Ausgeschaltet verschwinden auch die Spielernamen.
- **Lebensbalken:** Balken mit Farbe von Grün nach Rot und „♥ 7,5 / 10“ in Herzen (2 Lebenspunkte = 1 Herz). Bei Spielern zwischen Kopfsymbol und Name.
- Abweichung: Vanilla zeigt Namen benannter Mobs nur beim Anvisieren (außer bei `CustomNameVisible`); die Karte zeigt sie immer in der Nähe. Lebensbalken gibt es in Vanilla nicht.
- Standard: Namensschilder an, Lebensbalken aus.
- Umsetzung: `markers/EntityLabel.js` (Logik), `EntityLabelView.js` (HTML über den CSS2D-Renderer von BlueMap).

### 2.3 Entity-Filter (Gruppe „Entities filtern“)

| Kategorie | Enthält |
|---|---|
| Feindliche Mobs | Spawn-Gruppe `monster` |
| Tiere | `creature`, `ambient`, `axolotls`, `water_creature`, `water_ambient`, `underground_water_creature` |
| Andere Mobs | übrige Mobs (Dorfbewohner, Golems, …) und Mobs eines Servers ohne `group` |
| Gegenstände und Geschosse | Gegenstände am Boden, Wurfgegenstände, Pfeile |
| Boote und Loren | Boote, Flöße, Loren, Leinenknoten |

Die Wolke des Verweiltranks gehört zu den Partikeln und wird nicht gefiltert.

### 2.4 Weltuhr und Live-Anzeige (Kontrollleiste)

- **Uhr:** „HH:MM“ wie im Spiel (0 Ticks = 06:00), läuft mit dem Tageszyklus weiter. Symbol: Sonne/Mond (Tag 23000–13000), Regenwolke (`rain` > 0,2), Gewitterwolke (`thunder` > 0,9, Vanilla `isRaining`/`isThundering`). Der Tooltip nennt Wetter und nachts die Mondphase. Nur sichtbar, wenn die Welt eine Weltzeit hat.
- **LIVE:** grün, solange `players.json` regelmäßig ankommt (höchstens 3 s bzw. 3 Intervalle alt), gelb bis 15 s, danach rot. Ausgeblendet, solange noch keine Live-Daten geladen wurden.

### 2.5 Voreinstellungen (Gruppe „Voreinstellung“)

| | Auflösung | Hires | Lowres | Bildrate | Entities bis | Partikel |
|---|---|---|---|---|---|---|
| Leistung | ×0,5 | 60 | 1000 | 30 | 150 | aus |
| Ausgewogen | ×1 | Standard der Karte | Standard der Karte | 60 | 300 | an |
| Schön | ×2 | 300 | 5000 | unbegrenzt | 600 | an |

Die Sichtweiten werden auf die Reglergrenzen aus `webapp.conf` begrenzt. Ändert man danach einen Wert von Hand, ist keine Voreinstellung mehr markiert.

### 2.6 Live-Wetter (Kartenmenü → Beleuchtung → „Live-Wetter“)

Nur aktiv, wenn „Tag-Nacht-Zyklus der Welt“ eingeschaltet ist und die Welt eine Weltzeit sendet (nicht Nether/End). Umsetzung: `weather/WeatherData.js` (Logik), `weather/WeatherView.js` (three.js).

| Teil | Wie | Vanilla-Vorbild |
|---|---|---|
| Sonne, Mond | Texturen des Ressourcenpakets, additiv, 100 Blöcke entfernt, halbe Größe 30 bzw. 20; gedreht um −90° (y) und den Himmelswinkel (x): Aufgang im Osten, mittags senkrecht. Mondphase aus `moonPhase` (4 × 2 Felder). Bei Regen ausgeblendet (Deckkraft 1 − Regen). | `WorldRenderer.renderSky` |
| Sterne | 1500 Versuche zufälliger Punkte, 100 Blöcke entfernt, drehen mit dem Himmel; Helligkeit wie `getStarBrightness` (nachts 0,5), bei Regen weniger. Die Positionen sind nicht die von Vanilla (andere Zufallszahlen). | `buildStarsBuffer`, `getStarBrightness` |
| Wolken | flache Schicht („schnelle Wolken“) aus `clouds.png` in Höhe 192, 12 Blöcke pro Pixel, ziehen mit 0,03 Blöcken pro Tick nach Westen. Nachts und im Sturm dunkler. Von unten Deckkraft 0,8, von oben durchsichtig (0,3), damit die Karte sichtbar bleibt. | `renderClouds` (nicht die 3D-Wolken) |
| Regen, Schnee | Tropfen aus `rain.png`/`snow.png` in zwei Schichten: 1200 direkt um die Kamera (16 Blöcke, nur unterhalb der Wolken; füllt das ganze Bild wie in Vanilla, wo der Regen nur um die Kamera gezeichnet wird) und 4000 um den Punkt, auf den die Kamera schaut (Umkreis = Kameraabstand, 10 bis 400 Blöcke; sichtbar auch aus der Kartenansicht). Menge = Regenstärke. Schnee fällt langsam und pendelt. Ob Regen, Schnee oder nichts: Niederschlag im Biom des nächsten Spielers, sonst Regen. | `renderWeather` |
| Gewitter | Die Karte wird bereits über die Weltzeit dunkler. Zusätzlich alle 4–16 s ein Blitz, der die Karte kurz aufhellt und flackert. | `lightningTicksLeft` |

**Abweichungen (bewusst):**
- Regen fällt nicht nur unter freiem Himmel, sondern auch durch Dächer (die Webapp kennt die Höhe der obersten Blöcke nur über die Kacheln). Unter der Oberfläche ist er durch das Gelände verdeckt.
- Blitze sind nicht die echten Einschläge (der Server sendet keine Blitz-Entities); Zeitpunkt und Ort stimmen nicht mit dem Spiel überein. Es gibt keinen Blitzstrahl.
- Wolken und Sterne stehen nicht an derselben Stelle wie im Spiel (Vanilla nutzt die Ticks des Clients bzw. Java-Zufallszahlen).
- Die Farbe des Sonnenauf- und -untergangs und die Himmelsfarbe bei Regen fehlen; der Himmel wird wie bisher nur über die Sonnenlichtstärke dunkler.
- Die 3D-Wolken („Fancy“) fehlen.

**Nach dem ersten Test in Minecraft (Nutzer):** Der Regen war nur in einem Feld um den Blickpunkt zu sehen, nicht in der ganzen Ansicht. Deshalb gibt es jetzt die zweite Schicht um die Kamera. Außerdem stand `liveIndicator.label` statt „LIVE“ da: Der Browser hatte die alte Sprachdatei zwischengespeichert. Die Sprachdateien werden jetzt beim Server neu validiert (`fetch` mit `cache: "no-cache"`).

**Darstellung:** Sonne, Mond und Sterne werden nach BlueMaps Himmel mit einer eigenen Kamera gezeichnet (gleiche Drehung, Blickwinkel und Seitenverhältnis wie die Kamera der Karte; BlueMaps Himmelskamera behält ihr festes Seitenverhältnis, weil der Himmel nur eine Farbe hat). In der flachen Ansicht (orthografisch) nicht. Wolken und Tropfen liegen in der Marker-Szene; der Tropfen-Shader nutzt den logarithmischen Tiefenpuffer von BlueMaps Renderer.

## 3. Gespeicherte Einstellungen

Wie in Phase 12 unter `live.<key>`: `nameTags`, `healthBars`, `followMode`, `weather`, `category.hostile`, `category.animals`, `category.other`, `category.items`, `category.vehicles`. Die Voreinstellung wird nicht gespeichert, sondern aus den Werten erkannt.

## 4. Tests

**Automatisiert:**

| Test | Ergebnis |
|---|---|
| Node `npm test` | 176/176, neu `Weather.test.mjs` (6), `QualityPresets.test.mjs` (2); in `LiveEntities.test.mjs` Kategorien, Einstellungen, Beschriftung, Folgekamera; in `WorldTime.test.mjs` Mondphase, Uhr, Wetter, Live-Anzeige |
| JUnit lokal | 96/96, Texturfilter für Himmel und Wetter |
| Browser `qol-e2e.mjs` (neu) | 14/14: Filter nach Kategorie, Schalter im Menü, Namensschild, Lebensbalken (Mob und Spieler, Spielername ausgeblendet), Entfernen der Beschriftung, Uhr mit Wetter und Mondphase, Live-Anzeige grün → gelb → rot → grün, Voreinstellungen, Ego- und Schulterkamera (Position, Modell aus/an), Sonne mittags senkrecht (Pixel), Mond der Phase 2 um Mitternacht (Pixel), Regen, Schnee, kein Niederschlag, Blitz hellt die Karte auf und klingt ab, Wolken von oben (Pixel), Abschalten |
| Browser `display`, `particles`, `blocks`, `worldtime`, `entities`, `mobs`, `playback`, `animation`, `items`, `player` | 6/6, 13/13, 15/15, 9/9, 12/12, 15/15, 6/6, 19/19, 16/16, 22/22. `particles`: Die Prüfung „nichts mehr gezeichnet“ wartet jetzt auf das nächste Bild (die Gruppe wird ein Bild nach dem letzten Partikel ausgeblendet; vorher gelegentlich fehlgeschlagen). |
| Regression gegen das Original | in dieser Phase nicht erneut ausgeführt |

Die Fabric-Seite (Spawn-Gruppe, Lebenspunkte, Biom-Niederschlag, Mondphase) wird nur im CI kompiliert und ist nicht gegen ein laufendes Minecraft getestet.

**Manuell in Minecraft:** Q42–Q48 in `singleplayer-test.md`, offen.
