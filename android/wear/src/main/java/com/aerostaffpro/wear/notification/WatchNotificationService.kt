package com.aerostaffpro.wear.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.app.NotificationCompat
import com.aerostaffpro.wear.MainActivity
import com.aerostaffpro.wear.R
import com.aerostaffpro.wear.data.FlightData
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONObject

class WatchNotificationService : WearableListenerService() {

    companion object {
        private const val CHANNEL_ONGOING = "aerostaff_ongoing"
        private const val CHANNEL_ALERT = "aerostaff_alert"
        private const val NOTIF_ID_ONGOING = 1001
        private const val NOTIF_ID_ALERT_BASE = 2000
    }

    private val handler = Handler(Looper.getMainLooper())
    private var ongoingFlight: FlightData? = null
    private var shiftEnd: Long = 0
    private var alertCounter = 0
    private val updateRunnable = object : Runnable {
        override fun run() {
            updateOngoingNotification()
            handler.postDelayed(this, 60_000)
        }
    }

    override fun onMessageReceived(messageEvent: MessageEvent) {
        when (messageEvent.path) {
            "/watch_ongoing_start" -> handleOngoingStart(messageEvent)
            "/watch_alert" -> handleAlert(messageEvent)
            "/watch_ongoing_stop" -> handleOngoingStop()
        }
    }

    private fun handleOngoingStart(event: MessageEvent) {
        val json = String(event.data)
        if (json.isEmpty()) return
        val obj = JSONObject(json)
        val flightJson = obj.getJSONObject("flight").toString()
        val flight = FlightData.fromJson(flightJson) ?: return
        shiftEnd = obj.getLong("shiftEnd")

        ongoingFlight = flight
        ensureChannels()
        updateOngoingNotification()

        handler.removeCallbacks(updateRunnable)
        handler.postDelayed(updateRunnable, 60_000)

        // Auto-stop at shift end
        val msUntilEnd = (shiftEnd - System.currentTimeMillis() / 1000) * 1000
        if (msUntilEnd > 0) {
            handler.postDelayed({ handleOngoingStop() }, msUntilEnd)
        }
    }

    private fun handleAlert(event: MessageEvent) {
        val json = String(event.data)
        if (json.isEmpty()) return
        val obj = JSONObject(json)
        val title = obj.getString("title")
        val body = obj.getString("body")

        ensureChannels()
        val notifId = NOTIF_ID_ALERT_BASE + (alertCounter++ % 100)

        val tapIntent = Intent(this, MainActivity::class.java)
        val pending = PendingIntent.getActivity(
            this, notifId, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ALERT)
            .setSmallIcon(R.drawable.ic_flight)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()

        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(notifId, notification)

        // Vibrate
        val vibrator = getSystemService(Vibrator::class.java)
        vibrator?.vibrate(
            VibrationEffect.createWaveform(longArrayOf(0, 100, 100, 100, 100, 200), -1)
        )

        // Auto-dismiss after 2 minutes
        handler.postDelayed({ nm.cancel(notifId) }, 120_000)
    }

    private fun handleOngoingStop() {
        handler.removeCallbacksAndMessages(null)
        ongoingFlight = null
        val nm = getSystemService(NotificationManager::class.java)
        nm.cancel(NOTIF_ID_ONGOING)
    }

    private fun updateOngoingNotification() {
        val flight = ongoingFlight ?: return
        val now = System.currentTimeMillis() / 1000

        // Auto-stop if shift ended
        if (shiftEnd > 0 && now >= shiftEnd) {
            handleOngoingStop()
            return
        }

        val title = if (flight.tab == "departures") {
            "${flight.flightNumber} → ${flight.destination}"
        } else {
            "${flight.flightNumber} ← ${flight.origin}"
        }

        val body = buildCountdownBody(flight, now)

        val tapIntent = Intent(this, MainActivity::class.java)
        val pending = PendingIntent.getActivity(
            this, 0, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ONGOING)
            .setSmallIcon(R.drawable.ic_flight)
            .setContentTitle(title)
            .setContentText(body)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pending)
            .setSilent(true)
            .build()

        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIF_ID_ONGOING, notification)
    }

    private fun buildCountdownBody(flight: FlightData, now: Long): String {
        if (flight.tab == "arrivals") {
            val best = flight.realArrival ?: flight.estimatedTime ?: flight.scheduledTime
            if (flight.realArrival != null) return "Atterrato"
            val mins = ((best - now) / 60).coerceAtLeast(0)
            return if (mins > 60) "ETA ${mins / 60}h ${mins % 60}m" else "ETA ${mins}m"
        }

        val ops = flight.ops ?: return "DEP ${formatTime(flight.scheduledTime)}"
        val dep = flight.scheduledTime
        val gateOpenTime = flight.inboundArrival ?: (dep - ops.gateOpen * 60)

        data class Milestone(val label: String, val ts: Long)
        val milestones = listOf(
            Milestone("CI Open", dep - ops.checkInOpen * 60),
            Milestone("CI Close", dep - ops.checkInClose * 60),
            Milestone("Gate", gateOpenTime),
            Milestone("Gate Close", dep - ops.gateClose * 60),
            Milestone("DEP", dep)
        )

        val next = milestones.firstOrNull { it.ts > now }
            ?: return "Partito"

        val mins = ((next.ts - now) / 60).coerceAtLeast(0)
        val timeStr = if (mins > 60) "${mins / 60}h ${mins % 60}m" else "${mins}m"
        return "${next.label} tra $timeStr"
    }

    private fun formatTime(epochSec: Long): String {
        val sdf = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault())
        return sdf.format(java.util.Date(epochSec * 1000))
    }

    private fun ensureChannels() {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL_ONGOING) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ONGOING, "Volo in corso", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Notifica persistente con countdown volo"
                }
            )
        }
        if (nm.getNotificationChannel(CHANNEL_ALERT) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ALERT, "Avvisi volo", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Avvisi milestone volo (gate, check-in, ecc.)"
                    enableVibration(true)
                }
            )
        }
    }
}
