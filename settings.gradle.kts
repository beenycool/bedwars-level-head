pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        maven("https://maven.fabricmc.net")
        maven("https://maven.architectury.dev/")
        maven("https://maven.minecraftforge.net")
        maven("https://repo.polyfrost.org/releases")
        maven("https://repo.polyfrost.cc/releases")
        maven("https://maven.polyfrost.cc/releases")
    }
    plugins {
        val toolkitVersion = "0.1.10"
        id("org.polyfrost.multi-version.root") version toolkitVersion
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
