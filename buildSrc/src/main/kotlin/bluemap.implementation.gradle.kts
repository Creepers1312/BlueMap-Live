plugins {
    id ( "bluemap.java" )
    id ( "com.gradleup.shadow" )
}

tasks.shadowJar {
    archiveFileName = "${project.name}-${project.version}-shadow.jar"
}

tasks.register<CopyFileTask>("release") {
    group = "publishing"
    dependsOn(tasks.shadowJar, tasks.spotlessCheck)

    inputFile = tasks.shadowJar.flatMap { it.archiveFile }
    // BlueMap Live: bluemap-live-..., so it is not mixed up with the jars of the original BlueMap
    outputFile = releaseDirectory.resolve("bluemap-live-${project.version}-${project.name}.jar")
}

tasks.getByName<Delete>("clean") {
    delete(releaseDirectory.listFiles())
}
