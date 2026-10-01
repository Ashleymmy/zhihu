const screen = require("../../utils/screen");
const request = require("../../utils/request");
const feedback = require("../../utils/feedback");

Page(
  screen("invite", {
    scoped: false,
    data: {
      code: "",
      usageCount: 0,
      records: [],
      posterOpen: false,
      posterUrl: "",
    },
    async fetch({ scope }) {
      const [me, rewards] = await Promise.all([
        request.get("/modules/zhihu/invite/me", scope),
        request.get("/modules/zhihu/invite/rewards", scope),
      ]);
      return {
        code: me.code || "",
        usageCount: me.usageCount || 0,
        records: (rewards.records || []).map((r) =>
          Object.assign({}, r, {
            timeText: String(r.time || "").slice(0, 10),
          }),
        ),
      };
    },
    copyCode() {
      if (!this.data.code) return;
      wx.setClipboardData({ data: this.data.code });
      feedback.haptic("light");
    },
    // 转发分享：携带邀请码，好友打开后注册页自动预填
    onShareAppMessage() {
      return {
        title: "邀请你加入 TIMO 推广平台",
        path: "/pages/register/index?code=" + (this.data.code || ""),
      };
    },
    // 生成分享海报（品牌绿卡 + 邀请码），可保存到相册。
    // 邀请码本身就是给人看的，海报不隐藏它；防自邀由服务端「不能使用自己的邀请码」拦截。
    async makePoster() {
      if (!this.data.code || this.data.busy) return;
      this.setData({ busy: true, error: "" });
      try {
        const node = await new Promise((resolve, reject) =>
          wx.createSelectorQuery()
            .in(this)
            .select("#posterCanvas")
            .fields({ node: true })
            .exec((res) =>
              res && res[0] && res[0].node
                ? resolve(res[0].node)
                : reject(new Error("海报初始化失败，请重试")),
            ),
        );
        const W = 750;
        const H = 1180;
        const dpr = 2;
        node.width = W * dpr;
        node.height = H * dpr;
        const ctx = node.getContext("2d");
        ctx.scale(dpr, dpr);
        // 品牌绿渐变底 + 装饰圆
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, "#17352e");
        g.addColorStop(0.55, "#214239");
        g.addColorStop(1, "#2f6b52");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "rgba(255,255,255,0.07)";
        ctx.beginPath();
        ctx.arc(W - 90, 130, 190, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(80, H - 160, 150, 0, Math.PI * 2);
        ctx.fill();
        // logo 与品牌
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        ctx.beginPath();
        ctx.arc(W / 2, 180, 76, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 60px sans-serif";
        ctx.fillText("T", W / 2, 186);
        ctx.font = "bold 46px sans-serif";
        ctx.fillText("TIMO", W / 2, 320);
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.font = "26px sans-serif";
        ctx.fillText("多渠道 OPC 业务平台", W / 2, 368);
        // 主文案
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 46px sans-serif";
        ctx.fillText("邀请你一起赚推广收益", W / 2, 540);
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.font = "27px sans-serif";
        ctx.fillText(
          "注册时填写邀请码，自动绑定邀请归属",
          W / 2,
          596,
        );
        // 邀请码白卡
        const card = { x: 75, y: 680, w: W - 150, h: 240, r: 30 };
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(card.x + card.r, card.y);
        ctx.arcTo(card.x + card.w, card.y, card.x + card.w, card.y + card.h, card.r);
        ctx.arcTo(card.x + card.w, card.y + card.h, card.x, card.y + card.h, card.r);
        ctx.arcTo(card.x, card.y + card.h, card.x, card.y, card.r);
        ctx.arcTo(card.x, card.y, card.x + card.w, card.y, card.r);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#7c8883";
        ctx.font = "26px sans-serif";
        ctx.fillText("我的邀请码", W / 2, card.y + 62);
        ctx.fillStyle = "#214239";
        ctx.font = "bold 72px monospace";
        ctx.fillText(this.data.code.split("").join(" "), W / 2, card.y + 165);
        // 底部指引
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.font = "24px sans-serif";
        ctx.fillText("微信搜索「TIMO」小程序，注册页填写邀请码", W / 2, H - 80);
        const url = await new Promise((resolve, reject) =>
          wx.canvasToTempFilePath({
            canvas: node,
            success: (r) => resolve(r.tempFilePath),
            fail: reject,
          }),
        );
        this.setData({ posterUrl: url, posterOpen: true });
      } catch (error) {
        feedback.fail(
          (error && (error.errMsg || error.message)) || "海报生成失败，请重试",
        );
      } finally {
        this.setData({ busy: false });
      }
    },
    closePoster() {
      this.setData({ posterOpen: false });
    },
    savePoster() {
      if (!this.data.posterUrl) return;
      wx.saveImageToPhotosAlbum({
        filePath: this.data.posterUrl,
        success: () => feedback.success("已保存到相册"),
        fail: (error) => {
          if (/auth|deny|scope/i.test(error.errMsg || ""))
            wx.showModal({
              title: "需要相册权限",
              content: "请在设置中允许保存图片到相册",
              confirmText: "去设置",
              success: (r) => {
                if (r.confirm) wx.openSetting();
              },
            });
          else feedback.fail("保存失败，请重试");
        },
      });
    },
  }),
);
