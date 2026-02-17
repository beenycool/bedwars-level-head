import com.github.jengelman.gradle.plugins.shadow.tasks.ShadowJar
import net.fabricmc.loom.task.RemapJarTask
import org.gradle.api.file.DuplicatesStrategy
import org.gradle.jvm.tasks.Jar

plugins {
    kotlin("jvm")
    id("cc.polyfrost.multi-version")
    id("cc.polyfrost.defaults.repo")
    id("cc.polyfrost.defaults.java")
    id("cc.polyfrost.defaults.loom")
    id("com.github.johnrengelman.shadow")
}

val modGroup: String by project
val modBaseName: String by project
group = modGroup
base.archivesName.set("$modBaseName-${platform.mcVersionStr}")

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
    // Essential repository for gg.essential artifacts (UGraphics, UMatrixStack, etc.)
    maven("https://repo.essential.gg/repository/maven-public")
}

val embed by configurations.creating
configurations.implementation.get().extendsFrom(embed)

configurations.configureEach {
    exclude(group = "me.djtheredstoner", module = "DevAuth-common")
    exclude(group = "com.electronwill.night-config", module = "core")
    exclude(group = "com.electronwill.night-config", module = "toml")
}

dependencies {
    val oneconfig = "cc.polyfrost:oneconfig-$platform:0.2.2-alpha+"
    val universalcraft = "cc.polyfrost:universalcraft-$platform:246"
    val essentialForge = "gg.essential:essential-1.8.9-forge:1.3.10.2"
    val essentialLoader = "gg.essential:loader-launchwrapper:1.1.3"

    modCompileOnly(oneconfig)
    modImplementation(oneconfig)

    embed(oneconfig)

    modCompileOnly(universalcraft)
    modImplementation(universalcraft)

    // Essential is used for rendering (UGraphics/UMatrixStack) and is embedded via the loader
    compileOnly(essentialForge)
    embed(essentialLoader)

    embed(kotlin("stdlib"))
    embed("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")
    embed("com.squareup.okhttp3:okhttp:3.14.9")
    embed("com.google.code.gson:gson:2.10.1")
    compileOnly("org.spongepowered:mixin:0.8.5-SNAPSHOT")
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
}

tasks.jar {
    manifest.attributes(manifestAttributes)
}

tasks.named<ShadowJar>("shadowJar") {
    configurations = listOf(embed)
    archiveClassifier.set("dev")
    destinationDirectory.set(layout.buildDirectory.dir("dev-libs"))
    manifest.attributes(manifestAttributes)
}

tasks.named<RemapJarTask>("remapJar") {
    input.set(tasks.named<ShadowJar>("shadowJar").flatMap { it.archiveFile })
    dependsOn(tasks.named("shadowJar"))
    archiveClassifier.set("")
}
