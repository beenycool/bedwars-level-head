plugins {
    kotlin("jvm")
}

group = "me.beeny.bedwarslevelhead"
version = "8.3.0"

repositories {
    mavenCentral()
    maven("https://maven.minecraftforge.net")
    maven("https://maven.polyfrost.org/releases")
}

dependencies {
    // Forge 1.8.9 provided by environment
    compileOnly("net.minecraftforge:forge:1.8.9-11.15.1.2318-1.8.9")

    // OneConfig + PolyUI runtime (provided by user environment or bundled loader)
    compileOnly("org.polyfrost:oneconfig:1.0.0")
    compileOnly("org.polyfrost:polyui:1.0.0")

    // HTTP + JSON
    implementation("com.squareup.okhttp3:okhttp:3.14.9")
    implementation("com.google.code.gson:gson:2.10.1")
}

tasks.compileKotlin {
    kotlinOptions {
        jvmTarget = "1.8"
        freeCompilerArgs += listOf("-Xno-param-assertions", "-Xjvm-default=all-compatibility")
    }
}

tasks.jar {
    manifest.attributes(
        mapOf(
            "ModSide" to "CLIENT",
            "TweakOrder" to "0",
            "MixinConfigs" to "mixins.levelhead.json"
        )
    )
}