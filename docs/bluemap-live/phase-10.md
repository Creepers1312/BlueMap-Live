# BlueMap Live – Phase 10: Effekte und Partikel (0.4.0)

Stand: 2026-10-16 · Branch `bluemap-live` · Wunsch des Nutzers („Effekte und Partikel wie Creeper-Explosion, Tränke, Rauch“), vor die Blockänderungen gezogen

> **Kurzfassung:**
> - **Explosionen:** Creeper, TNT, Ghast-Feuerball, Witherschädel, Endkristall. Große Explosion oder einzelne Wolke wie in Vanilla.
> - **Tränke:** farbige Wirbel an Spielern und Mobs mit Effekten, Ring beim Zerbrechen eines Wurf- oder Verweiltranks, Wolke des Verweiltranks.
> - **Feuer:** brennende Spieler, Mobs, Gegenstände und Pfeile mit den animierten Flammen von Vanilla.
> - **Tod:** Rauchwolke („poof“) am Ende der Todesanimation.
> - Partikel-Regeln und Texturen wie im Spiel (aus dem CI-Dump von Minecraft 1.21 und dem Ressourcenpaket), ohne Kollision mit Blöcken.
> - **Nicht in Minecraft geprüft:** offen, siehe `singleplayer-test.md` (Q27–Q31).

## 1. Was der Server sendet

Ohne Mixins: Alles wird aus dem Zustand der Entities gelesen oder beim Entfernen einer Entity erkannt.

**Partikel einer Entity oder eines Spielers** (`ParticleState`, in `entities.json` und, als erweiterte Daten, in `players.json` unter `particles`):

| Feld | Bedeutung | Vanilla-Quelle |
|---|---|---|
| `fire` | wird brennend gezeichnet | `Entity.doesRenderOnFire` |
| `swirls` | Farben (ARGB) der Trankwirbel, höchstens 16 | `StatusEffectInstance.createParticle` der Effekte mit `shouldShowParticles`, nur `entity_effect` |
| `ambient` | alle sichtbaren Effekte sind „ambient“ (Leuchtfeuer) | `LivingEntity.containsOnlyAmbientEffects` |
| `invisible` | unsichtbar (weniger Wirbel) | `Entity.isInvisible` |
| `cloud` | Wolke des Verweiltranks: `radius`, `color` (ARGB), `waiting` | `AreaEffectCloudEntity.getRadius`, `getParticleType`, `isWaiting` |

Wolken (`minecraft:area_effect_cloud`) werden dafür mit abgetastet. Sie haben kein Modell, die Webapp zeigt nur ihre Partikel.

**Effekte** (`LiveEffect`, in `entities.json` unter `effects`): `{id, type, x, y, z, power?, destroy?, color?, time}`, `type` ist `explosion`, `splash` oder `instant_splash`. Jede Welt hat ein `LiveEffectLog`: Effekte bleiben 6 s darin (höchstens 256), damit jeder Browser sie mindestens einmal sieht; die `id` ist eindeutig. Gesendet werden nur Effekte im Umkreis eines angezeigten Spielers (wie die Entities).

**Erkennung beim Entfernen** (`ServerEntityEvents.ENTITY_UNLOAD`, `FabricParticles.onRemoved`), mit den Bedingungen aus dem Vanilla-Code:

| Auslöser | Bedingung | Stärke, Blockschaden |
|---|---|---|
| Creeper | `DISCARDED`, Zündzeit abgelaufen (`getClientFuseTime(1) = fuseTime / (fuseTime − 2)`) | `ExplosionRadius` × 2 bei geladenem Creeper, Schaden nach `mobGriefing` |
| TNT | `DISCARDED`, `getFuse() <= 0`, Höhe `getBodyY(0.0625)` | 4, Schaden |
| Ghast-Feuerball | `DISCARDED`, Besitzer nicht entfernt, Chunk geladen | `ExplosionPower`, Schaden nach `mobGriefing` |
| Witherschädel | wie Feuerball | 1, kein Schaden |
| Endkristall | `KILLED` | 6, Schaden |
| Wurf-/Verweiltrank | `DISCARDED`, nicht im Void | Farbe `PotionContentsComponent.getColor`, `instant_splash` bei einem Sofort-Trank (Weltereignis 2007, sonst 2002), Mitte des Blocks |

Das Entfernen beim Entladen von Chunks (`UNLOADED_TO_CHUNK`, `UNLOADED_WITH_PLAYER`) zählt nicht. Nur aktiv, wenn Live-Entities eingeschaltet sind.

**Texturen:** Die Partikeltexturen (`particle/explosion_0..15`, `effect_0..7`, `spell_0..7`, `generic_0..7`) und `block/fire_0`, `block/fire_1` werden wie die Rüstungstexturen unter `assets/textures/` bereitgestellt (`ParticleState.TEXTURES`), nur von Minecraft, nur diese. Angefordert werden sie erst, wenn etwas Partikel erzeugt.

## 2. Was die Webapp zeigt (`markers/particles/`)

