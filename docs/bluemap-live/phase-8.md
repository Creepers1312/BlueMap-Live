# BlueMap Live – Phase 8: Tag-Nacht-Zyklus der Welt und weitere Mob-Details

Stand: 2026-10-16 · Branch `bluemap-live` · Wunsch des Nutzers nach Phase 7

> **Kurzfassung:**
> - **Implementiert:**
>   - Die Kartenbeleuchtung kann dem Tag-Nacht-Zyklus der Minecraft-Welt folgen. Das ist eine zusätzliche Auswahl neben BlueMaps eigenem Tag/Nacht-Schalter.
>   - Der sichtbare Schlag der Mobs.
>   - Sitz-, Liege- und Schlafposen.
>   - Farben der Tropenfische, Größen der Kugelfische.
>   - Halsbänder, Lama-Teppiche, Pferderüstung, voll beleuchteter Leuchttintenfisch.
>   - Gegenstände auf dem Kopf (geschnitzter Kürbis, Blöcke).
> - **Woher die Werte stammen:** Die neuen Animationen und Feature-Renderer sind aus dem Bytecode von Minecraft 1.21.1 nachgebaut. Ein CI-Test gibt dazu die Instruktionen der Vanilla-Methoden aus (`VanillaAnimationDumpTest`), siehe Abschnitt 3.
> - **Nicht geprüft:** Minecraft (manuelle Prüfungen Q1–Q16 offen).

## 1. Tag-Nacht-Zyklus der Welt

**Server** (`FabricMod`, Server-Thread, im Takt der Live-Daten):
- Für jede Welt ohne feste Zeit (Oberwelt, nicht Nether und Ende) werden gelesen:
  - die Tageszeit (`getTimeOfDay() mod 24000`)
  - Regen- und Gewitterstärke
  - die Spielregel `doDaylightCycle`
- **Daten** in `players.json` der Karte, nur mit `live-player-extended-data`:
  ```json
  "world": {"dayTime": 13000, "rain": 0.0, "thunder": 0.0, "cycle": true}
  ```
- Ohne Feld (alter Server, Nether, Ende) bleibt alles wie bisher.

**Webapp** (`WorldTime.js`, `WorldTimeLighting.js`):
- **Helligkeit:** Das Sonnenlicht der Karte folgt dem Himmelslicht des Servers wie `World.calculateAmbientDarkness` (Sonnenwinkel wie `DimensionType.getSkyAngle`).
  - Werte: Tag 1, Nacht 4/15. Regen und Gewitter dunkeln ab.
  - Anders als in Minecraft wird nicht auf ganze Lichtstufen gerundet. Der Übergang ist dadurch fließend.
- **Zwischen den Abfragen** läuft die Zeit mit 20 Ticks pro Sekunde weiter (nicht bei `doDaylightCycle false`). Die Beleuchtung wird einmal pro Sekunde nachgeführt und nur bei einer Änderung neu gezeichnet.
- **Bedienung:**
  - Ein Uhr-Knopf direkt neben dem Tag/Nacht-Schalter und ein Schalter „Tag-Nacht-Zyklus der Welt“ im Einstellungsmenü unter „Beleuchtung“.
  - Beide erscheinen nur, wenn der Server die Zeit liefert. Standard: aus, das ursprüngliche Verhalten.
  - Der eigene Tag/Nacht-Schalter und der Sonnenlicht-Regler beenden den Modus.
  - Die Wahl wird mit den anderen Benutzereinstellungen gespeichert (nur mit `useCookies`, wie im Original).
- **Lebewesen und Gegenstände:**
  - Spieler, Mobs und Items werden jetzt wie die Karte im Freien beleuchtet, d. h. nachts dunkler: Farbe · mix(Umgebungslicht, 1, Sonnenlicht).
  - Das gilt auch für BlueMaps eigenen Schalter und die Regler.
  - Leuchtende Teile (Augen von Spinne und Enderman, Energiehülle) bleiben hell wie in Minecraft.
  - Das Blocklicht am Ort des Lebewesens wird nicht berücksichtigt (Näherung: draußen).

