# BlueMap Live – Phase 8: Tag-Nacht-Zyklus der Welt und weitere Mob-Details

Stand: 2026-10-16 · Branch `bluemap-live` · Wunsch des Nutzers nach Phase 7

> **Kurzfassung:**
> - **Implementiert:**
>   - Die Kartenbeleuchtung kann dem Tag-Nacht-Zyklus der Minecraft-Welt folgen. Das ist eine zusätzliche Auswahl neben BlueMaps eigenem Tag/Nacht-Schalter.
>   - Der sichtbare Schlag der Mobs.
>   - Sitz-, Liege- und Schlafposen.
>   - Farben der Tropenfische, Größen der Kugelfische.
>   - Halsbänder, Lama-Teppiche, Pferderüstung, Leuchtschichten des Wardens, voll beleuchteter Leuchttintenfisch.
>   - Gegenstände auf dem Kopf (geschnitzter Kürbis, Blöcke) und Köpfe (Schädel).
>   - Rüstungsverzierungen und Verzauberungsglanz der Rüstung.
> - **Woher die Werte stammen:** Die neuen Animationen und Feature-Renderer sind aus dem Bytecode von Minecraft 1.21.1 nachgebaut. Ein CI-Test gibt dazu die Instruktionen der Vanilla-Methoden aus (`VanillaAnimationDumpTest`), siehe Abschnitt 3.
> - **In Minecraft geprüft** (Rückmeldung des Nutzers): Tag-Nacht-Zyklus, Kopf-Gegenstände, Tropenfische, Schlagposen, Rüstung, Pandas, Glanz und Sitzpose, nach den Korrekturen in Abschnitt 9. Nicht einzeln zurückgemeldet: siehe `singleplayer-test.md`.

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

**Warden** (`WardenEntityRenderer`, `WardenFeatureRenderer`, `WardenEntityModel`):
- Die Ebenen sind durchscheinend-emissiv: nicht abgedunkelt, mit eigener Deckkraft.
- Jede Ebene zeichnet nur die eigenen Quader ihrer Teile, wie das vanilla `hidden`.

| Ebene | Deckkraft | Teile | Gezeigt |
|---|---|---|---|
| `warden_bioluminescent_layer` | 1 | Kopf, Arme, Beine | ja |
| `warden_pulsating_spots_1` | max(0, cos(Alter · 0,045) · 0,25) | Körper, Kopf, Arme, Beine | ja |
| `warden_pulsating_spots_2` | dasselbe um π versetzt | Körper, Kopf, Arme, Beine | ja |
| `warden` (Ranken) | Rankenausschlag | Ranken | nein |
| `warden_heart` | Herzschlag | Körper | nein |

- Herzschlag und Ranken laufen nur im Client von Minecraft (Wut und Vibrationen) und werden nicht abgetastet.

## 7. Gegenstände auf dem Kopf

- **Server:** Ein Gegenstand im Kopf-Slot, der kein Helm ist, wird als `equipment.head` gesendet, für Spieler und Mobs.
- **Webapp:** Wie `HeadFeatureRenderer`, Zweig für Gegenstände:
  - Kette: Skalierung des Renderers (Piglins 1,0019531), bei Babys außer Dorfbewohnern (0, 1/32) · 0,7 · (0, 1), dann die Drehung des Kopfes.
  - Danach (0, −0,25, 0), 180° um y, Skalierung (0,625, −0,625, −0,625), bei Dorfbewohnern 0,1875 höher.
  - Zuletzt das Item mit seiner `head`-Transformation. Der Baker gibt sie jetzt mit aus, `ASSET_VERSION` ist 4.
- **Wer ihn trägt:**
  - Spieler, Zombies, Skelette, Piglins, Illager, Dorfbewohner, Zombiedorfbewohner und der fahrende Händler.
  - Nicht der Riese: Sein Renderer hat keinen `HeadFeatureRenderer`.
