package com.aerostaffpro.app.runtime

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class RuntimeDiagnosticsModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "RuntimeDiagnostics"

    override fun getConstants(): MutableMap<String, Any> = mutableMapOf(
        "initialDiagnosticsJson" to RuntimeDiagnostics.getDiagnosticsJson(reactApplicationContext),
    )

    @ReactMethod
    fun getRuntimeDiagnostics(promise: Promise) {
        promise.resolve(RuntimeDiagnostics.getDiagnosticsJson(reactApplicationContext))
    }

    @ReactMethod
    fun clearLastReport(promise: Promise) {
        RuntimeDiagnostics.clearLastReport(reactApplicationContext)
        promise.resolve(true)
    }

    @ReactMethod
    fun markStartupCompleted(promise: Promise) {
        RuntimeDiagnostics.markStartupCompleted(reactApplicationContext)
        promise.resolve(true)
    }

    @ReactMethod
    fun recordJsError(
        message: String,
        stack: String?,
        isFatal: Boolean,
        source: String?,
        promise: Promise,
    ) {
        RuntimeDiagnostics.recordJsError(reactApplicationContext, message, stack, isFatal, source)
        promise.resolve(true)
    }
}
