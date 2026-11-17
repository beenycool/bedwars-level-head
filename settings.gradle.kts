pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        maven("https://maven.fabricmc.net")
        maven("https://maven.architectury.dev/")
        maven("https://maven.minecraftforge.net")
        // Mirror for Forge's Loom toolchain artifacts (binarypatcher, srgutils)
        // when the Forge Maven is missing or slow.
        maven("https://repo.spongepowered.org/repository/maven-public/")
        maven("https://repo.polyfrost.org/releases")
        maven("https://repo.polyfrost.cc/releases")
    }
    plugins {
        val toolkitVersion = "0.1.25"
        id("org.jetbrains.kotlin.jvm") version "1.9.10"
        id("cc.polyfrost.defaults.repo") version toolkitVersion
        id("cc.polyfrost.defaults.java") version toolkitVersion
        id("cc.polyfrost.defaults.loom") version toolkitVersion
    }
    resolutionStrategy {
        eachPlugin {
            if (requested.id.id.startsWith("cc.polyfrost.")) {
                useModule("cc.polyfrost:polyfrost-gradle-toolkit:0.1.25")
            }
            if (requested.id.id == "com.github.johnrengelman.shadow") {
                useModule("gradle.plugin.com.github.jengelman.gradle.plugins:shadow:7.0.0")
            }
        }
    }
}

rootProject.name = "bedwars-level-head"
