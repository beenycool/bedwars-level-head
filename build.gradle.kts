import com.modrinth.minotaur.TaskModrinthUpload
import gg.essential.gradle.util.noServerRunConfigs
import net.fabricmc.loom.task.RemapJarTask
import org.gradle.api.GradleException

plugins {
    kotlin("jvm")
    id("gg.essential.multi-version")
    id("gg.essential.defaults")
    id("com.modrinth.minotaur") version "2.7.5"
}

val modGroup: String by project
val modBaseName: String by project
group = modGroup
base.archivesName.set("$modBaseName-${platform.mcVersionStr}")

loom {
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
            arg("--tweakClass", "gg.essential.loader.stage0.EssentialSetupTweaker")
            arg("--mixin", "mixins.levelhead.json")
        }
    }
}

repositories {
    maven("https://repo.spongepowered.org/repository/maven-public/")
}

val embed by configurations.creating
configurations.implementation.get().extendsFrom(embed)

dependencies {
    compileOnly("gg.essential:essential-$platform:4246+g8be73312c")
    embed("gg.essential:loader-launchwrapper:1.1.3")

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
        "TweakClass" to "gg.essential.loader.stage0.EssentialSetupTweaker",
        "TweakOrder" to "0",
        "MixinConfigs" to "mixins.levelhead.json"
    ))
}

modrinth {
    token.set(providers.environmentVariable("MODRINTH_TOKEN"))
    projectId.set("bedwars-levelhead")
    versionNumber.set("${project.version}-${platform.mcVersionStr}")
    versionName.set("Levelhead ${platform.mcVersionStr} ${project.version}")
    changelog.set(providers.provider {
        val branch = System.getenv("BRANCH_NAME") ?: "local"
        val build = System.getenv("BUILD_ID") ?: "local"
        "Automated build $build on branch $branch."
    })
    file.set(tasks.named<RemapJarTask>("remapJar").flatMap { it.archiveFile })
    gameVersions.set(listOf(platform.mcVersionStr))
    loaders.set(listOf("forge"))
    versionType.set("release")
    detectLoaders.set(false)
}

tasks.named<TaskModrinthUpload>("modrinth") {
    dependsOn(tasks.named("remapJar"))
    outputs.upToDateWhen { false }
    doFirst {
        if (System.getenv("MODRINTH_TOKEN").isNullOrBlank()) {
            throw GradleException("MODRINTH_TOKEN is required to publish to Modrinth")
        }
    }
}
