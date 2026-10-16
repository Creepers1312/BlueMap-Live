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
        // jumping slimes: the squish (stretch) and its scale
        METHODS.put(RENDER + "SlimeEntityRenderer", Set.of("scale", "render"));
        METHODS.put("net/minecraft/entity/mob/SlimeEntity", Set.of("tick", "updateStretch", "jump", "getTicksUntilNextJump",
                "makesJumpSound", "getJumpSound"));
        METHODS.put(MODEL + "SlimeEntityModel", Set.of());
        // warden: walking, idle-sway, tendrils (code) and the keyframe-animations it plays
        METHODS.put(MODEL + "WardenEntityModel", Set.of("setAngles", "setHeadAngle", "setLimbAngles", "setHeadAndBodyAngles",
                "setTendrilPitches", "setArmPivots"));
        METHODS.put("net/minecraft/entity/mob/WardenEntity", Set.of("getTendrilPitch", "getHeartPitch", "getHeartRate",
                "getAngerAtTarget", "getAnger"));
    }

    /** text-resources of the game (shaders, atlas-definitions), printed as they are */
    private static final List<String> RESOURCES = List.of();

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
