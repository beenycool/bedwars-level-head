plugins {
    kotlin("jvm") version "1.6.0" apply false
}

allprojects {
    group = "me.beeny.bedwarslevelhead"
    version = "8.3.0"
}

preprocess {
    "1.8.9"(10809, "srg")
}
