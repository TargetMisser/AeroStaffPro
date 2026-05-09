package com.aerostaffpro.app.wear

import android.net.Uri
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject

class WearDataSenderModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "WearDataSender"

    @ReactMethod
    fun sendPinnedFlight(json: String, promise: Promise) {
        try {
            val request = PutDataMapRequest.create("/pinned_flight").apply {
                dataMap.putString("flight_json", json)
                dataMap.putLong("timestamp", System.currentTimeMillis())
            }
            val putRequest = request.asPutDataRequest().setUrgent()
            Wearable.getDataClient(reactApplicationContext)
                .putDataItem(putRequest)
                .addOnSuccessListener { promise.resolve(true) }
                .addOnFailureListener { e -> promise.reject("WEAR_SEND_ERROR", e.message, e) }
        } catch (e: Exception) {
            promise.reject("WEAR_SEND_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun clearPinnedFlight(promise: Promise) {
        try {
            val uri = Uri.parse("wear://*/pinned_flight")
            Wearable.getDataClient(reactApplicationContext)
                .deleteDataItems(uri)
                .addOnSuccessListener { promise.resolve(true) }
                .addOnFailureListener { e -> promise.reject("WEAR_CLEAR_ERROR", e.message, e) }
        } catch (e: Exception) {
            promise.reject("WEAR_CLEAR_ERROR", e.message, e)
        }
    }

    private fun sendMessageToNodes(path: String, data: String, promise: Promise) {
        Wearable.getNodeClient(reactApplicationContext).connectedNodes
            .addOnSuccessListener { nodes ->
                if (nodes.isEmpty()) {
                    promise.resolve(false)
                    return@addOnSuccessListener
                }
                var remaining = nodes.size
                var failed = false
                for (node in nodes) {
                    Wearable.getMessageClient(reactApplicationContext)
                        .sendMessage(node.id, path, data.toByteArray())
                        .addOnSuccessListener {
                            remaining--
                            if (remaining == 0 && !failed) promise.resolve(true)
                        }
                        .addOnFailureListener { e ->
                            if (!failed) {
                                failed = true
                                promise.reject("WEAR_MSG_ERROR", e.message, e)
                            }
                        }
                }
            }
            .addOnFailureListener { e -> promise.reject("WEAR_MSG_ERROR", e.message, e) }
    }

    @ReactMethod
    fun startWatchOngoing(flightJson: String, shiftEnd: Double, promise: Promise) {
        try {
            val payload = JSONObject().apply {
                put("flight", JSONObject(flightJson))
                put("shiftEnd", shiftEnd.toLong())
            }.toString()
            sendMessageToNodes("/watch_ongoing_start", payload, promise)
        } catch (e: Exception) {
            promise.reject("WEAR_MSG_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun sendWatchAlert(title: String, body: String, type: String, promise: Promise) {
        try {
            val payload = JSONObject().apply {
                put("title", title)
                put("body", body)
                put("type", type)
            }.toString()
            sendMessageToNodes("/watch_alert", payload, promise)
        } catch (e: Exception) {
            promise.reject("WEAR_MSG_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stopWatchOngoing(promise: Promise) {
        try {
            sendMessageToNodes("/watch_ongoing_stop", "", promise)
        } catch (e: Exception) {
            promise.reject("WEAR_MSG_ERROR", e.message, e)
        }
    }
}
