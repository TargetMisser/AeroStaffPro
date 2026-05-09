package com.aerostaffpro.wear.data

import android.content.Intent
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.wear.tiles.TileService
import com.aerostaffpro.wear.tile.FlightTileService
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService

class DataLayerListenerService : WearableListenerService() {

    companion object {
        const val PATH_PINNED_FLIGHT = "/pinned_flight"
        const val KEY_FLIGHT_JSON = "flight_json"
        const val ACTION_FLIGHT_UPDATED = "com.aerostaffpro.wear.FLIGHT_UPDATED"
        const val EXTRA_FLIGHT_JSON = "flight_json"
    }

    override fun onDataChanged(dataEvents: DataEventBuffer) {
        for (event in dataEvents) {
            val uri = event.dataItem.uri
            if (uri.path == PATH_PINNED_FLIGHT) {
                val dataMap = DataMapItem.fromDataItem(event.dataItem).dataMap
                val json = dataMap.getString(KEY_FLIGHT_JSON) ?: ""
                val intent = Intent(ACTION_FLIGHT_UPDATED).apply {
                    putExtra(EXTRA_FLIGHT_JSON, json)
                    setPackage(packageName)
                }
                sendBroadcast(intent)
                vibrateConfirmation()
                TileService.getUpdater(this)
                    .requestUpdate(FlightTileService::class.java)
            }
        }
    }

    private fun vibrateConfirmation() {
        val vibrator = getSystemService(Vibrator::class.java) ?: return
        vibrator.vibrate(
            VibrationEffect.createWaveform(longArrayOf(0, 50, 80, 50), -1)
        )
    }
}
