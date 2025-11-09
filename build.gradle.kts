import org.polyfrost.oneconfig.gradle.util.noServerRunConfigs

plugins {
    kotlin("jvm")
    id("org.polyfrost.oneconfig.multi-version")
    id("org.polyfrost.oneconfig.defaults")
}

val modGroup: String by project
val modBaseName: String by project
group = modGroup
base.archivesName.set("$modBaseName-${platform.mcVersionStr}")

oneconfig {
    noServerRunConfigs()
    mixin {
        defaultRefmapName.set("mixins.levelhead.refmap.json")
    }
    launchConfigs {
        getByName("client") {
            property("patcher.debugBytecode", "true")
            property("mixin.debug.verbose", "true")
            property("mixin.debug.export", "true")
            property("mixin.dumpTargetOnFailure", "true")
        }
    }
}

repositories {
    maven("https://repo.polyfrost.club/releases")
}

val embed by configurations.creating
configurations.implementation.get().extendsFrom(embed)

dependencies {
    compileOnly("org.polyfrost:oneconfig-$platform:0.3.0")
    
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

    manifest.attributes(mapOf(
        "ModSide" to "CLIENT",
        "FMLCorePluginContainsFMLMod" to "Yes, yes it does",
        "MixinConfigs" to "mixins.levelhead.json"
    ))
}