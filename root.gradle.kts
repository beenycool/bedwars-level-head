import org.polyfrost.gradle.util.versionFromBuildIdAndBranch

plugins {
    kotlin("jvm") version "1.6.0" apply false
    id("org.polyfrost.multi-version.root")
}

version = versionFromBuildIdAndBranch()

preprocess {
    "1.8.9"(10809, "srg")
}
