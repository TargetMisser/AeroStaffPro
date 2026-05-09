package com.aerostaffpro.wear.ui

import androidx.compose.ui.graphics.Color

enum class EventStatus { PAST, CURRENT, FUTURE }

data class TimelineEvent(
    val label: String,
    val time: String,
    val status: EventStatus,
    val accentColor: Color
)
