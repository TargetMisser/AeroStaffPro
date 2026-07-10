package com.aerostaffpro.wear.util

internal fun formatCountdownDuration(remainingSeconds: Long): String {
    val minutes = if (remainingSeconds > 0) (remainingSeconds + 59) / 60 else 0
    return if (minutes > 60) "${minutes / 60}h ${minutes % 60}m" else "${minutes}m"
}
