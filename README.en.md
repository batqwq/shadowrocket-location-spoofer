# iOS Location Spoofer for Shadowrocket

[中文说明](./README.md)

This is a Shadowrocket module port derived from
[acheong08/ios-location-spoofer](https://github.com/acheong08/ios-location-spoofer).

The upstream project uses an iOS PacketTunnel extension plus a local Go MITM
proxy to intercept Apple's `/clls/wloc` location service and rewrite Wi-Fi or
cellular location results. This repository keeps that core behavior, but moves
the runtime to Shadowrocket: Shadowrocket provides VPN, HTTPS decryption, and
script execution, while `location-spoofer.js` handles ARPC/protobuf parsing and
response patching.

The default location is Apple Park in Cupertino, California:

```text
latitude: 37.3349
longitude: -122.00902
timezone: America/Los_Angeles
```

## Quick Start

Import the main module in Shadowrocket:

```text
https://raw.githubusercontent.com/batqwq/shadowrocket-location-spoofer/main/ios-location-spoofer.sgmodule
```

Then:

1. Enable `HTTPS Decryption` in Shadowrocket.
2. Install and fully trust Shadowrocket's MITM certificate in iOS Settings.
3. Enable only the `iOS Location Spoofer` main module. Do not enable inspect,
   raw-dump, or probe modules at the same time.
4. Disconnect and reconnect Shadowrocket.
5. Turn iOS Location Services off, wait a few seconds, then turn them on again.
6. Test with Apple Maps, Weather, or another app that uses iOS system location.

The module automatically appends MITM hostnames:

```text
gs-loc.apple.com
gs-loc-cn.apple.com
```

## Current Status

Verified in Shadowrocket PacketTunnel logs:

- The module can read and patch `/clls/wloc` binary responses under HTTP/2 MITM.
- Wi-Fi location responses can be rewritten to Apple Park.
- Cellular `cell_tower_response` results can be rewritten to Apple Park.
- A real cellular test patched `121 cell towers`, with the first cellular result
  set to `37.33490000,-122.00902000`.

This module does not hook CoreLocation and does not modify real GNSS/GPS
hardware data. It only affects location flows that pass through Apple's
`/clls/wloc` service and can be decrypted by Shadowrocket. Strong GPS fixes,
app-specific location SDKs, or location paths that do not use this Apple
endpoint may not be affected.

## How It Works

The module intercepts Apple's Wi-Fi/cellular location endpoint:

```text
/clls/wloc
```

It patches location fields inside the AppleWLoc protobuf response:

- Wi-Fi results: `wifi_devices`, protobuf field `2`
- Cellular tower results: `cell_tower_response`, protobuf field `22` or `24`
- Coordinates are encoded as `coord * 1e8`
- Horizontal accuracy, vertical accuracy, altitude, motion type, and confidence
  are patched as well
- `num_cell_results`, `num_wifi_results`, and `device_type` are removed to match
  upstream behavior

## Files

- `ios-location-spoofer.sgmodule`: default Shadowrocket module.
- `location-spoofer.js`: Shadowrocket script with ARPC/protobuf patching.
- `location-spoofer-config.json`: remote config example.
- `ios-location-spoofer-inspect.sgmodule`: structured request/response
  diagnostic module, pass-through only.
- `ios-location-spoofer-raw-dump.sgmodule`: full raw body base64 diagnostic
  module, pass-through only.
- `ios-location-spoofer-response-probe.sgmodule`: response-body probe module.
- `ios-location-spoofer-request-only.sgmodule`: request-synthesis diagnostic
  module.
- `test-location-spoofer.js`: local Node.js test harness.
- `CONTRIBUTING.md`: contribution and bug report notes.
- `SECURITY.md`: privacy and security notes for diagnostic logs.
- `NOTICE.md`: derivative-work notice, upstream credits, and licensing notes.
- `LICENSE`: AGPL-3.0 license text.

## Config

Default config example:

```json
{
  "enabled": true,
  "mode": "response",
  "latitude": 37.3349,
  "longitude": -122.00902,
  "horizontalAccuracy": 39,
  "verticalAccuracy": 1000,
  "altitude": 530,
  "unknownValue4": 3,
  "motionActivityType": 63,
  "motionActivityConfidence": 467,
  "failOpen": true,
  "debug": false
}
```

The published main module passes the Apple Park coordinate inline through script
arguments. `location-spoofer-config.json` is kept as an editable example for
users who want to host their own remote config.

## Diagnostic Modules

For normal usage, enable only the main module. The following modules are for
debugging and should not be enabled together with the main module.

Structured inspect:

```text
https://raw.githubusercontent.com/batqwq/shadowrocket-location-spoofer/main/ios-location-spoofer-inspect.sgmodule?v=20260619-inspect1
```

`inspect` logs ARPC/protobuf summaries without dumping full raw bodies.

Full raw dump:

```text
https://raw.githubusercontent.com/batqwq/shadowrocket-location-spoofer/main/ios-location-spoofer-raw-dump.sgmodule?v=20260619-rawdump1
```

`raw-dump` writes full `/clls/wloc` request and response bodies into logs as
base64 chunks. It may contain nearby Wi-Fi/BSSID and cellular tower data, so use
it only temporarily for deep debugging.

Response probe:

```text
https://raw.githubusercontent.com/batqwq/shadowrocket-location-spoofer/main/ios-location-spoofer-response-probe.sgmodule?v=20260619-cell-probe1
```

Request-synthesis diagnostic:

```text
https://raw.githubusercontent.com/batqwq/shadowrocket-location-spoofer/main/ios-location-spoofer-request-only.sgmodule?v=20260619-cell-request1
```

## Logs

Debug logging is disabled in the main module by default. To confirm matching,
temporarily change `debug=false` to `debug=true` in the module argument, or use a
diagnostic module.

Successful Wi-Fi patch logs look like:

```text
Location spoofer patched 400 wifi devices, 0 cell towers, kind=synthetic
Location spoofer patched locations: firstWifi=37.33490000,-122.00902000
```

Successful cellular patch logs look like:

```text
Location spoofer patched 0 wifi devices, 121 cell towers, kind=synthetic
Location spoofer patched locations: firstCell=37.33490000,-122.00902000
```

If the log shows:

```text
Location spoofer patched 0 wifi devices, 0 cell towers
```

Apple's response did not contain usable Wi-Fi or cellular location results in
that run. Toggle Location Services and test again, or export the PacketTunnel log
for diagnosis.

HTTP/2 itself is not the issue. The current module has been verified in HTTP/2
logs with script matching, binary response body reading, and response patching.

## Test

```sh
node test-location-spoofer.js
```

Expected output:

```text
All location spoofer tests passed.
```

## Upstream and License

This project is a Shadowrocket derivative port of
[acheong08/ios-location-spoofer](https://github.com/acheong08/ios-location-spoofer).
The upstream project provides the original reverse engineering, PacketTunnel +
Go MITM implementation, AppleWLoc protobuf structure, and `/clls/wloc` patching
approach.

This repository follows the upstream AGPL-3.0 license. If you redistribute or
modify this project, keep the upstream link, author attribution, this
repository's modification notice, `NOTICE.md`, and `LICENSE`.

This project is not affiliated with Apple, Shadowrocket, or the upstream author.
