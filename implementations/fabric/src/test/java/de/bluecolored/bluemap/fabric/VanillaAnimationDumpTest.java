/*
 * This file is part of BlueMap, licensed under the MIT License (MIT).
 *
 * Copyright (c) Blue (Lukas Rieger) <https://bluecolored.de>
 * Copyright (c) contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
package de.bluecolored.bluemap.fabric;

import org.junit.jupiter.api.Test;
import org.objectweb.asm.*;

import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

/**
 * Writes the instructions of the vanilla methods that BlueMap Live rebuilds in the webapp (poses, feature-renderers)
 * to <code>build/vanilla-animation-dump.txt</code>, printed by the CI as annotations. So the webapp follows the code of
 * the game instead of guessed values. Nothing is executed, the classes (yarn-names) are only read with ASM.
 */
public class VanillaAnimationDumpTest {

    private static final String MODEL = "net/minecraft/client/render/entity/model/";
    private static final String RENDER = "net/minecraft/client/render/entity/";
    private static final String FEATURE = "net/minecraft/client/render/entity/feature/";

    /** class -> methods (empty: all methods except the model-data) */
    private static final Map<String, Set<String>> METHODS = new LinkedHashMap<>();
    static {
        // riding: the pose of the biped models, the passenger-offsets of the mounts
        METHODS.put(MODEL + "BipedEntityModel", Set.of("setAngles", "animateModel"));
        METHODS.put(MODEL + "PlayerEntityModel", Set.of("setAngles"));
        METHODS.put(MODEL + "IllagerEntityModel", Set.of("setAngles"));
        METHODS.put(MODEL + "VillagerResemblingModel", Set.of("setAngles"));
        METHODS.put(MODEL + "AbstractZombieModel", Set.of("setAngles"));
        METHODS.put(MODEL + "SkeletonEntityModel", Set.of("setAngles"));
        METHODS.put(MODEL + "PiglinEntityModel", Set.of("setAngles"));
        METHODS.put("net/minecraft/entity/Entity", Set.of("updatePassengerPosition", "getPassengerRidingPos", "getPassengerAttachmentPos",
                "getVehicleAttachmentPos", "getRidingOffset"));
        // boats and minecarts: renderers, models (paddles), paddle-phases, passenger-positions
        METHODS.put(RENDER + "BoatEntityRenderer", Set.of());
        METHODS.put(MODEL + "BoatEntityModel", Set.of());
        METHODS.put(MODEL + "RaftEntityModel", Set.of());
        METHODS.put(MODEL + "ChestBoatEntityModel", Set.of());
        METHODS.put(MODEL + "ChestRaftEntityModel", Set.of());
        METHODS.put(RENDER + "MinecartEntityRenderer", Set.of());
        METHODS.put(MODEL + "MinecartEntityModel", Set.of());
        METHODS.put("net/minecraft/entity/vehicle/BoatEntity", Set.of("tick", "interpolatePaddlePhase", "isPaddleMoving",
                "updatePassengerPosition", "getPassengerAttachmentPos", "getVariant", "clampPassengerYaw", "getMaxPassengers"));
        // leashes: the rope (MobEntityRenderer), the knot on fences, the attachment points of mobs, players and boats
        METHODS.put(RENDER + "MobEntityRenderer", Set.of());
        METHODS.put(RENDER + "LeashKnotEntityRenderer", Set.of());
        METHODS.put(MODEL + "LeashKnotEntityModel", Set.of());
        METHODS.put("net/minecraft/entity/Leashable", Set.of());
        METHODS.put("net/minecraft/entity/Entity", Set.of("updatePassengerPosition", "getPassengerRidingPos", "getPassengerAttachmentPos",
                "getVehicleAttachmentPos", "getRidingOffset", "getLeashPos", "getLeashOffset"));
        METHODS.put("net/minecraft/entity/player/PlayerEntity", Set.of("getLeashOffset", "getLeashPos"));
        METHODS.put(RENDER + "EntityRenderer", Set.of("render", "renderLeash", "renderLeashSegment", "renderLeashPiece", "shouldRender"));
        METHODS.put("net/minecraft/entity/decoration/LeashKnotEntity", Set.of("getLeashPos", "getLeashOffset", "<init>"));
        METHODS.put("net/minecraft/entity/vehicle/BoatEntity", Set.of("tick", "interpolatePaddlePhase", "isPaddleMoving",
                "updatePassengerPosition", "getPassengerAttachmentPos", "getVariant", "clampPassengerYaw", "getMaxPassengers", "getLeashOffset"));
        // effects and particles: explosions, potion swirls, splash potions, lingering clouds, death poof, fire overlay
        METHODS.put("net/minecraft/client/particle/ExplosionLargeParticle", Set.of());
        METHODS.put("net/minecraft/client/particle/ExplosionEmitterParticle", Set.of());
        METHODS.put("net/minecraft/client/particle/SpellParticle", Set.of());
        METHODS.put("net/minecraft/client/particle/SpriteBillboardParticle", Set.of());
        METHODS.put("net/minecraft/client/particle/BillboardParticle", Set.of());
        METHODS.put("net/minecraft/client/particle/AnimatedParticle", Set.of());
        METHODS.put("net/minecraft/client/particle/ExplosionSmokeParticle", Set.of());
        METHODS.put("net/minecraft/client/particle/Particle", Set.of("<init>", "tick", "move", "getMaxAge", "setMaxAge", "scale", "setColor", "setAlpha"));
        METHODS.put("net/minecraft/world/explosion/Explosion", Set.of("affectWorld", "<init>", "getParticle"));
        METHODS.put("net/minecraft/client/network/ClientPlayNetworkHandler", Set.of("onExplosion", "onEntityStatus"));
        METHODS.put("net/minecraft/entity/LivingEntity", Set.of("getPassengerRidingPos", "getPassengerAttachmentPos", "getLeashPos",
                "tickStatusEffects", "updatePostDeath", "handleStatus", "addDeathParticles", "updatePotionVisibility"));
        METHODS.put("net/minecraft/entity/projectile/thrown/PotionEntity", Set.of("onCollision", "applySplashPotion", "applyLingeringPotion"));
        METHODS.put("net/minecraft/entity/AreaEffectCloudEntity", Set.of("tick", "clientTick", "getColor"));
        METHODS.put("net/minecraft/client/render/WorldRenderer", Set.of("processWorldEvent", "processGlobalEvent"));
        METHODS.put("net/minecraft/client/world/ClientWorld", Set.of("syncWorldEvent", "addParticle"));
        METHODS.put(RENDER + "EntityRenderDispatcher", Set.of("renderFire"));
        METHODS.put("net/minecraft/entity/mob/CreeperEntity", Set.of("explode", "tick"));
        METHODS.put("net/minecraft/entity/TntEntity", Set.of("explode", "tick"));
        METHODS.put("net/minecraft/entity/projectile/FireballEntity", Set.of("onCollision", "<init>"));
        METHODS.put("net/minecraft/entity/decoration/EndCrystalEntity", Set.of("damage"));
        METHODS.put("net/minecraft/entity/projectile/WitherSkullEntity", Set.of("onCollision"));
        METHODS.put("net/minecraft/entity/effect/StatusEffectInstance", Set.of("createParticle", "shouldShowParticles", "isAmbient"));
        METHODS.put("net/minecraft/entity/effect/StatusEffect", Set.of("createParticle", "getColor", "<init>"));
        METHODS.put("net/minecraft/particle/EntityEffectParticleEffect", Set.of());
        METHODS.put("net/minecraft/entity/AreaEffectCloudEntity", Set.of());
        METHODS.put("net/minecraft/entity/mob/CreeperEntity", Set.of("getClientFuseTime", "writeCustomDataToNbt", "shouldRenderOverlay"));
        METHODS.put("net/minecraft/entity/projectile/FireballEntity", Set.of("writeCustomDataToNbt"));
        METHODS.put("net/minecraft/entity/projectile/ExplosiveProjectileEntity", Set.of("tick"));
        METHODS.put("net/minecraft/entity/LivingEntity", Set.of("updatePotionSwirls", "containsOnlyAmbientEffects"));
        METHODS.put("net/minecraft/component/type/PotionContentsComponent", Set.of("getColor", "getMixedColor"));
        METHODS.put("net/minecraft/client/render/model/ModelLoader", Set.of("<clinit>"));
        METHODS.put("net/minecraft/client/particle/FlameParticle", Set.of());
        METHODS.put("net/minecraft/client/particle/AbstractSlowingParticle", Set.of());
        METHODS.put("net/minecraft/entity/Entity", Set.of("isOnFire", "doesRenderOnFire", "getRemovalReason"));
        METHODS.put("net/minecraft/entity/TntEntity", Set.of("getFuse"));
        METHODS.put("net/fabricmc/fabric/api/event/lifecycle/v1/ServerEntityEvents", Set.of());
        METHODS.put("net/minecraft/client/particle/SpellParticle$EntityFactory", Set.of());
        METHODS.put("net/minecraft/client/particle/SpellParticle$DefaultFactory", Set.of());
        METHODS.put("net/minecraft/client/particle/SpellParticle$InstantFactory", Set.of());
        METHODS.put("net/minecraft/entity/effect/StatusEffect", Set.of("method_58145", "method_58147"));
        // horses: grazing, rearing, eating, tail, gallop (model and the animation-progress of the entity)
        METHODS.put(MODEL + "HorseEntityModel", Set.of());
        METHODS.put(MODEL + "DonkeyEntityModel", Set.of());
        METHODS.put(RENDER + "AbstractHorseEntityRenderer", Set.of());
        METHODS.put("net/minecraft/entity/passive/AbstractHorseEntity", Set.of("updatePassengerPosition", "getPassengerAttachmentPos",
                "tick", "tickMovement", "getEatingGrassAnimation", "getAngryAnimation", "getEatingAnimation", "isEatingGrass",
                "isAngry", "setEatingGrass", "setAngry", "updateAnger", "wagTail", "playWalkSound", "updateEating",
                "isEating", "setEating", "travel", "getControlledMovementInput", "getSaddledSpeed", "tickControlled"));
    }