**Simulation** (`LiveParticles.js`): 20 Ticks pro Sekunde, gezeichnet zwischen zwei Ticks interpoliert, wie im Spiel. Umgesetzt nach dem CI-Dump:
- `Particle`: Lebensdauer `4 / (rand × 0,9 + 0,1)`, Zufallsanteil und -länge der Geschwindigkeit, Schwerkraft `0,04 × gravityStrength`, Dämpfung pro Tick, neue Partikel erst ab dem nächsten Tick (`ParticleManager.newParticles`).
- `ExplosionLargeParticle` („explosion“): 6–9 Ticks, grau 0,4–1, halbe Größe `2 × (1 − param × 0,5)`, Sprite nach Alter, voll hell.
- `ExplosionEmitterParticle`: 8 Ticks lang je 6 Explosionen im Würfel ±4.
- `SpellParticle` („entity_effect“, „effect“, „instant_effect“): steigt langsam, Farbe und Alpha des Effekts, Sprites groß → klein.
- `ExplosionSmokeParticle` („poof“).
- **Auslöser:** `Explosion.affectWorld` (einzelne Explosion bei Stärke < 2 oder ohne Blockschaden, sonst der Emitter), Weltereignis 2002/2007 (100 Partikel im Ring), `LivingEntity.tickStatusEffects` (Wirbel mit Wahrscheinlichkeit 1/4, ambient 1/20, unsichtbar 1/15), `AreaEffectCloudEntity.tick` (⌈π r²⌉ pro Tick auf der Scheibe, wartend 2 oder keine, teils weiß), `LivingEntity.addDeathParticles` (20 × poof).
- Höchstens 4000 Partikel, höchstens 10 Ticks pro Bild.

**Feuer** (`fireLayers`): wie `EntityRenderDispatcher.renderFire`, Breite × 1,4, Ebenen alle 0,45, zur Kamera gedreht (nur um die Hochachse), `fire_0`/`fire_1` im Wechsel, animiert nach der `.mcmeta` (`fire_0`: Bilder 16–31, dann 0–15).

**Zeichnen** (`ParticleView.js`): Alle Sprites kommen in einen Atlas (eine Zelle pro Sprite bzw. Animationsbild). Pro Bild werden alle Partikel als Vierecke in zwei Meshes geschrieben: „lit“ (Explosion, Feuer: voll hell) und „shaded“ (nachts dunkler wie die Entities). Alpha < 0,1 wird verworfen wie im Partikel-Shader. Nicht anklickbar.

**Zeitpunkt:** Effekte erscheinen zur Wiedergabezeit (Phase 9) wie die Entities. Auch das Entfernen einer Entity läuft jetzt über die Wiedergabe: Ein Creeper verschwindet zusammen mit seiner Explosion und nicht eine Wiedergabeverzögerung früher. Ohne Glättung wird sofort entfernt wie bisher. Effekte, die beim Öffnen der Karte schon älter sind, werden nicht nachgeholt.

**Ausgeblendet:** Ist das Set „Entities“ ausgeblendet, werden keine Partikel gezeichnet und keine Effekte gezeigt.

## 3. Abweichungen von Vanilla (bewusst)

- Partikel kollidieren nicht mit Blöcken (die Webapp kennt keine Blockkollision). Betrifft vor allem die Rauchwolke, die im Spiel am Boden liegen bleiben kann.
- Licht: Partikel werden mit dem gemeinsamen Entity-Licht abgedunkelt, nicht mit dem Licht an ihrer Position.
- Nicht gezeigt: die 8 Glassplitter beim Zerbrechen eines Tranks, Trank-Partikel ohne Farbe (z. B. Befall, Schleim, Weben), Wolken mit anderen Partikeln (Drachenatem), Explosionen von Betten, Seelenankern, TNT-Loren, Windkugeln, Partikel unsichtbarer Mobs (diese werden nicht übertragen).
- Endkristall: Ein Kristall, der selbst durch eine Explosion zerstört wird, explodiert in Vanilla nicht. Das ist beim Entfernen nicht erkennbar; bei Kettenreaktionen zeigt die Karte eine Explosion pro Kristall.

## 4. Tests

**Automatisiert:**

| Test | Ergebnis |
|---|---|
| Node `npm test` | 140/140, neu `Particles.test.mjs` (15): Daten-Validierung, Sprite-Auswahl, Explosion und Emitter (6 × 8), neue Partikel erst ab dem nächsten Tick, Trankwirbel (Farbe, Alpha, Wahrscheinlichkeiten), Wolke, Wurftrank, Tod, Obergrenzen, Feuer-Ebenen, Atlas, geplantes Entfernen ohne Einfluss auf die Uhr |
| JUnit lokal | 80/80, neu `LiveParticlesTest` (JSON von Partikeln und Effekten, Effekt-Log), Effekte im Umkreis und Texturanforderung im Data-Supplier, Texturfilter für Partikel |
| Browser `particles-e2e.mjs` | 13/13: kleine und große Explosion (Pixel), einmalige Anzeige, Wurftrank (Pixel), Trankwirbel, Verweilwolke (Pixel), brennender Mob (Pixel, animiert), brennender Spieler mit Wirbeln, Rauch beim Tod, ausgeblendetes Set, Entfernen zusammen mit der Explosion bei 750 ms Glättung, keine alten Effekte nach dem Neuladen |
| Browser übrige Suiten | siehe unten |

Die Fabric-Seite (`FabricParticles`) wird nur im CI kompiliert; die Erkennung der Explosionen ist nicht automatisch gegen ein laufendes Minecraft getestet.

**Manuell in Minecraft:** Q27–Q31 in `singleplayer-test.md`, offen.
