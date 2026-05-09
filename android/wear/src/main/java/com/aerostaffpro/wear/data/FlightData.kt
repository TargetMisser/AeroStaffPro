package com.aerostaffpro.wear.data

import org.json.JSONObject

data class FlightOps(
    val checkInOpen: Int,
    val checkInClose: Int,
    val gateOpen: Int,
    val gateClose: Int
)

data class FlightData(
    val flightNumber: String,
    val airline: String,
    val airlineColor: String,
    val iataCode: String,
    val tab: String,
    val destination: String,
    val origin: String,
    val scheduledTime: Long,
    val estimatedTime: Long?,
    val realDeparture: Long?,
    val realArrival: Long?,
    val ops: FlightOps?,
    val inboundArrival: Long?,
    val pinnedAt: Long
) {
    companion object {
        fun fromJson(json: String): FlightData? {
            return try {
                val o = JSONObject(json)
                val opsObj = o.optJSONObject("ops")
                FlightData(
                    flightNumber = o.getString("flightNumber"),
                    airline = o.getString("airline"),
                    airlineColor = o.getString("airlineColor"),
                    iataCode = o.optString("iataCode", ""),
                    tab = o.getString("tab"),
                    destination = o.optString("destination", ""),
                    origin = o.optString("origin", ""),
                    scheduledTime = o.getLong("scheduledTime"),
                    estimatedTime = o.optLong("estimatedTime").takeIf { o.has("estimatedTime") && !o.isNull("estimatedTime") },
                    realDeparture = o.optLong("realDeparture").takeIf { o.has("realDeparture") && !o.isNull("realDeparture") },
                    realArrival = o.optLong("realArrival").takeIf { o.has("realArrival") && !o.isNull("realArrival") },
                    ops = opsObj?.let {
                        FlightOps(
                            checkInOpen = it.getInt("checkInOpen"),
                            checkInClose = it.getInt("checkInClose"),
                            gateOpen = it.getInt("gateOpen"),
                            gateClose = it.getInt("gateClose")
                        )
                    },
                    inboundArrival = o.optLong("inboundArrival").takeIf { o.has("inboundArrival") && !o.isNull("inboundArrival") },
                    pinnedAt = o.optLong("pinnedAt", System.currentTimeMillis() / 1000)
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}
