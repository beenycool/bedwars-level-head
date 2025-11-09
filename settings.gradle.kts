pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        maven("https://maven.fabricmc.net")
        maven("https://maven.architectury.dev/")
        maven("https://maven.minecraftforge.net")
        maven("https://repo.essential.gg/repository/maven-public")
        maven {
            url = uri("https://repo.polyfrost.club/releases")
            isAllowInsecureProtocol = false
            content {
                includeGroup("org.polyfrost")
            }
        }
    }
    plugins {
        val egtVersion = "0.1.10"
        id("gg.essential.multi-version.root") version egtVersion
        id("org.polyfrost.oneconfig.multi-version") version "0.3.0"
        id("org.polyfrost.oneconfig.defaults") version "0.3.0"
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
