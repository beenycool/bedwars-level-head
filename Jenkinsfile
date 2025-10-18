pipeline {
  agent any
  environment {
    MODRINTH_TOKEN = credentials(':MODRINTH_TOKEN')
  }
  stages {
    stage('Initialize') {
      steps {
        sh 'chmod +x ./gradlew'
        sh "./gradlew preprocessResources"
      }
    }
    stage('Build') {
      steps {
        sh "./gradlew publish -PBUILD_ID=${env.BUILD_ID} -Pbranch=${env.BRANCH_NAME} -PIS_CI=true --no-daemon"
        sh "./gradlew build -PBUILD_ID=${env.BUILD_ID} -Pbranch=${env.BRANCH_NAME} -PIS_CI=true --no-daemon"
      }
    }

    stage('Report') {
      steps {
        archiveArtifacts 'versions/1.8.9/build/libs/*.jar'
//         archiveArtifacts 'versions/1.8.9-vanilla/build/libs/*.jar'
        archiveArtifacts 'versions/1.12.2/build/libs/*.jar'
//         archiveArtifacts 'versions/1.12.2-vanilla/build/libs/*.jar'
//         archiveArtifacts 'versions/1.15.2/build/libs/*.jar'
      }
    }
    stage('Publish Modrinth Draft') {
      steps {
        sh '''
          set -euo pipefail
          ./gradlew modrinth -PBUILD_ID=${BUILD_ID} -Pbranch=${BRANCH_NAME} -PIS_CI=true --no-daemon --console=plain 2>&1 | tee modrinth-upload.log
          VERSION_IDS=$(sed -n 's/.*version ID \([A-Za-z0-9]+\).*/\1/p' modrinth-upload.log)
          if [ -z "$VERSION_IDS" ]; then
            echo "Failed to detect Modrinth version IDs from upload output" >&2
            exit 1
          fi
          for VERSION_ID in $VERSION_IDS; do
            curl -fSs -X PATCH "https://api.modrinth.com/v2/version/$VERSION_ID" \
              -H "Authorization: $MODRINTH_TOKEN" \
              -H "Content-Type: application/json" \
              -d '{"status":"draft"}' > /dev/null
          done
          rm -f modrinth-upload.log
        '''
      }
    }
  }
}
