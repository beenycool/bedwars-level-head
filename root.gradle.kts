plugins {
    kotlin("jvm") version "1.6.0" apply false
    id("cc.polyfrost.multi-version.root") version "0.1.25"
}

version = resolveVersion()

fun resolveVersion(): String {
    val buildId = (findProperty("BUILD_ID") as? String)?.takeIf { it.isNotBlank() }
    return buildId ?: "local"
}

preprocess {
    "1.8.9"(10809, "srg")
}
