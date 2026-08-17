package com.aerostaffpro.app.security

import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.view.WindowManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

class AppSecurityModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AppSecurity"

    @ReactMethod
    fun setSecureWindow(enabled: Boolean, promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.reject("SECURE_WINDOW_UNAVAILABLE", "No active Android activity")
            return
        }
        activity.runOnUiThread {
            try {
                if (enabled) {
                    activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
                } else {
                    activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                }
                promise.resolve(true)
            } catch (error: Exception) {
                promise.reject("SECURE_WINDOW_FAILED", error.message, error)
            }
        }
    }

    @ReactMethod
    fun verifyApk(
        fileUri: String,
        expectedPackageName: String,
        expectedVersionName: String,
        expectedSha256: String,
        expectedSize: Double,
        promise: Promise,
    ) {
        try {
            check(expectedPackageName == reactApplicationContext.packageName) {
                "Unexpected target package"
            }
            check(expectedVersionName.matches(Regex("\\d+\\.\\d+\\.\\d+"))) {
                "Invalid expected version"
            }
            check(expectedSha256.matches(Regex("[a-fA-F0-9]{64}"))) {
                "Invalid expected SHA-256"
            }

            val uri = Uri.parse(fileUri)
            check(uri.scheme == "file") { "Only private file:// APKs can be verified" }
            val apkFile = File(checkNotNull(uri.path) { "Missing APK path" }).canonicalFile
            val updatesDir = File(reactApplicationContext.filesDir, "updates").canonicalFile
            check(apkFile.parentFile == updatesDir && apkFile.extension.equals("apk", ignoreCase = true)) {
                "APK is outside the private updates directory"
            }
            check(apkFile.isFile) { "APK file does not exist" }
            check(expectedSize.toLong() > 0L && apkFile.length() == expectedSize.toLong()) {
                "APK size does not match the signed release metadata"
            }

            val packageManager = reactApplicationContext.packageManager
            val archiveInfo = getArchivePackageInfo(packageManager, apkFile)
                ?: error("Android could not parse the downloaded APK")
            check(archiveInfo.packageName == expectedPackageName) { "APK package name mismatch" }
            check(archiveInfo.versionName == expectedVersionName) { "APK version name mismatch" }

            val installedInfo = getInstalledPackageInfo(packageManager, expectedPackageName)
            val archiveVersionCode = getLongVersionCode(archiveInfo)
            check(archiveVersionCode > getLongVersionCode(installedInfo)) {
                "APK is not newer than the installed application"
            }

            val archiveSigners = getArchiveSignerDigests(archiveInfo)
            val trustedSigners = getTrustedInstalledSignerDigests(installedInfo)
            check(archiveSigners.isNotEmpty() && archiveSigners.all(trustedSigners::contains)) {
                "APK signing certificate does not match the installed application"
            }

            val actualSha256 = sha256(apkFile)
            check(MessageDigest.isEqual(
                actualSha256.toByteArray(Charsets.US_ASCII),
                expectedSha256.lowercase().toByteArray(Charsets.US_ASCII),
            )) { "APK SHA-256 mismatch" }

            promise.resolve(Arguments.createMap().apply {
                putString("sha256", actualSha256)
                putDouble("versionCode", archiveVersionCode.toDouble())
            })
        } catch (error: Exception) {
            promise.reject("APK_VERIFY_FAILED", error.message, error)
        }
    }

    @Suppress("DEPRECATION")
    private fun getArchivePackageInfo(packageManager: PackageManager, apkFile: File): PackageInfo? =
        packageManager.getPackageArchiveInfo(
            apkFile.absolutePath,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                PackageManager.GET_SIGNING_CERTIFICATES
            } else {
                PackageManager.GET_SIGNATURES
            },
        )

    @Suppress("DEPRECATION")
    private fun getInstalledPackageInfo(packageManager: PackageManager, packageName: String): PackageInfo =
        packageManager.getPackageInfo(
            packageName,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                PackageManager.GET_SIGNING_CERTIFICATES
            } else {
                PackageManager.GET_SIGNATURES
            },
        )

    @Suppress("DEPRECATION")
    private fun getLongVersionCode(packageInfo: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) packageInfo.longVersionCode
        else packageInfo.versionCode.toLong()

    @Suppress("DEPRECATION")
    private fun getArchiveSignerDigests(packageInfo: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            packageInfo.signingInfo?.apkContentsSigners.orEmpty()
        } else {
            packageInfo.signatures.orEmpty()
        }
        return signatures.mapTo(mutableSetOf()) { sha256(it.toByteArray()) }
    }

    @Suppress("DEPRECATION")
    private fun getTrustedInstalledSignerDigests(packageInfo: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            packageInfo.signingInfo?.signingCertificateHistory.orEmpty()
        } else {
            packageInfo.signatures.orEmpty()
        }
        return signatures.mapTo(mutableSetOf()) { sha256(it.toByteArray()) }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (count > 0) digest.update(buffer, 0, count)
            }
        }
        return toHex(digest.digest())
    }

    private fun sha256(bytes: ByteArray): String =
        toHex(MessageDigest.getInstance("SHA-256").digest(bytes))

    private fun toHex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }
}
