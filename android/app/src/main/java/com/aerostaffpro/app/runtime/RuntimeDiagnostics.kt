package com.aerostaffpro.app.runtime

import android.app.ActivityManager
import android.app.Application
import android.app.ApplicationExitInfo
import android.content.ContentUris
import android.content.Context
import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.aerostaffpro.app.BuildConfig
import org.json.JSONObject
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.system.exitProcess

object RuntimeDiagnostics {
    private const val PREFS_NAME = "runtime_diagnostics"
    private const val KEY_LAST_REPORT = "last_report"
    private const val KEY_STARTUP_PENDING = "startup_pending"
    private const val KEY_STARTUP_STARTED_AT = "startup_started_at"
    private const val KEY_STARTUP_COMPLETED_AT = "startup_completed_at"
    private const val KEY_RUNTIME_VERSION = "runtime_version"
    private const val KEY_LAST_EXIT_INFO = "last_exit_info"
    private const val KEY_LAST_PROCESSED_EXIT_TIMESTAMP = "last_processed_exit_timestamp"
    private const val LOG_FILE_NAME = "runtime-events.log"
    private const val PUBLIC_LOG_FILE_NAME = "AeroStaffPro-runtime-events.log"
    private const val LOG_MIME_TYPE = "text/plain"
    private const val MAX_EXIT_TRACE_LINES = 120
    private const val MAX_EXIT_TRACE_CHARS = 12000

    @Volatile
    private var installed = false

    data class ExitInfoSnapshot(
        val timestamp: Long,
        val reasonCode: Int,
        val reasonLabel: String,
        val status: Int,
        val importance: Int,
        val processName: String?,
        val description: String?,
        val pssKb: Long,
        val rssKb: Long,
        val traceAvailable: Boolean,
        val traceExcerpt: String?,
    ) {
        fun toJson(): JSONObject =
            JSONObject().apply {
                put("timestamp", timestamp)
                put("reasonCode", reasonCode)
                put("reasonLabel", reasonLabel)
                put("status", status)
                put("importance", importance)
                put("processName", processName ?: JSONObject.NULL)
                put("description", description ?: JSONObject.NULL)
                put("pssKb", pssKb)
                put("rssKb", rssKb)
                put("traceAvailable", traceAvailable)
                put("traceExcerpt", traceExcerpt ?: JSONObject.NULL)
            }
    }

