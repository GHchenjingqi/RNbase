# Bridge 能力清单（自动生成）

> 由 `scripts/gen-api-doc.js` 从 `scripts/api.js` 注册表自动生成，请勿手改。
> 漂移校验：`node scripts/gen-api-doc.js --check`。
> 详细使用说明见根目录 `DEVICE_CAPABILITIES.md`（手写文档）。

## H5 SDK 暴露的能力（16 模块）

| 调用 | Bridge module.action |
| --- | --- |
| `RN.APP.GETINFO` | app.getInfo |
| `RN.APP.GETVERSION` | app.getVersion |
| `RN.APP.GETCAPABILITIES` | app.getCapabilities |
| `RN.APP.GETCLIENTID` | app.getClientId |
| `RN.APP.READY` | app.ready |
| `RN.APP.LIFECYCLE` | app.lifecycle |
| `RN.APP.NATIVEBACKRESULT` | app.nativeBackResult |
| `RN.AUTH.GETTOKEN` | auth.getToken |
| `RN.AUTH.GETUSER` | auth.getUser |
| `RN.AUTH.LOGOUT` | auth.logout |
| `RN.NETWORK.GETSTATUS` | network.getStatus |
| `RN.CAMERA.TAKEPHOTO` | camera.takePhoto |
| `RN.SCANNER.SCAN` | scanner.scan |
| `RN.MEDIA.PICKIMAGE` | media.pickImage |
| `RN.MEDIA.SAVEIMAGE` | media.saveImage |
| `RN.FILE.PICK` | file.pick |
| `RN.FILE.PICKIMAGE` | file.pickImage |
| `RN.FILE.READASBASE64` | file.readAsBase64 |
| `RN.FILE.DOWNLOAD` | file.download |
| `RN.FILE.OPEN` | file.open |
| `RN.LOCATION.GETCURRENTPOSITION` | location.getCurrentPosition |
| `RN.CLIPBOARD.GETSTRING` | clipboard.getString |
| `RN.CLIPBOARD.SETSTRING` | clipboard.setString |
| `RN.CLIPBOARD.HASSTRING` | clipboard.hasString |
| `RN.NFC.AVAILABLE` | nfc.isAvailable |
| `RN.NFC.READTAG` | nfc.readTag |
| `RN.NFC.WRITENDEF` | nfc.writeNdef |
| `RN.UPDATE.GETINFO` | update.getInfo |
| `RN.UPDATE.STARTDOWNLOAD` | update.startDownload |
| `RN.UPDATE.GETPROGRESS` | update.getProgress |
| `RN.UPDATE.CANCELDOWNLOAD` | update.cancelDownload |
| `RN.UPDATE.INSTALL` | update.install |
| `RN.UPDATE.CANREQUESTINSTALL` | update.canRequestInstall |
| `RN.UPDATE.OPENINSTALLSETTINGS` | update.openInstallSettings |
| `RN.UPDATE.COPYTODOWNLOADS` | update.copyToDownloads |
| `RN.UPDATE.CLEANUP` | update.cleanup |
| `RN.SYSTEM.VIBRATE` | system.vibrate |
| `RN.SYSTEM.COPY` | system.copy |
| `RN.SYSTEM.SHARE` | system.share |
| `RN.SYSTEM.GETDARKMODE` | system.getDarkMode |
| `RN.SYSTEM.GETLANGUAGE` | system.getLanguage |
| `RN.SYSTEM.GETSCREENINFO` | system.getScreenInfo |
| `RN.SYSTEM.GETSTATUSBARHEIGHT` | system.getStatusBarHeight |
| `RN.SYSTEM.GETPLATFORM` | system.getPlatform |
| `RN.SYSTEM.GETACCESSIBILITY` | system.getAccessibility |
| `RN.SYSTEM.GETINFO` | system.getInfo |
| `RN.SYSTEM.GETDEVICEINFO` | system.getDeviceInfo |
| `RN.SYSTEM.GETBATTERY` | system.getBattery |
| `RN.NOTIFICATION.GETTOKEN` | notification.getToken |
| `RN.NOTIFICATION.SETBADGE` | notification.setBadge |
| `RN.NOTIFICATION.PLAYSOUND` | notification.playSound |
| `RN.NOTIFICATION.SENDNOTIFICATION` | notification.sendNotification |
| `RN.NOTIFICATION.GETPENDINGNOTIFICATION` | notification.getPendingNotification |
| `RN.PERMISSION.REQUEST` | permission.request |
| `RN.PERMISSION.REQUESTALL` | permission.requestAll |
| `RN.PERMISSION.CHECK` | permission.check |
| `RN.PERMISSION.OPENSETTINGS` | permission.openSettings |
| `RN.LOG.INFO` | log.info |
| `RN.LOG.ERROR` | log.error |
| `RN.LOG.WARN` | log.warn |
| `RN.LOG.DEBUG` | log.debug |
| `RN.VOICE.GETSTATUS` | voice.getStatus |
| `RN.VOICE.PREPAREMODEL` | voice.prepareModel |
| `RN.VOICE.STARTRECORDING` | voice.startRecording |
| `RN.VOICE.STOPANDRECOGNIZE` | voice.stopAndRecognize |
| `RN.VOICE.CANCELRECORDING` | voice.cancelRecording |

**合计 66 个方法。**

### APPMANAGER 特例（模块名 appManager，非全小写）

| 调用 | Bridge module.action |
| --- | --- |
| `RN.APPMANAGER.ISINSTALLED` | appManager.isInstalled |
| `RN.APPMANAGER.OPENAPP` | appManager.openApp |
| `RN.APPMANAGER.OPENAPPSTORE` | appManager.openAppStore |
| `RN.APPMANAGER.OPENAPPSETTINGS` | appManager.openAppSettings |
| `RN.APPMANAGER.OPENSYSTEMSETTINGS` | appManager.openSystemSettings |
| `RN.APPMANAGER.GETINSTALLEDAPPS` | appManager.getInstalledApps |

## RN 侧已注册但 H5 SDK 未暴露（25 个，按需在 api.js 补登记）

- `audio`
- `backgroundTask`
- `battery`
- `biometric`
- `bluetooth`
- `brightness`
- `calendar`
- `contacts`
- `device`
- `dialog`
- `flashlight`
- `haptics`
- `image`
- `inAppReview`
- `keyboard`
- `navigation`
- `networkInfo`
- `orientation`
- `qr`
- `sensor`
- `speech`
- `statusBar`
- `storage`
- `toast`
- `webViewControl`

## H5 SDK 登记但 RN 侧未见注册调用（0 个，需人工确认）

（无）
