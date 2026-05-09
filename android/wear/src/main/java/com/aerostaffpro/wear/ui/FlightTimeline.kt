package com.aerostaffpro.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Text
import com.aerostaffpro.wear.data.FlightData
import com.aerostaffpro.wear.theme.WearColors
import java.text.SimpleDateFormat
import java.util.*

private val timeFmt = SimpleDateFormat("HH:mm", Locale.getDefault())
private fun fmtTime(epochSec: Long): String = timeFmt.format(Date(epochSec * 1000))

fun buildDepartureEvents(flight: FlightData): List<TimelineEvent> {
    val now = System.currentTimeMillis() / 1000
    val dep = flight.scheduledTime
    val ops = flight.ops ?: return emptyList()
    val gateOpenTime = flight.inboundArrival ?: (dep - ops.gateOpen * 60)

    data class RawEvent(val label: String, val ts: Long, val color: Color)
    val raw = listOf(
        RawEvent("CI Open", dep - ops.checkInOpen * 60, WearColors.accent),
        RawEvent("CI Close", dep - ops.checkInClose * 60, WearColors.accent),
        RawEvent("Gate", gateOpenTime, WearColors.accent),
        RawEvent("Gate Close", dep - ops.gateClose * 60, WearColors.accent),
        RawEvent("DEP", dep, WearColors.accent)
    )

    return raw.mapIndexed { i, ev ->
        val nextTs = raw.getOrNull(i + 1)?.ts ?: Long.MAX_VALUE
        val status = when {
            now >= nextTs -> EventStatus.PAST
            now >= ev.ts -> EventStatus.CURRENT
            else -> EventStatus.FUTURE
        }
        TimelineEvent(ev.label, fmtTime(ev.ts), status, ev.color)
    }
}

fun buildArrivalEvents(flight: FlightData): List<TimelineEvent> {
    val now = System.currentTimeMillis() / 1000
    val bestArrival = flight.realArrival ?: flight.estimatedTime ?: flight.scheduledTime
    val landed = flight.realArrival != null
    val departed = flight.realDeparture != null

    val events = mutableListOf<TimelineEvent>()

    // Partito
    val depStatus = if (departed) EventStatus.PAST else EventStatus.FUTURE
    events.add(TimelineEvent(
        "Partito",
        if (departed) fmtTime(flight.realDeparture!!) else "--:--",
        depStatus,
        WearColors.green
    ))

    // In volo
    if (departed && !landed) {
        val remaining = bestArrival - now
        val mins = (remaining / 60).coerceAtLeast(0)
        val h = mins / 60
        val m = mins % 60
        val timeStr = if (h > 0) "~${h}h ${m}m" else "~${m}m"
        events.add(TimelineEvent("In volo", timeStr, EventStatus.CURRENT, WearColors.amber))
    }

    // Atterraggio
    val arrStatus = when {
        landed -> EventStatus.PAST
        departed -> EventStatus.FUTURE
        else -> EventStatus.FUTURE
    }
    events.add(TimelineEvent(
        if (landed) "Atterrato" else "Atterraggio",
        fmtTime(bestArrival),
        arrStatus,
        if (landed) WearColors.green else WearColors.accent
    ))

    return events
}

@Composable
fun FlightTimelineScreen(flight: FlightData) {
    val headerColor = try { Color(android.graphics.Color.parseColor(flight.airlineColor)) } catch (_: Exception) { WearColors.accent }
    val events = if (flight.tab == "departures") buildDepartureEvents(flight) else buildArrivalEvents(flight)
    val now = System.currentTimeMillis() / 1000

    // Countdown text
    val currentOrNext = events.firstOrNull { it.status == EventStatus.CURRENT }
        ?: events.firstOrNull { it.status == EventStatus.FUTURE }
    val countdownText = if (flight.tab == "arrivals") {
        val best = flight.realArrival ?: flight.estimatedTime ?: flight.scheduledTime
        val delay = ((best - flight.scheduledTime) / 60).toInt()
        if (flight.realArrival != null) "Atterrato"
        else if (delay > 0) "+$delay min ritardo"
        else "In orario"
    } else {
        currentOrNext?.let { ev ->
            val idx = events.indexOf(ev)
            val dep = flight.scheduledTime
            val ops = flight.ops
            if (ops != null) {
                val gateOpenTime = flight.inboundArrival ?: (dep - ops.gateOpen * 60)
                val timestamps = listOf(
                    dep - ops.checkInOpen * 60,
                    dep - ops.checkInClose * 60,
                    gateOpenTime,
                    dep - ops.gateClose * 60,
                    dep
                )
                val ts = timestamps.getOrNull(idx) ?: dep
                val mins = ((ts - now) / 60).coerceAtLeast(0)
                val timeStr = if (mins > 60) "${mins / 60}h ${mins % 60}m" else "${mins}m"
                "${ev.label} tra $timeStr"
            } else ""
        } ?: ""
    }

    // Header label
    val headerLabel = if (flight.tab == "departures") {
        "${flight.flightNumber} → ${flight.destination}"
    } else {
        "${flight.flightNumber} ← ${flight.origin}"
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(WearColors.background)
    ) {
        // Header
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(headerColor)
                .padding(vertical = 5.dp, horizontal = 10.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = headerLabel,
                color = Color.White,
                fontSize = 14.sp,
                fontWeight = FontWeight.Black
            )
        }

        // Timeline
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(start = 24.dp, end = 20.dp, top = 8.dp)
        ) {
            events.forEachIndexed { index, event ->
                Row(
                    modifier = Modifier.padding(bottom = if (event.status == EventStatus.CURRENT || flight.tab == "arrivals") 8.dp else 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Dot
                    val dotSize = if (event.status == EventStatus.CURRENT) 12.dp else 8.dp
                    val dotColor = when (event.status) {
                        EventStatus.PAST -> WearColors.green
                        EventStatus.CURRENT -> event.accentColor
                        EventStatus.FUTURE -> WearColors.lineBg
                    }
                    Box(
                        modifier = Modifier
                            .size(dotSize)
                            .clip(CircleShape)
                            .background(dotColor)
                    )

                    Spacer(Modifier.width(10.dp))

                    // Label + time
                    val rowModifier = if (event.status == EventStatus.CURRENT) {
                        Modifier
                            .fillMaxWidth()
                            .background(WearColors.accentBg, RoundedCornerShape(6.dp))
                            .padding(horizontal = 6.dp, vertical = 3.dp)
                    } else {
                        Modifier.fillMaxWidth()
                    }

                    Row(
                        modifier = rowModifier,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        val textColor = when (event.status) {
                            EventStatus.PAST -> WearColors.textMuted
                            EventStatus.CURRENT -> WearColors.accentLight
                            EventStatus.FUTURE -> WearColors.textSecondary
                        }
                        val fontSize = if (event.status == EventStatus.CURRENT) 14.sp else 12.sp
                        val weight = if (event.status == EventStatus.CURRENT) FontWeight.ExtraBold else FontWeight.Normal
                        val decoration = if (event.status == EventStatus.PAST) TextDecoration.LineThrough else TextDecoration.None

                        Text(event.label, color = textColor, fontSize = fontSize, fontWeight = weight, textDecoration = decoration)
                        Text(event.time, color = textColor, fontSize = fontSize, fontWeight = weight, textDecoration = decoration)
                    }
                }
            }
        }

        // Countdown
        if (countdownText.isNotEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 12.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = countdownText,
                    color = WearColors.amber,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.ExtraBold,
                    textAlign = TextAlign.Center
                )
            }
        }
    }
}