    @Synchronized
    fun prepareStartup(application: Application) {
        val prefs = prefs(application)
        val currentVersion = BuildConfig.VERSION_NAME
        if (prefs.getString(KEY_RUNTIME_VERSION, null) != currentVersion) {
            prefs.edit()
                .putString(KEY_RUNTIME_VERSION, currentVersion)
                .apply()
        }

        val startupWasPending = prefs.getBoolean(KEY_STARTUP_PENDING, false)
        val previousStartupStartedAt = prefs.getLong(KEY_STARTUP_STARTED_AT, 0L)
        val lastProcessedExitTimestamp = prefs.getLong(KEY_LAST_PROCESSED_EXIT_TIMESTAMP, 0L)
        val lastExitInfo = if (startupWasPending) {
            loadLatestExitInfo(
                context = application,
                startedAt = previousStartupStartedAt,
                processedAfter = lastProcessedExitTimestamp,
            )
        } else {
            null
        }
        if (lastExitInfo != null) {
            prefs.edit()
                .putString(KEY_LAST_EXIT_INFO, lastExitInfo.toJson().toString())
                .putLong(KEY_LAST_PROCESSED_EXIT_TIMESTAMP, lastExitInfo.timestamp)
                .apply()
        }

        if (startupWasPending) {
            recordEvent(
                context = application,
                type = "startup_recovery",
                message = "Previous startup did not complete. Recovery event recorded.",
                stack = lastExitInfo?.traceExcerpt,
                threadName = "main",
                metadata = buildMap {
                    put("reason", "startup_not_completed")
                    if (previousStartupStartedAt > 0L) {
                        put("previousStartupStartedAt", previousStartupStartedAt.toString())
                    }
                    lastExitInfo?.appendToMetadata(this)
                },
            )
        }

        prefs.edit()
            .putBoolean(KEY_STARTUP_PENDING, true)
            .putLong(KEY_STARTUP_STARTED_AT, System.currentTimeMillis())
            .apply()

        if (!installed) {
            val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
            Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
                recordNativeCrash(application, thread, throwable)
                if (previousHandler != null) {
                    previousHandler.uncaughtException(thread, throwable)
                } else {
                    exitProcess(10)
                }
            }

            installed = true
        }
    }

    fun clearLastReport(context: Context) {
        prefs(context).edit()
            .remove(KEY_LAST_REPORT)
            .remove(KEY_LAST_EXIT_INFO)
            .apply()
        privateLogFile(context).delete()
        deletePublicLogFile(context)
    }

    fun markStartupCompleted(context: Context) {
        prefs(context).edit()
            .putBoolean(KEY_STARTUP_PENDING, false)
            .putLong(KEY_STARTUP_COMPLETED_AT, System.currentTimeMillis())
            .apply()
    }

    fun recordNativeCrash(context: Context, thread: Thread, throwable: Throwable) {
        recordEvent(
            context = context,
            type = "native_crash",
            message = throwable.message ?: throwable.javaClass.simpleName,
            stack = stackTraceString(throwable),
            threadName = thread.name,
            metadata = mapOf(
                "exceptionClass" to throwable.javaClass.name,
            ),
        )
    }

    fun recordJsError(
        context: Context,
        message: String,
        stack: String?,
        isFatal: Boolean,
        source: String?,
    ) {
        recordEvent(
            context = context,
            type = if (isFatal) "js_fatal" else "js_error",
            message = message,
            stack = stack,
            threadName = Thread.currentThread().name,
            metadata = buildMap {
                put("source", source ?: "unknown")
                put("fatal", isFatal.toString())
            },
        )
    }

    fun recordSoftFailure(
        context: Context,
        type: String,
        message: String,
        throwable: Throwable? = null,
        metadata: Map<String, String> = emptyMap(),
    ) {
        recordEvent(
            context = context,
            type = type,
            message = message,
            stack = throwable?.let(::stackTraceString),
            threadName = Thread.currentThread().name,
            metadata = metadata,
        )
    }

    fun getDiagnosticsJson(context: Context): String {
        val prefersPublicLog = supportsPublicLogMirror()
        val publicLogReady = if (prefersPublicLog) syncPublicLogFile(context) else false
        val prefs = prefs(context)
        val payload = JSONObject()
        payload.put("appVersion", BuildConfig.VERSION_NAME)
        payload.put("device", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
        payload.put("androidVersion", "Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
        payload.put("startupPending", prefs.getBoolean(KEY_STARTUP_PENDING, false))
        payload.put("startupStartedAt", prefs.getLong(KEY_STARTUP_STARTED_AT, 0L))
        payload.put("startupCompletedAt", prefs.getLong(KEY_STARTUP_COMPLETED_AT, 0L))
        payload.put(
            "logFilePath",
            when {
                publicLogReady || prefersPublicLog -> publicLogDisplayPath()
                else -> privateLogFile(context).absolutePath
            },
        )

        val lastReport = prefs.getString(KEY_LAST_REPORT, null)
        if (!lastReport.isNullOrBlank()) {
            payload.put("lastReport", JSONObject(lastReport))
        }
        val lastExitInfo = prefs.getString(KEY_LAST_EXIT_INFO, null)
        if (!lastExitInfo.isNullOrBlank()) {
            payload.put("lastExitInfo", JSONObject(lastExitInfo))
        }

        return payload.toString()
    }

    @Synchronized
    private fun recordEvent(
        context: Context,
        type: String,
        message: String,
        stack: String?,
        threadName: String?,
        metadata: Map<String, String>,
    ) {
        val report = JSONObject()
        report.put("type", type)
        report.put("message", message)
        report.put("timestamp", isoNow())
        report.put("thread", threadName ?: "unknown")
        report.put("appVersion", BuildConfig.VERSION_NAME)
        report.put("device", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
        report.put("androidVersion", "Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
        report.put("startupPending", prefs(context).getBoolean(KEY_STARTUP_PENDING, false))
        if (!stack.isNullOrBlank()) {
            report.put("stack", stack)
        }
        if (metadata.isNotEmpty()) {
            val metadataJson = JSONObject()
            metadata.forEach { (key, value) -> metadataJson.put(key, value) }
            report.put("metadata", metadataJson)
        }

        prefs(context).edit()
            .putString(KEY_LAST_REPORT, report.toString())
            .apply()

        appendToLogFile(context, report.toString(2))
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun appendToLogFile(context: Context, payload: String) {
        privateLogFile(context).appendText(payload + "\n\n")
        syncPublicLogFile(context)
    }

    private fun privateLogFile(context: Context): File =
        File(context.filesDir, LOG_FILE_NAME)

    private fun supportsPublicLogMirror(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q || legacyPublicLogFile() != null

    private fun syncPublicLogFile(context: Context): Boolean {
        return try {
            val source = privateLogFile(context)
            if (!source.exists()) {
                deletePublicLogFile(context)
                true
            } else {
                val content = source.readText()
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val uri = findOrCreatePublicLogUri(context) ?: return false
                    val stream = context.contentResolver.openOutputStream(uri, "wt") ?: return false
                    stream.bufferedWriter().use { writer ->
                        writer.write(content)
                    }
                    true
                } else {
                    val target = legacyPublicLogFile() ?: return false
                    target.parentFile?.mkdirs()
                    target.writeText(content)
                    true
                }
            }
        } catch (_: Throwable) {
            false
        }
    }

    private fun deletePublicLogFile(context: Context) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                findPublicLogUri(context)?.let { uri ->
                    context.contentResolver.delete(uri, null, null)
                }
            } else {
                legacyPublicLogFile()?.delete()
            }
        } catch (_: Throwable) {
        }
    }

    private fun publicLogDisplayPath(): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            "Download/$PUBLIC_LOG_FILE_NAME"
        } else {
            legacyPublicLogFile()?.absolutePath ?: "Download/$PUBLIC_LOG_FILE_NAME"
        }

    private fun legacyPublicLogFile(): File? =
        Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            ?.let { directory -> File(directory, PUBLIC_LOG_FILE_NAME) }

    private fun findOrCreatePublicLogUri(context: Context) =
        findPublicLogUri(context) ?: context.contentResolver.insert(
            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
            ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, PUBLIC_LOG_FILE_NAME)
                put(MediaStore.MediaColumns.MIME_TYPE, LOG_MIME_TYPE)
                put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/")
            },
        )

    private fun findPublicLogUri(context: Context) =
        context.contentResolver.query(
            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
            arrayOf(MediaStore.MediaColumns._ID),
            "${MediaStore.MediaColumns.DISPLAY_NAME}=? AND ${MediaStore.MediaColumns.RELATIVE_PATH}=?",
            arrayOf(PUBLIC_LOG_FILE_NAME, "${Environment.DIRECTORY_DOWNLOADS}/"),
            null,
        )?.use { cursor ->
            if (!cursor.moveToFirst()) {
                return@use null
            }
            val id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID))
            ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI, id)
        }

    private fun isoNow(): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.US).format(Date())

    private fun stackTraceString(throwable: Throwable): String {
        val writer = StringWriter()
        throwable.printStackTrace(PrintWriter(writer))
        return writer.toString()
    }

    private fun loadLatestExitInfo(
        context: Context,
        startedAt: Long,
        processedAfter: Long,
    ): ExitInfoSnapshot? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return null
        }

        val activityManager = context.getSystemService(ActivityManager::class.java) ?: return null
        val currentProcessName = runCatching { Application.getProcessName() }
            .getOrNull()
            ?.takeIf { it.isNotBlank() }
            ?: context.packageName
        val notBefore = maxOf(startedAt, processedAfter)

        return runCatching {
            activityManager.getHistoricalProcessExitReasons(context.packageName, 0, 8)
                .asSequence()
                .filter { info ->
                    val processName = info.processName
                    processName == currentProcessName || processName == context.packageName
                }
                .filter { info -> info.timestamp > notBefore }
                .maxByOrNull { info -> info.timestamp }
                ?.toSnapshot()
        }.getOrNull()
    }

    private fun ApplicationExitInfo.toSnapshot(): ExitInfoSnapshot =
        readTraceSnapshot().let { trace ->
            ExitInfoSnapshot(
            timestamp = timestamp,
            reasonCode = reason,
            reasonLabel = exitReasonLabel(reason),
            status = status,
            importance = importance,
            processName = processName?.takeIf { it.isNotBlank() },
            description = description?.singleLineSummary(),
            pssKb = pss,
            rssKb = rss,
            traceAvailable = trace.available,
            traceExcerpt = trace.excerpt,
        )
        }

    private data class ExitTraceSnapshot(
        val available: Boolean,
        val excerpt: String?,
    )

    private fun ApplicationExitInfo.readTraceSnapshot(): ExitTraceSnapshot =
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            ExitTraceSnapshot(available = false, excerpt = null)
        } else {
            runCatching {
                traceInputStream?.use { stream ->
                    ExitTraceSnapshot(
                        available = true,
                        excerpt = stream.readTraceExcerpt(),
                    )
                } ?: ExitTraceSnapshot(available = false, excerpt = null)
            }.getOrElse { ExitTraceSnapshot(available = false, excerpt = null) }
        }

    private fun exitReasonLabel(reason: Int): String =
        when (reason) {
            ApplicationExitInfo.REASON_UNKNOWN -> "REASON_UNKNOWN"
            ApplicationExitInfo.REASON_EXIT_SELF -> "REASON_EXIT_SELF"
            ApplicationExitInfo.REASON_SIGNALED -> "REASON_SIGNALED"
            ApplicationExitInfo.REASON_LOW_MEMORY -> "REASON_LOW_MEMORY"
            ApplicationExitInfo.REASON_CRASH -> "REASON_CRASH"
            ApplicationExitInfo.REASON_CRASH_NATIVE -> "REASON_CRASH_NATIVE"
            ApplicationExitInfo.REASON_ANR -> "REASON_ANR"
            ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "REASON_INITIALIZATION_FAILURE"
            ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "REASON_PERMISSION_CHANGE"
            ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "REASON_EXCESSIVE_RESOURCE_USAGE"
            ApplicationExitInfo.REASON_USER_REQUESTED -> "REASON_USER_REQUESTED"
            ApplicationExitInfo.REASON_USER_STOPPED -> "REASON_USER_STOPPED"
            ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "REASON_DEPENDENCY_DIED"
            ApplicationExitInfo.REASON_OTHER -> "REASON_OTHER"
            ApplicationExitInfo.REASON_FREEZER -> "REASON_FREEZER"
            ApplicationExitInfo.REASON_PACKAGE_STATE_CHANGE -> "REASON_PACKAGE_STATE_CHANGE"
            ApplicationExitInfo.REASON_PACKAGE_UPDATED -> "REASON_PACKAGE_UPDATED"
            else -> "REASON_$reason"
        }

    private fun ExitInfoSnapshot.appendToMetadata(target: MutableMap<String, String>) {
        target["exitReason"] = reasonLabel
        target["exitReasonCode"] = reasonCode.toString()
        target["exitStatus"] = status.toString()
        target["exitImportance"] = importance.toString()
        target["exitTimestamp"] = timestamp.toString()
        target["exitTraceAvailable"] = traceAvailable.toString()
        if (processName != null) {
            target["exitProcessName"] = processName
        }
        if (!description.isNullOrBlank()) {
            target["exitDescription"] = description
        }
        if (pssKb > 0L) {
            target["exitPssKb"] = pssKb.toString()
        }
        if (rssKb > 0L) {
            target["exitRssKb"] = rssKb.toString()
        }
    }

    private fun String.singleLineSummary(): String =
        replace(Regex("\\s+"), " ")
            .trim()
            .let { summary ->
                if (summary.length <= 240) summary else "${summary.take(237)}..."
            }

    private fun java.io.InputStream.readTraceExcerpt(): String? {
        val bytes = readBytes()
        return decodeTombstoneTrace(bytes) ?: extractPrintableStrings(bytes)
    }

    private data class TombstoneSummary(
        val buildFingerprint: String?,
        val revision: String?,
        val timestamp: String?,
        val pid: Int?,
        val tid: Int?,
        val signal: TombstoneSignalSummary?,
        val abortMessage: String?,
        val causes: List<String>,
        val crashingThread: TombstoneThreadSummary?,
    )

    private data class TombstoneSignalSummary(
        val number: Int?,
        val name: String?,
        val code: Int?,
        val codeName: String?,
        val faultAddress: Long?,
    )

    private data class TombstoneThreadSummary(
        val mapKey: Int?,
        val id: Int?,
        val name: String?,
        val notes: List<String>,
        val unreadableElfFiles: List<String>,
        val frames: List<TombstoneFrameSummary>,
    )

    private data class TombstoneFrameSummary(
        val relPc: Long?,
        val pc: Long?,
        val functionName: String?,
        val functionOffset: Long?,
        val fileName: String?,
    )

    private class ProtoReader(private val data: ByteArray) {
        private var position = 0

        fun readTag(): Int? =
            if (position >= data.size) null else readVarint().toInt()

        fun readVarint(): Long {
            var result = 0L
            var shift = 0
            while (true) {
                if (position >= data.size) {
                    throw IllegalStateException("Unexpected end of protobuf input.")
                }
                val value = data[position++].toInt() and 0xFF
                result = result or ((value and 0x7F).toLong() shl shift)
                if ((value and 0x80) == 0) {
                    return result
                }
                shift += 7
                if (shift > 63) {
                    throw IllegalStateException("Invalid protobuf varint.")
                }
            }
        }

        fun readLengthDelimitedBytes(): ByteArray {
            val length = readVarint().toInt()
            if (length < 0 || position + length > data.size) {
                throw IllegalStateException("Invalid protobuf length-delimited field.")
            }
            val end = position + length
            val value = data.copyOfRange(position, end)
            position = end
            return value
        }

        fun readString(): String =
            readLengthDelimitedBytes()
                .toString(Charsets.UTF_8)
                .replace('\u0000', ' ')
                .trim()

        fun skipField(wireType: Int) {
            when (wireType) {
                0 -> readVarint()
                1 -> advance(8)
                2 -> advance(readVarint().toInt())
                5 -> advance(4)
                else -> throw IllegalStateException("Unsupported protobuf wire type: $wireType")
            }
        }

        private fun advance(length: Int) {
            if (length < 0 || position + length > data.size) {
                throw IllegalStateException("Invalid protobuf skip length.")
            }
            position += length
        }
    }

    private fun decodeTombstoneTrace(bytes: ByteArray): String? {
        val summary = runCatching { parseTombstone(bytes) }.getOrNull() ?: return null
        if (
            summary.signal == null &&
            summary.abortMessage.isNullOrBlank() &&
            summary.causes.isEmpty() &&
            summary.crashingThread?.frames.isNullOrEmpty()
        ) {
            return null
        }

        val lines = mutableListOf<String>()
        lines += "Android native tombstone"
        summary.timestamp?.takeIf { it.isNotBlank() }?.let { lines += "Timestamp: $it" }
        summary.buildFingerprint?.takeIf { it.isNotBlank() }?.let { lines += "Build fingerprint: $it" }
        summary.revision?.takeIf { it.isNotBlank() }?.let { lines += "Revision: $it" }
        if (summary.pid != null || summary.tid != null) {
            lines += "PID/TID: ${summary.pid ?: "?"}/${summary.tid ?: "?"}"
        }

        summary.signal?.let { signal ->
            val signalLabel = buildString {
                append("Signal: ")
                append(signal.number ?: "?")
                signal.name?.takeIf { it.isNotBlank() }?.let { append(" ($it)") }
                if (signal.code != null || !signal.codeName.isNullOrBlank()) {
                    append(" code ")
                    append(signal.code ?: "?")
                    signal.codeName?.takeIf { it.isNotBlank() }?.let { append(" ($it)") }
                }
            }
            lines += signalLabel
            signal.faultAddress?.let { lines += "Fault addr: ${formatHex(it)}" }
        }

        summary.abortMessage?.takeIf { it.isNotBlank() }?.let { lines += "Abort message: $it" }
        summary.causes.take(4).forEachIndexed { index, cause ->
            lines += "Cause ${index + 1}: $cause"
        }

        summary.crashingThread?.let { thread ->
            lines += ""
            lines += "Crashed thread: ${thread.name ?: "tid ${thread.id ?: thread.mapKey ?: "?"}"}"
            thread.notes.take(4).forEach { note -> lines += "Note: $note" }
            thread.unreadableElfFiles.take(4).forEach { file -> lines += "Unreadable ELF: $file" }
            if (thread.frames.isNotEmpty()) {
                lines += "Backtrace:"
                thread.frames.take(24).forEachIndexed { index, frame ->
                    lines += formatFrame(index, frame)
                }
            }
        }

        return clampTraceOutput(lines)
    }

    private fun parseTombstone(bytes: ByteArray): TombstoneSummary {
        val reader = ProtoReader(bytes)
        var buildFingerprint: String? = null
        var revision: String? = null
        var timestamp: String? = null
        var pid: Int? = null
        var tid: Int? = null
        var signal: TombstoneSignalSummary? = null
        var abortMessage: String? = null
        val causes = mutableListOf<String>()
        val threads = mutableListOf<TombstoneThreadSummary>()

        while (true) {
            val tag = reader.readTag() ?: break
            val fieldNumber = tag ushr 3
            val wireType = tag and 0x07
            when (fieldNumber) {
                2 -> buildFingerprint = if (wireType == 2) reader.readString().takeIf { it.isNotBlank() } else {
                    reader.skipField(wireType); buildFingerprint
                }
                3 -> revision = if (wireType == 2) reader.readString().takeIf { it.isNotBlank() } else {
                    reader.skipField(wireType); revision
                }
                4 -> timestamp = if (wireType == 2) reader.readString().takeIf { it.isNotBlank() } else {
                    reader.skipField(wireType); timestamp
                }
                5 -> pid = if (wireType == 0) reader.readVarint().toInt() else {
                    reader.skipField(wireType); pid
                }
                6 -> tid = if (wireType == 0) reader.readVarint().toInt() else {
                    reader.skipField(wireType); tid
                }
                10 -> if (wireType == 2) {
                    signal = parseSignal(reader.readLengthDelimitedBytes())
                } else {
                    reader.skipField(wireType)
                }
                14 -> abortMessage = if (wireType == 2) {
                    reader.readString().takeIf { it.isNotBlank() }?.singleLineSummary()
                } else {
                    reader.skipField(wireType); abortMessage
                }
                15 -> if (wireType == 2) {
                    parseCause(reader.readLengthDelimitedBytes())?.let(causes::add)
                } else {
                    reader.skipField(wireType)
                }
                16 -> if (wireType == 2) {
                    parseThreadEntry(reader.readLengthDelimitedBytes())?.let(threads::add)
                } else {
                    reader.skipField(wireType)
                }
                else -> reader.skipField(wireType)
            }
        }

        val crashingThread = threads.firstOrNull { it.mapKey == tid || it.id == tid }
            ?: threads.firstOrNull { it.frames.isNotEmpty() }

        return TombstoneSummary(
            buildFingerprint = buildFingerprint,
            revision = revision,
            timestamp = timestamp,
            pid = pid,
            tid = tid,
            signal = signal,
            abortMessage = abortMessage,
            causes = causes,
            crashingThread = crashingThread,
        )
    }

    private fun parseSignal(bytes: ByteArray): TombstoneSignalSummary {
        val reader = ProtoReader(bytes)
        var number: Int? = null
        var name: String? = null
        var code: Int? = null
        var codeName: String? = null
        var hasFaultAddress = false
        var faultAddress: Long? = null

        while (true) {
            val tag = reader.readTag() ?: break
            val fieldNumber = tag ushr 3
            val wireType = tag and 0x07
            when (fieldNumber) {
                1 -> number = if (wireType == 0) reader.readVarint().toInt() else {
                    reader.skipField(wireType); number
                }
                2 -> name = if (wireType == 2) reader.readString().takeIf { it.isNotBlank() } else {
                    reader.skipField(wireType); name
                }
                3 -> code = if (wireType == 0) reader.readVarint().toInt() else {
                    reader.skipField(wireType); code
                }
                4 -> codeName = if (wireType == 2) reader.readString().takeIf { it.isNotBlank() } else {
                    reader.skipField(wireType); codeName
                }
                8 -> hasFaultAddress = if (wireType == 0) reader.readVarint() != 0L else {
                    reader.skipField(wireType); hasFaultAddress
                }
                9 -> faultAddress = if (wireType == 0) reader.readVarint() else {
                    reader.skipField(wireType); faultAddress
                }
                else -> reader.skipField(wireType)
            }
        }

        return TombstoneSignalSummary(
            number = number,
            name = name,
            code = code,
            codeName = codeName,
            faultAddress = if (hasFaultAddress) faultAddress else null,
        )
    }

    private fun parseCause(bytes: ByteArray): String? {
        val reader = ProtoReader(bytes)
        while (true) {
            val tag = reader.readTag() ?: break
            val fieldNumber = tag ushr 3
            val wireType = tag and 0x07
            when (fieldNumber) {
                1 -> if (wireType == 2) {
                    return reader.readString().takeIf { it.isNotBlank() }?.singleLineSummary()
                } else {
                    reader.skipField(wireType)
                }
                else -> reader.skipField(wireType)
            }
        }
        return null
    }

    private fun parseThreadEntry(bytes: ByteArray): TombstoneThreadSummary? {
        val reader = ProtoReader(bytes)
        var mapKey: Int? = null
        var thread: TombstoneThreadSummary? = null

        while (true) {
            val tag = reader.readTag() ?: break
            val fieldNumber = tag ushr 3
            val wireType = tag and 0x07
            when (fieldNumber) {
                1 -> mapKey = if (wireType == 0) reader.readVarint().toInt() else {
                    reader.skipField(wireType); mapKey
                }
                2 -> if (wireType == 2) {
                    thread = parseThread(reader.readLengthDelimitedBytes())
                } else {
                    reader.skipField(wireType)
                }
                else -> reader.skipField(wireType)
            }
        }

        return thread?.copy(mapKey = mapKey)
    }

    private fun parseThread(bytes: ByteArray): TombstoneThreadSummary {
        val reader = ProtoReader(bytes)
        var id: Int? = null
        var name: String? = null
        val notes = mutableListOf<String>()
        val unreadableElfFiles = mutableListOf<String>()
        val frames = mutableListOf<TombstoneFrameSummary>()

        while (true) {
            val tag = reader.readTag() ?: break
            val fieldNumber = tag ushr 3
            val wireType = tag and 0x07
            when (fieldNumber) {
                1 -> id = if (wireType == 0) reader.readVarint().toInt() else {
                    reader.skipField(wireType); id
                }
                2 -> name = if (wireType == 2) reader.readString().takeIf { it.isNotBlank() } else {
                    reader.skipField(wireType); name
                }
                4 -> if (wireType == 2) {
                    parseBacktraceFrame(reader.readLengthDelimitedBytes())?.let(frames::add)
                } else {
                    reader.skipField(wireType)
                }
                7 -> if (wireType == 2) {
                    reader.readString().takeIf { it.isNotBlank() }?.let(notes::add)
                } else {
                    reader.skipField(wireType)
                }
                9 -> if (wireType == 2) {
                    reader.readString().takeIf { it.isNotBlank() }?.let(unreadableElfFiles::add)
                } else {
                    reader.skipField(wireType)
                }
                else -> reader.skipField(wireType)
            }
        }

        return TombstoneThreadSummary(
            mapKey = null,
            id = id,
            name = name,
            notes = notes,
            unreadableElfFiles = unreadableElfFiles,
            frames = frames,
        )
    }

    private fun parseBacktraceFrame(bytes: ByteArray): TombstoneFrameSummary? {
        val reader = ProtoReader(bytes)
        var relPc: Long? = null
        var pc: Long? = null
        var functionName: String? = null
        var functionOffset: Long? = null
        var fileName: String? = null

        while (true) {
            val tag = reader.readTag() ?: break
            val fieldNumber = tag ushr 3
            val wireType = tag and 0x07
            when (fieldNumber) {
                1 -> relPc = if (wireType == 0) reader.readVarint() else {
                    reader.skipField(wireType); relPc
                }
                2 -> pc = if (wireType == 0) reader.readVarint() else {
                    reader.skipField(wireType); pc
                }
                4 -> functionName = if (wireType == 2) reader.readString().takeIf { it.isNotBlank() } else {
                    reader.skipField(wireType); functionName
                }
                5 -> functionOffset = if (wireType == 0) reader.readVarint() else {
                    reader.skipField(wireType); functionOffset
                }
                6 -> fileName = if (wireType == 2) reader.readString().takeIf { it.isNotBlank() } else {
                    reader.skipField(wireType); fileName
                }
                else -> reader.skipField(wireType)
            }
        }

        return if (
            relPc == null &&
            pc == null &&
            functionName.isNullOrBlank() &&
            fileName.isNullOrBlank()
        ) {
            null
        } else {
            TombstoneFrameSummary(
                relPc = relPc,
                pc = pc,
                functionName = functionName,
                functionOffset = functionOffset,
                fileName = fileName,
            )
        }
    }

    private fun formatFrame(index: Int, frame: TombstoneFrameSummary): String {
        val address = frame.relPc?.let(::formatHex) ?: frame.pc?.let(::formatHex) ?: "?"
        val library = frame.fileName ?: "<unknown>"
        val symbol = frame.functionName?.takeIf { it.isNotBlank() }?.let { functionName ->
            frame.functionOffset?.let { "$functionName+${formatHex(it)}" } ?: functionName
        } ?: "<unknown>"
        return buildString {
            append('#')
            append(index.toString().padStart(2, '0'))
            append(" pc ")
            append(address)
            append(' ')
            append(library)
            append(" (")
            append(symbol)
            append(')')
        }
    }

    private fun formatHex(value: Long): String = "0x${value.toString(16)}"

    private fun clampTraceOutput(lines: List<String>): String? {
        val output = buildString {
            var totalChars = 0
            lines.forEachIndexed { index, line ->
                val normalized = line.trimEnd()
                val extraChars = normalized.length + if (index > 0) 1 else 0
                if (index >= MAX_EXIT_TRACE_LINES || totalChars + extraChars > MAX_EXIT_TRACE_CHARS) {
                    if (isNotEmpty()) {
                        append('\n')
                    }
                    append("... (trace truncated)")
                    return@buildString
                }
                if (isNotEmpty()) {
                    append('\n')
                }
                append(normalized)
                totalChars += extraChars
            }
        }.trim()
        return output.takeIf { it.isNotBlank() }
    }

    private fun extractPrintableStrings(bytes: ByteArray): String? {
        val strings = mutableListOf<String>()
        val current = StringBuilder()

        fun flush() {
            val value = current.toString().trim()
            if (value.length >= 4) {
                strings += value
            }
            current.clear()
        }

        bytes.forEach { byte ->
            val value = byte.toInt() and 0xFF
            val ch = value.toChar()
            if (ch in ' '..'~' || ch == '\n' || ch == '\r' || ch == '\t') {
                current.append(ch)
            } else {
                flush()
            }
        }
        flush()

        return clampTraceOutput(strings.take(MAX_EXIT_TRACE_LINES))
    }
}