    /** text-resources of the game (shaders, atlas-definitions), printed as they are */
    private static final List<String> RESOURCES = List.of(
            "assets/minecraft/particles/explosion.json", "assets/minecraft/particles/explosion_emitter.json",
            "assets/minecraft/particles/entity_effect.json", "assets/minecraft/particles/effect.json",
            "assets/minecraft/particles/poof.json", "assets/minecraft/particles/splash.json",
            "assets/minecraft/particles/instant_effect.json", "assets/minecraft/particles/smoke.json",
            "assets/minecraft/particles/large_smoke.json", "assets/minecraft/particles/flame.json",
            "assets/minecraft/textures/block/fire_0.png.mcmeta", "assets/minecraft/textures/block/fire_1.png.mcmeta");

    private static final Map<Integer, String> OPCODES = new HashMap<>();
    static {
        boolean inOpcodes = false;
        for (Field field : Opcodes.class.getFields()) {
            if (field.getName().equals("NOP")) inOpcodes = true;
            if (!inOpcodes || field.getType() != int.class) continue;
            try {
                OPCODES.putIfAbsent(field.getInt(null), field.getName());
            } catch (IllegalAccessException ignored) {}
            if (field.getName().equals("IFNONNULL")) break;
        }
    }

    @Test
    public void dumpVanillaAnimations() throws IOException {
        List<String> lines = new ArrayList<>();
        for (Map.Entry<String, Set<String>> entry : METHODS.entrySet()) {
            byte[] bytes;
            try (InputStream in = getClass().getClassLoader().getResourceAsStream(entry.getKey() + ".class")) {
                if (in == null) {
                    lines.add(entry.getKey() + ": class not found");
                    continue;
                }
                bytes = in.readAllBytes();
            }
            dumpClass(bytes, entry.getValue(), lines);
        }
        for (String resource : RESOURCES) {
            try (InputStream in = getClass().getClassLoader().getResourceAsStream(resource)) {
                lines.add(resource + ": " + (in == null ? "not found" : new String(in.readAllBytes(), StandardCharsets.UTF_8)
                        .replaceAll("\\s+", " ")));
            }
        }
        writeAnnotations(lines);
    }