**Einschränkungen:**
- Der Himmel der Karte ist BlueMaps eigener (keine Sonne, kein Mond, keine Sterne).
- Das Licht der Karte ist BlueMaps Shader: `mix(Blocklicht, Himmelslicht, Sonnenlicht)`. In Minecraft wird stattdessen die Verdunkelung vom Himmelslicht abgezogen. Höhlen und Innenräume können dadurch leicht anders wirken.

## 2. Sichtbarer Schlag der Mobs

**Server** (`FabricMobs`):
- **Armschwung:** `handSwingTicks`, solange `handSwinging` gesetzt ist, und die schwingende Hand.
  - Nur für feindliche Mobs (`HostileEntity`): Nur deren `tickMovement` lässt den Schwung auf dem Server weiterlaufen.
  - Das betrifft u. a. Zombies, Skelette, Piglins, Diener und Hexen.
- **Angriffs-Zähler** der Modelle mit eigener Angriffsanimation:
  - Eisengolem: `getAttackTicksLeft`
  - Verwüster: `getAttackTick`
  - Hoglin und Zoglin: `getMovementCooldownTicks`
- **Daten:** `mob.swingTicks` und `mob.attackTicks` in `entities.json`, nur wenn gesetzt. Die schwingende Nebenhand ist die Flag `swing_off_hand`.
- **Abtastung:** Ein Armschwung dauert 6 Ticks. Beim Standardtakt von 250 ms (5 Ticks) wird so jeder Schwung mindestens einmal erfasst. Bei längeren Intervallen können einzelne Schwünge fehlen.

**Webapp:**
- **Zeitverlauf:**
  - Schwung und Angriff laufen zwischen den Abfragen lokal weiter.
  - Eine weitere Abfrage desselben Schwungs startet ihn nicht neu. Nur ein neuer, früherer Fortschritt beginnt einen neuen.
- **Animationen:**
  - Armschwung wie `BipedEntityModel.animateArms`, mit dem Arm aus `getPreferredArm`: Der Körper dreht sich mit, der Arm schlägt.
  - Zombies, Skelette, Piglins und Diener nutzen den Fortschritt zusätzlich in ihren Angriffsposen (`CrossbowPosing.meleeAttack` usw.).
  - Eisengolem wie `IronGolemEntityModel.animateModel`: beide Arme `-2 + 1,5 · wrap(Zähler, 10)`.
  - Hoglin und Zoglin wie `HoglinEntityModel.setAngles`: Der Kopf wird bis −20° hochgerissen.
  - Verwüster wie `RavagerEntityModel.animateModel`: Der Hals stößt 12 px nach vorn, das Maul öffnet sich.
- **Prüfung der Werte:**
  - Die Ruhewerte stimmen mit den CI-geprüften Modelldaten überein: Hoglin-Kopf 0,87266463, Verwüster-Hals bei z = 5,5.
  - Die Formeln selbst sind nicht automatisch gegen Minecraft geprüft.

**Nicht gezeigt:**
- Angriff des Wardens (Keyframe-Animation).
- Betäubter oder brüllender Verwüster.
- Schwünge friedlicher Mobs, z. B. des Allays (deren Schwung läuft nur im Client).

## 3. Vanilla-Code als Quelle (`VanillaAnimationDumpTest`)

- **Was der Test tut:**
  - Er liest im CI ausgewählte Klassen des yarn-gemappten Minecraft-Jars mit ASM.
  - Nichts wird ausgeführt. Er schreibt die Instruktionen als Annotationen, in einem eigenen CI-Job mit vier Teilen (je höchstens 50 Annotationen).
- **Wie die Werte übernommen wurden:**
  - Die Werte in der Webapp stammen aus diesen Instruktionen, nicht aus dem Gedächtnis.
  - Wo eine frühere Version aus dem Gedächtnis gebaut war, wurde sie gegen den Dump geprüft: Eisengolem, Hoglin, Verwüster, Armschwung, Kugelfisch-Flossen.
  - Dabei korrigiert: das leicht geöffnete Maul des ruhenden Verwüsters (π·0,01), Mähne und Babykopf des Hoglins.