**Köpfe** (`HeadFeatureRenderer`, Schädel-Zweig, und `SkullBlockEntityRenderer`):
- **Kette:** Skalierung (1,1875, −1,1875, −1,1875), bei Dorfbewohnern 1/16 höher, dann (−0,5, 0, −0,5) und `renderSkull`: (0,5, 0, 0,5), Skalierung (−1, −1, 1), Kopf um 180° gedreht.
- **Modelle** wie `getModels`, im Modelltest geprüft:
  - Schädel (Skelett, Witherskelett, Creeper)
  - Kopf mit Hut-Ebene (Spieler, Zombie)
  - Drachenkopf mit Kiefer, Piglinkopf mit Ohren
- **Bewegung:** Kiefer und Ohren bewegen sich wie `setHeadRotation` mit der Laufbewegung des Mobs. Beim Spieler stehen sie still.
- **Texturen:** wie `SkullBlockEntityRenderer.TEXTURES`. Spielerköpfe zeigen den Standard-Skin; der Skin des Kopf-Besitzers ist nicht bekannt.

## 7a. Rüstungsverzierungen und Verzauberungsglanz

**Verzierungen:**
- Der Server ermittelt den Sprite-Namen mit Vanillas `ArmorTrim.getGenericModelId` bzw. `getLeggingsModelId`, z. B. `trims/models/armor/coast_leggings_iron_darker`. Die `_darker`-Varianten für gleiche Materialien entstehen dabei wie im Spiel.
- Der Baker erzeugt das Bild wie `PalettedPermutationsAtlasSource`:
  - Die Farben des Schlüssels `trim_palette` werden auf die Palette des Materials abgebildet.
  - Die Deckkraft eines Pixels wird mit der Deckkraft der Palettenfarbe multipliziert.
  - Unbekannte Farben bleiben.
- Die Permutationen heißen wie ihre Paletten; das bestätigt die Vanilla-Datei `atlases/armor_trims.json` im CI-Dump.
- Die Verzierung liegt als weitere Ebene über der Rüstung, wie `renderTrim` nach den Material-Ebenen.

**Glanz** (`ArmorFeatureRenderer.renderGlint` mit `RenderLayer.ARMOR_ENTITY_GLINT`):
- **Textur und Bewegung:** `enchanted_glint_entity` (weich gefiltert, wiederholt), bewegt mit der Texturmatrix von `setupGlintTexturing(0.16)`.
  - t = ms · Geschwindigkeit · 8
  - Verschiebung (−(t mod 110000)/110000, (t mod 30000)/30000), Drehung 10°, Skalierung 0,16
- **Darstellung:**
  - Mischung SRC_COLOR/ONE (Alpha ZERO/ONE).
  - Nur wo die Rüstung ist (Tiefentest EQUAL, ohne Tiefenschreiben), ohne Culling.
  - Farbe · Glanzstärke, Pixel mit Alpha unter 0,1 werden verworfen (Shader `rendertype_armor_entity_glint`).
- **Nicht aus dem Dump:** Geschwindigkeit und Stärke sind Client-Einstellungen. Verwendet werden ihre Standardwerte 0,5 und 0,75.
- **Bekannte Abweichung:** Die v-Richtung der Texturkoordinaten ist in der Webapp gespiegelt; der Glanz läuft daher in v in die andere Richtung.
- **Nicht gezeigt:** der Glanz verzauberter Gegenstände in der Hand.

## 8. Tests

**Automatisiert:**

