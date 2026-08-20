import { describe, expect, it } from "vitest";
import { ZhihuOpenApiClient } from "./zhihuOpenApi";

const accessToken = process.env.ZHIHU_OPEN_API_ACCESS_TOKEN ?? "";
const secretKey = process.env.ZHIHU_OPEN_API_SECRET_KEY ?? "";
const channelId = process.env.ZHIHU_OPEN_API_CHANNEL_ID ?? "2067662706400834870";
const taskId = process.env.ZHIHU_OPEN_API_TASK_ID ?? "1443567656205545472";

describe.runIf(process.env.RUN_ZHIHU_OPEN_API_INTEGRATION === "true")("知乎开放平台开发者凭据", () => {
  it("可读取渠道并用签名读取指定渠道任务，从而验证凭据与任务映射", async () => {
    expect(accessToken).not.toHaveLength(0);
    expect(secretKey).not.toHaveLength(0);

    const client = new ZhihuOpenApiClient({ accessToken, secretKey });
    const channels = await client.getAgentChannels();
    expect(channels.some(channel => channel.channel_id === channelId)).toBe(true);

    const tasks = await client.getPromotionTasks(channelId, 0, 100);
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.some(task => task.id === taskId)).toBe(true);

  }, 20_000);
});
