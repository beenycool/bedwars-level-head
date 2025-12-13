#!/bin/bash

# Script to automatically copy the built mod to MultiMC mods directory

BUILD_JAR="/home/beeny/Documents/projects/java mods/bedwars-level-head/versions/1.8.9/build/libs/Levelhead-1.8.9-8.3.0.jar"
MODS_DIR="/home/beeny/.local/share/multimc/instances/1.8.9/.minecraft/mods"

# Check if build JAR exists
if [ ! -f "$BUILD_JAR" ]; then
    echo "Error: Build JAR not found at $BUILD_JAR"
    echo "Please build the project first."
    exit 1
fi

# Create mods directory if it doesn't exist
mkdir -p "$MODS_DIR"

# Copy the JAR file
echo "Copying build to MultiMC mods directory..."
cp "$BUILD_JAR" "$MODS_DIR/"

if [ $? -eq 0 ]; then
    echo "Successfully copied $(basename "$BUILD_JAR") to $MODS_DIR"
    ls -lh "$MODS_DIR/$(basename "$BUILD_JAR")"
else
    echo "Error: Failed to copy file"
    exit 1
fi

