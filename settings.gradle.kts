pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        maven("https://maven.fabricmc.net")
        maven("https://maven.architectury.dev/")
        maven("https://maven.minecraftforge.net")
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
            // The Polyfrost plugins are shipped inside the toolkit jar rather than
            // as individual plugin markers, so point the ids at the module.
            if (requested.id.id.startsWith("cc.polyfrost.")) {
                useModule("cc.polyfrost:polyfrost-gradle-toolkit:0.1.25")
            }
            // Shadow 7.x is the version the Polyfrost toolkit is built against;
            // resolve it from its implementation artifact (no marker is published
            // under the new id for that version).
            if (requested.id.id == "com.github.johnrengelman.shadow") {
                useModule("gradle.plugin.com.github.jengelman.gradle.plugins:shadow:7.0.0")
            }
        }
    }
}

rootProject.name = "bedwars-level-head"
