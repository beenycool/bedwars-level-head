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
        id("cc.polyfrost.multi-version.root") version toolkitVersion
        id("cc.polyfrost.multi-version") version toolkitVersion
        id("cc.polyfrost.defaults.repo") version toolkitVersion
        id("cc.polyfrost.defaults.java") version toolkitVersion
        id("cc.polyfrost.defaults.loom") version toolkitVersion
    }
}

rootProject.buildFileName = "root.gradle.kts"

listOf(
    "1.8.9"
).forEach { version ->
    include(":$version")
    project(":$version").apply {
        projectDir = file("versions/$version")
        buildFileName = "../../build.gradle.kts"
    }

}
