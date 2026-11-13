import com.github.jengelman.gradle.plugins.shadow.tasks.ShadowJar
import net.fabricmc.loom.task.RemapJarTask
import org.gradle.api.file.DuplicatesStrategy
import org.gradle.jvm.tasks.Jar

plugins {
    kotlin("jvm")
    id("cc.polyfrost.defaults.repo")
    id("cc.polyfrost.defaults.java")
    id("cc.polyfrost.defaults.loom")
    id("com.github.johnrengelman.shadow")
}

val modGroup: String by project
val modBaseName: String by project

// The mod targets exactly one Minecraft version (1.8.9 / legacy Forge), so the
// platform is read from a plain property instead of a multi-version lookup.
val mcVersionStr = (findProperty("minecraft.version") as? String) ?: "1.8.9"

group = modGroup
version = (findProperty("BUILD_ID") as? String)?.takeIf { it.isNotBlank() } ?: "local"
base.archivesName.set("$modBaseName-$mcVersionStr")

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(8))
    }
}

loom {
    mixin {
        defaultRefmapName.set("mixins.levelhead.refmap.json")
    }
    remapArchives.set(true)
    launchConfigs {
        getByName("client") {
            property("mixin.debug.verbose", "true")
            property("mixin.debug.export", "true")
            property("mixin.dumpTargetOnFailure", "true")
            arg("--tweakClass", "cc.polyfrost.oneconfig.loader.stage0.LaunchWrapperTweaker")
            arg("--mixin", "mixins.levelhead.json")
        }
    }
}

repositories {
    mavenCentral()
    maven("https://repo.polyfrost.org/releases")
    maven("https://repo.polyfrost.cc/releases")
    maven("https://repo.spongepowered.org/repository/maven-public/")
}

val embed by configurations.creating
configurations.implementation.get().extendsFrom(embed)

configurations.configureEach {
    exclude(group = "me.djtheredstoner", module = "DevAuth-common")
    exclude(group = "com.electronwill.night-config", module = "core")
    exclude(group = "com.electronwill.night-config", module = "toml")
}

dependencies {
    val oneconfig = "cc.polyfrost:oneconfig-$mcVersionStr-forge:0.2.2-alpha223"
    val oneconfigWrapperLaunchwrapper = "cc.polyfrost:oneconfig-wrapper-launchwrapper:1.0.0-beta17"

    modCompileOnly(oneconfig)

    // Legacy (1.8.9) Forge: ship the LaunchWrapper OneConfig wrapper.
    embed(oneconfigWrapperLaunchwrapper)

    // The jar must run on Forge alone: no Essential / UniversalCraft / Elementa /
    // MixinExtras at runtime. Rendering uses plain GlStateManager/Tessellator/
    // FontRenderer and the tab mixin uses plain @Inject (B27, B28).
    embed(kotlin("stdlib"))
    embed("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")
    embed("com.squareup.okhttp3:okhttp:3.14.9")
    embed("com.google.code.gson:gson:2.10.1")
    compileOnly("org.spongepowered:mixin:0.8.5")

    // Test dependencies - pure JVM
    testImplementation(platform("org.junit:junit-bom:5.10.0"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

val manifestAttributes = mapOf(
    "ModSide" to "CLIENT",
    "FMLCorePluginContainsFMLMod" to "Yes, yes it does",
    "TweakClass" to "cc.polyfrost.oneconfig.loader.stage0.LaunchWrapperTweaker",
    "TweakOrder" to "0",
    "MixinConfigs" to "mixins.levelhead.json"
)

tasks.compileKotlin {
    kotlinOptions {
        freeCompilerArgs += listOf("-Xno-param-assertions", "-Xjvm-default=all-compatibility")
    }
}

tasks.withType<Jar> {
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}

tasks.jar {
    manifest.attributes(manifestAttributes)
}

tasks.named<ShadowJar>("shadowJar") {
    configurations = listOf(embed)
    archiveClassifier.set("dev")
    destinationDirectory.set(layout.buildDirectory.dir("dev-libs"))
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
    mergeServiceFiles()
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
    relocate("kotlin", "club.sk1er.mods.levelhead.shadow.kotlin")
    relocate("kotlinx.coroutines", "club.sk1er.mods.levelhead.shadow.kotlinx.coroutines")
    relocate("okhttp3", "club.sk1er.mods.levelhead.shadow.okhttp3")
    relocate("okio", "club.sk1er.mods.levelhead.shadow.okio")
    relocate("com.google.gson", "club.sk1er.mods.levelhead.shadow.gson")
    manifest.attributes(manifestAttributes)
}

tasks.named<RemapJarTask>("remapJar") {
    input.set(tasks.named<ShadowJar>("shadowJar").flatMap { it.archiveFile })
    dependsOn(tasks.named("shadowJar"))
    archiveClassifier.set("")
}

// Configure JUnit5 for tests
tasks.test {
    useJUnitPlatform()
}

// Expand version placeholders in mcmod.info (no-op for other resources).
tasks.processResources {
    filesMatching("mcmod.info") {
        expand(
            mapOf(
                "version" to project.version,
                "mcVersionStr" to mcVersionStr
            )
        )
    }
}
