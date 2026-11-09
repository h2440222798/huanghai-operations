# 校园小鸟模型（GLB）

本目录模型用于 `student/campus` 三维校园场景，运行时由 `GLTFLoader` 加载，按物种缩放后放置到湖面、河岸、草坪与树旁。

| 文件 | 模型 | 作者 | 许可 | 来源 |
| --- | --- | --- | --- | --- |
| `Gull.glb` | Flying gull | Poly by Google | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | https://poly.pizza/m/eMNhHDZakYp |
| `Sparrow.glb` | Sparrow | Poly by Google | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | https://poly.pizza/m/3rTjKefT184 |
| `Bluebird.glb` | Western bluebird | Poly by Google | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | https://poly.pizza/m/cdcl5UwlYWd |
| `Eagle.glb` | Eagle | Robert Mirabelle | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | https://poly.pizza/m/1Z5L1v0bfu7 |
| `Stork.glb` | Stork | three.js examples | [MIT（three.js）](https://github.com/mrdoob/three.js/blob/dev/LICENSE) | https://threejs.org/examples/models/gltf/Stork.glb |

修改说明：

- 模型仅做等比缩放、朝向调整和材质 `DoubleSide` 处理，未修改几何体。
- `Gull.glb` 是静态展翅模型，项目在材质 `onBeforeCompile` 中注入了一个很小的顶点位移，让翅膀上下扇动。
- `Sparrow.glb` / `Bluebird.glb` 作为站立小鸟放在草坪、花钵与长椅附近，做轻微转头与跳动。
- `Eagle.glb` 在高空大半径盘旋。
- `Stork.glb` 播放模型自带的变形目标动画（`weights` 通道）低空飞行。
- CC BY 3.0 模型在页面的「帮助 / 技术说明」中署名；如再分发请保留本文件与署名。
