plugins {
    kotlin("jvm")
    id("org.polyfrost.multi-version")
    id("org.polyfrost.defaults.repo")
    id("org.polyfrost.defaults.java")
    id("org.polyfrost.defaults.loom")
    id("com.github.johnrengelman.shadow") version "8.1.1"
}

val modGroup: String by project
val modBaseName: String by project
group = modGroup
base.archivesName.set("$modBaseName-${platform.mcVersionStr}")

loom {
    mixin {
        defaultRefmapName.set("mixins.levelhead.refmap.json")
    }
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
    maven("https://maven.polyfrost.cc/releases")
    maven("https://repo.spongepowered.org/repository/maven-public/")
}

val embed by configurations.creating
configurations.implementation.get().extendsFrom(embed)

dependencies {
    modCompileOnly("cc.polyfrost:oneconfig-$platform:0.2.2-alpha+")
    include("cc.polyfrost:oneconfig-$platform:0.2.2-alpha+")
    modCompileOnly("cc.polyfrost:universalcraft-$platform:298")
    include("cc.polyfrost:universalcraft-$platform:298")

    embed("com.squareup.okhttp3:okhttp:3.14.9")
    compileOnly("org.spongepowered:mixin:0.8.5-SNAPSHOT")
}

tasks.compileKotlin {
    kotlinOptions {
        freeCompilerArgs += listOf("-Xno-param-assertions", "-Xjvm-default=all-compatibility")
    }
}

tasks.jar {
    from(embed.files.map { zipTree(it) })

    manifest.attributes(
        mapOf(
            "ModSide" to "CLIENT",
            "FMLCorePluginContainsFMLMod" to "Yes, yes it does",
            "TweakClass" to "cc.polyfrost.oneconfig.loader.stage0.LaunchWrapperTweaker",
            "TweakOrder" to "0",
            "MixinConfigs" to "mixins.levelhead.json"
        )
    )
}