- **Die neuen Modellebenen** prüft der bestehende Modelltest:
  - Katzenhalsband, Lama-Teppich und Pferderüstung.
  - Ihre Dilatationen (0,01, 0,5, 0,1) stammen aus `EntityModels.getModels`.
- **Die Farbstoff-Farben** (`dyeColors`, `DyeColor.getEntityColor`) prüft der Modelltest wie die Schaffarben.

## 4. Posen

**Server** (Flags):
- `in_bed` mit `bed_<richtung>` und `bedOffset`
- Fuchs `sleeping` und `sitting`
- Katze `lying` und `head_down`
- Panda `sitting`, `lying_on_back` und `eating`
- Eisbär `warning`, Gürteltier `rolled_up`, Kamel `sitting`
- Wolf und Katze `sitting` wie bisher

**Webapp:**

| Mob | Vanilla-Quelle | Gezeigt |
|---|---|---|
| Wolf | `WolfEntityModel.animateModel` | Sitzen |
| Katze, Ozelot | `OcelotEntityModel`, `CatEntityModel`, `CatEntityRenderer.setupTransforms` | Stehen, Sitzen, Liegen auf der Seite, Kopf gesenkt |
| Fuchs | `FoxEntityModel` | Sitzen, Schlafen (eingerollt, Beine ausgeblendet) |
| Panda | `PandaEntityModel`, `PandaEntityRenderer.setupTransforms` | Sitzen (auch fressend), auf dem Rücken liegen |
| Eisbär | `PolarBearEntityModel.setAngles` | Aufrichten |
| Mobs im Bett (Dorfbewohner) | `LivingEntityRenderer.render` und `setupTransforms` | nach der Bettrichtung gedreht, liegend, zum Kopfende verschoben |

- **Übergänge:** Wie in Minecraft laufen sie über Fortschrittswerte pro Tick.
  - Katze: Liegen +0,15/−0,22, Schwanz +0,08/−0,13, Kopf +0,1/−0,13
  - Panda: +0,15/−0,19
  - Eisbär: ±1/6
- **Nicht gezeigt:**
  - Rollen des Gürteltiers und Sitzen des Kamels (Keyframe-Animationen)
  - Schleichen und Springen des Fuchses
  - Niesen, Spielen und Gewitterangst des Pandas
  - Schlafende Spieler

## 5. Tropenfische und Kugelfische

- **Tropenfische:** Der Server sendet Grund- und Musterfarbe (`base_<farbe>`, `pattern_<farbe>`). Wie `TropicalFishEntityRenderer` und `TropicalFishColorFeatureRenderer` wird der Körper in der Grundfarbe und das Muster in der Musterfarbe eingefärbt.
- **Kugelfische:** Der Aufblähzustand (`puff_1`, `puff_2`) wählt wie `PufferfishEntityRenderer` das kleine, mittlere oder große Modell. Beim Aufblähen wird das Modell gewechselt; die Seitenflossen schlagen wie in `setAngles`.

## 6. Halsbänder, Teppiche, Pferderüstung, Leuchten

| Ebene | Vanilla | Bedingung |
|---|---|---|
| Wolfshalsband | `WolfCollarFeatureRenderer`: Wolfsmodell, `wolf_collar` in der Halsbandfarbe | gezähmt |
| Katzenhalsband | `CatCollarFeatureRenderer`: Halsbandmodell (Dilatation 0,01) | gezähmt |
| Lama-Teppich | `LlamaDecorFeatureRenderer`: Dekormodell (0,5), `decor/<farbe>`; Händlerlama ohne Teppich: `trader_llama` | Teppich oder Händlerlama |
| Pferderüstung | `HorseArmorFeatureRenderer`: Rüstungsmodell (0,1), Lederrüstung in ihrer Farbe | Rüstung vom Typ „equestrian“ |
| Leuchttintenfisch | `GlowSquidEntityRenderer.getBlockLight`: Blocklicht 15 | immer voll beleuchtet, auch nachts |