    private static String shortName(String internalName) {
        return internalName.substring(internalName.lastIndexOf('/') + 1);
    }

    private static void dumpClass(byte[] bytes, Set<String> methods, List<String> lines) {
        ClassReader reader = new ClassReader(bytes);
        String className = shortName(reader.getClassName());
        reader.accept(new ClassVisitor(Opcodes.ASM9) {
            @Override
            public void visitEnd() {
                lines.add(className + " extends " + shortName(reader.getSuperName()));
            }

            @Override
            public FieldVisitor visitField(int access, String name, String descriptor, String signature, Object value) {
                if (value != null) lines.add(className + "." + name + " = " + value);
                return null;
            }

            @Override
            public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
                if (name.equals("getTexturedModelData") || (name.startsWith("lambda$") && !className.startsWith("Warden"))) return null;
                if (!methods.isEmpty() && !methods.contains(name)) return null;
                StringBuilder out = new StringBuilder(className + "." + name + descriptor.replaceAll("L[a-z0-9/]+/([A-Za-z0-9$]+);", "$1;") + ":");
                Map<Label, Integer> labels = new HashMap<>();
                java.util.function.Function<Label, String> label = l -> "L" + labels.computeIfAbsent(l, k -> labels.size());
                return new MethodVisitor(Opcodes.ASM9) {
                    private void add(String text) { out.append(' ').append(text).append(';'); }
                    @Override public void visitInsn(int opcode) { add(OPCODES.getOrDefault(opcode, "?" + opcode)); }
                    @Override public void visitIntInsn(int opcode, int operand) { add(OPCODES.get(opcode) + " " + operand); }
                    @Override public void visitVarInsn(int opcode, int var) { add(OPCODES.get(opcode) + " " + var); }
                    @Override public void visitTypeInsn(int opcode, String type) { add(OPCODES.get(opcode) + " " + shortName(type)); }
                    @Override public void visitFieldInsn(int opcode, String owner, String fieldName, String d) {
                        add(OPCODES.get(opcode) + " " + shortName(owner) + "." + fieldName);
                    }
                    @Override public void visitMethodInsn(int opcode, String owner, String methodName, String d, boolean itf) {
                        add(OPCODES.get(opcode).replace("INVOKE", "") + " " + shortName(owner) + "." + methodName +
                                d.replaceAll("L[a-z0-9/]+/([A-Za-z0-9$]+);", "$1;"));
                    }
                    @Override public void visitInvokeDynamicInsn(String n, String d, Handle h, Object... args) {
                        StringBuilder b = new StringBuilder("INDY " + n);
                        for (Object arg : args) if (arg instanceof Handle handle) b.append(" -> ").append(shortName(handle.getOwner())).append('.').append(handle.getName());
                        add(b.toString());
                    }
                    @Override public void visitJumpInsn(int opcode, Label target) { add(OPCODES.get(opcode) + " " + label.apply(target)); }
                    @Override public void visitLabel(Label l) { add(label.apply(l) + ":"); }
                    @Override public void visitLdcInsn(Object value) { add("LDC " + (value instanceof Type t ? shortName(t.getInternalName()) : value)); }
                    @Override public void visitIincInsn(int var, int increment) { add("IINC " + var + " " + increment); }
                    @Override public void visitTableSwitchInsn(int min, int max, Label dflt, Label... targets) {
                        StringBuilder b = new StringBuilder("TABLESWITCH " + min + ".." + max + " default " + label.apply(dflt));
                        for (Label t : targets) b.append(' ').append(label.apply(t));
                        add(b.toString());
                    }
                    @Override public void visitLookupSwitchInsn(Label dflt, int[] keys, Label[] targets) {
                        StringBuilder b = new StringBuilder("LOOKUPSWITCH default " + label.apply(dflt));
                        for (int i = 0; i < keys.length; i++) b.append(' ').append(keys[i]).append("->").append(label.apply(targets[i]));
                        add(b.toString());
                    }
                    @Override public void visitEnd() { lines.add(out.toString()); }
                };
            }
        }, ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
    }

