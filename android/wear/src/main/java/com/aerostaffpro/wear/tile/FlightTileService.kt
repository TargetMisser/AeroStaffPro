package com.aerostaffpro.wear.tile

import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders.*
import androidx.wear.protolayout.LayoutElementBuilders.*
import androidx.wear.protolayout.ModifiersBuilders.*
import androidx.wear.protolayout.TimelineBuilders.*
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.ResourceBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.aerostaffpro.wear.data.DataLayerListenerService
import com.aerostaffpro.wear.data.FlightData
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import java.text.SimpleDateFormat
import java.util.*

class FlightTileService : TileService() {

    companion object {
        private val timeFmt = SimpleDateFormat("HH:mm", Locale.getDefault())
        private fun fmtTime(epochSec: Long): String = timeFmt.format(Date(epochSec * 1000))

        private const val BG = 0xFF0F172A.toInt()
        private const val TEXT_PRIMARY = 0xFFF1F5F9.toInt()
        private const val TEXT_SECONDARY = 0xFF94A3B8.toInt()
        private const val TEXT_MUTED = 0xFF6B7280.toInt()
        private const val ACCENT = 0xFF3B82F6.toInt()
        private const val GREEN = 0xFF10B981.toInt()
        private const val AMBER = 0xFFF59E0B.toInt()
    }

    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
        val flight = loadFlightBlocking()
        val layout = if (flight != null) buildFlightLayout(flight) else buildEmptyLayout()

        val tile = TileBuilders.Tile.Builder()
            .setResourcesVersion("1")
            .setFreshnessIntervalMillis(60_000)
            .setTileTimeline(
                Timeline.Builder()
                    .addTimelineEntry(
                        TimelineEntry.Builder()
                            .setLayout(Layout.Builder().setRoot(layout).build())
                            .build()
                    )
                    .build()
            )
            .build()

