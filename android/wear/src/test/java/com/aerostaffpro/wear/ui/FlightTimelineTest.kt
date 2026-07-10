package com.aerostaffpro.wear.ui

import com.aerostaffpro.wear.data.FlightData
import com.aerostaffpro.wear.data.FlightOps
import org.junit.Assert.assertEquals
import org.junit.Test

class FlightTimelineTest {
    private val scheduledDeparture = 2_000_000L
    private val delayedDeparture = scheduledDeparture + 30 * 60
    private val flight = FlightData(
        flightNumber = "FR123",
        airline = "Ryanair",
        airlineColor = "#2563EB",
        iataCode = "FR",
        tab = "departures",
        destination = "STN",
        origin = "PSA",
        scheduledTime = scheduledDeparture,
        estimatedTime = delayedDeparture,
        realDeparture = null,
        realArrival = null,
        ops = FlightOps(
            checkInOpen = 120,
            checkInClose = 40,
            gateOpen = 45,
            gateClose = 15,
        ),
        pinnedAt = scheduledDeparture - 3_600,
    )

    @Test
    fun countsDownToGateCloseBeforeGateClose() {
        val now = scheduledDeparture - 20 * 60

        assertEquals("Gate Close tra 5m", buildDepartureCountdownText(flight, now))
    }

    @Test
    fun roundsUpDuringLastSecondsBeforeGateClose() {
        val now = scheduledDeparture - 15 * 60 - 30

        assertEquals("Gate Close tra 1m", buildDepartureCountdownText(flight, now))
    }

    @Test
    fun countsDownToLiveDepartureAfterGateClose() {
        assertEquals("DEP tra 30m", buildDepartureCountdownText(flight, scheduledDeparture))
    }
}
