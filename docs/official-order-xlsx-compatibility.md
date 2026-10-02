# 官方订单 Excel 导入兼容修复

知乎邮件导出的部分 `.xlsx` 在旧报表导入和报告归因入口被误报为非法文件。文件未损坏，问题有两处：

- ZIP 使用流式写入（通用标志 bit 3），本地文件头的 CRC/长度为零，真实值写在数据描述符和中央目录中。
- 工作表引用使用 `relationships:id`，并在工作表元素上声明命名空间。原校验固定读取 `r:id`。

校验现在按记录边界验证有签名/无签名的数据描述符，并比对中央目录、已填写的本地头以及实际解压后的 CRC/长度；工作表引用按有效作用域内的命名空间 URI 解析。仍然拒绝加密、ZIP64、路径逃逸、异常压缩比、外部关系、活动内容及不一致的结构。此修改不改变报表的归因和入账规则。

格式依据：[PKWARE APPNOTE 4.3.9](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)、[W3C XML 命名空间](https://www.w3.org/TR/xml-names/)。

## 验证

在 `server` 目录运行：

```sh
npx vitest run tests/unit/alliance-xlsx.spec.ts tests/unit/data-import.spec.ts tests/attribution/feedback-report.spec.ts tests/unit/relay-import.spec.ts tests/routes/data-import-streamed.test.ts
npm run build
```

42 项测试通过，覆盖两种描述符布局、混合条目、不同中央目录顺序、损坏/越界结构、命名空间作用域、邮件附件和手动 Excel 的真实 multipart 路由。HTTP 测试使用隔离身份与内存预览，不写业务数据库。

用户提供的原文件另行只读核验：5,486 字节，SHA-256 `22efaf65dfa3cc01fd0a02011ef1c3d0ad5464bd2aaab19ab27edcbfc35826eb`，新旧解析器均得到 1 条有效订单记录、0 条错误。原文件及其中的业务数据未加入仓库。

补充回归检查中的历史联盟路由套件 `alliance.test.ts` / `alliance-proxy.spec.ts` 有 28 项既有失败（主要在认证阶段返回 401），以修改前的校验器复跑得到相同的 28 项失败、6 项通过。它们不是本次修复引入，也未通过修改认证逻辑规避。
