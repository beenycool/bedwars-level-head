package me.truffle.bedwarslevelhead.data

data class PlayerLevelData(
    val playerName: String,
    val level: Int,
    val lastSeen: Long = System.currentTimeMillis()
) {
    fun getFormattedLevel(): String {
        return "§7[§f$level⭐§7]"
    }
}