    /** chunks of at most 3400 characters, error/warning/notice rotating (github shows 10 of each type per step) */
    private static void writeAnnotations(List<String> lines) throws IOException {
        List<String> chunks = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        for (String line : lines) {
            String text = line;
            while (!text.isEmpty()) {
                int room = 3400 - current.length();
                if (room < 200) {
                    chunks.add(current.toString());
                    current.setLength(0);
                    room = 3400;
                }
                String part = text.length() > room ? text.substring(0, room) : text;
                current.append(part);
                text = text.substring(part.length());
                if (text.isEmpty()) current.append(" ##### ");
            }
        }
        if (current.length() > 0) chunks.add(current.toString());
        String[] types = {"error", "warning", "notice"};
        List<String> out = new ArrayList<>();
        for (int i = 0; i < chunks.size(); i++) {
            out.add("::" + types[(i / 10) % 3] + " title=vanilla-dump " + (i + 1) + "/" + chunks.size() + "::" +
                    chunks.get(i).replace("%", "%25").replace("\r", "").replace("\n", " "));
        }
        Path file = Path.of(System.getProperty("bluemap.animationDump", "build/vanilla-animation-dump.txt"));
        Files.createDirectories(file.getParent());
        Files.write(file, out, StandardCharsets.UTF_8);
    }

}
