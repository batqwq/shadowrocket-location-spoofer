# iOS Location Spoofer for Shadowrocket

[Chinese README](./README.md)

This project ports the core behavior of
[acheong08/ios-location-spoofer](https://github.com/acheong08/ios-location-spoofer)
to a Shadowrocket module.

The original project uses an iOS PacketTunnel extension and a local Go MITM
proxy. This repository lets Shadowrocket provide the VPN, HTTPS decryption, and
script runtime while `location-spoofer.js` reimplements the ARPC/protobuf
patching logic in JavaScript.

The default location is Apple Park in Cupertino, California:

```text
latitude: 37.3349
longitude: -122.00902
timezone: America/Los_Angeles
```

## Quick Start

Import the main module in Shadowrocket:

```text
https://raw.githubusercontent.com/batqwq/shadowrocket-location-spoofer/main/ios-location-spoofer.sgmodule?v=20260619-cell-response2
```

Then:

1. Enable HTTPS decryption in Shadowrocket.
2. Install and fully trust Shadowrocket's MITM certificate in iOS Settings.
3. Enable only the `iOS Location Spoofer` main module. Do not enable the probe
   module at the same time.
4. Disconnect and reconnect Shadowrocket.
5. Turn iOS Location Services off, wait a few seconds, then turn them on again.
6. Test in Apple Maps or another app that uses iOS system location.

The module enables MITM for:

```text
gs-loc.apple.com
gs-loc-cn.apple.com
```

## How It Works

The module intercepts Apple's Wi-Fi/cellular location endpoint:

```text
/clls/wloc
```

It patches location fields inside the AppleWLoc protobuf response:

- Wi-Fi results: `wifi_devices`, protobuf field `2`
- Cellular tower results: `cell_tower_response`, protobuf field `22`
- Coordinates are encoded as `coord * 1e8`
- Horizontal accuracy, vertical accuracy, altitude, motion type, and confidence
  are patched as well
- `num_cell_results`, `num_wifi_results`, and `device_type` are removed to match
  the original implementation

This module does not hook CoreLocation and does not modify real GNSS/GPS
hardware data. It only affects location flows that use Apple's `/clls/wloc`
service and can be MITM-decrypted by Shadowrocket.

## Files

- `ios-location-spoofer.sgmodule`: default Shadowrocket module.
- `location-spoofer.js`: Shadowrocket script with ARPC/protobuf patching.
- `location-spoofer-config.json`: default config example.
- `ios-location-spoofer-response-probe.sgmodule`: response-body diagnostic
  module.
- `ios-location-spoofer-request-only.sgmodule`: request-synthesis diagnostic
  module.
- `test-location-spoofer.js`: local Node.js test harness.
- `NOTICE.md`: derivative-work notice, upstream credits, and licensing notes.
- `LICENSE`: AGPL-3.0 license text.

## Config

Default config:

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

The published module passes the Apple Park coordinate inline through the script
argument. `location-spoofer-config.json` is kept as an editable example for users
who want to host a remote config themselves.

## Diagnostic Modules

Response probe:

```text
https://raw.githubusercontent.com/batqwq/shadowrocket-location-spoofer/main/ios-location-spoofer-response-probe.sgmodule?v=20260619-cell-probe1
```

Request-synthesis diagnostic:

```text
https://raw.githubusercontent.com/batqwq/shadowrocket-location-spoofer/main/ios-location-spoofer-request-only.sgmodule?v=20260619-cell-request1
```

When the module works, Shadowrocket logs should include something like:

```text
Location spoofer response body: ... bytes
Location spoofer patched 2 wifi devices, 0 cell towers, kind=synthetic
```

On LTE/cellular, logs may show:

```text
Location spoofer patched 0 wifi devices, 100+ cell towers, kind=synthetic
Location spoofer patched locations: firstCell=37.33490000,-122.00902000
```

That is expected. It means cellular tower responses were patched.

## Troubleshooting

If the log shows:

```text
Location spoofer response body too short: 0 bytes
```

Shadowrocket is not exposing the binary response body to the script. Confirm
that the module line contains:

```text
requires-body=1,binary-body-mode=1,max-size=1048576
```

If the log shows:

```text
Location spoofer patched 0 wifi devices, 0 cell towers
```

Apple's response did not contain usable Wi-Fi or cellular location results in
that run. Toggle Location Services and test again, or export the PacketTunnel log
for diagnosis.

HTTP/2 itself is not the issue. The current module has been verified in logs
where the script matched and read binary response bodies under both HTTP/1.1 and
HTTP/2.

## Test

```sh
node test-location-spoofer.js
```

Expected output:

```text
All location spoofer tests passed.
```

## Upstream and License

This is a derivative port of
[acheong08/ios-location-spoofer](https://github.com/acheong08/ios-location-spoofer).
The original reverse engineering, Go MITM implementation, and protobuf structure
come from the upstream project.

This repository follows the upstream AGPL-3.0 license. If you redistribute or
modify this project, keep the upstream attribution, this repository's
modification notice, `NOTICE.md`, and `LICENSE`.

This project is not affiliated with Apple, Shadowrocket, or the upstream author.
