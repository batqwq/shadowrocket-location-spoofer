# iOS Location Spoofer for Shadowrocket

[English version](./README.en.md)

这是一个把 [acheong08/ios-location-spoofer](https://github.com/acheong08/ios-location-spoofer)
核心逻辑移植到 Shadowrocket 模块的项目。

原项目使用 iOS PacketTunnel 和本地 Go MITM 代理。这个仓库改为使用
Shadowrocket 提供 VPN、HTTPS 解密和脚本执行能力，并用
`location-spoofer.js` 重写 ARPC/protobuf 解析与响应 patch 逻辑。

默认位置是美国 Apple Park：

```text
latitude: 37.3349
longitude: -122.00902
timezone: America/Los_Angeles
```

## 快速使用

在 Shadowrocket 中导入主模块：

```text
https://raw.githubusercontent.com/batqwq/shadowrocket-location-spoofer/main/ios-location-spoofer.sgmodule?v=20260619-cell-response3
```

然后按下面步骤配置：

1. 打开 Shadowrocket 的 HTTPS 解密。
2. 安装并完全信任 Shadowrocket 的 MITM 证书。
3. 只启用 `iOS Location Spoofer` 主模块，不要同时启用 probe 模块。
4. 断开并重新连接 Shadowrocket。
5. 在 iOS 设置中关闭定位服务，等待几秒后再打开。
6. 打开 Apple 地图或其他使用系统定位的应用测试。

模块会自动对下面两个域名启用 MITM：

```text
gs-loc.apple.com
gs-loc-cn.apple.com
```

## 当前实现

模块拦截 Apple Wi-Fi/蜂窝定位服务接口：

```text
/clls/wloc
```

它会修改 AppleWLoc protobuf 响应中的位置字段：

- Wi-Fi 结果：`wifi_devices`，protobuf field `2`
- 蜂窝基站结果：`cell_tower_response`，protobuf field `22`
- 经纬度编码：`coord * 1e8`
- 同步修改水平精度、垂直精度、海拔、运动类型和置信度
- 移除 `num_cell_results`、`num_wifi_results`、`device_type`，与原项目行为保持一致

模块不 hook CoreLocation，也不修改真实 GNSS/GPS 硬件数据。它只影响能够被
Shadowrocket HTTPS 解密并经过 Apple `/clls/wloc` 服务的定位流程。

## 文件说明

- `ios-location-spoofer.sgmodule`：默认 Shadowrocket 模块。
- `location-spoofer.js`：Shadowrocket 脚本，包含 ARPC/protobuf patch 逻辑。
- `location-spoofer-config.json`：默认配置示例。
- `ios-location-spoofer-response-probe.sgmodule`：响应体诊断模块。
- `ios-location-spoofer-request-only.sgmodule`：请求合成诊断模块。
- `test-location-spoofer.js`：本地 Node.js 测试。
- `NOTICE.md`：派生说明、原项目引用和授权说明。
- `LICENSE`：AGPL-3.0 许可证。

## 配置

默认配置如下：

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

发布的主模块把 Apple Park 坐标以内联参数传给脚本。`location-spoofer-config.json`
保留为可编辑示例，适合想自己托管远程配置的用户。

## 诊断模块

响应 probe：

```text
https://raw.githubusercontent.com/batqwq/shadowrocket-location-spoofer/main/ios-location-spoofer-response-probe.sgmodule?v=20260619-cell-probe1
```

请求合成诊断：

```text
https://raw.githubusercontent.com/batqwq/shadowrocket-location-spoofer/main/ios-location-spoofer-request-only.sgmodule?v=20260619-cell-request1
```

正常工作时，Shadowrocket 日志里应出现类似：

```text
Location spoofer response body: ... bytes
Location spoofer patched 2 wifi devices, 0 cell towers, kind=synthetic
```

如果在 LTE/蜂窝网络下测试，也可能出现：

```text
Location spoofer patched 0 wifi devices, 100+ cell towers, kind=synthetic
Location spoofer patched locations: firstCell=37.33490000,-122.00902000
```

这也是正常的，说明蜂窝基站结果已经被 patch。

## 常见问题

如果日志显示：

```text
Location spoofer response body too short: 0 bytes
```

说明 Shadowrocket 当前没有把二进制响应体暴露给脚本。请确认模块行里存在：

```text
requires-body=1,binary-body-mode=1,max-size=1048576
```

如果日志显示：

```text
Location spoofer patched 0 wifi devices, 0 cell towers
```

说明这次 Apple 响应里没有可用的 Wi-Fi 或蜂窝定位结果。重新打开定位服务后再测，
必要时导出 PacketTunnel 日志排查。

HTTP/2 本身不是问题。当前模块已经在 HTTP/1.1 和 HTTP/2 日志中验证过脚本匹配和
二进制响应体读取。

## 本地测试

```sh
node test-location-spoofer.js
```

预期输出：

```text
All location spoofer tests passed.
```

## 来源与授权

这是 [acheong08/ios-location-spoofer](https://github.com/acheong08/ios-location-spoofer)
的派生移植项目。原始逆向研究、Go MITM 实现和 protobuf 结构来自原项目。

本仓库遵循原项目的 AGPL-3.0 授权。重新分发或修改本项目时，请保留原作者署名、
本仓库修改说明、`NOTICE.md` 和 `LICENSE`。

本项目与 Apple、Shadowrocket 或原项目作者没有官方关联。