        return Futures.immediateFuture(tile)
    }

    override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest): ListenableFuture<androidx.wear.protolayout.ResourceBuilders.Resources> {
        return Futures.immediateFuture(
            androidx.wear.protolayout.ResourceBuilders.Resources.Builder()
                .setVersion("1")
                .build()
        )
    }

    private fun loadFlightBlocking(): FlightData? {
        return try {
            val task = Wearable.getDataClient(this).dataItems
            val items = com.google.android.gms.tasks.Tasks.await(task, 3, java.util.concurrent.TimeUnit.SECONDS)
            var result: FlightData? = null
            for (item in items) {
                if (item.uri.path == DataLayerListenerService.PATH_PINNED_FLIGHT) {
                    val dataMap = DataMapItem.fromDataItem(item).dataMap
                    val json = dataMap.getString(DataLayerListenerService.KEY_FLIGHT_JSON) ?: ""
                    if (json.isNotEmpty()) result = FlightData.fromJson(json)
                }
            }
            items.release()
            result
        } catch (_: Exception) {
            null
        }
    }

    private fun buildFlightLayout(flight: FlightData): LayoutElement {
        val now = System.currentTimeMillis() / 1000
        val headerColor = try {
            android.graphics.Color.parseColor(flight.airlineColor)
        } catch (_: Exception) { ACCENT }

        val headerLabel = if (flight.tab == "departures") {
            "${flight.flightNumber} → ${flight.destination}"
        } else {
            "${flight.flightNumber} ← ${flight.origin}"
        }

        val countdownInfo = buildCountdownInfo(flight, now)

        return Box.Builder()
            .setWidth(expand())
            .setHeight(expand())
            .setModifiers(
                Modifiers.Builder()
                    .setBackground(Background.Builder().setColor(argb(BG)).build())
                    .setClickable(
                        Clickable.Builder()
                            .setOnClick(
                                ActionBuilders.LaunchAction.Builder()
                                    .setAndroidActivity(
                                        ActionBuilders.AndroidActivity.Builder()
                                            .setPackageName(packageName)
                                            .setClassName("com.aerostaffpro.wear.MainActivity")
                                            .build()
                                    )
                                    .build()
                            )
                            .build()
                    )
                    .build()
            )
            .addContent(
                Column.Builder()
                    .setWidth(expand())
                    .setHeight(expand())
                    .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
                    .addContent(
                        Box.Builder()
                            .setWidth(expand())
                            .setHeight(wrap())
                            .setModifiers(
                                Modifiers.Builder()
                                    .setBackground(Background.Builder().setColor(argb(headerColor)).build())
                                    .setPadding(
                                        Padding.Builder()
                                            .setAll(dp(6f))
                                            .build()
                                    )
                                    .build()
                            )
                            .addContent(
                                Text.Builder()
                                    .setText(headerLabel)
                                    .setFontStyle(
                                        FontStyle.Builder()
                                            .setSize(sp(14f))
                                            .setWeight(FONT_WEIGHT_BOLD)
                                            .setColor(argb(0xFFFFFFFF.toInt()))
                                            .build()
                                    )
                                    .build()
                            )
                            .build()
                    )
                    .addContent(
                        Spacer.Builder().setHeight(dp(8f)).build()
                    )
                    .addContent(
                        Text.Builder()
                            .setText(fmtTime(flight.scheduledTime))
                            .setFontStyle(
                                FontStyle.Builder()
                                    .setSize(sp(28f))
                                    .setWeight(FONT_WEIGHT_BOLD)
                                    .setColor(argb(TEXT_PRIMARY))
                                    .build()
                            )
                            .build()
                    )
                    .addContent(
                        Spacer.Builder().setHeight(dp(4f)).build()
                    )
                    .addContent(
                        Text.Builder()
                            .setText(countdownInfo.first)
                            .setFontStyle(
                                FontStyle.Builder()
                                    .setSize(sp(13f))
                                    .setWeight(FONT_WEIGHT_BOLD)
                                    .setColor(argb(countdownInfo.second))
                                    .build()
                            )
                            .build()
                    )
                    .build()
            )
            .build()
    }

    private fun buildCountdownInfo(flight: FlightData, now: Long): Pair<String, Int> {
        if (flight.tab == "arrivals") {
            val best = flight.realArrival ?: flight.estimatedTime ?: flight.scheduledTime
            if (flight.realArrival != null) return "Atterrato" to GREEN
            val mins = ((best - now) / 60).coerceAtLeast(0)
            return if (mins > 60) "ETA ${mins / 60}h ${mins % 60}m" to AMBER
            else "ETA ${mins}m" to AMBER
        }

        val ops = flight.ops ?: return fmtTime(flight.scheduledTime) to TEXT_SECONDARY
        val dep = flight.scheduledTime
        val gateOpenTime = flight.inboundArrival ?: (dep - ops.gateOpen * 60)
        val milestones = listOf(
            "CI Open" to (dep - ops.checkInOpen * 60),
            "CI Close" to (dep - ops.checkInClose * 60),
            "Gate" to gateOpenTime,
            "Gate Close" to (dep - ops.gateClose * 60),
            "DEP" to dep
        )
        val next = milestones.firstOrNull { it.second > now }
            ?: return "Partito" to GREEN
        val mins = ((next.second - now) / 60).coerceAtLeast(0)
        val timeStr = if (mins > 60) "${mins / 60}h ${mins % 60}m" else "${mins}m"
        return "${next.first} tra $timeStr" to AMBER
    }

    private fun buildEmptyLayout(): LayoutElement {
        return Box.Builder()
            .setWidth(expand())
            .setHeight(expand())
            .setModifiers(
                Modifiers.Builder()
                    .setBackground(Background.Builder().setColor(argb(BG)).build())
                    .build()
            )
            .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(VERTICAL_ALIGN_CENTER)
            .addContent(
                Column.Builder()
                    .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
                    .addContent(
                        Text.Builder()
                            .setText("AeroStaff")
                            .setFontStyle(
                                FontStyle.Builder()
                                    .setSize(sp(16f))
                                    .setWeight(FONT_WEIGHT_BOLD)
                                    .setColor(argb(TEXT_PRIMARY))
                                    .build()
                            )
                            .build()
                    )
                    .addContent(
                        Spacer.Builder().setHeight(dp(4f)).build()
                    )
                    .addContent(
                        Text.Builder()
                            .setText("Nessun volo pinnato")
                            .setFontStyle(
                                FontStyle.Builder()
                                    .setSize(sp(12f))
                                    .setColor(argb(TEXT_MUTED))
                                    .build()
                            )
                            .build()
                    )
                    .build()
            )
            .build()
    }
}
