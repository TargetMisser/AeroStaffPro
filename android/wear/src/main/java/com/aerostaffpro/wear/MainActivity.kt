package com.aerostaffpro.wear

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import com.aerostaffpro.wear.data.DataLayerListenerService
import com.aerostaffpro.wear.data.FlightData
import com.aerostaffpro.wear.ui.EmptyState
import com.aerostaffpro.wear.ui.FlightTimelineScreen
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable

class MainActivity : ComponentActivity() {

    private var flightState = mutableStateOf<FlightData?>(null)

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val json = intent.getStringExtra(DataLayerListenerService.EXTRA_FLIGHT_JSON) ?: ""
            flightState.value = if (json.isNotEmpty()) FlightData.fromJson(json) else null
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Load initial data from DataLayer
        loadInitialData()

        setContent {
            val flight by flightState
            if (flight != null) {
                FlightTimelineScreen(flight!!)
            } else {
                EmptyState()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        val filter = IntentFilter(DataLayerListenerService.ACTION_FLIGHT_UPDATED)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(receiver, filter)
        }
        loadInitialData()
    }

    override fun onPause() {
        super.onPause()
        unregisterReceiver(receiver)
    }

    private fun loadInitialData() {
        Wearable.getDataClient(this).getDataItems().addOnSuccessListener { items ->
            for (item in items) {
                if (item.uri.path == DataLayerListenerService.PATH_PINNED_FLIGHT) {
                    val dataMap = DataMapItem.fromDataItem(item).dataMap
                    val json = dataMap.getString(DataLayerListenerService.KEY_FLIGHT_JSON) ?: ""
                    flightState.value = if (json.isNotEmpty()) FlightData.fromJson(json) else null
                }
            }
            items.release()
        }
    }
}
