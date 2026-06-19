# iOS Location Spoofer for Shadowrocket

This is a pure Shadowrocket module port of the core behavior from
`acheong08/ios-location-spoofer`.

The original app runs a PacketTunnel plus a local Go MITM proxy. This port lets
Shadowrocket provide the VPN and MITM layer, while `location-spoofer.js` ports
the ARPC/protobuf patching logic in JavaScript.

## Files

- `ios-location-spoofer.sgmodule`: Shadowrocket module.
- `location-spoofer.js`: request/response script.
- `location-spoofer-config.json`: coordinate and behavior config.
- `test-location-spoofer.js`: Node.js test harness for the binary codec.

## Configure

1. Edit `location-spoofer-config.json`.
2. The module is configured for this GitHub Raw location:
   `https://raw.githubusercontent.com/batqwq/shadowrocket-location-spoofer/main/`
3. Import this URL in Shadowrocket:
   `https://raw.githubusercontent.com/batqwq/shadowrocket-location-spoofer/main/ios-location-spoofer.sgmodule`
4. Install and fully trust Shadowrocket's MITM certificate in iOS Settings.
5. Enable the module, start Shadowrocket, then toggle iOS Location Services off
   and on before testing Maps.

Shadowrocket cannot generally read the adjacent local JSON file after module
import, so the config URL must be reachable from the device. If you do not want
an external config file, pass inline JSON through the script `argument=config=...`
or edit `DEFAULT_CONFIG` in `location-spoofer.js`.

## Config

The default coordinate is Apple Park in Cupertino, California.

```json
{
  "enabled": true,
  "mode": "request",
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

`mode: "request"` is the default. The script reads the intercepted ARPC request
and returns a synthetic Apple WLoc response.

If your Shadowrocket build does not support synthetic binary responses from an
`http-request` script, set `mode` to `"response"`. In that mode, the request is
sent upstream and the script rewrites Apple's binary response body instead.

## What It Spoofs

The module targets:

- `gs-loc.apple.com`
- `gs-loc-cn.apple.com`
- `/clls/wloc`

It patches Wi-Fi location results in the AppleWLoc protobuf:

- latitude and longitude are encoded as `coord * 1e8`
- horizontal accuracy, vertical accuracy, altitude, motion type, and motion
  confidence mirror the upstream Go implementation defaults
- root fields `num_cell_results`, `num_wifi_results`, and `device_type` are
  removed, matching the original implementation

It does not hook CoreLocation directly and does not spoof raw GNSS hardware data.
It only affects location flows that use Apple's Wi-Fi location service and can be
MITM-decrypted by Shadowrocket.

## Test

Run:

```sh
node test-location-spoofer.js
```

Expected output:

```text
All location spoofer tests passed.
```

## License Notice

This is a derivative port of `acheong08/ios-location-spoofer`, which is licensed
under AGPL-3.0. Keep the original attribution and AGPL-3.0 obligations when
redistributing this port.
