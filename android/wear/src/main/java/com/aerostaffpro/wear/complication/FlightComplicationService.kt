package com.aerostaffpro.wear.complication

import android.app.PendingIntent
import android.content.Intent
import androidx.wear.watchface.complications.data.*
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService
import com.aerostaffpro.wear.MainActivity
import com.aerostaffpro.wear.data.DataLayerListenerService
import com.aerostaffpro.wear.data.FlightData
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.tasks.Tasks
import java.util.concurrent.TimeUnit

class FlightComplicationService : SuspendingComplicationDataSourceService() {

    override fun getPreviewData(type: ComplicationType): ComplicationData {
        return ShortTextComplicationData.Builder(
            text = PlainComplicationText.Builder("Gate 12m").build(),
            contentDescription = PlainComplicationText.Builder("Flight countdown").build()
        ).build()
    }

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData {
        val tapIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val flight = loadFlightData()

        val text = if (flight == null) {
            "—"
        } else {
            getCountdownText(flight)
        }

        return ShortTextComplicationData.Builder(
            text = PlainComplicationText.Builder(text).build(),
            contentDescription = PlainComplicationText.Builder("Flight: $text").build()
        )
            .setTapAction(pendingIntent)
            .build()
    }

    private fun loadFlightData(): FlightData? {
        return try {
            val task = Wearable.getDataClient(this).dataItems
            val items = Tasks.await(task, 3, TimeUnit.SECONDS)
            var result: FlightData? = null
            for (item in items) {
                if (item.uri.path == DataLayerListenerService.PATH_PINNED_FLIGHT) {
                    val json = DataMapItem.fromDataItem(item).dataMap
                        .getString(DataLayerListenerService.KEY_FLIGHT_JSON) ?: ""
                    if (json.isNotEmpty()) result = FlightData.fromJson(json)
                }
            }
            items.release()
            result
        } catch (_: Exception) { null }
    }

    private fun getCountdownText(flight: FlightData): String {
        val now = System.currentTimeMillis() / 1000

        if (flight.tab == "arrivals") {
            val best = flight.realArrival ?: flight.estimatedTime ?: flight.scheduledTime
            if (flight.realArrival != null) return "Landed"
            val mins = ((best - now) / 60).coerceAtLeast(0)
            return if (mins > 60) "ETA ${mins / 60}h${mins % 60}m" else "ETA ${mins}m"
        }

        // Departures
        val dep = flight.scheduledTime
        val ops = flight.ops ?: return fmtMins(dep - now)
        val gateOpenTime = flight.inboundArrival ?: (dep - ops.gateOpen * 60)

        data class Ev(val label: String, val ts: Long)
        val events = listOf(
            Ev("CI", dep - ops.checkInOpen * 60),
            Ev("CI End", dep - ops.checkInClose * 60),
            Ev("Gate", gateOpenTime),
            Ev("GClose", dep - ops.gateClose * 60),
            Ev("DEP", dep)
        )

        val next = events.firstOrNull { it.ts > now }
        return if (next != null) {
            "${next.label} ${fmtMins(next.ts - now)}"
        } else {
            "DEP"
        }
    }

    private fun fmtMins(secs: Long): String {
        val mins = (secs / 60).coerceAtLeast(0)
        return if (mins > 60) "${mins / 60}h${mins % 60}m" else "${mins}m"
    }
}