- **Noch offen:** die Leuchtschichten des Wardens.
  - Fünf durchscheinend-emissive Ebenen mit eigener Helligkeit und eigenen Teilen.
  - Welche Teile und welche Helligkeit zu welcher Ebene gehören, liefert der nächste CI-Dump.

## 7. Gegenstände auf dem Kopf

- **Server:** Ein Gegenstand im Kopf-Slot, der kein Helm ist, wird als `equipment.head` gesendet, für Spieler und Mobs.
- **Webapp:** Wie `HeadFeatureRenderer`, Zweig für Gegenstände:
  - Kette: Skalierung des Renderers (Piglins 1,0019531), bei Babys außer Dorfbewohnern (0, 1/32) · 0,7 · (0, 1), dann die Drehung des Kopfes.
  - Danach (0, −0,25, 0), 180° um y, Skalierung (0,625, −0,625, −0,625), bei Dorfbewohnern 0,1875 höher.
  - Zuletzt das Item mit seiner `head`-Transformation. Der Baker gibt sie jetzt mit aus, `ASSET_VERSION` ist 4.
- **Wer ihn trägt:**
  - Spieler, Zombies, Skelette, Piglins, Illager, Dorfbewohner, Zombiedorfbewohner und der fahrende Händler.
  - Nicht der Riese: Sein Renderer hat keinen `HeadFeatureRenderer`.
- **Noch offen:** Köpfe (Schädel-Blöcke) auf dem Kopf haben ein eigenes Schädelmodell und werden noch nicht gezeigt.

## 8. Tests

**Automatisiert:**

| Test | Ergebnis |
|---|---|
| Java (lokal) | 63/63, u. a. `world` in `players.json` nur mit erweiterten Daten, `swingTicks` und `attackTicks` nur wenn gesetzt |
| Node | 107/107, zuletzt neu: Posen (Wolf, Katze, Fuchs, Panda, Eisbär, Bett), Kugelfisch-Modellwechsel, Tropenfischfarben, Halsbänder, Teppiche, Pferderüstung, Kopf-Slot; davor 100/100, u. a. Sonnenwinkel, Himmelslicht (Tag, Nacht, Regen, Gewitter), Weiterlaufen der Zeit, Beleuchtung der Lebewesen, Ein- und Ausschalten; Eisengolem-, Hoglin- und Verwüster-Angriff, Körperdrehung beim Schwung (Haupt- und Nebenhand), lokaler Ablauf ohne Neustart |
| Browser `worldtime-e2e.mjs` | 9/9: Knopf nur mit Weltzeit, Mitternacht dunkelt die Karte ab (Pixel), Mittag, Regen, Speichern/Laden, eigener Schalter beendet den Modus, Einstellungsmenü |
| Browser `mobs-e2e.mjs` | 13/13, neu: Zombie schwingt (Körper dreht sich und kehrt zurück), Eisengolem schlägt mit beiden Armen, Tropenfisch in Grund- und Musterfarbe (Pixel), Block auf dem Kopf eines Zombies (Pixel) |
| Browser `entities`, `items`, `animation` | 12/12, 16/16, 19/19 |
| Browser `player-e2e.mjs` | 22/22 nach der Tag-Nacht-Änderung; in späteren Läufen 21/22 (s. u.) |

- Ein Lauf von `animation-e2e.mjs` schlug einmal bei der Gehamplitude nach Skinwechsel fehl, zwei Wiederholungen liefen fehlerfrei durch (Zeitabhängigkeit des Tests).
- `player-e2e.mjs`, Schritt „skin (slim)“: Ein Farbpixel am linken Arm weicht ab. Derselbe Fehler tritt mit dem Webclient-Stand vor Phase 8 (`e41baa29`) auf. Er stammt also nicht aus diesen Änderungen; die Ursache ist noch nicht geklärt.
- Der Fabric-Teil kompiliert nur in der CI.

**Manuell in Minecraft:** Q1–Q6 in `singleplayer-test.md`, alle offen.