| Test | Ergebnis |
|---|---|
| Java (lokal) | 65/65, neu: Verzierungs-Sprite (Palette, Namensaufteilung), Texturindex für Verzierungen und Glanz; u. a. `world` in `players.json` nur mit erweiterten Daten, `swingTicks` und `attackTicks` nur wenn gesetzt |
| Node | 110/110, zuletzt neu: Warden-Ebenen, Schädel, Glanz; davor 107/107, neu: Posen (Wolf, Katze, Fuchs, Panda, Eisbär, Bett), Kugelfisch-Modellwechsel, Tropenfischfarben, Halsbänder, Teppiche, Pferderüstung, Kopf-Slot; davor 100/100, u. a. Sonnenwinkel, Himmelslicht (Tag, Nacht, Regen, Gewitter), Weiterlaufen der Zeit, Beleuchtung der Lebewesen, Ein- und Ausschalten; Eisengolem-, Hoglin- und Verwüster-Angriff, Körperdrehung beim Schwung (Haupt- und Nebenhand), lokaler Ablauf ohne Neustart |
| Browser `worldtime-e2e.mjs` | 9/9: Knopf nur mit Weltzeit, Mitternacht dunkelt die Karte ab (Pixel), Mittag, Regen, Speichern/Laden, eigener Schalter beendet den Modus, Einstellungsmenü |
| Browser `mobs-e2e.mjs` | 14/14, neu: Skelettschädel auf einem Zombie (Pixel); davor 13/13, neu: Zombie schwingt (Körper dreht sich und kehrt zurück), Eisengolem schlägt mit beiden Armen, Tropenfisch in Grund- und Musterfarbe (Pixel), Block auf dem Kopf eines Zombies (Pixel) |
| Browser `entities`, `items`, `animation` | 12/12, 16/16, 19/19 |
| Browser `player-e2e.mjs` | 22/22 nach der Tag-Nacht-Änderung; in späteren Läufen 21/22 (s. u.) |
| Browser `worldtime-e2e.mjs` (letzter Lauf) | 9/9 |
| Regression gegen das Original (Karte ohne Spieler) | zwei Läufe: 0 Pixel Unterschied bzw. 141 Pixel Rauschen (höchstens 42 von 255 Stufen) |

- Ein Lauf von `animation-e2e.mjs` schlug einmal bei der Gehamplitude nach Skinwechsel fehl, zwei Wiederholungen liefen fehlerfrei durch (Zeitabhängigkeit des Tests).
- `player-e2e.mjs`, Schritt „skin (slim)“: Ein Farbpixel am linken Arm weicht ab.
  - Derselbe Fehler tritt mit dem Webclient-Stand vor Phase 8 (`e41baa29`) auf.
  - Die abweichende Farbe ist immer die des benachbarten Texturfelds, und das Feld wechselt zwischen den Läufen (q0, q2). Vermutete Ursache: Der Test projiziert den Messpunkt vor dem Screenshot, und die Leerlaufbewegung des Arms läuft dazwischen weiter.
  - Nicht aus diesen Änderungen; noch nicht behoben.
- Ein Lauf schlug einmal bei „skin (classic)“ mit einem Randpixel fehl; zwei Wiederholungen liefen fehlerfrei.
- Der Fabric-Teil kompiliert nur in der CI.

**Manuell in Minecraft:** Q1–Q6 in `singleplayer-test.md`, alle offen.

## 9. Korrekturen nach dem Test in Minecraft

| Problem | Ursache | Korrektur |
|---|---|---|
| Rüstung fehlte (lief im Browser-Test) | Im fertigen Spiel gelten Intermediary-Namen. `ArmorItem` hat zwei öffentliche Methoden ohne Parameter, die einen `RegistryEntry` liefern (`getMaterial`, `getEquipSound`); der Namensvergleich griff nur in der Testumgebung. Es entstand ein falscher Texturname. | Auswahl über den generischen Rückgabetyp `RegistryEntry<ArmorMaterial>` oder über den Wert. `Layer.getTexture` wird über das Ergebnis gewählt (`getTextureId` hat dieselbe Signatur), `isDyeable` über den Typ. Die Rückfallregel gilt nur für Rüstungsmaterial-Schlüssel. |
| Sitzender Wolf bzw. Katze „in sich gedreht“, Pandas unsichtbar | Die Transformation des sitzenden Pandas (`PandaEntityRenderer`, 90° nach hinten) galt für jeden Mob mit der Flag `sitting` | Nur noch für Pandas; die Liegetransformation der Katze nur für Katzen |
| Verzauberungsglanz stand still | Die Karte zeichnet nur bei Bewegung neu | Ein sichtbarer Glanz hält das Neuzeichnen am Laufen. Browsertest: Der Glanz bewegt sich ohne andere Bewegung. |
| Warden und Slimes ohne Animation | fehlte | Warden: Laufen und Schwanken wie `WardenEntityModel.setAngles`. Slimes: Strecken und Stauchen wie `SlimeEntity.tick` und `SlimeEntityRenderer.scale` (aus dem CI-Dump). |

**CI:** Der Dump der Vanilla-Methoden läuft nur noch, wenn er von Hand gestartet wird (Actions → CI → „Run workflow“). Das spart vier Jobs pro Push.
