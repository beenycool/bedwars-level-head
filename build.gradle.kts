plugins {
    kotlin("jvm")
    id("gg.essential.multi-version")
    id("gg.essential.defaults")
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
            property("patcher.debugBytecode", "true")
            property("mixin.debug.verbose", "true")
            property("mixin.debug.export", "true")
            property("mixin.dumpTargetOnFailure", "true")
            arg("--mixin", "mixins.levelhead.json")
        }
    }
}


val embed by configurations.creating
configurations.implementation.get().extendsFrom(embed)

repositories {
    maven("https://repo.polyfrost.org/releases")
    maven("https://jitpack.io")
    maven("https://repo.spongepowered.org/repository/maven-public/")
}

dependencies {
    compileOnly("org.polyfrost:universalcraft-1.8.9-forge:2.0.1")

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