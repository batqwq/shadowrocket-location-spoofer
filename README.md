# iOS Location Spoofer for Shadowrocket

[English version](./README.en.md)

这是一个把 [acheong08/ios-location-spoofer](https://github.com/acheong08/ios-location-spoofer)
移植为 Shadowrocket 模块的派生项目。

上游项目使用 iOS PacketTunnel 和本地 Go MITM 代理，拦截 Apple
`/clls/wloc` 定位服务返回并改写其中的 Wi-Fi/蜂窝定位结果。本仓库保留这个核心思路，
但把运行环境换成 Shadowrocket：由 Shadowrocket 提供 VPN、HTTPS 解密和脚本运行时，
`location-spoofer.js` 负责 ARPC/protobuf 解析与响应 patch。

默认位置是美国 Apple Park：

```text
latitude: 37.3349
longitude: -122.00902
timezone: America/Los_Angeles
```

## 快速使用

在 Shadowrocket 中导入主模块：

```text
https://raw.githubusercontent.com/batqwq/shadowrocket-location-spoofer/main/ios-location-spoofer.sgmodule
```

然后按下面步骤配置：

1. 打开 Shadowrocket 的 `HTTPS 解密`。
2. 安装并完全信任 Shadowrocket 的 MITM 证书。
3. 只启用 `iOS Location Spoofer` 主模块，不要同时启用 inspect、raw-dump 或 probe 诊断模块。
4. 断开并重新连接 Shadowrocket。
5. 在 iOS 设置中关闭定位服务，等待几秒后再打开。
6. 用 Apple 地图、系统天气或其它使用 iOS 系统定位的 App 测试。

主模块会自动追加 MITM 域名：

```text
gs-loc.apple.com
gs-loc-cn.apple.com
```

## 当前状态

已在 Shadowrocket PacketTunnel 日志中验证：

- HTTP/2 MITM 下可以读取并修改 `/clls/wloc` 二进制响应。
- Wi-Fi 定位响应可以改写到 Apple Park。
- 蜂窝网络下的 `cell_tower_response` 响应可以改写到 Apple Park。
- 真实日志中出现过 `121 cell towers` 被 patch，首个蜂窝结果为 `37.33490000,-122.00902000`。

这个模块不 hook CoreLocation，也不修改真实 GNSS/GPS 硬件数据。它只影响能被
Shadowrocket HTTPS 解密并经过 Apple `/clls/wloc` 服务的定位流程。使用强 GPS、
App 自己的定位 SDK，或没有经过该 Apple 接口的定位请求时，结果可能不会被改变。

## 实现说明

模块拦截 Apple Wi-Fi/蜂窝定位接口：

```text
/clls/wloc
```

它会修改 AppleWLoc protobuf 响应中的位置字段：

- Wi-Fi 结果：`wifi_devices`，protobuf field `2`
- 蜂窝基站结果：`cell_tower_response`，protobuf field `22` 或 `24`
- 经纬度编码：`coord * 1e8`
- 同步修改水平精度、垂直精度、海拔、运动类型和置信度
- 移除 `num_cell_results`、`num_wifi_results`、`device_type`，保持与上游实现一致

## 文件说明

- `ios-location-spoofer.sgmodule`：默认 Shadowrocket 模块。
- `location-spoofer.js`：Shadowrocket 脚本，包含 ARPC/protobuf patch 逻辑。
- `location-spoofer-config.json`：远程配置示例。
- `ios-location-spoofer-inspect.sgmodule`：结构化请求/响应诊断模块，不修改流量。
- `ios-location-spoofer-raw-dump.sgmodule`：完整 raw body base64 诊断模块，不修改流量。
- `ios-location-spoofer-response-probe.sgmodule`：响应体探测诊断模块。
- `ios-location-spoofer-request-only.sgmodule`：请求合成诊断模块。
- `test-location-spoofer.js`：本地 Node.js 测试。
- `CONTRIBUTING.md`：贡献和问题反馈说明。
- `SECURITY.md`：诊断日志的隐私和安全说明。
- `NOTICE.md`：派生说明、上游致谢和授权说明。
- `LICENSE`：AGPL-3.0 许可证。

## 配置

默认配置示例：

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

发布用主模块把 Apple Park 坐标写在脚本参数中。`location-spoofer-config.json`
保留为可编辑示例，适合想自己托管远程配置的用户。

## 诊断模块

正常使用时只启用主模块。下面这些模块用于排查问题，启用时不要与主模块同时使用。

结构化 inspect：

```text
https://raw.githubusercontent.com/batqwq/shadowrocket-location-spoofer/main/ios-location-spoofer-inspect.sgmodule?v=20260619-inspect1
```

`inspect` 只输出 ARPC/protobuf 摘要，不输出完整 raw body。

完整 raw dump：

```text
https://raw.githubusercontent.com/batqwq/shadowrocket-location-spoofer/main/ios-location-spoofer-raw-dump.sgmodule?v=20260619-rawdump1
```

`raw-dump` 会把 `/clls/wloc` 请求和响应 body 以 base64 分块完整写入日志。它可能包含附近
Wi-Fi/BSSID 和蜂窝基站信息，只建议临时用于深度排查。

响应 probe：

```text
https://raw.githubusercontent.com/batqwq/shadowrocket-location-spoofer/main/ios-location-spoofer-response-probe.sgmodule?v=20260619-cell-probe1
```

请求合成诊断：

```text
https://raw.githubusercontent.com/batqwq/shadowrocket-location-spoofer/main/ios-location-spoofer-request-only.sgmodule?v=20260619-cell-request1
```

## 日志判断

主模块默认关闭 debug。如果需要确认是否命中，可以临时把模块参数里的 `debug=false`
改成 `debug=true`，或使用诊断模块。

成功 patch Wi-Fi 时，日志类似：

```text
Location spoofer patched 400 wifi devices, 0 cell towers, kind=synthetic
Location spoofer patched locations: firstWifi=37.33490000,-122.00902000
```

成功 patch 蜂窝基站时，日志类似：

```text
Location spoofer patched 0 wifi devices, 121 cell towers, kind=synthetic
Location spoofer patched locations: firstCell=37.33490000,-122.00902000
```

如果出现：

```text
Location spoofer patched 0 wifi devices, 0 cell towers
```

说明这次 Apple 响应里没有可用的 Wi-Fi 或蜂窝定位结果。重新打开定位服务后再测，必要时导出
PacketTunnel 日志排查。

HTTP/2 本身不是问题。当前模块已在 HTTP/2 日志中验证过脚本匹配、二进制响应读取和响应 patch。

## 本地测试

```sh
node test-location-spoofer.js
```

预期输出：

```text
All location spoofer tests passed.
```

## 来源与授权

本项目是 [acheong08/ios-location-spoofer](https://github.com/acheong08/ios-location-spoofer)
的 Shadowrocket 派生移植版。上游项目提供了原始逆向研究、PacketTunnel + Go MITM 实现、
AppleWLoc protobuf 结构和 `/clls/wloc` patch 思路。

本仓库遵循上游 AGPL-3.0 授权。重新分发或修改本项目时，请保留上游链接、作者署名、
本仓库修改说明、`NOTICE.md` 和 `LICENSE`。

本项目与 Apple、Shadowrocket 或上游作者没有官方关联。
